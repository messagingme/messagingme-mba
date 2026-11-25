import { z } from 'zod';
import { demanderJeton, type IssueJeton } from './connexion';
import { lireDroitsDeLApp } from './commandes-lues';
import {
  CLIENTS_PAR_LOT, TELEPHONES_PAR_RECHERCHE, chercherParTelephones, lireClientsParIds, type LotClients, type RechercheTelephones,
} from './etiquettes-lues';
import {
  BAIL_SYNCHRO_SECONDES, RELECTURE_HEURES, SYNCHRO_PERIMEE_MINUTES, type EtatSynchroEtiquettes, type IssueSynchro, type MagasinEtiquettes,
} from './etiquettes.pg';
import {
  creerRequeteAsynchrone, lirePageMembres, listerSegments, suivreRequeteAsynchrone, type ListeSegments, type PageMembres,
  type RequeteAsynchrone, type SuiviRequete,
} from './segments-lues';
import type { CoutRequete } from './reprise';
import type { PgShopifyStore } from './store.pg';
import type { Offre } from '../offres/offres';
import { BORNES_SEGMENTS, type EtiquettesShopifyLuesVue, type SegmentsShopifyLusVue, type SynchroEtiquettesVue } from '../../web/lib/partage/segments';
import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';

/**
 * LA SYNCHRONISATION DES ÉTIQUETTES DES CLIENTS SHOPIFY (segments Shopify enrichis, lot 6b ; spec, chantier 4, lot 4a ;
 * plan `docs/superpowers/plans/2026-11-24-segments-shopify-lot-6b-etiquettes.md`). Les étiquettes que le marchand pose sur
 * ses clients DANS SHOPIFY, lues dans une table à part (`./etiquettes.pg.ts`) : jamais copiées dans les étiquettes
 * Messaging Me, sauf par la copie explicite du marchand.
 *
 * 🔴 ÉTEINTE TANT QUE LE MARCHAND NE L'ALLUME PAS (la carte Shopify, ou `sync_shopify_customer_tags`) ; jamais au
 * branchement, jamais un passage de toutes les boutiques. Allumée : en Pro, Business et Entreprise, le balayage horaire du
 * worker la relance au plus une fois par 24 h (`relancerEtiquettesDues`), plus le bouton « maintenant » ; en Free, le même
 * travail, à la demande seulement, au plus une fois par 24 h.
 *
 * UN PASSAGE DU JOB : le bail pris (pg-boss ne déduplique rien), la boutique et les droits de son app lus d'abord
 * (`read_customers` suffit), puis deux temps, chacun repris là où il en était au passage suivant :
 * 1. les fiches pas encore cherchées sont cherchées par leur téléphone (25 téléphones par recherche) : un client se relie à
 *    chaque fiche de ses numéros chez Shopify, ses coordonnées ou ses adresses enregistrées (lot 6b bis, décision
 *    de Julien du 2026-11-25, « le max de numéros ») ; une fiche se relie à tous les clients qui ont son numéro ;
 * 2. les clients reliés sont lus par lots de 250 (`nodes(ids:)`), depuis le dernier lu, et leurs étiquettes REMPLACÉES en
 *    bloc sur chacune de leurs fiches.
 * Le geste du marchand (`synchroniserEtiquettes`) fait chercher de nouveau toutes les fiches ; la relecture quotidienne,
 * seulement celles jamais cherchées. La boutique est relue avant chaque écriture ; le passage dure au plus
 * `PASSAGE_ETIQUETTES_MS`, puis se réenfile. La synchronisation est ABOUTIE quand le dernier client relié est lu : c'est
 * elle qui ouvre le critère d'étiquette Shopify. Le coût du premier lot de chaque temps est journalisé
 * (`shopify_etiquettes_cout`), le frein de Shopify respecté.
 *
 * LOT 6c, LES SEGMENTS NATIFS : la même synchronisation (le même interrupteur, le même bail, la même relecture) relit au
 * début de chaque passage la liste des segments de la boutique, puis, en troisième temps, les membres de chaque segment
 * SUIVI (20 au plus, le choix du marchand), page par page, rattachés aux fiches par les liens du premier temps. Un segment
 * lourd passe par la requête asynchrone de Shopify ; pas prête, le passage se réenfile un peu plus tard.
 *
 * Le lien ne passe pas par `shopify_commandes` (la fiche d'une commande est celle de son téléphone de livraison d'abord,
 * `telephoneDeCommande`) mais par les numéros que Shopify rend pour le client lui-même, revérifiés.
 */

