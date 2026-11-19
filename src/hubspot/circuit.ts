import type { Filiere } from '../application/comptes';
import { journaliser } from '../lib/journal';
import type { SourceOffres } from '../offres/offre.pg';
import { issueDeLEnvoi, pontSelonLOffre, type EnvoyerPublic, type IssueEnvoi } from '../shopify/envoi';
import { premierBloc, type LecturesPremierBloc } from '../shopify/premier-bloc';
import type { LigneHubspot } from './lignes';

/**
 * LE CIRCUIT D'UNE LIGNE HUBSPOT D'ÉTAPE OU DE RENDEZ-VOUS (menu « Scénario », lot 6b, tâches 1 et 2 ; spec § 5.5) : le
 * premier bloc PUBLIÉ du scénario de la ligne (un template marqué), envoyé par le cœur public qui ne coupe pas le fil, et le
 * pont du parcours d'événement (`evenement_hubspot`) quand le bloc a une suite. Le schéma de Shopify (`servir`), avec ce qui
 * change pour HubSpot :
 *   - 🔴 AUCUN consentement écrit (jamais le `consent: 'opted_in'` de Shopify) et Service seulement : HubSpot n'atteste
 *     l'accord marketing que par l'action d'un workflow (`accordMarketing`), qu'une ligne n'a pas. Un premier template
 *     Marketing est refusé sur la catégorie que Meta rend (`modele_refuse`) ;
 *   - les données du deal se lisent sur la FICHE (décision 38) : la route y a écrit les champs `hs_*` avant ; une source
 *     `variable` du premier bloc n'a donc rien à lire, et rien ne part (`donnee_manquante`) ;
 *   - 🔴 le plafond par ligne (décision 36) : une étape changée sur beaucoup de deals d'un coup est bornée par heure, comme le
 *     runner bornait l'automation (`automation_fires`, la ligne EST une automation) ;
 *   - la clé d'idempotence est l'ORIGINE (`./origine.ts`, sa fenêtre de 24 h) : un événement rejoué relit le rapport ;
 *   - le tir est marqué AVANT l'envoi (un claim avec le marqueur d'un rendez-vous, sa date), et effacé quand rien n'est parti,
 *     pour qu'une tentative suivante regagne sa place (le contrat du runner, `markFired` puis `clearFired`).
 */

/** Ce que devient l'événement d'une ligne : l'issue de l'envoi, ou pourquoi rien n'est parti avant lui. */
export type IssueLigneHubspot = IssueEnvoi | 'filiere_differente' | 'a_completer' | 'donnee_manquante' | 'plafond' | 'deja_tire';

export interface DepsCircuitHubspot {
  /** Le cœur public (`lancerEnvoiPublic`), options transmises. */
  envoyer: EnvoyerPublic;
  /** La filière de l'espace, lue à l'envoi : un template ne part pas d'un numéro relié par QR code. */
  filiere(tenantId: string): Promise<Filiere | null>;
  /** Le premier bloc : les magasins des scénarios et des indices, ENTIERS. */
  lectures: LecturesPremierBloc;
  /** L'offre en cache court, ENTIÈRE : le pont ne se pose qu'avec la fonction `scenarios`. */
  offres: SourceOffres;
  /** Les tirs des automations (`PgAutomationStore`), ENTIER : le plafond par ligne et le claim. */
  tirs: {
    firedSince(automationId: string, since: Date): Promise<number>;
    markFired(automationId: string, waId: string, marqueur?: string): Promise<boolean>;
    clearFired(automationId: string, waId: string): Promise<void>;
  };
  /** Le plafond horaire d'une ligne (`AUTOMATION_MAX_FIRES_PER_HOUR`) ; 0 = aucun. */
  plafondParHeure: number;
  now?: () => number;
}

export interface EvenementDeLigne {
  ligne: LigneHubspot;
  /** Le numéro en E.164, normalisé par l'appelant. */
  telephone: string;
  waId: string;
  /** `origineHubspot(...)` : la clé d'idempotence et l'origine du parcours. */
  origine: string;
  /** Un rendez-vous : la date pour laquelle on tire (le claim). Absent pour une étape. */
  marqueur?: string;
}

