/**
 * Client du canal service vers le connecteur mm-hubspot : appel signé (`callService`), import de listes,
 * déconnexion d'un portail, signalement d'un contact injoignable, passage à l'équipe, lecture des étapes de deal et
 * du portail relié, lecture et pose des champs HubSpot choisis.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { signRequest } from '../lib/signature';
import type { HubspotPortalLink, ModeTaches } from '../account/types';
import { estAbandon, withRetry } from '../meta/http';
import type { HttpTransport } from '../meta/http';
import { importContacts } from './import';
import type { ImportDeps } from './import';
import type { ColumnMapping, ImportReport } from './types';
import { CALCULES_HUBSPOT, CHAMPS_HUBSPOT_MAX, NOM_PROPRIETE_HUBSPOT, type ChampChoisi, type ChampLibelle } from '../hubspot-workflow/champs';

/** Le portail n'a pas (encore) accordé crm.lists.read : l'admin doit re-consentir. Porte l'URL construite par mm-hubspot. */
export class ReconsentRequiredError extends Error {
  constructor(readonly reconsentUrl: string | undefined) {
    super('reconsent_required');
    this.name = 'ReconsentRequiredError';
  }
}
/** Autre échec du canal service (tenant non connecté, portail désinstallé, 5xx...). `retryable` piloté par withRetry. */
export class HubspotServiceError extends Error {
  /** `corps` : la réponse du connecteur telle quelle, NON validée (un refus qui détaille sa cause, lu par `safeParse`). */
  constructor(readonly status: number, readonly code: string | undefined, readonly retryable: boolean, readonly corps?: unknown) {
    super(`hubspot service HTTP ${status}${code ? ` (${code})` : ''}`);
    this.name = 'HubspotServiceError';
  }
}

export interface ConnectorDeps {
  /** Base interne du connecteur (ex. http://mm-hubspot-api:8096). */
  baseUrl: string;
  /** Secret HMAC du canal service (== SERVICE_SECRET de mm-hubspot). */
  secret: string;
  transport: HttpTransport;
}

export interface HubspotList { listId: string; name: string; size: number | null; processingType: string }

/**
 * POST signé (x-mm-service-signature) vers le connecteur, retry borné sur 429/5xx/réseau ; 409 reconsent -> terminal.
 * Avec `delaiMs` : un seul essai, sous cette échéance (une lecture qui sert un affichage n'attend pas les reprises).
 */
async function callService<T>(deps: ConnectorDeps, path: string, body: unknown, delaiMs?: number): Promise<T> {
  const fullUrl = `${deps.baseUrl}${path}`;
  // Chemin signé = pathname de l'URL complète (robuste à un éventuel préfixe de proxy), tel que mm-hubspot voit req.url.
  const signedPath = new URL(fullUrl).pathname;
  const appel = async (): Promise<T> => {
    const raw = JSON.stringify(body);
    // ts + nonce frais à chaque tentative : le vérificateur mm-hubspot rejette un ts hors fenêtre.
    const sig = signRequest(deps.secret, { ts: Date.now(), nonce: randomBytes(8).toString('hex'), method: 'POST', path: signedPath, body: raw });
    const entetes = { 'x-mm-service-signature': sig };
    const res = delaiMs === undefined
      ? await deps.transport.post(fullUrl, body, entetes)
      : await deps.transport.post(fullUrl, body, entetes, { signal: AbortSignal.timeout(delaiMs) });
    if (res.status >= 200 && res.status < 300) return res.json as T;
    const j = res.json as { error?: string; reconsentUrl?: string } | undefined;
    if (res.status === 409 && j?.error === 'reconsent_required') throw new ReconsentRequiredError(j.reconsentUrl);
    throw new HubspotServiceError(res.status, j?.error, res.status === 429 || res.status >= 500, res.json);
  };
  return delaiMs === undefined ? withRetry(appel) : appel();
}

