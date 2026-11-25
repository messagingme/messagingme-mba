import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import {
  MAX_REPONSES_RAPIDES, MAX_TEXTE_REPONSE_RAPIDE, TEXTE_MAX_AVEC_FICHIER_OU_BOUTON, TEXTE_MAX_SIMPLE,
} from '../../web/lib/partage/message-rapide';
import type { AnnotationsMcp, OutilMcp, ProprieteEntree } from './outils';
import { RefusOutil, entierBorne, refusDuCoeur, texteObligatoire } from './saisie';
import { newTestToken, waMeTestLink } from '../workflow/test-token';
import { PARCOURS_MAX, PASSAGES_MAX, type LecteurDeroule } from '../workflow/deroule.pg';
import type { PgErreursLivraisonStore } from '../ops/erreurs-livraison.pg';
import { waIdOf } from '../crm/identity';
import { e164DepuisSaisie } from '../crm/phone';
import { ecriture, signataire } from './outils-agent';
import { envoyerAUnePersonne } from './outils-modeles';
import { VALEUR_ACCEPTEE } from '../api/modele-envoi';
import { CLE_IDEMPOTENCE_MAX } from '../api/idempotence';
import { MAX_NODES } from '../workflow/graph';
import { SORTIE_MAX, simulerParcours, type ContactFictif, type ReponseSimulee } from '../workflow/simulation';
import { ECRANS, LISTES, lire } from './ecran';
import {
  BOUTON_MENU_MAX, DESCRIPTION_LIGNE_MAX, ECHEANCE_MAX_JOURS, ETIQUETTE_MAX, LIGNES_MENU_MAX, LISTE_OPERATION_MAX,
  LONGUEUR_CHAMP_MAX, LONGUEUR_URL_FICHIER_MAX, MAX_BOUTONS_TEMPLATE, MAX_FICHIERS_RECETTE, MAX_TEXTE_BOUTON_TEMPLATE, NOM_SCENARIO_MAX,
  OPERATIONS_MAX, PROFONDEUR_MAX_RECETTE, TEXTE_QUESTION_MAX, TITRE_LIGNE_MAX, UNITES_ECHEANCE, VALEUR_CHAMP_RECETTE_MAX,
} from '../workflow/recette';
import {
  creerScenario, lireScenario, remplacerScenario, supprimerScenario, type DepsScenariosApi, type ResultatScenario,
} from '../workflow/scenarios-api';

/**
 * LES SCÉNARIOS DEPUIS CLAUDE (spec `docs/superpowers/specs/2026-11-02-scenarios-api-design.md`) : créer, relire,
 * remplacer, supprimer un scénario par sa recette. 🔴 Aucune logique ici : le MÊME service que `/v1/scenarios`
 * (`src/workflow/scenarios-api.ts`). Les écritures exigent une personne (`exigePersonne`) : un scénario publié écrit à de
 * vrais contacts, et une clé `mcp:write` branchée sur un agent qui lit des messages de clients ne doit pas pouvoir en
 * publier un.
 */
export interface DepsScenariosMcp {
  scenariosApi: DepsScenariosApi;
  /** Le déroulé d'un contact dans un scénario (lot 1 du CSM virtuel, B6b) : `PgDeroule`. */
  deroule: LecteurDeroule;
  /** Les deux journaux d'erreurs de la console (B6b) : le magasin de `/erreurs-livraison` et `/erreurs-systeme`. */
  erreurs: Pick<PgErreursLivraisonStore, 'lister' | 'listerEchecsSysteme'>;
  /** Le jeton du lien de test d'un scénario (B6b) : posé au premier appel, rendu tel quel ensuite (le magasin de la console). */
  liensDeTest: { ensureTestToken(id: string, tenantId: string, token: string): Promise<string | null> };
  /**
   * Le numéro de Meta de l'espace, tel que la console le lit pour son lien de test (`getDisplayPhoneNumber`) : jamais
   * celui de la seule application WhatsApp Business, dont la filière ne lit pas les mots de test (relecture du lot F).
   */
  numeroAffiche(tenantId: string): Promise<string | null>;
}

/**
 * Les journaux d'erreurs lus par Claude : 100 lignes au plus (écrit aussi en clair dans `entierBorne`, que le test des
 * bornes lit et compare au schéma), et les 10 dernières erreurs d'un contact dans son déroulé.
 */
const ERREURS_MAX = 100;
const ERREURS_DU_CONTACT = 10;
const RECHERCHE_ERREURS_MAX = 120;

/** Un texte de recherche facultatif, borné et refusé au-delà (jamais coupé en silence). */
function rechercheFacultative(args: Record<string, unknown>, cle: string): string | undefined {
  const v = args[cle];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return undefined;
  if (typeof v !== 'string' || v.trim().length > RECHERCHE_ERREURS_MAX) {
    throw new RefusOutil(`paramètre « ${cle} » : un texte de ${RECHERCHE_ERREURS_MAX} caractères au plus`, 'invalid_args');
  }
  return v.trim();
}