export const FILE_ETIQUETTES = 'shopify-etiquettes';
/** Un passage du job ; au-delà, il se réenfile, et la synchronisation reprend au dernier client lu. */
export const PASSAGE_ETIQUETTES_MS = 120_000;
/** Le délai d'un lot, frein de Shopify compris. */
const DELAI_LOT_MS = 20_000;
/** Les étiquettes rendues à la console et à l'outil, celles que portent le plus de fiches d'abord. */
export const ETIQUETTES_LISTEES = 50;
/** Lot 6c : une requête asynchrone de segment pas encore prête ; le passage se réenfile après ce délai. */
export const REQUETE_ASYNCHRONE_ATTENTE_S = 15;
/** Lot 6c : l'attente la plus longue d'une requête asynchrone, depuis sa création ; au-delà, la synchronisation s'arrête en erreur. */
export const REQUETE_ASYNCHRONE_MAX_MS = 30 * 60_000;
/** Les espaces relancés par un passage du balayage horaire ; les suivants attendent le passage d'après. */
export const DUES_PAR_BALAYAGE = 200;

export const schemaJobEtiquettes = z.object({ tenantId: z.string().uuid() });
export type JobEtiquettes = z.infer<typeof schemaJobEtiquettes>;

export const AUCUNE_BOUTIQUE_ETIQUETTES = 'Aucune boutique Shopify n’est branchée dans cet espace : branchez-la avant de synchroniser '
  + 'les étiquettes de ses clients.';
export const BOUTIQUE_COUPEE_ETIQUETTES = 'La boutique Shopify est coupée : rebranchez-la pour synchroniser les étiquettes de ses clients.';
const BOUTIQUE_CHANGEE = 'La boutique Shopify a changé pendant la synchronisation des étiquettes : elle reprendra à la prochaine demande.';
export const SYNCHRO_ETEINTE = 'La synchronisation des étiquettes Shopify est éteinte : allumez-la d’abord (carte Shopify, ou '
  + 'sync_shopify_customer_tags depuis Claude).';
/** Le droit qui manque : la phrase dit comment l'ajouter. */
export const SANS_READ_CUSTOMERS = 'Pour lire les étiquettes de vos clients, l’app Messaging Me de la boutique doit avoir le droit '
  + 'read_customers : ajoutez-le à ses portées, publiez sa nouvelle version, puis réinstallez-la sur la boutique pour l’accepter '
  + '(depuis Claude Code, la skill shopify le fait). Rien n’a été lu.';

export interface DepsEtiquettes {
  magasin: MagasinEtiquettes;
  /** La boutique de l'espace et son secret déchiffré ; `null` sans boutique (effacée). */
  boutique(tenantId: string): Promise<{ domaine: string; clientId: string; secret: string; pays: string | null; etat: string } | null>;
  /** L'état de la boutique, sans son secret : seule une boutique branchée se synchronise. */
  etatBoutique(tenantId: string): Promise<string | null>;
  jeton(domaine: string, clientId: string, secret: string): Promise<IssueJeton>;
  /** Les droits accordés à l'app de la boutique : sans `read_customers`, rien ne se lit. */
  droits(acces: { domaine: string; jeton: string }): Promise<{ ok: true; droits: string[] } | { ok: false; code: 'acces_refuse' | 'passager'; message: string }>;
  /** Un lot de clients reliés, par leur identifiant ; `delaiMs` borne l'appel ENTIER, attentes du frein comprises. */
  lireClients(acces: { domaine: string; jeton: string }, p: { ids: readonly string[]; delaiMs: number }): Promise<LotClients>;
  /** Une recherche de clients par téléphones, revérifiés sur tous leurs numéros (coordonnées, adresses enregistrées). */
  chercher(acces: { domaine: string; jeton: string }, p: { telephones: readonly string[]; pays: string | null; delaiMs: number }): Promise<RechercheTelephones>;
  /** Lot 6c : la liste des segments de la boutique. */
  listerSegments(acces: { domaine: string; jeton: string }, p: { delaiMs: number }): Promise<ListeSegments>;
  /** Une page de membres d'un segment, directement ou par sa requête asynchrone. */
  lireMembres(acces: { domaine: string; jeton: string }, p: { segmentId: string; requete: string | null; apres: string | null; delaiMs: number }): Promise<PageMembres>;
  /** La requête asynchrone d'un segment lourd : la créer, puis la suivre jusqu'à `done`. */
  creerRequete(acces: { domaine: string; jeton: string }, p: { segmentId: string; delaiMs: number }): Promise<RequeteAsynchrone>;
  suivreRequete(acces: { domaine: string; jeton: string }, p: { requete: string; delaiMs: number }): Promise<SuiviRequete>;
  /** L'offre de l'espace : la Free synchronise à la demande, au plus une fois par 24 h. */
  offre(tenantId: string): Promise<Offre>;
  enfiler(job: JobEtiquettes, dansSecondes: number): Promise<void>;
  maintenant?: () => number;
}