/**
 * Délie le tenant de son portail HubSpot côté connecteur (qui révoque le refresh token si c'était le dernier
 * tenant). Idempotent : `{disconnected:false}` = déjà délié = succès. Un échec terminal lève HubspotServiceError, et
 * l'appelant ne coupe pas l'état local : mba ne doit jamais afficher « coupé » pendant que le connecteur pousse encore.
 */
export async function disconnectHubspot(deps: ConnectorDeps, tenantId: string): Promise<{ disconnected: boolean; revoked: boolean }> {
  const res = await callService<{ disconnected?: boolean; revoked?: boolean }>(deps, '/service/unlink', { tenantId });
  return { disconnected: res.disconnected ?? false, revoked: res.revoked ?? false };
}

/**
 * Marque un contact « injoignable en WhatsApp » dans HubSpot (au 2e échec de livraison 131026), résolu par
 * téléphone côté connecteur. `tenant_not_connected` (404) = pas de portail lié, rien à marquer ; un échec
 * réseau ou 5xx est rejoué, un autre 4xx lève.
 */
export async function flagContactUnreachable(deps: ConnectorDeps, tenantId: string, e164: string): Promise<{ flagged: boolean }> {
  try {
    const res = await callService<{ flagged?: boolean }>(deps, '/service/contact-flag', { tenantId, e164, flag: 'unreachable' });
    return { flagged: res.flagged ?? false };
  } catch (err) {
    if (err instanceof HubspotServiceError && err.status === 404) return { flagged: false }; // portail non lié : rien à marquer
    throw err;
  }
}

/**
 * Le corps de `POST /service/handoff` : une conversation passée à l'équipe (contrat figé avec le connecteur, plan du
 * lot 1 de la reprise humaine, 2026-10-23). `e164` est la valeur que porte `contactE164` dans l'analyse poussée,
 * `occasion` = `conversationId:escaladee_le` en ISO, la clé qui fait qu'un rejeu ne crée jamais une seconde tâche.
 */
export interface CorpsHandoff {
  tenantId: string;
  e164: string;
  nom: string | null;
  conversationId: string;
  lienConversation: string;
  finFenetre: string | null;
  occasion: string;
  /** Lot 2b (décision C) : `relance`, le client a réécrit sans réponse de l'équipe. Absente : une escalade. */
  nature?: 'escalade' | 'relance';
}

/** La réponse 200 du connecteur, validée : `taskId` nul en mode `hubspot_native`, `created` faux sur un rejeu. */
const reponseHandoff = z.object({ taskId: z.string().nullable(), contactId: z.string(), created: z.boolean() });

/**
 * L'issue d'un passage poussé. `fait` : le connecteur a répondu 2xx (une réponse illisible reste un succès, rien ne
 * se rejoue pour elle). `non_relie` : 404, l'espace n'a pas de portail, fin normale. `refuse` : un autre 4xx (corps
 * invalide, signature refusée, portail désinstallé), terminal : le rejouer donnerait le même refus.
 */
export type IssueHandoff =
  | { issue: 'fait'; created: boolean | null; taskId: string | null }
  | { issue: 'non_relie' }
  | { issue: 'refuse'; status: number; code: string | undefined };

/**
 * Pousse un passage à l'équipe au connecteur. 429, 5xx et réseau sont rejoués ici (`withRetry`), puis LÈVENT : pg-boss
 * rejoue le job. Tout autre refus rend une issue, jamais une erreur, pour ne pas rejouer à l'infini un appel voué au
 * même refus.
 */
export async function pousserHandoff(deps: ConnectorDeps, corps: CorpsHandoff): Promise<IssueHandoff> {
  let reponse: unknown;
  try {
    reponse = await callService<unknown>(deps, '/service/handoff', corps);
  } catch (err) {
    if (err instanceof ReconsentRequiredError) return { issue: 'refuse', status: 409, code: 'reconsent_required' };
    if (err instanceof HubspotServiceError && !err.retryable) {
      // Seul le 404 `tenant_not_connected` dit « espace sans portail ». Tout autre 404 (route absente parce que le
      // connecteur n'est pas encore déployé, objet introuvable d'un connecteur ancien) est un REFUS journalisé en
      // erreur : le confondre avec une fin normale perdrait la demande d'humain sans aucune trace.
      return err.status === 404 && err.code === 'tenant_not_connected'
        ? { issue: 'non_relie' }
        : { issue: 'refuse', status: err.status, code: err.code };
    }
    throw err;
  }
  const r = reponseHandoff.safeParse(reponse);
  return r.success ? { issue: 'fait', created: r.data.created, taskId: r.data.taskId } : { issue: 'fait', created: null, taskId: null };
}