const NOM_DE_FAMILLE = { etape: 'étape', rdv: 'rendez-vous', workflow: 'workflow' } as const;

/**
 * Le nom de la ligne dans Campagnes : jamais le préfixe des workflows (`PREFIXE_LIGNE_HUBSPOT`, « HubSpot · workflow »), qui
 * décide `workflow_hubspot` et l'exclusion des leviers.
 */
export function nomDansCampagnes(ligne: Pick<LigneHubspot, 'famille' | 'nom'>): string {
  return `HubSpot · ${NOM_DE_FAMILLE[ligne.famille]} · ${ligne.nom}`;
}

/** Rien n'est parti, et la prochaine tentative doit pouvoir regagner le tir. */
const RIEN_PARTI: ReadonlySet<IssueLigneHubspot> = new Set<IssueLigneHubspot>([
  'desabonne', 'sans_consentement', 'bloque', 'limite_contacts', 'limite_modeles', 'modele_refuse', 'numero_indisponible',
  'sans_telephone', 'refuse', 'filiere_differente',
]);

export async function servirLigneHubspot(d: DepsCircuitHubspot, tenantId: string, e: EvenementDeLigne): Promise<IssueLigneHubspot> {
  const now = d.now ?? (() => Date.now());
  const bloc = await premierBloc(d.lectures, tenantId, e.ligne.workflowId, 'hubspot');
  if (bloc.etat !== 'pret') {
    journaliser('warn', 'hubspot_ligne_a_completer', { tenantId, ligne: e.ligne.id, raison: bloc.raison });
    return 'a_completer';
  }
  if (bloc.params.some((p) => p.source.type === 'variable')) {
    journaliser('warn', 'hubspot_ligne_donnee_manquante', { tenantId, ligne: e.ligne.id });
    return 'donnee_manquante';
  }
  if (d.plafondParHeure > 0 && (await d.tirs.firedSince(e.ligne.id, new Date(now() - 3600_000))) >= d.plafondParHeure) {
    journaliser('warn', 'hubspot_ligne_plafond', { tenantId, ligne: e.ligne.id, plafond: d.plafondParHeure });
    return 'plafond';
  }
  if (!(await d.tirs.markFired(e.ligne.id, e.waId, e.marqueur))) return 'deja_tire';

  let issue: IssueLigneHubspot;
  try {
    if ((await d.filiere(tenantId)) === 'application') {
      issue = 'filiere_differente';
    } else {
      const pont = await pontSelonLOffre(d.offres, tenantId, bloc, e.origine, 'evenement_hubspot');
      const corps = {
        idempotencyKey: e.origine,
        target: { template: { name: bloc.modele, language: bloc.langue } },
        params: bloc.params.map((p) => ({ position: p.position, source: p.source })),
        recipients: [{ phone: e.telephone }],
      };
      issue = issueDeLEnvoi(await d.envoyer(tenantId, corps, async () => true, {
        nom: nomDansCampagnes(e.ligne), sansCampagneVide: true, serviceSeulement: true,
        ...(pont !== undefined ? { parcoursEvenement: pont } : {}),
      }));
    }
  } catch (err) {
    // Une panne (base, réseau) après le claim : le tir s'efface, sinon le rappel d'un rendez-vous serait « déjà tiré »
    // pour toujours (relecture de 6b). L'étape, elle, se rejoue par l'erreur ; la clé d'idempotence évite le doublon.
    await d.tirs.clearFired(e.ligne.id, e.waId);
    throw err;
  }
  if (RIEN_PARTI.has(issue)) await d.tirs.clearFired(e.ligne.id, e.waId);
  journaliser('info', 'hubspot_ligne_servie', { tenantId, ligne: e.ligne.id, famille: e.ligne.famille, issue });
  return issue;
}
