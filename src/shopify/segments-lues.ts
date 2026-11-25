import { z } from 'zod';
import type { CoutRequete } from './reprise';
import { appelerGraphql, pause, type Echec } from './etiquettes-lues';
import { fetchPublic } from '../lib/connexion-publique';

/**
 * LES SEGMENTS NATIFS DE SHOPIFY, LUS PAR L'API ADMIN GRAPHQL (segments Shopify enrichis, lot 6c), le droit
 * `read_customers` seul. Mesuré le 2026-11-25 sur les deux boutiques branchées : la liste coûte 13 points ; une page de
 * 1 000 membres est acceptée en synchrone, environ 140 points demandés ; le numéro d'un membre
 * (`gid://shopify/CustomerSegmentMember/<n>`) est l'identifiant du client.
 *
 * Un segment trop lourd se lit par une requête ASYNCHRONE (guide « migrate to async queries ») : la lecture directe répond
 * `USE_CUSTOMER_SEGMENT_MEMBERS_QUERY_CREATE_MUTATION` (`asynchrone`), on crée la requête
 * (`customerSegmentMembersQueryCreate`), on attend `done`, puis on lit par `queryId` ; lue trop tôt, elle répond
 * `QUERY_NOT_COMPLETE` (`pas_fini`). La requête ShopifyQL d'un segment est gardée pour l'affichage, JAMAIS réévaluée :
 * les membres viennent de Shopify. Passe par `fetchPublic` et le frein commun (`appelerGraphql`).
 */

/** La liste lue en une fois : le plafond de `first` de l'API (250 segments par boutique au plus dans la doc). */
export const SEGMENTS_PAR_LISTE = 250;
/** Une page de membres : accepté par l'API (mesuré), environ 140 points demandés. */
export const MEMBRES_PAR_PAGE = 1000;
/** Les bornes des colonnes de la migration 0327 : un nom de 1 à 255 caractères, une requête de 5 000 au plus. */
export const NOM_SEGMENT_MAX = 255;
export const REQUETE_SEGMENT_MAX = 5000;
const ID = /^\d{1,19}$/;

const REQUETE_LISTE = `query($n: Int!) {
  segments(first: $n) { pageInfo { hasNextPage } nodes { id name query } }
}`;
const REQUETE_MEMBRES_SEGMENT = `query($segment: ID!, $n: Int!, $apres: String) {
  customerSegmentMembers(segmentId: $segment, first: $n, after: $apres) { pageInfo { hasNextPage endCursor } edges { node { id } } }
}`;
const REQUETE_MEMBRES_ASYNCHRONE = `query($requete: ID!, $n: Int!, $apres: String) {
  customerSegmentMembers(queryId: $requete, first: $n, after: $apres) { pageInfo { hasNextPage endCursor } edges { node { id } } }
}`;
const MUTATION_REQUETE = `mutation($segment: ID!) {
  customerSegmentMembersQueryCreate(input: { segmentId: $segment }) { customerSegmentMembersQuery { id done } userErrors { message } }
}`;
const REQUETE_SUIVI = `query($id: ID!) { customerSegmentMembersQuery(id: $id) { id done } }`;

/** Le numéro d'un gid Shopify (`gid://shopify/<Type>/<n>`), ou `null`. */
const numero = (gid: string): string | null => {
  const n = gid.split('/').pop() ?? '';
  return ID.test(n) ? n : null;
};
/** Un texte coupé à `max` points de code (jamais une moitié de paire), sans ses espaces de bord ; vide, `null`. */
const coupe = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? '').replace(/[\uD800-\uDFFF]/gu, '�').split('\u0000').join('').trim();
  return t === '' ? null : Array.from(t).slice(0, max).join('');
};