const lecture = (title: string): AnnotationsMcp => ({ title, readOnlyHint: true, openWorldHint: false });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rend la valeur, ou lève le refus du service avec son chemin : le modèle corrige l'endroit exact. */
function valeurOuRefus<T>(r: ResultatScenario<T>): T {
  if (r.ok) return r.valeur;
  const chemin = typeof r.details?.chemin === 'string' ? ` (à ${r.details.chemin})` : '';
  const id = typeof r.details?.id === 'string' ? ` Scénario existant : ${r.details.id}.` : '';
  const upgradeUrl = typeof r.details?.upgradeUrl === 'string' ? r.details.upgradeUrl : undefined;
  throw refusDuCoeur({ statut: r.statut, code: r.code, message: `${r.message}${chemin}.${id}`, ...(upgradeUrl === undefined ? {} : { upgradeUrl }) });
}

/**
 * 🔴 LA RECETTE ANNONCÉE AU MODÈLE porte chaque borne que `lireRecette` applique : le schéma MCP ne décrit pas une
 * récursion, donc la forme d'une étape est dite ici, et le test `tests/mcp-outils-scenarios.test.ts` exige chaque borne.
 */
const FORME_ETAPE = 'A step is an object with EXACTLY ONE of these forms. '
  + '(1) { "template": { "nom", "langue", "variables"? }, "boutons"?, "autre_reponse"? }: sends an APPROVED template of the '
  + 'workspace (create it first with create_template and wait for get_template_status to say approved). "variables" maps a '
  + `template position ("1" for {{1}}) to { "champ": a field key (list_fields, ${LONGUEUR_CHAMP_MAX} characters) } or `
  + '{ "texte": fixed text, with no line break, no tab and at most four spaces in a row } or { "attribut": "name" | "phone" }; '
  + 'absent: the associations set in the console. A carousel template is refused. "boutons": a '
  + `list of { "texte", "suite" }, one per QUICK_REPLY button of the template, "texte" being its exact text (${MAX_TEXTE_BOUTON_TEMPLATE} `
  + `characters, ${MAX_BOUTONS_TEMPLATE} buttons at most); EVERY quick reply needs one, if need be { "humain": {} }. A template without `
  + 'quick replies ends the scenario. "autre_reponse": the step when the contact writes instead of tapping. '
  + '"si_echec": the step played when Meta cannot deliver the template (failed status: no WhatsApp on the number, '
  + 'undeliverable), e.g. { "humain": {} } so the team takes over; never a contact who said STOP. '
  + '(2) { "message": { "texte", "fichier"? }, "reponses"?, "autre_reponse"?, "suite"? }: a free message within the 24-hour '
  + `window. "texte": ${TEXTE_MAX_SIMPLE} characters, ${TEXTE_MAX_AVEC_FICHIER_OU_BOUTON} with a file or quick replies. "fichier": `
  + `{ "url": a public https address (${LONGUEUR_URL_FICHIER_MAX} characters) of a JPEG, PNG or GIF image, an MP4 video or a PDF }, `
  + `read at each send and checked once now. "reponses": up to ${MAX_REPONSES_RAPIDES} quick replies { "texte", "suite" }, `
  + `${MAX_TEXTE_REPONSE_RAPIDE} characters each, distinct, in the order the contact sees them; with them, "autre_reponse" is `
  + 'the step when the contact writes. Without quick replies the message does not wait: "suite" is the next step. '
  + '(3) { "agent": { "agent_id" } }: an active AI agent of the workspace (list_agents) takes the conversation; it ends the '
  + 'scenario. (4) { "humain": {} }: the conversation goes to the team (To handle); it ends the scenario. '
  + '(5) { "question": { "texte", "champ"?, "bouton"?, "ranger_choix"?, "sans_reponse_apres"? }, "menu"?, "autre_reponse"?, '
  + `"suite"?, "sans_reponse"? }: asks the contact and waits for the answer. "texte": ${TEXTE_QUESTION_MAX} characters. "champ": a `
  + 'field key (list_fields) that stores the written answer. "menu": a WhatsApp list of up to '
  + `${LIGNES_MENU_MAX} lines { "titre", "description"?, "suite" } (titre ${TITRE_LIGNE_MAX} characters, distinct; description `
  + `${DESCRIPTION_LIGNE_MAX}); EVERY line needs its step; with a menu, "bouton" (${BOUTON_MENU_MAX} characters) labels the button `
  + 'that opens the list, "ranger_choix": true stores the chosen title in "champ", and "autre_reponse" is the step when the '
  + 'contact writes; without a menu, "suite" is the step after the answer. "sans_reponse_apres": { "valeur": a whole number '
  + `from 1, "unite": ${UNITES_ECHEANCE.map((u) => `"${u}"`).join(', ')} }, ${ECHEANCE_MAX_JOURS} days at most: then "sans_reponse" `
  + '(required with it, refused without) is played, e.g. { "humain": {} }. A reminder there must respect the 24-hour '
  + 'window: a free message or a question reaches the contact only within 24 hours of their last message; beyond, '
  + 'only a template does. '
  + `(6) { "action": [operations], "suite"? }: ${OPERATIONS_MAX} operations at most, played in order: { "etiquette": a tag `
  + `(${ETIQUETTE_MAX} characters) to add }, { "retirer_etiquettes": [tags] }, { "champ": a field key, "valeur": its value as text `
  + `(${VALEUR_CHAMP_RECETTE_MAX} characters, matching the field type) }, { "vider_champs": [field keys] }, lists of `
  + `${LISTE_OPERATION_MAX} at most. Never the contact's consent. "suite": the next step. `
  + `At most ${PROFONDEUR_MAX_RECETTE} steps deep, ${MAX_NODES} steps and ${MAX_FICHIERS_RECETTE} distinct files.`;

