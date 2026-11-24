import { z } from 'zod';
import { demanderJeton, type IssueJeton } from './connexion';
import { lireDroitsDeLApp } from './commandes-lues';
import { lireCollectionsDesProduits, type LotCollections } from './collections-lues';
import { DEMANDE_PERIMEE_MINUTES, type EtatLectureCollections, type IssueLecture, type MagasinCollections } from './collections.pg';
import type { PgShopifyStore } from './store.pg';
import type { CollectionsLuesVue, LectureCollectionsVue } from '../../web/lib/partage/segments';
import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';

/**
 * LA RÉSOLUTION DES COLLECTIONS DES PRODUITS ACHETÉS (segments Shopify enrichis, lot 6a ; spec, chantier 1, « La
 * résolution des collections ») : une collection n'est pas dans la ligne d'une commande, elle se lit sur le produit, chez
 * Shopify, depuis un job (jamais sur le chemin du webhook, que Shopify coupe à 5 s).
 *
 * Un job par espace, enfilé par la lecture de la liste (le volet Shopify de la console, `get_shopify_state`) quand un
 * produit acheté n'a jamais été lu ou date de plus de 24 h : aucun passage quotidien de toutes les boutiques. Le job lit
 * d'abord les droits de l'app (sans `read_products`, rien n'est lu et l'état le dit), inscrit au cache les produits vus
 * dans les lignes, puis réserve les produits à lire par lots (bail, `for update skip locked` : pg-boss ne déduplique
 * rien), les lit par `nodes(ids:)` et remplace leurs collections. Il passe au plus `PASSAGE_COLLECTIONS_MS`, puis se
 * réenfile ; la lecture est ABOUTIE quand plus aucun produit n'attend, et c'est elle qui ouvre le critère.
 *
 * 🔴 « A acheté dans la collection » veut dire « un produit qui est dans cette collection à la dernière lecture » : l'API
 * ne rend pas l'appartenance passée, et une collection automatique bouge sans qu'une commande change. L'écran et l'outil
 * le disent, avec la date de la lecture.
 */

export const FILE_COLLECTIONS = 'shopify-collections';
/** Un passage du job ; au-delà, il se réenfile, et les produits pas encore lus restent à lire. */
export const PASSAGE_COLLECTIONS_MS = 120_000;
/**
 * Les produits d'un lot. Environ 53 points de coût demandé chacun avec leurs 50 collections (le plafond d'une requête est
 * de 1 000) : un lot trop lourd pour Shopify se redemande plus petit, et chaque passage journalise le coût de son premier
 * lot (`shopify_collections_cout`), de quoi régler ce nombre sur la mesure.
 */
export const PRODUITS_PAR_LOT = 10;
/** Le délai d'un lot, frein de Shopify compris. */
const DELAI_LOT_MS = 20_000;
/** Les collections rendues à la console et à l'outil, celles qui portent le plus de produits commandés d'abord. */
export const COLLECTIONS_LISTEES = 50;

export const schemaJobCollections = z.object({ tenantId: z.string().uuid() });
export type JobCollections = z.infer<typeof schemaJobCollections>;

const BOUTIQUE_COUPEE = 'La boutique Shopify est coupée : ses collections ne se relisent plus.';
const BOUTIQUE_CHANGEE = 'La boutique Shopify a changé pendant la lecture de ses collections : elle reprendra à la prochaine demande.';
/** Le droit qui manque à une app créée avant le 2026-11-24 : la phrase dit comment l'ajouter. */
export const SANS_READ_PRODUCTS_COLLECTIONS = 'Pour lire les collections de vos produits, l’app Messaging Me de la boutique doit '
  + 'avoir le droit read_products : ajoutez-le à ses portées, publiez sa nouvelle version, puis réinstallez-la sur la boutique '
  + 'pour l’accepter (depuis Claude Code, la skill shopify le fait). Rien n’a été lu.';

export interface DepsCollections {
  magasin: MagasinCollections;
  /** La boutique de l'espace et son secret déchiffré ; `null` sans boutique (effacée). */
  boutique(tenantId: string): Promise<{ domaine: string; clientId: string; secret: string; etat: string } | null>;
  /** L'état de la boutique, sans son secret : seule une boutique branchée relit ses collections. */
  etatBoutique(tenantId: string): Promise<string | null>;
  jeton(domaine: string, clientId: string, secret: string): Promise<IssueJeton>;
  /** Les droits accordés à l'app de la boutique : sans `read_products`, aucune collection ne se lit. */
  droits(acces: { domaine: string; jeton: string }): Promise<{ ok: true; droits: string[] } | { ok: false; code: 'acces_refuse' | 'passager'; message: string }>;
  /** Un lot ; `delaiMs` borne l'appel ENTIER, attentes du frein de Shopify comprises. */
  lireLot(acces: { domaine: string; jeton: string }, p: { produits: readonly string[]; delaiMs: number }): Promise<LotCollections>;
  enfiler(job: JobCollections, dansSecondes: number): Promise<void>;
  maintenant?: () => number;
}