/**
 * LE CÂBLAGE COMMUN de l'API (la carte, le volet, l'outil) et du worker (le job, le balayage) : écrit une fois, pour qu'ils
 * ne divergent pas. Les magasins passent ENTIERS ou par une flèche : leurs méthodes lisent `this`.
 */
export function cablerEtiquettes(o: {
  magasin: MagasinEtiquettes;
  boutiques: Pick<PgShopifyStore, 'acces' | 'lire'>;
  /** L'offre effective de l'espace (le cache des offres). */
  offre: (tenantId: string) => Promise<Offre>;
  /** `queue.enqueue` de la file `FILE_ETIQUETTES`, différé à `quand` s'il est donné. */
  enfiler: (job: JobEtiquettes, quand: Date | undefined) => Promise<void>;
}): DepsEtiquettes {
  return {
    magasin: o.magasin,
    boutique: (tenantId) => o.boutiques.acces(tenantId),
    etatBoutique: async (tenantId) => (await o.boutiques.lire(tenantId))?.etat ?? null,
    jeton: (domaine, clientId, secret) => demanderJeton(domaine, clientId, secret),
    droits: (acces) => lireDroitsDeLApp(acces),
    lireClients: (acces, p) => lireClientsParIds(acces, p),
    chercher: (acces, p) => chercherParTelephones(acces, p),
    listerSegments: (acces, p) => listerSegments(acces, p),
    lireMembres: (acces, p) => lirePageMembres(acces, p),
    creerRequete: (acces, p) => creerRequeteAsynchrone(acces, p),
    suivreRequete: (acces, p) => suivreRequeteAsynchrone(acces, p),
    offre: (tenantId) => o.offre(tenantId),
    enfiler: (job, dansSecondes) => o.enfiler(job, dansSecondes > 0 ? new Date(Date.now() + dansSecondes * 1000) : undefined),
  };
}

const SANS_COMPTES: SynchroEtiquettesVue['comptes'] = { clientsLus: 0, trouvesParTelephone: 0, sansFiche: 0, fichesEtiquetees: 0 };

/**
 * La vue de l'état : en cours tant qu'un job tient la synchronisation ou qu'elle a progressé depuis moins d'un quart
 * d'heure ; le refus de la dernière synchronisation, tant qu'une nouvelle ne tourne pas.
 */
export function vueSynchro(e: EtatSynchroEtiquettes | null, maintenant: number): SynchroEtiquettesVue {
  const enCours = e !== null && e.enCoursDepuis !== null
    && (e.tenue || (e.majLe !== null && maintenant - e.majLe.getTime() < SYNCHRO_PERIMEE_MINUTES * 60_000));
  const refus = !enCours && e !== null && e.issue !== null && e.issue !== 'lue'
    ? { code: e.issue, message: e.message ?? '' }
    : null;
  return { allumee: e?.allumee ?? false, synchroLe: e?.synchroLe?.toISOString() ?? null, enCours, refus, comptes: e?.comptes ?? SANS_COMPTES };
}