const RECETTE: Record<'nom' | 'entree', ProprieteEntree> = {
  nom: {
    type: 'string', minLength: 1, maxLength: NOM_SCENARIO_MAX,
    description: `The scenario name, unique in the workspace (case-insensitive), ${NOM_SCENARIO_MAX} characters.`,
  },
  entree: { type: 'object', description: `The first step of the scenario. ${FORME_ETAPE}` },
};

const SCENARIO: ProprieteEntree = {
  type: 'string', minLength: 1, maxLength: 100,
  description: 'The scenario id, or its scn_ code (create_scenario, get_scenario, list_scenarios).',
};

const PUBLIE = 'Without brouillon, the write PUBLISHES at once: a published scenario writes to nobody until a send '
  + '(send_scenario_to_contact, launch_campaign, POST /v1/sends) or the default responder (set_default_responder) starts it. '
  + 'With brouillon: true, only the DRAFT is written and nothing can start it: propose_go_live (action "publier") then '
  + 'shows it to an administrator, whose click publishes it. Prepare every change for a person that way. '
  + 'A rule added to an AI agent after the write is not wired: it goes to the team until the scenario is replaced.';

/** `brouillon` (lot 1 du CSM virtuel, B4) : n'écrire que la version de travail. Absent ou faux : l'écriture publie. */
const BROUILLON: ProprieteEntree = {
  type: 'boolean',
  description: 'true: write the DRAFT only (nothing published, nothing starts it; propose_go_live publishes it on an '
    + 'administrator\'s click). Absent or false: the write publishes at once.',
};

/**
 * La simulation (lot 1 du CSM virtuel, B6) : ses bornes, annoncées dans le schéma et la description de l'outil.
 * 🔴 Les valeurs de la fiche fictive sont bornées comme celles d'une vraie fiche (`VALEUR_CHAMP_RECETTE_MAX`, la borne
 * d'un champ texte) : sans borne, des blocs « Extraire du JSON » recopiaient une valeur de plusieurs centaines de Ko
 * à chaque ligne et figeaient la copie de l'API (relecture du lot F) ; la sortie a en plus son budget (`SORTIE_MAX`).
 */
const REPONSES_SIMULEES_MAX = 20;
const CHAMPS_FICTIFS_MAX = 50;
/** Un choix se donne par son texte (une ligne de menu en a 24, un bouton 20, une réponse de template 25). */
const CHOIX_SIMULE_MAX = 200;
/** Une réponse écrite : la longueur d'un message texte WhatsApp. */
const TEXTE_SIMULE_MAX = 4096;

/** Les réponses du contact fictif, chacune d'une seule forme, ou un refus qui dit laquelle ne va pas, et pourquoi. */
function reponsesSimulees(brut: unknown): ReponseSimulee[] {
  if (!Array.isArray(brut)) throw new RefusOutil('paramètre « reponses » : une liste', 'invalid_args');
  if (brut.length > REPONSES_SIMULEES_MAX) throw new RefusOutil(`paramètre « reponses » : ${REPONSES_SIMULEES_MAX} au plus`, 'invalid_args');
  return brut.map((r, i) => {
    const o = r !== null && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
    const cles = Object.keys(o);
    const trop = (cle: string, max: number): never => {
      throw new RefusOutil(`paramètre « reponses[${i}].${cle} » : ${max} caractères au plus`, 'invalid_args');
    };
    if (cles.length === 1 && typeof o.choix === 'string' && o.choix.trim() !== '') return o.choix.length <= CHOIX_SIMULE_MAX ? { choix: o.choix } : trop('choix', CHOIX_SIMULE_MAX);
    if (cles.length === 1 && typeof o.texte === 'string' && o.texte.trim() !== '') return o.texte.length <= TEXTE_SIMULE_MAX ? { texte: o.texte } : trop('texte', TEXTE_SIMULE_MAX);
    if (cles.length === 1 && o.sans_reponse === true) return { sans_reponse: true as const };
    throw new RefusOutil(`paramètre « reponses[${i}] » : exactement un de { "choix": texte }, { "texte": texte }, { "sans_reponse": true }`, 'invalid_args');
  });
}