/**
 * L'issue d'une clôture de passage (lot 2b, décision A). `clos` : le connecteur a coché la tâche et levé la demande.
 * `sans_objet` : 404, l'occasion lui est inconnue ou l'espace n'a plus de portail, rien à cocher. `refuse` : un autre
 * refus (portail à re-consentir, contrat décalé), le passage reste ouvert et le balayage suivant réessaie.
 */
export type IssueCloture = 'clos' | 'sans_objet' | { refuse: number; code: string | undefined };

/** Clôt un passage chez le connecteur. 429, 5xx et réseau sont rejoués ici, puis LÈVENT. */
export async function cloreHandoff(deps: ConnectorDeps, corps: { tenantId: string; occasion: string }): Promise<IssueCloture> {
  try {
    await callService<unknown>(deps, '/service/handoff-clos', corps);
    return 'clos';
  } catch (err) {
    if (err instanceof ReconsentRequiredError) return { refuse: 409, code: 'reconsent_required' };
    if (err instanceof HubspotServiceError && !err.retryable) {
      return err.status === 404 && (err.code === 'occasion_inconnue' || err.code === 'tenant_not_connected')
        ? 'sans_objet'
        : { refuse: err.status, code: err.code };
    }
    throw err;
  }
}

/**
 * Le signal « contact injoignable » SELON le choix du client (lot 1bis) : éteint, rien n'est flagué, et c'est un succès
 * pour la clôture qui suit dans `runRetrySweep` (le no-op qui réussit, comme sans HubSpot). Extrait du câblage du
 * worker pour être testé par la même porte que la production.
 */
export function flagSelonLeChoix(
  injoignableBranche: (tenantId: string) => Promise<boolean>,
  flag: (tenantId: string, e164: string) => Promise<unknown>,
): (tenantId: string, e164: string) => Promise<void> {
  return async (tenantId, e164) => {
    if (!(await injoignableBranche(tenantId))) return;
    await flag(tenantId, e164);
  };
}

/** L'échéance d'une lecture du portail : deux requêtes indexées chez le connecteur, quelques millisecondes d'habitude. */
export const DELAI_PORTAIL_MS = 3_000;

/**
 * La lecture du portail a dépassé `DELAI_PORTAIL_MS`. Depuis le 2026-10-27, la porte du connecteur dort quand personne
 * ne s'en sert (zéro copie minimum) et met une quinzaine de secondes à se réveiller (mesuré : 15,5 à 16,6 s) : l'appel
 * qui expire l'a réveillée. Ce n'est ni « relié » ni « pas relié » : l'écran dit que la connexion est en cours, et
 * relit. Un connecteur figé donne la même erreur, et l'écran finit par le dire après ses relectures.
 */
export class ConnecteurEnReveil extends Error {
  constructor() {
    super('connecteur_en_reveil');
    this.name = 'ConnecteurEnReveil';
  }
}

/** La réponse de `POST /service/portal`, validée : rien d'autre ne passe. */
const reponsePortail = z.union([
  z.object({ connected: z.literal(false) }),
  z.object({
    connected: z.literal(true), hubId: z.string().min(1), hubDomain: z.string().nullable(), listsScopeGranted: z.boolean(),
    // Lot 1bis : facultatif, un connecteur plus ancien ne le rend pas.
    routingMode: z.enum(['mm_routing', 'hubspot_native']).optional(),
  }),
]);

/** La réponse de `POST /service/routing-mode` (lot 1bis), validée. */
const reponseModeTaches = z.object({ routingMode: z.enum(['mm_routing', 'hubspot_native']) });