const schemaListe = z.object({
  segments: z.object({ pageInfo: z.object({ hasNextPage: z.boolean() }), nodes: z.array(z.unknown()) }),
});
const schemaSegment = z.object({ id: z.string(), name: z.string().nullish(), query: z.string().nullish() });
const schemaMembres = z.object({
  customerSegmentMembers: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullish() }),
    edges: z.array(z.object({ node: z.object({ id: z.string() }) })),
  }),
});
const schemaCreation = z.object({
  customerSegmentMembersQueryCreate: z.object({
    customerSegmentMembersQuery: z.object({ id: z.string(), done: z.boolean() }).nullish(),
    userErrors: z.array(z.object({ message: z.string().catch('') })).nullish(),
  }),
});
const schemaSuivi = z.object({ customerSegmentMembersQuery: z.object({ id: z.string(), done: z.boolean() }).nullish() });

export interface SegmentLu { segmentId: string; nom: string; requete: string | null }
export type ListeSegments = { ok: true; segments: SegmentLu[]; complete: boolean; cout: CoutRequete } | Echec;
/** Une page de membres : les numéros des clients, et le curseur de la page suivante (`null` : c'était la dernière). */
export type PageMembres = { ok: true; clients: string[]; suivant: string | null; cout: CoutRequete } | Echec;
export type RequeteAsynchrone = { ok: true; requete: string; fini: boolean } | Echec;
/** Où en est une requête asynchrone : `perdue`, Shopify ne la connaît plus (elle se recrée). */
export type SuiviRequete = { ok: true; etat: 'prete' | 'en_cours' | 'perdue' } | Echec;

type Appel = { appeler?: typeof fetch; attendre?: (ms: number) => Promise<void>; maintenant?: () => number };
const outils = (o: Appel) => [o.appeler ?? fetchPublic, o.attendre ?? pause, o.maintenant ?? Date.now] as const;

/**
 * La liste des segments de la boutique : identifiant, nom (coupé à `NOM_SEGMENT_MAX`, un segment sans nom prend son
 * identifiant) et requête (coupée à `REQUETE_SEGMENT_MAX`). Un nœud illisible est écarté et rend la liste INCOMPLÈTE :
 * un segment absent d'une liste incomplète ne se dit jamais disparu.
 */
export async function listerSegments(acces: { domaine: string; jeton: string }, p: { delaiMs: number } & Appel): Promise<ListeSegments> {
  const [appeler, attendre, maintenant] = outils(p);
  const r = await appelerGraphql(acces, { query: REQUETE_LISTE, variables: { n: SEGMENTS_PAR_LISTE } }, p.delaiMs, 'les segments', appeler, attendre, maintenant);
  if (!r.ok) return r;
  const d = schemaListe.safeParse(r.data);
  if (!d.success) return { ok: false, code: 'passager', message: 'Shopify n’a pas rendu la liste des segments : réessayez dans un instant.' };
  const segments: SegmentLu[] = [];
  let illisibles = 0;
  for (const brut of d.data.segments.nodes) {
    const s = schemaSegment.safeParse(brut);
    const id = s.success ? numero(s.data.id) : null;
    if (!s.success || id === null) { illisibles += 1; continue; }
    // Un identifiant rendu deux fois n'est écrit qu'une fois (l'écriture en bloc refuserait la même ligne deux fois).
    if (segments.some((x) => x.segmentId === id)) continue;
    segments.push({ segmentId: id, nom: coupe(s.data.name, NOM_SEGMENT_MAX) ?? id, requete: coupe(s.data.query, REQUETE_SEGMENT_MAX) });
  }
  return { ok: true, segments, complete: !d.data.segments.pageInfo.hasNextPage && illisibles === 0, cout: r.cout };
}

/**
 * Une page de membres d'un segment, directement ou par sa requête asynchrone (`requete`), après `apres`. Un membre dont
 * le numéro est illisible est écarté (il ne relie rien). `asynchrone` : ce segment demande une requête asynchrone ;
 * `pas_fini` : la requête n'est pas prête.
 */