/**
 * LE CÂBLAGE COMMUN de l'API (la liste, qui enfile) et du worker (le job) : écrit une fois, pour qu'ils ne divergent pas.
 * Les magasins passent ENTIERS ou par une flèche : leurs méthodes lisent `this`.
 */
export function cablerCollections(o: {
  magasin: MagasinCollections;
  boutiques: Pick<PgShopifyStore, 'acces' | 'lire'>;
  /** `queue.enqueue` de la file `FILE_COLLECTIONS`, différé à `quand` s'il est donné. */
  enfiler: (job: JobCollections, quand: Date | undefined) => Promise<void>;
}): DepsCollections {
  return {
    magasin: o.magasin,
    boutique: (tenantId) => o.boutiques.acces(tenantId),
    etatBoutique: async (tenantId) => (await o.boutiques.lire(tenantId))?.etat ?? null,
    jeton: (domaine, clientId, secret) => demanderJeton(domaine, clientId, secret),
    droits: (acces) => lireDroitsDeLApp(acces),
    lireLot: (acces, p) => lireCollectionsDesProduits(acces, p),
    enfiler: (job, dansSecondes) => o.enfiler(job, dansSecondes > 0 ? new Date(Date.now() + dansSecondes * 1000) : undefined),
  };
}

/**
 * La vue de l'état de la lecture : en cours tant qu'une demande vive (moins de 15 minutes) attend son issue ; le refus de
 * la dernière lecture, tant qu'une nouvelle n'est pas en cours.
 */
export function vueLecture(e: EtatLectureCollections | null, maintenant: number): LectureCollectionsVue {
  const enCours = e !== null && e.demandeeLe !== null && maintenant - e.demandeeLe.getTime() < DEMANDE_PERIMEE_MINUTES * 60_000
    && (e.issueLe === null || e.issueLe.getTime() < e.demandeeLe.getTime());
  const refus = !enCours && e !== null && e.issue !== null && e.issue !== 'lue'
    ? { code: e.issue, message: e.message ?? '' }
    : null;
  return { lueLe: e?.lueLe?.toISOString() ?? null, enCours, refus, incompletes: e?.incompletes ?? false };
}

/**
 * LA LISTE DES COLLECTIONS LUES ET L'ÉTAT DE LA LECTURE (`GET .../contacts/segments/collections`, `get_shopify_state`).
 * Une boutique branchée dont un produit acheté attend une lecture en reçoit une : la demande posée (une seule à la fois,
 * `demander`), le job enfilé. 🔴 Un job qui n'a pas pu être enfilé efface sa demande : sinon la lecture se dirait en cours
 * un quart d'heure sans que rien ne tourne. La liste se rend quand même.
 */
export async function lireCollections(
  deps: Pick<DepsCollections, 'magasin' | 'etatBoutique' | 'enfiler' | 'maintenant'>, tenantId: string, recherche: string | undefined,
): Promise<CollectionsLuesVue> {
  if ((await deps.etatBoutique(tenantId)) === 'connectee' && (await deps.magasin.aLire(tenantId))) {
    const le = await deps.magasin.demander(tenantId);
    if (le !== null) {
      try {
        await deps.enfiler({ tenantId }, 0);
      } catch (err) {
        journaliser('warn', 'shopify_collections_non_enfilee', { tenantId, erreur: messageDe(err) });
        await deps.magasin.annulerDemande(tenantId, le).catch(() => undefined);
      }
    }
  }
  const [etat, collections] = await Promise.all([
    deps.magasin.etat(tenantId),
    deps.magasin.collections(tenantId, recherche, COLLECTIONS_LISTEES),
  ]);
  return { collections, lecture: vueLecture(etat, (deps.maintenant ?? Date.now)()) };
}

/**
 * UN PASSAGE DU JOB. Boutique effacée : rien. Coupée : l'issue le dit. Refus de Shopify ou droit manquant : l'issue le
 * dit, rien n'est lu. Puis les lots, jusqu'à ce qu'aucun produit ne reste à réserver ou que le passage soit fini. 🔴 TOUTE
 * panne pendant un lot libère son bail AVANT de remonter : pg-boss rejoue le job, ses essais s'usent, et les produits du
 * lot sont repris tout de suite au lieu d'attendre la fin du bail.
 */