/** La fiche de départ du contact fictif : des valeurs de champ en texte et des étiquettes, bornées. */
function contactFictif(brut: unknown): ContactFictif {
  if (brut === undefined || brut === null) return {};
  if (typeof brut !== 'object' || Array.isArray(brut)) throw new RefusOutil('paramètre « contact » : un objet { champs?, etiquettes? }', 'invalid_args');
  const o = brut as Record<string, unknown>;
  const inconnue = Object.keys(o).find((k) => k !== 'champs' && k !== 'etiquettes');
  if (inconnue !== undefined) throw new RefusOutil(`paramètre « contact » : clé inconnue « ${inconnue} »`, 'invalid_args');
  const champs: Record<string, string> = {};
  if (o.champs !== undefined) {
    if (o.champs === null || typeof o.champs !== 'object' || Array.isArray(o.champs)) throw new RefusOutil('paramètre « contact.champs » : un objet clé vers valeur', 'invalid_args');
    const entrees = Object.entries(o.champs as Record<string, unknown>);
    if (entrees.length > CHAMPS_FICTIFS_MAX) throw new RefusOutil(`paramètre « contact.champs » : ${CHAMPS_FICTIFS_MAX} au plus`, 'invalid_args');
    for (const [k, v] of entrees) {
      if (k.length > LONGUEUR_CHAMP_MAX) throw new RefusOutil(`paramètre « contact.champs » : une clé de ${LONGUEUR_CHAMP_MAX} caractères au plus`, 'invalid_args');
      if (typeof v !== 'string') throw new RefusOutil(`paramètre « contact.champs.${k} » : une valeur en texte`, 'invalid_args');
      if (v.length > VALEUR_CHAMP_RECETTE_MAX) {
        throw new RefusOutil(`paramètre « contact.champs.${k} » : ${VALEUR_CHAMP_RECETTE_MAX} caractères au plus, comme sur une fiche`, 'invalid_args');
      }
      champs[k] = v;
    }
  }
  let etiquettes: string[] = [];
  if (o.etiquettes !== undefined) {
    if (!Array.isArray(o.etiquettes) || o.etiquettes.length > CHAMPS_FICTIFS_MAX
      || o.etiquettes.some((e) => typeof e !== 'string' || e.length > ETIQUETTE_MAX)) {
      throw new RefusOutil(`paramètre « contact.etiquettes » : une liste de ${CHAMPS_FICTIFS_MAX} textes de ${ETIQUETTE_MAX} caractères au plus`, 'invalid_args');
    }
    etiquettes = o.etiquettes as string[];
  }
  return { champs, etiquettes };
}

/** Le booléen `brouillon`, ou un refus : jamais deviné. */
function optionBrouillon(args: Record<string, unknown>): { brouillon: boolean } {
  const b = args.brouillon;
  if (b === undefined || b === null) return { brouillon: false };
  if (typeof b !== 'boolean') throw new RefusOutil('paramètre « brouillon » : true ou false', 'invalid_args');
  return { brouillon: b };
}