/**
 * Pose le mode des tâches du portail de l'espace (lot 1bis, « Créer des tâches dans HubSpot ») : `POST
 * /service/routing-mode`. Il vaut pour tout le portail. LÈVE sur tout échec (portail absent, connecteur injoignable,
 * réponse invalide) : l'appelant le dit au client, jamais un succès muet.
 */
export async function poserModeTaches(deps: ConnectorDeps, tenantId: string, mode: ModeTaches): Promise<ModeTaches> {
  const r = reponseModeTaches.safeParse(await callService<unknown>(deps, '/service/routing-mode', { tenantId, mode }));
  if (!r.success) throw new HubspotServiceError(502, 'reponse_invalide', false);
  return r.data.routingMode;
}

/**
 * Le portail HubSpot relié à un espace, lu PAR LE CONNECTEUR (`POST /service/portal`, lot 1 de la bascule Scaleway).
 * On le lisait en cross-schéma dans `mmhs`, dans la même base ; une fois ce schéma sur sa propre base, la lecture
 * rendrait `42P01`, que les consommateurs traduisaient en « aucun portail relié ». Le contrat :
 * - aucun connecteur configuré (`deps` null, `HUBSPOT_SERVICE_URL` vide) : `{ connected: false }`, sans appel. C'est
 *   le remplaçant légitime de `42P01` : sans connecteur, aucun portail ne peut être relié ;
 * - le connecteur répond : sa réponse, validée par Zod ;
 * - injoignable, délai, signature refusée, 404 (connecteur pas encore à jour), 5xx, réponse invalide : une ERREUR,
 *   jamais `connected: false`. Chaque consommateur décide : l'interrupteur refuse (503), la suppression d'un espace
 *   rend « on ne sait pas », l'écran du compte affiche « non connecté ».
 * Un seul essai, sous `DELAI_PORTAIL_MS` : l'Accueil et les réglages l'attendent, et un connecteur figé les aurait tenus
 * jusqu'à deux minutes et demie (30 s par essai, cinq essais). L'interrupteur répond alors 503, et l'on réessaie.
 * Le délai dépassé lève `ConnecteurEnReveil`, que l'Accueil et les réglages affichent comme une connexion en cours.
 */
export async function lireHubspotPortal(deps: ConnectorDeps | null, tenantId: string): Promise<HubspotPortalLink> {
  if (deps === null) return { connected: false };
  const brut = await callService<unknown>(deps, '/service/portal', { tenantId }, DELAI_PORTAIL_MS).catch((err: unknown) => {
    throw estAbandon(err) ? new ConnecteurEnReveil() : err;
  });
  const reponse = reponsePortail.safeParse(brut);
  if (!reponse.success) throw new HubspotServiceError(502, 'reponse_invalide', false);
  return reponse.data;
}

/**
 * Le connecteur ne connaît pas encore la route (404 sans `tenant_not_connected`) : il n'est pas encore à jour, l'API de
 * mba partant avant lui (plan du 2026-11-02, ordre de déploiement). Ce n'est ni « aucun champ » ni « pas relié » :
 * l'écran dit qu'une mise à jour est en cours.
 */
export class ConnecteurPasAJour extends Error {
  constructor() {
    super('connecteur_pas_a_jour');
    this.name = 'ConnecteurPasAJour';
  }
}

/** Le connecteur refuse une liste : une propriété choisie n'existe plus dans le portail, ou ne s'importe pas. */
export class ProprietesInconnues extends Error {
  constructor(readonly champs: ReadonlyArray<{ objet: string; propriete: string }>) {
    super('propriete_inconnue');
    this.name = 'ProprietesInconnues';
  }
}

/**
 * L'échéance d'une lecture des champs : le connecteur lit les propriétés du contact et de la transaction chez HubSpot,
 * deux appels d'une seconde ou deux, et dort quand personne ne s'en sert (réveil d'une quinzaine de secondes).
 */
export const DELAI_CHAMPS_MS = 8_000;

