import { parse as secureJsonParse } from 'secure-json-parse';
import type { ChatMessage, ChatMessageImage, OutilExpose, ReponseChat } from '../llm/chat-client';
import type { IssueImportEntretien } from '../connaissance';
import {
  MESSAGE_PLAFOND, reserverBudget, solderReservation, type BudgetAssistantDeps,
} from '../../assistant/budget';
import { direPanneModele } from '../../llm/errors';
import { journaliser } from '../../lib/journal';
import { avancementEntretien, type AvancementEntretien } from './avancement';
import { construireMessages, inventaireDe, type ContexteConstruction } from './conversation';
import {
  accordDonneesClient, actionChoisie, basculesDuTour, CODE_DONNEES_CLIENT, fusionner, fusionnerBascules, momentDuPoint,
  momentsDesReponses, outilLireFiche, poseUneQuestion, prochainPoint, questionDeRelance, questionOuiOuNonMontree,
  reponseOuiOuNon, sansSesQuestions, annonceUneFin, PAS_ENCORE_FINI, annonceUnChangement, RIEN_A_ENREGISTRER, HANDLER_PASSER_LA_MAIN, outilPasserLaMain,
  urlDeConnaissance,
} from './couverture';
import { outilMaison } from '../outils-maison';
import {
  bornerPourModele, ENTRETIEN_VIERGE, MAX_BASCULES, type EntretienComplet, type EntretienStore, type TourEntretien,
} from './entretien-store';
import { rendreProposition, type PropositionEnAttente } from './en-attente';
import { blocDeFin } from './fin';
import {
  assainirProposition, BORNES_PROPOSITION, neProposeRien, propositionSchema, OUTIL_PROPOSER, SCHEMA_PROPOSITION,
  type Changement, type Proposition,
} from './proposition';
import {
  MOYEN_DECRIT_PAR_LE_CLIENT, scenarioDuMoyen, scenariosAPoser, scenariosDesMoments,
  type ScenarioAPoser, type ScenarioEnLigne,
} from './scenarios';

const DELAI_MS = 45_000;

export interface CommandeTourEntretien {
  tenantId: string;
  agentId: string;
  auteurId: string | null;
  /** Message déjà validé et borné par l'adaptateur HTTP. */
  message: string;
  /** Instantané déjà chargé sous le tenant authentifié ; le module ne le mute pas. */
  contexte: Readonly<ContexteConstruction>;
}

export interface PropositionAffichee {
  fiche: NonNullable<Proposition['fiche']>;
  outils: NonNullable<Proposition['outils']>;
  connecteurs: NonNullable<Proposition['connecteurs']>;
  outilsBranches: string[];
  outilsDebranches: string[];
  scenarios?: ScenarioAPoser[];
  /**
   * Les outils que l'enregistrement ACTIVE (la lecture de la fiche posée sur un oui, \`outilLireFiche\`), par handler.
   * Décidé par le serveur, jamais par le modèle ; leur ligne \`outil.<handler>.actif\` du diff se garde ou se jette.
   */
  outilsAActiver?: string[];
}

export interface ReponseTourEntretien {
  message: string;
  couverture: AvancementEntretien;
  proposition: PropositionAffichee;
  changements: Changement[];
  usage: { tokensIn: number; tokensOut: number };
}

export interface ReponseBudgetEpuise extends ReponseTourEntretien {
  budgetEpuise: true;
  ongletsUtilisables: true;
}

export type ResultatTourEntretien =
  | { issue: 'repondu'; reponse: ReponseTourEntretien }
  | { issue: 'budget_epuise'; reponse: ReponseBudgetEpuise }
  | { issue: 'assistant_indisponible' }
  | { issue: 'modele_en_panne'; raison: string }
  | { issue: 'proposition_absente' }
  | { issue: 'proposition_illisible' }
  | { issue: 'proposition_hors_format' };