/** Un refus de la gestion : son statut et sa phrase ; `reessayerDansS` pour la Free qui redemande trop tôt. */
export type RefusEtiquettes = { ok: false; statut: 409 | 429; message: string; reessayerDansS?: number };
export type IssueEtiquettes<T> = { ok: true; valeur: T } | RefusEtiquettes;
const refus = (message: string): RefusEtiquettes => ({ ok: false, statut: 409, message });

/** Les étiquettes lues et l'état de la synchronisation : le volet Shopify des filtres, la carte, `get_shopify_state`. */
export async function lireEtiquettes(
  deps: Pick<DepsEtiquettes, 'magasin' | 'maintenant'>, tenantId: string, recherche: string | undefined,
): Promise<EtiquettesShopifyLuesVue> {
  const [etat, etiquettes] = await Promise.all([
    deps.magasin.etat(tenantId), deps.magasin.etiquettes(tenantId, recherche, ETIQUETTES_LISTEES),
  ]);
  return { etiquettes, synchro: vueSynchro(etat, (deps.maintenant ?? Date.now)()) };
}

/**
 * « MAINTENANT » : une synchronisation de la boutique branchée dont la synchronisation est allumée, qui cherche de nouveau
 * TOUTES les fiches (`demander` efface leurs marques, lot 6b bis). Une synchronisation
 * qui tourne déjà n'en lance pas une seconde (`lancee: false`). La Free est refusée si sa dernière demande date de moins de
 * 24 h, avec le délai. 🔴 Un job qui n'a pas pu être enfilé efface sa demande : sinon la synchronisation se dirait en
 * cours un quart d'heure sans que rien ne tourne, et compterait dans les 24 h de la Free.
 */
export async function synchroniserEtiquettes(
  deps: Pick<DepsEtiquettes, 'magasin' | 'etatBoutique' | 'offre' | 'enfiler' | 'maintenant'>, tenantId: string,
): Promise<IssueEtiquettes<SynchroEtiquettesVue & { lancee: boolean }>> {
  const maintenant = deps.maintenant ?? Date.now;
  const boutique = await deps.etatBoutique(tenantId);
  if (boutique === null) return refus(AUCUNE_BOUTIQUE_ETIQUETTES);
  if (boutique !== 'connectee') return refus(BOUTIQUE_COUPEE_ETIQUETTES);
  if (!(await deps.magasin.etat(tenantId))?.allumee) return refus(SYNCHRO_ETEINTE);
  const free = (await deps.offre(tenantId)) === 'base';
  const le = await deps.magasin.demander(tenantId, { auPlusUneFoisParJour: free });
  if (le === null) {
    const e = await deps.magasin.etat(tenantId);
    const v = vueSynchro(e, maintenant());
    if (v.enCours || !free) return { ok: true, valeur: { ...v, lancee: false } };
    const resteMs = Math.max(1000, (e?.demandeeLe?.getTime() ?? maintenant()) + RELECTURE_HEURES * 3_600_000 - maintenant());
    const heures = Math.ceil(resteMs / 3_600_000);
    return {
      ok: false, statut: 429, reessayerDansS: Math.ceil(resteMs / 1000),
      message: 'Sur l’offre Free, les étiquettes Shopify se synchronisent au plus une fois toutes les 24 heures : la prochaine '
        + `est possible dans ${heures} heure${heures > 1 ? 's' : ''}. Avec l’offre Pro, elles se relisent seules chaque jour.`,
    };
  }
  try {
    await deps.enfiler({ tenantId }, 0);
  } catch (err) {
    journaliser('warn', 'shopify_etiquettes_non_enfilee', { tenantId, erreur: messageDe(err) });
    await deps.magasin.annulerDemande(tenantId, le).catch(() => undefined);
    throw err;
  }
  return { ok: true, valeur: { ...vueSynchro(await deps.magasin.etat(tenantId), maintenant()), lancee: true } };
}

/**
 * LE RÉGLAGE DU MARCHAND : allumer lance aussitôt une synchronisation (la boutique doit être branchée) ; éteindre arrête la
 * relecture quotidienne, garde ce qui a été lu, et laisse finir une synchronisation en cours.
 */