const champLibelle = z.union([
  z.object({ objet: z.enum(['contact', 'deal']), propriete: z.string().regex(NOM_PROPRIETE_HUBSPOT), libelle: z.string().max(500) }),
  z.object({ objet: z.literal('calcule'), propriete: z.enum(CALCULES_HUBSPOT), libelle: z.string().max(500) }),
]);
const proprieteDuPortail = z.object({ nom: z.string().regex(NOM_PROPRIETE_HUBSPOT), libelle: z.string().max(500), type: z.string().max(100) });

/** La réponse de `POST /service/champs` (lot 2 du 2026-11-02), validée : rien d'autre ne passe. */
const reponseChamps = z.object({
  proprietes: z.object({ contact: z.array(proprieteDuPortail).max(5000), deal: z.array(proprieteDuPortail).max(5000) }),
  calcules: z.array(z.object({ cle: z.enum(CALCULES_HUBSPOT), libelle: z.string().max(500), disponible: z.boolean() })).max(CALCULES_HUBSPOT.length),
  choisis: z.array(champLibelle).max(CHAMPS_HUBSPOT_MAX),
});
export type ChampsDuPortail = z.infer<typeof reponseChamps>;

/** La réponse de `POST /service/champs/poser`, validée. */
const reponsePoserChamps = z.object({ choisis: z.array(champLibelle).max(CHAMPS_HUBSPOT_MAX) });
/** Le refus 400 d'une propriété absente ou filtrée : son code, et les champs en cause (illisibles : aucun nommé). */
const refusProprietes = z.object({
  champs: z.array(z.object({ objet: z.string().max(20), propriete: z.string().max(100) })).max(CHAMPS_HUBSPOT_MAX).catch([]),
});

/** Un 404 qui ne dit pas « espace sans portail » : la route n'existe pas encore chez le connecteur. */
const traduireAbsence = (err: unknown): unknown => (
  estAbandon(err) ? new ConnecteurEnReveil()
    : err instanceof HubspotServiceError && err.status === 404 && err.code !== 'tenant_not_connected' ? new ConnecteurPasAJour()
      : err
);

/**
 * Les champs HubSpot de l'espace, lus PAR LE CONNECTEUR (`POST /service/champs`) : les propriétés importables du contact
 * et de la transaction, les deux calculés, et la liste choisie. Un seul essai sous `DELAI_CHAMPS_MS` : le délai dépassé
 * lève `ConnecteurEnReveil`, une route absente `ConnecteurPasAJour`. Pas de portail : `HubspotServiceError` 404
 * `tenant_not_connected` (ou 409 `portal_disconnected`). Une réponse invalide : 502, jamais une liste vide.
 */
export async function lireChampsHubspot(deps: ConnectorDeps, tenantId: string): Promise<ChampsDuPortail> {
  const brut = await callService<unknown>(deps, '/service/champs', { tenantId }, DELAI_CHAMPS_MS).catch((err: unknown) => {
    throw traduireAbsence(err);
  });
  const r = reponseChamps.safeParse(brut);
  if (!r.success) throw new HubspotServiceError(502, 'reponse_invalide', false);
  return r.data;
}

/**
 * Pose la liste choisie chez le connecteur (`POST /service/champs/poser`), qui relit les propriétés du portail et refuse
 * une propriété absente ou filtrée (`ProprietesInconnues`). Rend la liste enregistrée, avec les libellés HubSpot. Mêmes
 * traductions que `lireChampsHubspot` ; l'écriture est idempotente, l'écran peut la refaire.
 */
export async function poserChampsHubspot(deps: ConnectorDeps, tenantId: string, champs: readonly ChampChoisi[]): Promise<ChampLibelle[]> {
  const brut = await callService<unknown>(deps, '/service/champs/poser', { tenantId, champs }, DELAI_CHAMPS_MS).catch((err: unknown) => {
    if (err instanceof HubspotServiceError && err.status === 400) {
      const c = err.corps as { code?: unknown; error?: unknown } | null | undefined;
      if (c?.code === 'propriete_inconnue' || c?.error === 'propriete_inconnue') {
        const lu = refusProprietes.safeParse(err.corps);
        throw new ProprietesInconnues(lu.success ? lu.data.champs : []);
      }
    }
    throw traduireAbsence(err);
  });
  const r = reponsePoserChamps.safeParse(brut);
  if (!r.success) throw new HubspotServiceError(502, 'reponse_invalide', false);
  return r.data.choisis;
}