export interface TourEntretienDeps extends BudgetAssistantDeps {
  /** La mémoire du fil. L'écriture ne porte jamais l'état de l'agent lui-même. */
  entretiens: Pick<EntretienStore, 'lire' | 'ecrire'>;
  /** Scénarios réellement en ligne, seuls choix que le tour peut proposer. */
  scenariosEnLigne(tenantId: string): Promise<ScenarioEnLigne[]>;
  /** Import détaché de l'adresse retenue ; le module ne le lance qu'après la persistance. */
  importerSiteDeLEntretien(tenantId: string, agentId: string, url: string): Promise<IssueImportEntretien>;
  completer?(input: {
    tenantId: string;
    modele: string;
    messages: Array<ChatMessage | ChatMessageImage>;
    outils: OutilExpose[];
    toolChoice: string;
    signal: AbortSignal;
  }): Promise<ReponseChat>;
  modele: string;
}

export interface TourEntretienAgent {
  /** Préserve la priorité du 503 actuel sur la validation du corps HTTP. */
  readonly indisponibilite: 'modele_non_configure' | null;
  executer(commande: CommandeTourEntretien): Promise<ResultatTourEntretien>;
}

const propositionVide = (): PropositionAffichee => ({
  fiche: {}, outils: [], connecteurs: [], outilsBranches: [], outilsDebranches: [],
});

/**
 * Possède le cycle complet d'un message de l'entretien. L'adaptateur appelant ne choisit ni l'ordre des
 * lectures et écritures, ni le moment des appels modèle, de la comptabilisation ou de l'import du site.
 */