export async function reglerEtiquettes(
  deps: Pick<DepsEtiquettes, 'magasin' | 'etatBoutique' | 'offre' | 'enfiler' | 'maintenant'>, tenantId: string, allumee: boolean,
): Promise<IssueEtiquettes<SynchroEtiquettesVue & { lancee: boolean }>> {
  if (!allumee) {
    await deps.magasin.regler(tenantId, false);
    return { ok: true, valeur: { ...vueSynchro(await deps.magasin.etat(tenantId), (deps.maintenant ?? Date.now)()), lancee: false } };
  }
  const boutique = await deps.etatBoutique(tenantId);
  if (boutique === null) return refus(AUCUNE_BOUTIQUE_ETIQUETTES);
  if (boutique !== 'connectee') return refus(BOUTIQUE_COUPEE_ETIQUETTES);
  await deps.magasin.regler(tenantId, true);
  return synchroniserEtiquettes(deps, tenantId);
}

/** Les segments lus et l'état de la synchronisation (lot 6c) : le volet Shopify des filtres, la carte, `get_shopify_state`. */
export async function lireSegments(deps: Pick<DepsEtiquettes, 'magasin' | 'maintenant'>, tenantId: string): Promise<SegmentsShopifyLusVue> {
  const [etat, segments] = await Promise.all([deps.magasin.etat(tenantId), deps.magasin.segments(tenantId)]);
  return { segments, synchro: vueSynchro(etat, (deps.maintenant ?? Date.now)()) };
}

/**
 * LE CHOIX DES SEGMENTS SUIVIS (lot 6c), par la carte ou l'outil : exactement ces segments, `segmentsShopifyMax` au plus,
 * chacun connu (lu dans la liste de la boutique) et encore chez Shopify ; puis une synchronisation, comme « maintenant »,
 * pour les lire. Un choix vide arrête le suivi de tous. La synchronisation doit être allumée : c'est elle qui les lit.
 */
export async function suivreSegmentsShopify(
  deps: Pick<DepsEtiquettes, 'magasin' | 'etatBoutique' | 'offre' | 'enfiler' | 'maintenant'>, tenantId: string, segmentIds: readonly string[],
): Promise<IssueEtiquettes<SynchroEtiquettesVue & { lancee: boolean }>> {
  const ids = [...new Set(segmentIds)];
  if (ids.length > BORNES_SEGMENTS.segmentsShopifyMax) {
    return refus(`${BORNES_SEGMENTS.segmentsShopifyMax} segments suivis au plus : retirez-en avant d’en ajouter.`);
  }
  const boutique = await deps.etatBoutique(tenantId);
  if (boutique === null) return refus(AUCUNE_BOUTIQUE_ETIQUETTES);
  if (boutique !== 'connectee') return refus(BOUTIQUE_COUPEE_ETIQUETTES);
  if (!(await deps.magasin.etat(tenantId))?.allumee) return refus(SYNCHRO_ETEINTE);
  const { inconnus } = await deps.magasin.suivreSegments(tenantId, ids);
  if (inconnus.length > 0) {
    return refus(`Segment inconnu de cet espace ou disparu chez Shopify : ${inconnus.slice(0, 5).join(', ')}. La liste se relit à chaque `
      + 'synchronisation : lancez-en une, puis choisissez parmi les segments lus.');
  }
  const sansLecture = async () => ({ ok: true as const, valeur: { ...vueSynchro(await deps.magasin.etat(tenantId), (deps.maintenant ?? Date.now)()), lancee: false } });
  if (ids.length === 0) return sansLecture();
  // Le choix est écrit : un refus de la lecture (la Free, une fois par 24 h) ne le défait pas, la prochaine lecture le lit.
  const s = await synchroniserEtiquettes(deps, tenantId);
  return s.ok ? s : sansLecture();
}

/**
 * LA RELECTURE QUOTIDIENNE, par le balayage horaire du worker (jamais un passage de toutes les boutiques) : les espaces
 * allumés en Pro et au-dessus dont la dernière demande date de plus de 24 h. Rend le nombre enfilé ; un job qui n'a pas pu
 * l'être efface sa demande, et le passage suivant le reprend.
 */