export async function traiterCollections(deps: DepsCollections, data: unknown): Promise<void> {
  const j = schemaJobCollections.safeParse(data);
  if (!j.success) {
    journaliser('warn', 'shopify_collections_illisible', { erreur: j.error.issues[0]?.message ?? 'invalide' });
    return;
  }
  const { tenantId } = j.data;
  const noter = (issue: IssueLecture, message: string | null) => deps.magasin.noterIssue(tenantId, issue, message);
  const b = await deps.boutique(tenantId);
  if (!b) return;
  if (b.etat !== 'connectee') { await noter('erreur', BOUTIQUE_COUPEE); return; }
  const jt = await deps.jeton(b.domaine, b.clientId, b.secret);
  if (!jt.ok) {
    if (jt.code === 'passager') throw new Error(jt.message);
    await noter('refusee', jt.message);
    return;
  }
  const acces = { domaine: b.domaine, jeton: jt.jeton };
  const d = await deps.droits(acces);
  if (!d.ok) {
    if (d.code === 'passager') throw new Error(d.message);
    await noter('refusee', d.message);
    return;
  }
  if (!d.droits.includes('read_products')) { await noter('sans_droit', SANS_READ_PRODUCTS_COLLECTIONS); return; }

  await deps.magasin.synchroniser(tenantId);
  const maintenant = deps.maintenant ?? Date.now;
  const debut = maintenant();
  let parLot = PRODUITS_PAR_LOT;
  let premier = true;
  for (;;) {
    if (maintenant() - debut >= PASSAGE_COLLECTIONS_MS) {
      // Les produits pas encore lus restent à lire : le passage suivant les reprend.
      await deps.enfiler({ tenantId }, 0);
      return;
    }
    const lot = await deps.magasin.reserver(tenantId, parLot);
    if (lot.produits.length === 0) {
      // Plus rien à réserver. Des produits encore à lire sont tenus par un autre passage : c'est lui qui finira.
      if (!(await deps.magasin.resteALire(tenantId))) await noter('lue', null);
      return;
    }
    const suite = await traiterLot(deps, tenantId, acces, b.domaine, lot, parLot, premier);
    if (suite === 'fin') return;
    if (suite === 'plus_petit') { parLot = Math.max(1, Math.floor(parLot / 2)); continue; }
    premier = false;
  }
}

/** Un lot réservé : lu, écrit, ou libéré (panne, refus, lot trop lourd, boutique coupée ou changée entre-temps). */
async function traiterLot(
  deps: DepsCollections, tenantId: string, acces: { domaine: string; jeton: string }, domaine: string,
  lot: { jeton: string; produits: string[] }, parLot: number, premier: boolean,
): Promise<'suite' | 'plus_petit' | 'fin'> {
  const liberer = () => deps.magasin.liberer(tenantId, lot.jeton);
  try {
    const lu = await deps.lireLot(acces, { produits: lot.produits, delaiMs: DELAI_LOT_MS });
    if (!lu.ok) {
      if (lu.code === 'trop_lourd' && parLot > 1) { await liberer(); return 'plus_petit'; }
      if (lu.code === 'acces_refuse') { await liberer(); await deps.magasin.noterIssue(tenantId, 'refusee', lu.message); return 'fin'; }
      // Une panne passagère, ou un seul produit encore trop lourd : le `catch` rend le bail, pg-boss rejoue.
      throw new Error(lu.message);
    }
    if (premier) journaliser('info', 'shopify_collections_cout', { tenantId, parLot, demande: lu.cout.demande, reel: lu.cout.reel });
    // 🔴 La boutique relue avant d'écrire : coupée, effacée ou remplacée pendant le passage, rien de ce lot ne s'écrit.
    const relue = await deps.boutique(tenantId);
    if (relue === null || relue.etat !== 'connectee' || relue.domaine !== domaine) {
      await liberer();
      if (relue !== null) await deps.magasin.noterIssue(tenantId, 'erreur', relue.etat !== 'connectee' ? BOUTIQUE_COUPEE : BOUTIQUE_CHANGEE);
      return 'fin';
    }
    await deps.magasin.ecrire(tenantId, lot.jeton, lu.produits);
    return 'suite';
  } catch (err) {
    await liberer().catch(() => undefined);
    throw err;
  }
}