export function creerTourEntretien(deps: TourEntretienDeps): TourEntretienAgent {
  const indisponibilite = !deps.completer || deps.modele.trim() === '' ? 'modele_non_configure' : null;
  const appelerProposition = (tenantId: string, messages: Array<ChatMessage | ChatMessageImage>) => deps.completer!({
    tenantId,
    modele: deps.modele,
    messages,
    outils: [{
      name: OUTIL_PROPOSER,
      description: 'Rends ta réponse et, si tu en as une, ta proposition de réglage.',
      parameters: SCHEMA_PROPOSITION,
    }],
    toolChoice: OUTIL_PROPOSER,
    signal: AbortSignal.timeout(DELAI_MS),
  });

  /**
   * La seconde demande d'un tour de réparation : budget réservé puis soldé comme la synthèse. Une panne attendue du
   * fournisseur ou une sortie illisible rend `null` (le message sera remplacé) ; une panne interne remonte.
   */
  const redemanderLaProposition = async (
    tenantId: string, agentId: string, messages: ChatMessage[],
  ): Promise<{ proposition: Proposition; usage: { tokensIn: number; tokensOut: number } } | null> => {
    const reservation = await reserverBudget(deps, tenantId);
    if (!reservation) return null;
    let seconde: ReponseChat;
    try {
      seconde = await appelerProposition(tenantId, messages);
    } catch (err) {
      await solderReservation(deps, tenantId, reservation, 0);
      if (direPanneModele(err) === null) throw err;
      journaliser('warn', 'agent_setup_reparation_echec', { tenantId, agentId, err });
      return null;
    }
    await solderReservation(deps, tenantId, reservation, seconde.usage.coutDollars);
    const usage = { tokensIn: seconde.usage.tokensIn, tokensOut: seconde.usage.tokensOut };
    const appel = seconde.appelsOutils.find((a) => a.nom === OUTIL_PROPOSER);
    let brut: unknown;
    try {
      brut = appel ? secureJsonParse(appel.argumentsJson) : undefined;
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
    }
    const lue = brut === undefined ? null : propositionSchema.safeParse(assainirProposition(brut));
    if (!lue?.success) {
      journaliser('warn', 'agent_setup_reparation_echec', { tenantId, agentId, err: 'proposition illisible' });
      return null;
    }
    return { proposition: lue.data, usage };
  };

  return {
    indisponibilite,
    async executer(commande): Promise<ResultatTourEntretien> {
      if (indisponibilite || !deps.completer) return { issue: 'assistant_indisponible' };

      const contexte: ContexteConstruction = {
        ...commande.contexte,
        scenarios: await deps.scenariosEnLigne(commande.tenantId),
      };
      const avant = (await deps.entretiens.lire(commande.tenantId, commande.agentId)) ?? ENTRETIEN_VIERGE;
      // Le fil complet est conservé ; seule sa copie destinée au modèle est bornée.
      const filComplet: TourEntretien[] = [...avant.messages, { role: 'user', content: commande.message }];
      const auteursComplets: Array<string | null> = [...avant.auteurs, commande.auteurId];
      const historique = bornerPourModele(filComplet);
      const pointDuTour = prochainPoint(avant, inventaireDe(contexte));

      const reservation = await reserverBudget(deps, commande.tenantId);
      if (!reservation) {
        return {
          issue: 'budget_epuise',
          reponse: {
            message: MESSAGE_PLAFOND,
            couverture: avancementEntretien(avant, contexte),
            proposition: propositionVide(),
            changements: [],
            budgetEpuise: true,
            ongletsUtilisables: true,
            usage: { tokensIn: 0, tokensOut: 0 },
          },
        };
      }

      let reponse: ReponseChat;
      try {
        reponse = await appelerProposition(
          commande.tenantId,
          construireMessages(contexte, historique, avant),
        );
      } catch (err) {
        // Rien de lisible n'a été rendu : la réservation est rendue avant toute sortie, relance comprise.
        await solderReservation(deps, commande.tenantId, reservation, 0);
        const raison = direPanneModele(err);
        if (raison === null) throw err;
        journaliser('error', 'agent_setup_tour_echec', { tenantId: commande.tenantId, err });
        return { issue: 'modele_en_panne', raison };
      }

      // L'appel est payé même si sa sortie est ensuite absente ou invalide.
      await solderReservation(deps, commande.tenantId, reservation, reponse.usage.coutDollars);
      const appel = reponse.appelsOutils.find((a) => a.nom === OUTIL_PROPOSER);
      if (!appel) return { issue: 'proposition_absente' };

      let brut: unknown;
      try {
        brut = secureJsonParse(appel.argumentsJson);
      } catch {
        return { issue: 'proposition_illisible' };
      }
      const propose = propositionSchema.safeParse(assainirProposition(brut));
      if (!propose.success) {
        journaliser('warn', 'agent_setup_proposition_hors_schema', {
          tenantId: commande.tenantId,
          agentId: commande.agentId,
          champs: propose.error.issues.map((i) => `${i.path.join('.') || '(racine)'}:${i.code}`),
        });
        return { issue: 'proposition_hors_format' };
      }

      /**
       * 🔴 UN CHANGEMENT ANNONCÉ SE PROPOSE (Maison Saint-Honoré, 2026-11-25). Agent complet, le client demande une
       * correction, le modèle répond « Je corrige : … » avec une proposition VIDE : rien à enregistrer, et le client croit
       * l'agent corrigé. Le serveur redemande UNE fois la proposition (contrat : `consigneDeReparation`, journalisée) ;
       * s'il n'en vient toujours aucune, le message est remplacé plus bas (`RIEN_A_ENREGISTRER`), jamais laissé mentir.
       */
      const enEvolution = avancementEntretien(avant, contexte).manquants.length === 0;
      let lu: Proposition = propose.data;
      let usageReparation = { tokensIn: 0, tokensOut: 0 };
      if (enEvolution && neProposeRien(lu) && annonceUnChangement(lu.message)) {
        journaliser('warn', 'agent_setup_reparation', { tenantId: commande.tenantId, agentId: commande.agentId });
        const reparee = await redemanderLaProposition(commande.tenantId, commande.agentId,
          construireMessages(contexte, historique, avant, { reparation: lu.message }));
        if (reparee) {
          usageReparation = reparee.usage;
          if (!neProposeRien(reparee.proposition)) lu = reparee.proposition;
        }
      }

      /**
       * 🔴 LE POINT DES DONNÉES DE LA FICHE N'A QU'UN JUGE, LE SERVEUR. Le oui ou le non se lit dans le message du CLIENT,
       * sans le modèle (comme `actionChoisie`), et seulement si la dernière question de l'assistant portait la marque
       * (`MARQUE_OUI_OU_NON`) : un « ok merci » après « C'est enregistré » n'est pas un oui à une question jamais posée.
       * Ce que le modèle range pour ce point est IGNORÉ : il couvrirait le point sans qu'aucun outil ne suive. Sans
       * réponse lisible, le point reste ouvert, et la question revient. La réponse se cherche dans TOUT le message
       * (`reponseOuiOuNon`) : le client recopie la question avant d'y répondre, ou répond à deux questions d'un coup.
       */
      const derniereQuestion = [...avant.messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
      const accordLu = pointDuTour?.code === CODE_DONNEES_CLIENT && questionOuiOuNonMontree(derniereQuestion)
        ? reponseOuiOuNon(commande.message) : null;
      const reponses = fusionner(avant.reponses, [
        ...lu.reponses.filter((r) => r.point !== CODE_DONNEES_CLIENT),
        ...(accordLu ? [{ point: CODE_DONNEES_CLIENT, valeur: accordLu }] : []),
      ]);
      // Le modèle range parfois les moments dans les réponses. On ne les reprend qu'au tour qui les demande,
      // et seulement si aucune liste n'existe encore, sinon une reformulation ferait naître des doublons.
      const reprendreDesReponses = pointDuTour?.collecteDesMoments === true
        && (lu.bascules ?? []).length === 0 && (avant.bascules ?? []).length === 0;
      const basculesProposees = reprendreDesReponses
        ? momentsDesReponses(lu.reponses)
        : basculesDuTour(avant.bascules ?? [], lu.bascules ?? [], pointDuTour);
      // Plafonnée À L'ÉCRITURE comme à la relecture (`MAX_BASCULES`) : une liste plus longue que ce que la relecture
      // accepte ferait annoncer au client des moments qui disparaîtraient au tour suivant.
      const listeBascules = fusionnerBascules(avant.bascules ?? [], basculesProposees).slice(0, MAX_BASCULES);

      const vise = momentDuPoint(pointDuTour?.code);
      const momentVise = vise?.quoi === 'action' ? listeBascules[vise.index] : undefined;
      if (momentVise && !momentVise.action) {
        // Le numéro se lit dans la liste que le client a VUE : le dernier message de l'assistant, que la liste soit
        // celle du modèle ou celle du serveur.
        const vue = [...avant.messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
        const choisie = actionChoisie(commande.message, vue);
        if (choisie) momentVise.action = choisie;
      }

      const scenariosEnLigne = contexte.scenarios ?? [];
      const nomme = scenarioDuMoyen(commande.message, scenariosEnLigne);
      const reconnu = (moyen: string | undefined) => (moyen ? scenarioDuMoyen(moyen, scenariosEnLigne) : null);
      const sansScenario = listeBascules.filter((b) => b.action === 'scenario' && reconnu(b.moyen) === null);
      // Le nom exact vient du message du client : une paraphrase du modèle ne doit pas changer le scénario retenu.
      listeBascules.forEach((b, i) => {
        if (b.action !== 'scenario') return;
        const ancien = (avant.bascules ?? [])[i];
        const prisDuModele = reconnu(b.moyen);
        const pourCeMoment = vise?.index === i
          || (nomme !== null && prisDuModele?.id === nomme.id)
          || (sansScenario.length === 1 && sansScenario[0] === b && Boolean(b.moyen?.trim())
            && b.moyen !== ancien?.moyen && reconnu(ancien?.moyen) === null);
        if (nomme && pourCeMoment) {
          b.moyen = nomme.nom;
          return;
        }
        if (ancien?.moyen && b.moyen !== ancien.moyen && reconnu(ancien.moyen)) b.moyen = ancien.moyen;
      });

      const momentDuMoyen = vise?.quoi === 'moyen' ? listeBascules[vise.index] : undefined;
      // Au second passage, une description libre ferme le point sans devenir un faux nom de scénario.
      if (momentDuMoyen && !momentDuMoyen.moyen?.trim() && pointDuTour && avant.poses.includes(pointDuTour.code)) {
        momentDuMoyen.moyen = MOYEN_DECRIT_PAR_LE_CLIENT;
      }
      const poses = pointDuTour && !avant.poses.includes(pointDuTour.code)
        ? [...avant.poses, pointDuTour.code]
        : avant.poses;

      const ouvertApres = prochainPoint({ poses, reponses, bascules: listeBascules }, inventaireDe(contexte));
      /**
       * 🔴 LE POINT DES DONNÉES DE LA FICHE, C'EST LE SERVEUR QUI LE POSE, SEUL dans son message. Tant que le oui ou le non
       * n'est pas lu, sa question (qui porte la marque) remplace celles du modèle, dont il ne garde que l'accusé de
       * réception (`sansSesQuestions`). Avant le 2026-11-24, elle s'AJOUTAIT à la question du modèle : chez Maison
       * Saint-Honoré, des messages à deux questions, le client répondait à l'autre, et l'entretien ne finissait jamais.
       */
      const forcerLaMarque = ouvertApres?.code === CODE_DONNEES_CLIENT && accordLu === null;
      /**
       * 🔴 « VOTRE AGENT EST PRÊT » PENDANT L'ENTRETIEN EST FAUX : le modèle ne sait pas ce que le serveur attend encore.
       * Son message part entier et la question du serveur prend sa place (Maison Saint-Honoré, 2026-11-24 : deux
       * « Votre agent est prêt ! 🎉 » de suite, sans proposition ni bouton pour l'activer).
       */
      const finPrematuree = ouvertApres !== null && annonceUneFin(lu.message);
      const relance = ouvertApres && (!poseUneQuestion(lu.message) || forcerLaMarque || finPrematuree)
        ? ouvertApres : null;
      const posesApres = relance && !poses.includes(relance.code) ? [...poses, relance.code] : poses;
      const etatApres: EntretienComplet = {
        messages: filComplet,
        auteurs: auteursComplets,
        reponses,
        bascules: listeBascules,
        poses: posesApres,
      };
      const suivi = avancementEntretien(etatApres, contexte);
      const enEntretien = suivi.manquants.length > 0;

      let propositionFinale = lu;
      const avantRelance = finPrematuree ? PAS_ENCORE_FINI
        : forcerLaMarque ? sansSesQuestions(lu.message) : lu.message;
      let message = relance
        ? [avantRelance, questionDeRelance(relance, etatApres)].filter(Boolean).join('\n\n')
        : lu.message;
      let tokensIn = reponse.usage.tokensIn + usageReparation.tokensIn;
      let tokensOut = reponse.usage.tokensOut + usageReparation.tokensOut;
      const vientDeFinir = !enEntretien && avancementEntretien(avant, contexte).manquants.length > 0;

      // La synthèse ne tourne que sur la transition vers « couvert ». Une panne attendue du fournisseur ou une
      // sortie invalide garde la première proposition ; une panne interne de budget ou de stockage remonte.
      const reservationSynthese = vientDeFinir ? await reserverBudget(deps, commande.tenantId) : null;
      if (reservationSynthese) {
        let seconde: ReponseChat | null = null;
        try {
          seconde = await appelerProposition(
            commande.tenantId,
            construireMessages(contexte, historique, etatApres, { synthese: true }),
          );
        } catch (err) {
          await solderReservation(deps, commande.tenantId, reservationSynthese, 0);
          const raison = direPanneModele(err);
          if (raison === null) throw err;
          journaliser('warn', 'agent_setup_synthese_echec', { tenantId: commande.tenantId, agentId: commande.agentId, err });
        }

        if (seconde) {
          await solderReservation(deps, commande.tenantId, reservationSynthese, seconde.usage.coutDollars);
          tokensIn += seconde.usage.tokensIn;
          tokensOut += seconde.usage.tokensOut;
          const appelSynthese = seconde.appelsOutils.find((a) => a.nom === OUTIL_PROPOSER);
          if (appelSynthese) {
            let brutSynthese: unknown;
            try {
              brutSynthese = secureJsonParse(appelSynthese.argumentsJson);
            } catch (err) {
              if (!(err instanceof SyntaxError)) throw err;
              journaliser('warn', 'agent_setup_synthese_echec', {
                tenantId: commande.tenantId, agentId: commande.agentId, err: err.name,
              });
            }
            if (brutSynthese !== undefined) {
              const proposeSynthese = propositionSchema.safeParse(assainirProposition(brutSynthese));
              if (proposeSynthese.success) {
                propositionFinale = proposeSynthese.data;
                message = proposeSynthese.data.message;
              } else {
                journaliser('warn', 'agent_setup_synthese_hors_schema', {
                  tenantId: commande.tenantId,
                  agentId: commande.agentId,
                  champs: proposeSynthese.error.issues.map((i) => `${i.path.join('.') || '(racine)'}:${i.code}`),
                });
              }
            }
          }
        }
      }

      const adresseRetenue = propositionFinale.connaissanceUrl ?? avant.connaissanceUrl;
      const importLance = Boolean(adresseRetenue && adresseRetenue !== avant.connaissanceUrl);
      if (adresseRetenue && importLance) {
        message = `${message}\n\nJ’importe les pages de ${adresseRetenue} dans votre base de connaissance : elles seront `
          + 'dans l’onglet « Base de connaissance » d’ici une minute, à relire et corriger si besoin.';
      }

      const vises = new Set(contexte.outils.flatMap((o) => (
        o.handler === 'lancer_scenario' && o.workflowId ? [o.workflowId] : []
      )));
      const desMoments = enEntretien ? [] : scenariosDesMoments(listeBascules, contexte.scenarios ?? [], vises);
      const aPoser = scenariosAPoser(desMoments);
      /**
       * 🔴 SUR UN OUI, LE SERVEUR POSE LA LECTURE DE LA FICHE, AVEC SES MOTS, ET LA FAIT ACTIVER À L'ENREGISTREMENT (décision
       * de Julien du 2026-11-23 : « poser des questions si ce n'est pas suivi de la mise en place d'un outil, ça ne sert à
       * rien »). Laissé au modèle, un oui pouvait finir sans outil, ou avec un outil inactif et muet sur où regarder.
       * Ce que le modèle aurait proposé pour le même outil est remplacé : la carte du serveur dit ce qui est branché.
       */
      const outilFiche = enEntretien || accordDonneesClient(reponses) !== 'oui' ? null : outilLireFiche(inventaireDe(contexte));
      if (outilFiche) {
        propositionFinale = {
          ...propositionFinale,
          outils: [...(propositionFinale.outils ?? []).filter((o) => o.handler !== outilFiche.handler), outilFiche],
        };
      }
      /**
       * 🔴 LA RÈGLE DE TRANSFERT DEVIENT L'OUTIL « Passer la main » (2026-11-25, décision de Julien) : le prompt ne lit
       * plus `reglesTransfert`. Ce que le modèle écrit pour ce champ quitte la fiche proposée et devient la description
       * de l'outil, posé et activé à l'enregistrement ; une règle « jamais » ne pose rien.
       */
      const regleTransfert = propositionFinale.fiche?.reglesTransfert;
      if (regleTransfert !== undefined) {
        const { reglesTransfert: _t, ...ficheSansTransfert } = propositionFinale.fiche ?? {};
        propositionFinale = { ...propositionFinale, fiche: ficheSansTransfert };
      }
      const modeleTransfert = outilMaison(HANDLER_PASSER_LA_MAIN);
      // Un agent qui qualifie avant de transférer (`qualifier_transferer` actif, camp « qualification ») ne peut pas avoir
      // « Passer la main » actif (`src/agent/camp.ts`) : le proposer ferait échouer l'enregistrement sur un refus.
      const qualifieDeja = contexte.outils.some((o) => o.handler === 'qualifier_transferer' && o.actif === true);
      const outilTransfert = enEntretien || !modeleTransfert || qualifieDeja ? null : outilPasserLaMain(
        regleTransfert,
        contexte.outils.find((o) => o.handler === HANDLER_PASSER_LA_MAIN),
        modeleTransfert.nePasUtiliser.fr,
        BORNES_PROPOSITION.description,
      );
      if (outilTransfert) {
        propositionFinale = {
          ...propositionFinale,
          outils: [...(propositionFinale.outils ?? []).filter((o) => o.handler !== outilTransfert.handler), outilTransfert],
        };
      }
      const outilsAActiver = [
        ...(outilFiche ? [outilFiche.handler] : []),
        ...(outilTransfert ? [outilTransfert.handler] : []),
      ];
      const { reponses: _r, bascules: _b, ...retenue } = propositionFinale;
      const rendue = rendreProposition(contexte, retenue, aPoser, outilsAActiver);
      const changements = enEntretien ? [] : rendue.changements;
      if (enEvolution && changements.length === 0 && !importLance && annonceUnChangement(message)) {
        journaliser('warn', 'agent_setup_changement_sans_proposition', {
          tenantId: commande.tenantId, agentId: commande.agentId,
        });
        message = RIEN_A_ENREGISTRER;
      }

      if (vientDeFinir) {
        const inventaire = inventaireDe(contexte);
        message = `${message}\n\n${blocDeFin({
          aAppliquer: changements.length > 0,
          connaissanceUrl: propositionFinale.connaissanceUrl ?? avant.connaissanceUrl ?? urlDeConnaissance(etatApres),
          fichesDeConnaissance: contexte.titresConnaissance.length,
          bascules: listeBascules,
          outilsApi: inventaire.outilsApi.length,
          outilsMcp: inventaire.outilsMcp.length,
          modele: contexte.modele ?? null,
          importEnCours: importLance,
          scenarios: desMoments,
        })}`;
      }

      const apres: EntretienComplet = {
        messages: [...filComplet, { role: 'assistant', content: message }],
        auteurs: [...auteursComplets, null],
        reponses,
        bascules: listeBascules,
        poses: posesApres,
        ...(adresseRetenue ? { connaissanceUrl: adresseRetenue } : {}),
        // La proposition reste lisible après ce tour (`en-attente.ts`) ; un tour sans proposition garde la précédente.
        ...(changements.length > 0
          ? { enAttente: { proposition: retenue, scenarios: aPoser, outilsAActiver } satisfies PropositionEnAttente }
          : avant.enAttente === undefined ? {} : { enAttente: avant.enAttente }),
      };
      // L'annonce d'import n'est vraie que pour un tour effectivement conservé.
      await deps.entretiens.ecrire(commande.tenantId, commande.agentId, apres);

      if (adresseRetenue && importLance) {
        void deps.importerSiteDeLEntretien(commande.tenantId, commande.agentId, adresseRetenue)
          .then((r) => journaliser(r.issue === 'refuse' ? 'warn' : 'info', 'agent_setup_import_site', {
            tenantId: commande.tenantId, agentId: commande.agentId, ...r,
          }))
          .catch((err) => journaliser('error', 'agent_setup_import_site_echec', {
            tenantId: commande.tenantId, agentId: commande.agentId, err,
          }));
      }

      return {
        issue: 'repondu',
        reponse: {
          message,
          couverture: suivi,
          proposition: enEntretien ? propositionVide() : rendue.proposition,
          changements,
          usage: { tokensIn, tokensOut },
        },
      };
    },
  };
}