export async function relancerEtiquettesDues(deps: Pick<DepsEtiquettes, 'magasin' | 'enfiler'>): Promise<number> {
  let n = 0;
  for (const d of await deps.magasin.dues(DUES_PAR_BALAYAGE)) {
    try {
      await deps.enfiler({ tenantId: d.tenantId }, 0);
      n += 1;
    } catch (err) {
      journaliser('warn', 'shopify_etiquettes_non_enfilee', { tenantId: d.tenantId, erreur: messageDe(err) });
      await deps.magasin.annulerDemande(d.tenantId, d.le).catch(() => undefined);
    }
  }
  return n;
}

function journaliserCout(tenantId: string, quoi: 'telephones' | 'clients' | 'membres', taille: number, cout: CoutRequete): void {
  journaliser('info', 'shopify_etiquettes_cout', { tenantId, quoi, taille, demande: cout.demande, reel: cout.reel });
}

/**
 * UN PASSAGE DU JOB. Une synchronisation tenue par un autre passage : on repasse voir après une partie de son bail (s'il
 * meurt, on la reprend). 🔴 TOUTE panne libère le bail AVANT de remonter : pg-boss rejoue le job, ses essais s'usent, et la
 * synchronisation reprend tout de suite au dernier client lu au lieu d'attendre la fin du bail.
 */
export async function traiterEtiquettes(deps: DepsEtiquettes, data: unknown): Promise<void> {
  const j = schemaJobEtiquettes.safeParse(data);
  if (!j.success) {
    journaliser('warn', 'shopify_etiquettes_illisible', { erreur: j.error.issues[0]?.message ?? 'invalide' });
    return;
  }
  const { tenantId } = j.data;
  const prise = await deps.magasin.prendre(tenantId);
  if (!prise) {
    const e = await deps.magasin.etat(tenantId);
    if (e?.enCoursDepuis && e.tenue) await deps.enfiler(j.data, Math.ceil(BAIL_SYNCHRO_SECONDES / 3));
    return;
  }
  try {
    await passage(deps, tenantId, prise.jeton, prise.curseur);
  } catch (err) {
    await deps.magasin.relacher(tenantId, prise.jeton).catch(() => undefined);
    throw err;
  }
}