export async function lirePageMembres(
  acces: { domaine: string; jeton: string },
  p: { segmentId: string; requete: string | null; apres: string | null; delaiMs: number } & Appel,
): Promise<PageMembres> {
  const [appeler, attendre, maintenant] = outils(p);
  const corps = p.requete !== null
    ? { query: REQUETE_MEMBRES_ASYNCHRONE, variables: { requete: p.requete, n: MEMBRES_PAR_PAGE, apres: p.apres } }
    : { query: REQUETE_MEMBRES_SEGMENT, variables: { segment: `gid://shopify/Segment/${p.segmentId}`, n: MEMBRES_PAR_PAGE, apres: p.apres } };
  const r = await appelerGraphql(acces, corps, p.delaiMs, 'les membres du segment', appeler, attendre, maintenant);
  if (!r.ok) return r;
  const d = schemaMembres.safeParse(r.data);
  if (!d.success) return { ok: false, code: 'passager', message: 'Shopify n’a pas rendu les membres du segment : réessayez dans un instant.' };
  const c = d.data.customerSegmentMembers;
  const clients = [...new Set(c.edges.map((e) => numero(e.node.id)).filter((x): x is string => x !== null))];
  // Une page qui continue sans curseur, ou sur le curseur qu'on vient de lui donner, ne se lit pas plus loin : elle serait
  // relue sans fin.
  if (c.pageInfo.hasNextPage && (!c.pageInfo.endCursor || c.pageInfo.endCursor === p.apres)) {
    return { ok: false, code: 'passager', message: 'Shopify a rendu une page de membres sans la suite : réessayez dans un instant.' };
  }
  return { ok: true, clients, suivant: c.pageInfo.hasNextPage ? c.pageInfo.endCursor! : null, cout: r.cout };
}

/** Crée la requête asynchrone des membres d'un segment ; son identifiant, et si elle est déjà prête. */
export async function creerRequeteAsynchrone(
  acces: { domaine: string; jeton: string }, p: { segmentId: string; delaiMs: number } & Appel,
): Promise<RequeteAsynchrone> {
  const [appeler, attendre, maintenant] = outils(p);
  const r = await appelerGraphql(acces, { query: MUTATION_REQUETE, variables: { segment: `gid://shopify/Segment/${p.segmentId}` } },
    p.delaiMs, 'la requête du segment', appeler, attendre, maintenant);
  if (!r.ok) return r;
  const d = schemaCreation.safeParse(r.data);
  const q = d.success ? d.data.customerSegmentMembersQueryCreate.customerSegmentMembersQuery : null;
  if (!d.success || !q) {
    const raison = d.success ? d.data.customerSegmentMembersQueryCreate.userErrors?.[0]?.message : undefined;
    return { ok: false, code: 'passager', message: `Shopify n’a pas créé la requête du segment${raison ? ` (${raison.slice(0, 200)})` : ''}.` };
  }
  return { ok: true, requete: q.id, fini: q.done };
}

/** Où en est une requête asynchrone : prête, en cours, ou perdue (Shopify ne la connaît plus). */
export async function suivreRequeteAsynchrone(
  acces: { domaine: string; jeton: string }, p: { requete: string; delaiMs: number } & Appel,
): Promise<SuiviRequete> {
  const [appeler, attendre, maintenant] = outils(p);
  const r = await appelerGraphql(acces, { query: REQUETE_SUIVI, variables: { id: p.requete } }, p.delaiMs, 'la requête du segment', appeler, attendre, maintenant);
  if (!r.ok) return r;
  const d = schemaSuivi.safeParse(r.data);
  if (!d.success) return { ok: false, code: 'passager', message: 'Shopify n’a pas rendu l’état de la requête du segment : réessayez dans un instant.' };
  const q = d.data.customerSegmentMembersQuery;
  return { ok: true, etat: !q ? 'perdue' : q.done ? 'prete' : 'en_cours' };
}