export interface HubspotDealStage { id: string; label: string; closed: boolean }
export interface HubspotDealPipeline { id: string; label: string; stages: HubspotDealStage[] }

/**
 * Pipelines de deals du portail, avec les libellés de leurs étapes, pour le menu « étape de deal » de l'écran
 * Automation. Ne lève pas ReconsentRequiredError (les deals sont dans les scopes obligatoires) ; un tenant sans
 * portail remonte en HubspotServiceError 404, que la route traduit en « pas connecté ».
 */
export async function fetchHubspotDealStages(deps: ConnectorDeps, tenantId: string): Promise<HubspotDealPipeline[]> {
  const res = await callService<{ pipelines?: HubspotDealPipeline[] }>(deps, '/service/deal-stages', { tenantId });
  return res.pipelines ?? [];
}

/** Liste les listes HubSpot du portail du tenant. Lève ReconsentRequiredError si crm.lists.read pas accordé. */
export async function fetchHubspotLists(deps: ConnectorDeps, tenantId: string, query?: string): Promise<HubspotList[]> {
  const res = await callService<{ lists: HubspotList[] }>(deps, '/service/lists', { tenantId, ...(query ? { query } : {}) });
  return res.lists ?? [];
}

/**
 * Importe les contacts d'une liste HubSpot, taggés « HubSpot: <nom> ». Ils arrivent `opted_in`, source
 * `hubspot_list` : le consentement est géré et prouvé dans HubSpot, et `optInAllows` exige un opt-in explicite
 * pour le marketing. 🔴 Sauf qui a dit STOP : il reste désabonné, la base refusant de lever le STOP
 * (autorité `import`, `src/crm/transition-consentement.ts`). Rend le rapport d'import, plus `truncated` et `skippedNoPhone`.
 */
export async function importHubspotList(
  connector: ConnectorDeps,
  importDeps: ImportDeps,
  tenantId: string,
  listId: string,
  listName: string,
): Promise<{ report: ImportReport; truncated: boolean; skippedNoPhone: number; tags: string[] }> {
  const data = await callService<{ contacts: Array<{ phone: string; name: string | null }>; truncated: boolean; skippedNoPhone: number }>(
    connector,
    '/service/lists/contacts',
    { tenantId, listId },
  );
  const rows = data.contacts.map((c) => ({ phone: c.phone, name: c.name ?? '' }));
  const mapping: ColumnMapping = { columns: { phone: { target: 'phone' }, name: { target: 'name' } } };
  // `tags` = source de vérité unique du tag posé : le front s'en sert pour filtrer, il doit correspondre exactement
  // à ce qui est stocké plutôt que d'être reconstruit côté front.
  const tags = [`HubSpot: ${listName}`];
  const report = await importContacts({ rows, mapping, tenantId, optIn: true, optInSource: 'hubspot_list', tags, autorite: 'import' }, importDeps);
  return { report, truncated: data.truncated, skippedNoPhone: data.skippedNoPhone, tags };
}

/**
 * L'échéance d'une écriture de champ HubSpot par un scénario : le connecteur cherche le contact puis écrit la propriété,
 * avec ses propres relances sur un 429 de HubSpot. Un seul essai ici : le parcours attend, et un échec n'écrit pas le
 * miroir (cadrage `~/mm-hubspot/docs/2026-11-06-remontee-champs-cadrage.md`, décision 1).
 */
export const DELAI_ECRITURE_CHAMP_MS = 25_000;

/**
 * L'issue d'une écriture de propriété du contact dans HubSpot, dans les mots du parcours :
 *  - `ecrit` : HubSpot a la valeur, le miroir de la fiche s'écrit ;
 *  - `fiche_seule` : il n'y a plus de miroir à tenir (champ retiré de la liste, espace sans portail, connecteur pas encore
 *    à jour) : la fiche s'écrit seule, comme avant la remontée ;
 *  - `echec` : HubSpot n'a PAS la valeur, le miroir ne s'écrit pas ; `motif` va au journal des échecs de scénario.
 */