export const OUTILS_SCENARIOS: OutilMcp[] = [
  {
    ...ficheOutilMcp('create_scenario'),
    fonction: 'scenarios',
    description: 'Creates a scenario from a recipe. Returns its id and scn_ code, publie, and the published recipe read '
      + 'back with entreeCode (the nod_ code of the first step), empreinte and ouverture; with brouillon, these are null '
      + 'and brouillon holds the recipe and the empreinte to pass to update_scenario. ' + PUBLIE,
    annotations: ecriture('Create a scenario', false, false),
    entree: { type: 'object', properties: { ...RECETTE, brouillon: BROUILLON }, required: ['nom', 'entree'], additionalProperties: false },
    ecran: (_args, r) => ECRANS.scenario(lire(r, 'id')),
    async executer(deps, tenantId, args, personne) {
      const auteur = { userId: signataire(personne), acces: null };
      const options = optionBrouillon(args);
      const { brouillon: _b, ...recette } = args;
      return valeurOuRefus(await creerScenario(deps.scenariosApi, tenantId, recette, 'mcp', auteur, options));
    },
  },
  {
    ...ficheOutilMcp('get_scenario'),
    fonction: 'scenarios',
    description: 'Reads a scenario as a recipe, with its empreinte, needed by update_scenario: publie (it has a published '
      + 'version), recette and empreinte of the published version (null for a scenario that only exists as a draft), '
      + 'and brouillon, the draft waiting to be published, with its own recette and empreinte (null without draft; '
      + 'brouillonNonDecrit: a draft from the console that a recipe cannot say). A published scenario edited in the console '
      + 'beyond what a recipe can say is refused: only the console edits it.',
    annotations: lecture('Read a scenario'),
    entree: { type: 'object', properties: { scenario: SCENARIO }, required: ['scenario'], additionalProperties: false },
    async executer(deps, tenantId, args) {
      return valeurOuRefus(await lireScenario(deps.scenariosApi, tenantId, texteObligatoire(args, 'scenario', 100)));
    },
  },
  {
    ...ficheOutilMcp('simulate_scenario'),
    fonction: 'scenarios',
    description: 'Plays a scenario for a FICTITIOUS contact and sends nothing, calls no connector, writes nothing: returns '
      + 'each step (the effects planned: messages, questions, tags, fields), what the scenario then waits for (the choices '
      + 'offered, the no-answer delay), the exit each answer takes and the field it fills, and how it ends (fin.etat: '
      + 'equipe, termine, repondeur, agent_ia, agent_de_meta, autre_scenario, attend_une_reponse, reponse_impossible). '
      + 'version: "brouillon" or "publie"; absent, the draft when there is one, otherwise the published version. '
      + `reponses: the contact's answers in order, ${REPONSES_SIMULEES_MAX} at most, each EXACTLY one of { "choix": the text `
      + 'of a button, quick reply or menu line }, { "texte": a written answer }, { "sans_reponse": true } (the no-answer '
      + 'delay runs out). The contact has just written when the scenario starts; a wait or a delay of 24 hours or more '
      + 'without a reply closes the WhatsApp window, as in production. An API call or a JS function is named, not run: '
      + 'the field it would fill keeps the contact\'s starting value, so give one in contact.champs to try a branch. Not '
      + 'simulated, so said here: a filled form (only a written answer), a file sent to a Question, the space\'s business '
      + 'hours (a Condition on them takes the closed branch, a wait until they open does not wait), the contact\'s name, '
      + 'phone and language (empty for a Condition), and Meta\'s agent as the space\'s responder (a template without a '
      + 'button waits here, while in production the next step leaves at once). The output stops at '
      + `${SORTIE_MAX} characters. Show the person two contacts (one who goes to the end, one who goes to the team) `
      + 'before propose_go_live.',
    annotations: lecture('Simulate a scenario'),
    entree: {
      type: 'object',
      properties: {
        scenario: SCENARIO,
        version: { type: 'string', enum: ['brouillon', 'publie'], description: 'Which version to play. Absent: the draft, otherwise the published one.' },
        reponses: {
          type: 'array', maxItems: REPONSES_SIMULEES_MAX,
          description: 'The fictitious contact\'s answers, in order: each exactly one of choix, texte, sans_reponse.',
          items: {
            type: 'object',
            properties: {
              choix: { type: 'string', maxLength: CHOIX_SIMULE_MAX, description: 'The text of a button, quick reply or menu line.' },
              texte: { type: 'string', maxLength: TEXTE_SIMULE_MAX, description: 'A written answer.' },
              sans_reponse: { type: 'boolean', enum: [true], description: 'The no-answer delay runs out.' },
            },
            additionalProperties: false,
          },
        },
        contact: {
          type: 'object',
          description: 'Optional starting record, read by the conditions.',
          properties: {
            champs: {
              type: 'object',
              description: `Field key (${LONGUEUR_CHAMP_MAX} characters at most) to text value (${VALEUR_CHAMP_RECETTE_MAX} characters at most, as on a real record), ${CHAMPS_FICTIFS_MAX} at most.`,
            },
            etiquettes: {
              type: 'array', maxItems: CHAMPS_FICTIFS_MAX, items: { type: 'string', maxLength: ETIQUETTE_MAX },
              description: 'The contact\'s tags.',
            },
          },
          additionalProperties: false,
        },
      },
      required: ['scenario', 'reponses'],
      additionalProperties: false,
    },
    async executer(deps, tenantId, args) {
      const ref = texteObligatoire(args, 'scenario', 100);
      const reponses = reponsesSimulees(args.reponses);
      const contact = contactFictif(args.contact);
      const version = args.version;
      if (version !== undefined && version !== 'brouillon' && version !== 'publie') {
        throw new RefusOutil('paramètre « version » : brouillon ou publie', 'invalid_args');
      }
      const ligne = await deps.scenariosApi.scenarios.lireParApi(tenantId, ref);
      if (!ligne) throw new RefusOutil('scénario introuvable dans cet espace', 'not_found');
      const brouillon = ligne.draftGraph && ligne.draftGraph.nodes.length > 0 ? ligne.draftGraph : null;
      const publie = ligne.graph.nodes.length > 0 ? ligne.graph : null;
      const graphe = version === 'publie' ? publie : version === 'brouillon' ? brouillon : (brouillon ?? publie);
      if (graphe === null) {
        throw new RefusOutil(version === 'publie' || (version === undefined && brouillon === null)
          ? 'ce scénario n’a pas de version publiée' : 'ce scénario n’a pas de brouillon', 'conflict');
      }
      return { scenario: ligne.id, version: graphe === brouillon ? 'brouillon' : 'publie', ...simulerParcours(graphe, reponses, contact) };
    },
  },
  {
    ...ficheOutilMcp('get_scenario_test_link'),
    fonction: 'scenarios',
    description: 'The test link of a scenario, as in the console: a WhatsApp link to the workspace number with a test word '
      + 'already typed (mot). Whoever sends that word from their own phone goes through the scenario as its draft stands '
      + 'now (its published version when it has no draft), without it going live: the way to try a draft from a phone '
      + 'before propose_go_live. The word stays the same for the scenario. lien and numero are null while no number is '
      + 'connected. When Meta\'s agent answers everyone in this workspace, it also replies to the test word: the tester '
      + 'then sees two voices.',
    // Le premier appel pose le jeton, puis le rend tel quel (comme le POST de la console) : une valeur stable du scénario,
    // lue par aucun autre outil. `AnnotationsMcp` ne connaît que la lecture et l'écriture destructive : c'est une lecture.
    annotations: lecture('Get the test link of a scenario'),
    entree: { type: 'object', properties: { scenario: SCENARIO }, required: ['scenario'], additionalProperties: false },
    async executer(deps, tenantId, args) {
      const ligne = await deps.scenariosApi.scenarios.lireParApi(tenantId, texteObligatoire(args, 'scenario', 100));
      if (!ligne) throw new RefusOutil('scénario introuvable dans cet espace', 'not_found');
      // Le même jeton que la console : posé au premier appel, idempotent ensuite.
      const mot = await deps.liensDeTest.ensureTestToken(ligne.id, tenantId, newTestToken());
      if (mot === null) throw new RefusOutil('scénario introuvable dans cet espace', 'not_found');
      const numero = await deps.numeroAffiche(tenantId);
      return { scenario: ligne.id, mot, numero, lien: waMeTestLink(numero, mot) };
    },
  },
  {
    ...ficheOutilMcp('get_contact_journey'),
    fonction: 'scenarios',
    description: 'Where a real contact stands in a scenario, and what happened to them: their last runs (statut waiting '
      + `for an answer, sleeping until reprise, inbox once handed to the team, done; bloc, the block they wait on; the ${PARCOURS_MAX} latest), the `
      + `blocks they passed (passages, oldest first, ${PASSAGES_MAX} at most: sent, delivered, read, failed, reply_button `
      + `with its exit, reply_text; within those runs, 90 days at most), and the ${ERREURS_DU_CONTACT} last delivery errors of their number (Meta's code and message). Blocks are `
      + 'named from the scenario (id, type, code). Use it to follow the first real conversations after propose_go_live '
      + 'and to give the cause of a failure; list_delivery_errors and list_system_errors cover the whole workspace.',
    annotations: lecture('Read a contact journey'),
    entree: {
      type: 'object',
      properties: {
        scenario: SCENARIO,
        phone: { type: 'string', minLength: 1, maxLength: 32, description: 'The contact\'s number, with the country code (+33612345678).' },
      },
      required: ['scenario', 'phone'],
      additionalProperties: false,
    },
    async executer(deps, tenantId, args) {
      const ligne = await deps.scenariosApi.scenarios.lireParApi(tenantId, texteObligatoire(args, 'scenario', 100));
      if (!ligne) throw new RefusOutil('scénario introuvable dans cet espace', 'not_found');
      const phone = e164DepuisSaisie(texteObligatoire(args, 'phone', 32));
      if (phone === null) throw new RefusOutil('numéro illisible : donnez-le au format international (+33612345678)', 'invalid_args');
      const c = await deps.contacts.findByPhone(tenantId, phone);
      if (!c) throw new RefusOutil('aucun contact avec ce numéro dans cet espace', 'not_found');
      const waId = waIdOf(c.phoneE164, c.bsuid);
      const d = waId ? await deps.deroule.lire(tenantId, ligne.id, waId) : { parcours: [], passages: [] };
      // Un bloc se nomme par le scénario : celui d'un parcours de test vit dans le brouillon, les autres dans le publié.
      const blocs = new Map([...(ligne.draftGraph?.nodes ?? []), ...ligne.graph.nodes].map((n) => [n.id, {
        id: n.id, type: n.type, ...(typeof n.data.code === 'string' && n.data.code !== '' ? { code: n.data.code } : {}),
      }]));
      const bloc = (id: string) => blocs.get(id) ?? { id };
      // Le journal cherche le numéro par morceau : un numéro plus long qui le contient n'est pas ce contact.
      const chiffres = phone.replace(/\D/g, '');
      const erreurs = (await deps.erreurs.lister(tenantId, { telephone: chiffres, limit: ERREURS_DU_CONTACT }))
        .filter((e) => e.telephone.replace(/\D/g, '') === chiffres);
      return {
        contact: { id: c.id, phone },
        scenario: { id: ligne.id, nom: ligne.name },
        parcours: d.parcours.map((p) => ({ ...p, bloc: p.bloc === null ? null : bloc(p.bloc) })),
        passages: d.passages.map((p) => ({ ...p, bloc: bloc(p.bloc) })),
        erreurs_de_livraison: erreurs,
      };
    },
  },
  {
    ...ficheOutilMcp('list_delivery_errors'),
    fonction: null,
    description: 'The delivery error log of the console: what Meta answered when a message (campaign, scenario, free '
      + 'message) did not leave or did not arrive, newest first, with the number, the contact, Meta\'s code and message. '
      + `limit: the ${ERREURS_MAX} most recent at most (default 50): narrow with q (the text), telephone (a number) or code (one of Meta's codes).`,
    annotations: lecture('List delivery errors'),
    entree: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: ERREURS_MAX, description: 'How many errors, newest first.' },
        q: { type: 'string', maxLength: RECHERCHE_ERREURS_MAX, description: 'Text searched in the error, the campaign or the contact.' },
        telephone: { type: 'string', maxLength: RECHERCHE_ERREURS_MAX, description: 'A number, or part of it.' },
        code: { type: 'integer', minimum: 0, description: 'One of Meta\'s error codes (131026, 131049...).' },
      },
      additionalProperties: false,
    },
    async executer(deps, tenantId, args) {
      const code = args.code;
      if (code !== undefined && code !== null && !(typeof code === 'number' && Number.isInteger(code) && code >= 0)) {
        throw new RefusOutil('paramètre « code » : un code d’erreur de Meta, un entier', 'invalid_args');
      }
      const q = rechercheFacultative(args, 'q');
      const telephone = rechercheFacultative(args, 'telephone');
      const erreurs = await deps.erreurs.lister(tenantId, {
        limit: entierBorne(args, 'limit', 50, 1, 100),
        ...(q ? { q } : {}), ...(telephone ? { telephone } : {}), ...(typeof code === 'number' ? { code } : {}),
      });
      return { erreurs };
    },
  },
  {
    ...ficheOutilMcp('list_system_errors'),
    fonction: null,
    description: 'The system half of the console\'s error log: the calls to the customer\'s own systems (an API call '
      + 'block, a connector) that did not succeed, newest first, with the HTTP status and the error. '
      + `limit: the ${ERREURS_MAX} most recent at most (default 50).`,
    annotations: lecture('List system errors'),
    entree: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: ERREURS_MAX, description: 'How many errors, newest first.' } },
      additionalProperties: false,
    },
    async executer(deps, tenantId, args) {
      return { erreurs: await deps.erreurs.listerEchecsSysteme(tenantId, entierBorne(args, 'limit', 50, 1, 100)) };
    },
  },
  {
    ...ficheOutilMcp('update_scenario'),
    fonction: 'scenarios',
    description: 'Replaces a WHOLE scenario. Without brouillon, only a scenario created through the API or by Claude, '
      + 'and it is published. With brouillon: true, any scenario of the Builder, the console\'s included, as long as a '
      + 'recipe can say it: only its draft changes. Pass the empreinte read by get_scenario (the draft\'s when it has one, '
      + 'otherwise the published one): if the scenario changed in the meantime (in the console too), the call is refused '
      + 'instead of overwriting. A step left at the same place keeps its id, so a contact in the middle of the scenario '
      + 'resumes there. With brouillon, the name of a published scenario cannot change (a send may target it by name). ' + PUBLIE,
    annotations: ecriture('Replace a scenario', true, false),
    entree: {
      type: 'object',
      properties: {
        scenario: SCENARIO,
        ...RECETTE,
        empreinte: { type: 'string', minLength: 1, maxLength: 100, description: 'The empreinte read by get_scenario or returned by the last write: brouillon.empreinte when the scenario has a draft, otherwise empreinte.' },
        brouillon: BROUILLON,
      },
      required: ['scenario', 'nom', 'entree', 'empreinte'],
      additionalProperties: false,
    },
    ecran: (_args, r) => ECRANS.scenario(lire(r, 'id')),
    async executer(deps, tenantId, args, personne) {
      const auteur = { userId: signataire(personne), acces: null };
      const ref = texteObligatoire(args, 'scenario', 100);
      const options = optionBrouillon(args);
      const { scenario: _ref, empreinte, brouillon: _b, ...recette } = args;
      return valeurOuRefus(await remplacerScenario(
        deps.scenariosApi, tenantId, ref, recette, typeof empreinte === 'string' ? empreinte : undefined, 'mcp', auteur, options,
      ));
    },
  },
  {
    ...ficheOutilMcp('delete_scenario'),
    fonction: 'scenarios',
    description: 'Deletes a scenario created through the API or by Claude. Refused while something uses it (an automation, '
      + 'the default responder, a scheduled campaign, an ad, a widget, a "Go to" step): the refusal names it.',
    annotations: ecriture('Delete a scenario', true, false),
    entree: { type: 'object', properties: { scenario: SCENARIO }, required: ['scenario'], additionalProperties: false },
    ecran: () => LISTES.scenarios,
    async executer(deps, tenantId, args, personne) {
      const auteur = { userId: signataire(personne), acces: null };
      return valeurOuRefus(await supprimerScenario(deps.scenariosApi, tenantId, texteObligatoire(args, 'scenario', 100), 'mcp', auteur));
    },
  },
  /*
   * Faire PARTIR un scénario vers une personne (plan `2026-11-03-outil-envoyer-scenario.md`) : le trou de l'essai réel du
   * 2026-11-02, où il a fallu `POST /v1/sends` depuis un terminal. Le même envoi que `send_template_to_contact`
   * (`envoyerAUnePersonne`), cible `scenario`. `category: utility` ne déclare rien : le chemin public prend la plus stricte
   * de celle-ci et de celle que Meta donne au template d'ouverture (`categoriePlusStricte`), donc celle de Meta.
   */
  {
    ...ficheOutilMcp('send_scenario_to_contact'),
    fonction: 'scenarios',
    description:
      'Starts a published scenario for ONE person, even outside the 24-hour window, through the same path as POST /v1/sends: '
      + 'STOP, number unlinked or suspended, the plan\'s monthly templates. The scenario must open with an APPROVED template '
      + '(or an RCS message); one that opens with a quick message, a question, a form or an AI agent is refused, as it needs '
      + 'the person to have written within 24 hours. Its category is the one Meta gives the opening template (an RCS '
      + 'opening is recorded as utility). It takes the conversation back from a team member or an AI agent handling the '
      + 'person, and replaces a scenario the person was in. Sending '
      + 'through Claude declares, on the user\'s behalf and under their responsibility, that the person agreed to receive '
      + 'their messages: the record becomes opted in (marketing included), with who declared it; consent is not a parameter. '
      + 'A person who sent STOP is never written to. The person is designated by phone (with the country code: '
      + '+33612345678) or contact_id; an unknown number creates its contact record. values: one value per variable {{1}}, '
      + '{{2}}... of the OPENING template body, in order (read the person\'s record with get_contact for their first name, '
      + 'for example). idempotency_key: a key chosen for THIS send (a call replayed with the same key sends nothing again, '
      + 'for 24 hours). The first message goes out within the minute and the person\'s replies follow the scenario: '
      + 'returns send_id. Counts toward the workspace\'s heavy operations.',
    // Monde ouvert : un message part chez une personne. Idempotent : la même clé ne renvoie rien. Destructeur pour la
    // règle du répertoire de Claude (voir `AnnotationsMcp`), comme l'envoi d'un modèle.
    annotations: { title: 'Send a scenario to a contact', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    entree: {
      type: 'object',
      properties: {
        scenario: {
          type: 'string', minLength: 1, maxLength: 200,
          description: 'The scenario id (list_scenarios), its scn_ code (create_scenario, get_scenario), or its name.',
        },
        phone: { type: 'string', pattern: '^\\+[1-9][0-9]{7,14}$', description: 'The number with the country code. Or contact_id.' },
        contact_id: { type: 'string', format: 'uuid', minLength: 36, maxLength: 36, description: 'The id of a contact record. Or phone.' },
        values: {
          type: 'array', maxItems: 50,
          items: { type: 'string', minLength: 1, maxLength: 1024, pattern: VALEUR_ACCEPTEE.source },
          description: 'One value per variable of the opening template body, in order ({{1}} then {{2}}...), without line '
            + 'breaks, tabs or more than four spaces in a row (Meta refuses them). Omitted or empty: the fields chosen in the '
            + 'opening block are used, when they cover every variable.',
        },
        idempotency_key: { type: 'string', minLength: 1, maxLength: CLE_IDEMPOTENCE_MAX, description: 'A key specific to this send (a UUID for example).' },
      },
      required: ['scenario', 'idempotency_key'],
      additionalProperties: false,
    },
    ecran: () => LISTES.inbox,
    async executer(deps, tenantId, args, personne) {
      let scenario = texteObligatoire(args, 'scenario', 200);
      // Le chemin public ne connaît que le code `scn_` et le nom (`resolveScenario`) : l'id que rend `list_scenarios` y
      // serait cherché comme un nom. Traduit ici, dans l'espace, AVANT l'envoi : un refus n'use alors ni plafond ni quota.
      if (UUID.test(scenario)) {
        const ligne = await deps.scenariosApi.scenarios.lireParApi(tenantId, scenario);
        if (!ligne?.code) throw new RefusOutil('scénario introuvable dans cet espace (list_scenarios)', 'not_found');
        scenario = ligne.code;
      }
      return envoyerAUnePersonne(deps, tenantId, args, personne, { target: { scenario }, category: 'utility' }, 'mcp_scenario_envoye');
    },
  },
];