async function passage(deps: DepsEtiquettes, tenantId: string, jeton: string, curseurDepart: string | null): Promise<void> {
  const finir = (issue: IssueSynchro, message: string | null) => deps.magasin.finir(tenantId, jeton, issue, message);
  const b = await deps.boutique(tenantId);
  if (!b) { await finir('erreur', AUCUNE_BOUTIQUE_ETIQUETTES); return; }
  if (b.etat !== 'connectee') { await finir('erreur', BOUTIQUE_COUPEE_ETIQUETTES); return; }
  const jt = await deps.jeton(b.domaine, b.clientId, b.secret);
  if (!jt.ok) {
    if (jt.code === 'passager') throw new Error(jt.message);
    await finir('refusee', jt.message);
    return;
  }
  const acces = { domaine: b.domaine, jeton: jt.jeton };
  const d = await deps.droits(acces);
  if (!d.ok) {
    if (d.code === 'passager') throw new Error(d.message);
    await finir('refusee', d.message);
    return;
  }
  if (!d.droits.includes('read_customers')) { await finir('sans_droit', SANS_READ_CUSTOMERS); return; }

  const maintenant = deps.maintenant ?? Date.now;
  const debut = maintenant();
  const passageFini = (): boolean => maintenant() - debut >= PASSAGE_ETIQUETTES_MS;
  // La suite d'abord, le bail ensuite : un plantage entre les deux laisse un job qui attend la fin du bail, jamais une
  // synchronisation commencée sans job.
  const reenfiler = async (): Promise<void> => { await deps.enfiler({ tenantId }, 0); await deps.magasin.relacher(tenantId, jeton); };
  const reenfilerDans = async (secondes: number): Promise<void> => { await deps.enfiler({ tenantId }, secondes); await deps.magasin.relacher(tenantId, jeton); };
  // 🔴 La boutique relue avant d'écrire : coupée, effacée ou remplacée pendant le passage, rien de ce lot ne s'écrit.
  const boutiqueIntacte = async (): Promise<boolean> => {
    const relue = await deps.boutique(tenantId);
    if (relue !== null && relue.etat === 'connectee' && relue.domaine === b.domaine) return true;
    if (relue !== null) await finir('erreur', relue.etat !== 'connectee' ? BOUTIQUE_COUPEE_ETIQUETTES : BOUTIQUE_CHANGEE);
    return false;
  };

  // 1. Les fiches pas encore cherchées, par leur téléphone : chaque lot écrit les marque, et relie leurs clients.
  let parRecherche = TELEPHONES_PAR_RECHERCHE;
  let premiere = true;
  let apres: string | null = null;
  for (;;) {
    if (passageFini()) { await reenfiler(); return; }
    const fiches = await deps.magasin.aChercher(tenantId, parRecherche, apres);
    if (fiches.length === 0) break;
    const r = await deps.chercher(acces, { telephones: fiches.map((f) => f.telephone), pays: b.pays, delaiMs: DELAI_LOT_MS });
    if (!r.ok) {
      if (r.code === 'trop_lourd' && parRecherche > 1) { parRecherche = Math.max(1, Math.floor(parRecherche / 2)); continue; }
      if (r.code === 'acces_refuse') { await finir('refusee', r.message); return; }
      throw new Error(r.message);
    }
    // Une page incomplète ne prouve pas qu'un téléphone n'a pas de client : redemandée plus petite, et la taille réduite
    // vaut pour la fin du passage. Un seul téléphone dont la page est encore incomplète est écrit tel quel (un client trouvé
    // y est revérifié), sans défaire aucun lien de sa fiche, et sa fiche marquée.
    if (!r.complete && parRecherche > 1) { parRecherche = Math.max(1, Math.floor(parRecherche / 2)); continue; }
    if (premiere) { journaliserCout(tenantId, 'telephones', parRecherche, r.cout); premiere = false; }
    if (!(await boutiqueIntacte())) return;
    const ficheDe = new Map(fiches.map((f) => [f.telephone, f.contactId]));
    const trouves = r.trouves.flatMap((t) => {
      const contactId = ficheDe.get(t.telephone);
      return contactId === undefined ? [] : [{ contactId, clientId: t.clientId, etiquettes: t.etiquettes }];
    });
    if ((await deps.magasin.ecrireRecherche(tenantId, jeton, { cherchees: fiches.map((f) => f.contactId), trouves, complete: r.complete })) === null) return;
    apres = fiches[fiches.length - 1]!.telephone;
  }

  // 2. Les clients reliés, par lots, depuis le dernier lu : leurs étiquettes remplacées en bloc sur chacune de leurs fiches.
  let curseur = curseurDepart;
  let parLot = CLIENTS_PAR_LOT;
  premiere = true;
  for (;;) {
    if (passageFini()) { await reenfiler(); return; }
    const ids = await deps.magasin.clientsALire(tenantId, curseur, parLot);
    if (ids.length === 0) break;
    const lu = await deps.lireClients(acces, { ids, delaiMs: DELAI_LOT_MS });
    if (!lu.ok) {
      if (lu.code === 'trop_lourd' && parLot > 1) { parLot = Math.max(1, Math.floor(parLot / 2)); continue; }
      if (lu.code === 'acces_refuse') { await finir('refusee', lu.message); return; }
      throw new Error(lu.message);
    }
    if (premiere) { journaliserCout(tenantId, 'clients', parLot, lu.cout); premiere = false; }
    if (!(await boutiqueIntacte())) return;
    const dernier = ids[ids.length - 1]!;
    if (!(await deps.magasin.ecrireClients(tenantId, jeton, { lus: lu.clients, curseur: dernier }))) return;
    curseur = dernier;
  }

  // 3. Lot 6c : la liste des segments (13 points), relue à chaque passage qui arrive ici ; une liste incomplète ne fait
  // disparaître aucun segment. Puis les segments suivis, un par un, page par page ; leurs membres rattachés aux fiches par
  // les liens. 🔴 Les segments ne bloquent JAMAIS les étiquettes déjà lues : une liste refusée, un segment refusé ou une
  // requête jamais prête sont journalisés et laissés de côté pour ce passage (le segment se dit partiel si sa lecture avait
  // commencé, ses membres d'avant restent, la synchronisation suivante le reprend de zéro), et la synchronisation aboutit.
  // Une panne passagère remonte, comme partout ici (le passage est rejoué).
  const liste = await deps.listerSegments(acces, { delaiMs: DELAI_LOT_MS });
  if (!liste.ok) {
    if (liste.code !== 'acces_refuse') throw new Error(liste.message);
    journaliser('warn', 'shopify_segments_refuses', { tenantId, message: liste.message });
    await finir('lue', null);
    return;
  }
  if (!(await deps.magasin.ecrireSegments(tenantId, jeton, { segments: liste.segments, complete: liste.complete }))) return;
  const sautes: string[] = [];
  const sauter = (segmentId: string, raison: string): void => {
    journaliser('warn', 'shopify_segment_saute', { tenantId, segmentId, raison: raison.slice(0, 200) });
    sautes.push(segmentId);
  };
  premiere = true;
  for (;;) {
    if (passageFini()) { await reenfiler(); return; }
    const seg = await deps.magasin.prochainSegment(tenantId, jeton, sautes);
    if (seg === 'perdu') return;
    if (seg === null) { await finir('lue', null); return; }
    if (seg.requete !== null) {
      // 🔴 Une requête que Shopify ne prépare jamais ne réenfile pas la synchronisation sans fin : au-delà de la borne, le
      // segment est laissé de côté (contrôle local, sans appel), et la synchronisation va au suivant.
      if (seg.lectureDebut !== null && maintenant() - seg.lectureDebut.getTime() >= REQUETE_ASYNCHRONE_MAX_MS) {
        sauter(seg.segmentId, 'requete_jamais_prete');
        continue;
      }
      const suivi = await deps.suivreRequete(acces, { requete: seg.requete, delaiMs: DELAI_LOT_MS });
      if (!suivi.ok) {
        if (suivi.code === 'acces_refuse') { sauter(seg.segmentId, suivi.message); continue; }
        throw new Error(suivi.message);
      }
      // Une requête que Shopify ne connaît plus est oubliée, et recréée au passage suivant : une boutique qui les perdrait
      // toutes n'en ferait créer qu'une par attente, jusqu'à la borne.
      if (suivi.etat === 'perdue') {
        if (!(await deps.magasin.noterRequeteSegment(tenantId, jeton, seg.segmentId, null))) return;
        await reenfilerDans(REQUETE_ASYNCHRONE_ATTENTE_S);
        return;
      }
      if (suivi.etat === 'en_cours') { await reenfilerDans(REQUETE_ASYNCHRONE_ATTENTE_S); return; }
    }
    const page = await deps.lireMembres(acces, { segmentId: seg.segmentId, requete: seg.requete, apres: seg.curseur, delaiMs: DELAI_LOT_MS });
    if (!page.ok) {
      if (page.code === 'acces_refuse') { sauter(seg.segmentId, page.message); continue; }
      if (page.code === 'asynchrone') {
        const q = await deps.creerRequete(acces, { segmentId: seg.segmentId, delaiMs: DELAI_LOT_MS });
        if (!q.ok) {
          if (q.code === 'acces_refuse') { sauter(seg.segmentId, q.message); continue; }
          throw new Error(q.message);
        }
        if (!(await deps.magasin.noterRequeteSegment(tenantId, jeton, seg.segmentId, q.requete))) return;
        continue;
      }
      // `pas_fini` ne vient que de la lecture par une requête asynchrone ; sans elle, c'est une réponse inattendue, une panne.
      if (page.code === 'pas_fini' && seg.requete !== null) { await reenfilerDans(REQUETE_ASYNCHRONE_ATTENTE_S); return; }
      throw new Error(page.message);
    }
    if (premiere) { journaliserCout(tenantId, 'membres', page.clients.length, page.cout); premiere = false; }
    if (!(await boutiqueIntacte())) return;
    // La page s'écrit seulement si la lecture en est encore à elle (`apres`) : un segment décoché puis recoché pendant
    // l'appel repart de sa première page au lieu de reprendre au milieu.
    const ecrite = { apres: seg.curseur, clients: page.clients, suivant: page.suivant };
    if (!(await deps.magasin.ecrirePageSegment(tenantId, jeton, seg.segmentId, ecrite))) return;
  }
}