export type IssueEcritureChamp = { issue: 'ecrit' } | { issue: 'fiche_seule' } | { issue: 'echec'; motif: string };

const reponseEcritureChamp = z.discriminatedUnion('issue', [
  z.object({ issue: z.literal('ecrit') }),
  z.object({ issue: z.literal('non_choisi') }),
  z.object({ issue: z.literal('contact_inconnu') }),
  z.object({ issue: z.literal('refuse'), message: z.string().max(300).catch('') }),
]);

/**
 * Écrit une propriété du CONTACT dans HubSpot (`POST /service/champs/ecrire`), le contact trouvé par son téléphone. Ne
 * lève jamais : toute panne devient `echec`, et le parcours continue sans écrire le miroir.
 */
export async function ecrireChampContactHubspot(
  deps: ConnectorDeps, corps: { tenantId: string; e164: string; propriete: string; valeur: string },
): Promise<IssueEcritureChamp> {
  let brut: unknown;
  try {
    brut = await callService<unknown>(deps, '/service/champs/ecrire', corps, DELAI_ECRITURE_CHAMP_MS);
  } catch (err) {
    if (estAbandon(err)) return { issue: 'echec', motif: 'HubSpot n’a pas répondu à temps' };
    if (err instanceof ReconsentRequiredError) return { issue: 'echec', motif: 'HubSpot refuse l’écriture : ré-autorisez l’application Messaging Me sur le portail' };
    if (err instanceof HubspotServiceError) {
      // Espace sans portail, ou route absente (le 404 de Fastify, connecteur pas encore à jour) : plus de miroir à tenir.
      // Tout autre 404 (une adresse fausse, un frontal) est un échec VISIBLE, jamais une écriture locale silencieuse.
      if (err.status === 404 && (err.code === 'tenant_not_connected' || err.code === 'Not Found')) return { issue: 'fiche_seule' };
      // Le portail est relié mais son jeton manque : HubSpot n'a pas la valeur, le miroir ne s'écrit pas.
      if (err.status === 409 && err.code === 'portal_disconnected') return { issue: 'echec', motif: 'le portail HubSpot est déconnecté : reconnectez-le' };
      return { issue: 'echec', motif: `HubSpot n’a pas pu écrire la valeur (erreur ${err.status})` };
    }
    return { issue: 'echec', motif: 'HubSpot injoignable' };
  }
  const r = reponseEcritureChamp.safeParse(brut);
  if (!r.success) return { issue: 'echec', motif: 'réponse illisible du connecteur HubSpot' };
  switch (r.data.issue) {
    case 'ecrit': return { issue: 'ecrit' };
    case 'non_choisi': return { issue: 'fiche_seule' };
    // Aucun contact HubSpot pour ce numéro (un contact né sur WhatsApp) : rien à tenir égal, la fiche s'écrit seule
    // (décision de Julien du 2026-11-06, sans ligne au journal : ce n'est pas une panne).
    case 'contact_inconnu': return { issue: 'fiche_seule' };
    case 'refuse': return { issue: 'echec', motif: `HubSpot refuse la valeur${r.data.message ? ` : ${r.data.message}` : ''}` };
  }
}

/*
 * L'INBOX HUBSPOT (lot 1 de l'Inbox, tâche 6 du plan `~/mm-hubspot/docs/2026-11-06-inbox-hubspot-lot1-plan.md`). Le
 * connecteur porte le canal personnalisé « WhatsApp (Messaging Me) » ; mba lui dit quelle boîte brancher et lui pousse
 * les messages. Les quatre routes exigent les trois portées `conversations.*` du portail (409
 * `portees_inbox_manquantes` sinon), qu'un admin accorde par la réautorisation habituelle (`grant=lists`, qui
 * redemande toutes les portées facultatives).
 */

/** Une boîte de réception du portail, pour le menu de la console. */
export interface BoiteInbox { id: string; nom: string; type: string | null }

const reponseBoites = z.object({ boites: z.array(z.object({ id: z.string(), nom: z.string(), type: z.string().nullable() })) });

/** Les boîtes du portail. Un seul essai sous 8 s (un affichage n'attend pas les reprises) ; tout échec LÈVE. */
export async function lireBoitesInbox(deps: ConnectorDeps, tenantId: string): Promise<BoiteInbox[]> {
  const r = reponseBoites.safeParse(await callService<unknown>(deps, '/service/inbox/boites', { tenantId }, 8_000));
  if (!r.success) throw new HubspotServiceError(502, 'reponse_illisible', false);
  return r.data.boites;
}

/**
 * Branche la ligne WhatsApp de l'espace sur une boîte : le connecteur crée le compte de canal (ou rend celui qui
 * existe pour cette boîte). Un seul essai sous 25 s (le connecteur endormi met ~16 s à se réveiller), c'est un geste de la console ; tout échec LÈVE
 * (`HubspotServiceError` 409 `deja_branche` si la ligne l'est sur une autre boîte).
 */
export async function brancherInbox(
  deps: ConnectorDeps,
  corps: { tenantId: string; ligne: string; inboxId: string; nom: string },
): Promise<void> {
  await callService<unknown>(deps, '/service/inbox/brancher', corps, 25_000);
}

/** Débranche la ligne : le connecteur désautorise le compte de canal et l'oublie. Idempotent ; tout échec LÈVE. */
export async function debrancherInbox(deps: ConnectorDeps, corps: { tenantId: string; ligne: string }): Promise<void> {
  await callService<unknown>(deps, '/service/inbox/debrancher', corps, 25_000);
}

/** Un message poussé au connecteur : `id` (uuid de `conversation_messages`) est la clé d'idempotence chez HubSpot. */
export interface MessageInboxHubspot {
  id: string;
  conversationId: string;
  sens: 'in' | 'out';
  texte: string;
  le: string;
  contactE164: string;
  contactNom: string | null;
  expediteur: string | null;
}

/**
 * L'issue d'un lot poussé. `fait` : publié (les refus propres à un message sont dans `refuses`, ils ne se rejouent pas).
 * `non_branche` : le connecteur n'a pas de compte de canal pour la ligne. `non_relie` : l'espace n'a plus de portail.
 * `portees` : le portail n'a pas (ou plus) les portées de l'Inbox. `refuse` : un autre 4xx, terminal.
 */
export type IssueInbox =
  | { issue: 'fait'; publies: number; refuses: number }
  | { issue: 'non_branche' }
  | { issue: 'non_relie' }
  | { issue: 'portees' }
  | { issue: 'refuse'; status: number; code: string | undefined };

const reponseMessages = z.object({ publies: z.number(), refuses: z.array(z.unknown()) });

/** Pousse un lot (50 au plus). 429, 5xx et réseau sont rejoués ici, puis LÈVENT : le balayage suivant rejoue le lot. */
export async function pousserMessagesInbox(
  deps: ConnectorDeps,
  corps: { tenantId: string; ligne: string; messages: MessageInboxHubspot[] },
): Promise<IssueInbox> {
  let reponse: unknown;
  try {
    reponse = await callService<unknown>(deps, '/service/inbox/messages', corps);
  } catch (err) {
    if (err instanceof HubspotServiceError && !err.retryable) {
      if (err.status === 404 && err.code === 'ligne_non_branchee') return { issue: 'non_branche' };
      if (err.status === 404 && err.code === 'tenant_not_connected') return { issue: 'non_relie' };
      if (err.status === 409 && err.code === 'portees_inbox_manquantes') return { issue: 'portees' };
      return { issue: 'refuse', status: err.status, code: err.code };
    }
    throw err;
  }
  const r = reponseMessages.safeParse(reponse);
  return r.success ? { issue: 'fait', publies: r.data.publies, refuses: r.data.refuses.length } : { issue: 'fait', publies: 0, refuses: 0 };
}
