import { randomUUID } from 'node:crypto';
import type { CommandeConnue, CommandeLue, DepsReprise, JobReprise, PageCommandes } from '../src/shopify/reprise';
import { BAIL_REPRISE_SECONDES, ERREUR_ABANDON, REPRISE_ABANDONNEE_MINUTES, type ComptesReprise, type Reprise } from '../src/shopify/reprises.pg';
import type { DetailsCommande } from '../src/shopify/store.pg';
import type { IssueJeton } from '../src/shopify/connexion';
import { schemaCommande } from '../src/shopify/donnees';

/**
 * UN FAUX DU RATTRAPAGE DES COMMANDES SHOPIFY (segments Shopify enrichis, lot 5) : les reprises en mémoire, avec les
 * MÊMES règles que `PgReprisesStore` (une seule vivante par espace, un bail et un jeton, l'abandon à 15 minutes, la fin
 * qui ajoute ses comptes), et une boutique dont les pages de commandes sont données d'avance, par curseur. L'horloge est
 * celle du faux : un test l'avance, ou la fait avancer à chaque page lue (`msParPage`). Le vrai magasin est éprouvé sur
 * PGlite (`tests/integration/shopify-reprises.integration.test.ts`).
 */

/** Les droits d'une app à jour (2026-11-24) : ceux d'avant, plus `read_products`. */
export const DROITS_A_JOUR = ['read_customers', 'read_orders', 'read_checkouts', 'read_fulfillments', 'read_products'];
export const BOUTIQUE_REPRISE = { domaine: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x', pays: 'FR', devise: 'EUR', etat: 'connectee' };
/** Le 2026-11-23 à midi (UTC) : la fenêtre commence le 2026-09-24 à minuit. */
export const MIDI_REPRISE = Date.UTC(2026, 10, 23, 12);

/** Une commande payée lue chez Shopify, dans la forme du webhook (`versCorpsWebhook` la produit ainsi). */
export function commandeLue(id: number, o: { telephone?: string | null; client?: number; lignes?: number; tronquees?: boolean } = {}): CommandeLue {
  const corps = schemaCommande.safeParse({
    id, name: `#${id}`, phone: o.telephone === undefined ? '+33612345678' : o.telephone,
    customer: o.client ? { id: o.client, phone: null } : null,
    total_price_set: { shop_money: { amount: '42.00', currency_code: 'EUR' } },
    processed_at: '2026-11-01T10:00:00Z', test: false,
    line_items: Array.from({ length: o.lignes ?? 1 }, (_, i) => ({
      id: id * 100 + i, product_id: 7, variant_id: 8, sku: 'SKU-7', title: 'Bougie', variant_title: null, quantity: 1, gift_card: false,
    })),
  });
  if (!corps.success) throw new Error(`commande de test illisible : ${corps.error.issues[0]?.message}`);
  return { corps: corps.data, lignesTronquees: o.tronquees ?? false };
}

/** Une page servie : ses commandes, ses écartées, son curseur suivant (`null` : la dernière). */
export const page = (commandes: CommandeLue[], suivant: string | null, ecartees = 0): PageCommandes => ({ ok: true, commandes, ecartees, suivant });

/** Une commande déjà notée : sa fiche, et s'il faut lui ajouter ses lignes (par défaut non : elle les a déjà). */
export const connue = (contactId: string, aCompleter = false): CommandeConnue => ({ contactId, aCompleter });

interface LigneFaux { r: Reprise; tenantId: string; jeton: string | null; bail: number | null }

export function monterReprise(o: {
  boutique?: typeof BOUTIQUE_REPRISE | null;
  jeton?: IssueJeton;
  /** Les droits de l'app, ou le refus de leur lecture ; par défaut, une app à jour. */
  droits?: string[] | { ok: false; code: 'acces_refuse' | 'passager'; message: string };
  /** Les pages par curseur (`''` : la première). Une liste se sert dans l'ordre, sa dernière ensuite ; aucune : page vide et finale. */
  pages?: Record<string, PageCommandes | PageCommandes[]>;
  /** Les commandes déjà notées. */
  connues?: Record<string, CommandeConnue>;
  /** Les fiches actives : numéro vers fiche. */
  fiches?: Record<string, string>;
  /** Le temps que prend chaque page lue, sur l'horloge du faux. */
  msParPage?: number;
} = {}) {
  const horloge = { t: MIDI_REPRISE };
  const lignes: LigneFaux[] = [];
  const trace = {
    lectures: [] as Array<{ apres: string | null; parPage: number; depuis: string; delaiMs: number }>,
    jobs: [] as Array<{ job: JobReprise; dansSecondes: number }>,
    liees: [] as Array<{ tenantId: string; commandeId: string; clientId: string | null; contactId: string; details: DetailsCommande }>,
    connues: [] as string[][],
    numeros: [] as string[][],
    jetons: 0,
    droits: 0,
  };
  const tenue = (l: LigneFaux) => l.bail !== null && l.bail > horloge.t;
  const vue = (l: LigneFaux): Reprise => ({ ...l.r, comptes: { ...l.r.comptes }, tenue: tenue(l) });
  const vivante = (l: LigneFaux) => l.r.statut === 'en_attente' || l.r.statut === 'en_cours';
  const trouver = (id: string, tenantId: string) => lignes.find((l) => l.r.id === id && l.tenantId === tenantId);
  const toucher = (l: LigneFaux) => { l.r.majLe = new Date(horloge.t); };
  const zero = (): ComptesReprise => ({ lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0 });
  const ajouter = (l: LigneFaux, ajout: ComptesReprise) => {
    for (const k of Object.keys(ajout) as Array<keyof ComptesReprise>) l.r.comptes[k] += ajout[k];
  };

  const reprises: DepsReprise['reprises'] = {
    async lancer(tenantId, fenetreDebut, domaine, par) {
      for (const l of lignes) {
        if (l.tenantId === tenantId && vivante(l) && !tenue(l) && l.r.majLe.getTime() < horloge.t - REPRISE_ABANDONNEE_MINUTES * 60_000) {
          Object.assign(l.r, { statut: 'erreur', erreur: ERREUR_ABANDON, finiLe: new Date(horloge.t) });
          l.bail = null; l.jeton = null; toucher(l);
        }
      }
      const v = lignes.find((l) => l.tenantId === tenantId && vivante(l));
      if (v) return { ok: false, vivante: vue(v) };
      const l: LigneFaux = {
        tenantId, jeton: null, bail: null,
        r: {
          id: randomUUID(), statut: 'en_attente', domaine, fenetreDebut, curseur: null, comptes: zero(), erreur: null, par,
          commenceLe: new Date(horloge.t), majLe: new Date(horloge.t), finiLe: null, tenue: false,
        },
      };
      lignes.push(l);
      return { ok: true, reprise: vue(l) };
    },
    async prendre(id, tenantId) {
      const l = trouver(id, tenantId);
      if (!l || !vivante(l) || tenue(l)) return null;
      l.r.statut = 'en_cours'; l.jeton = randomUUID(); l.bail = horloge.t + BAIL_REPRISE_SECONDES * 1000; toucher(l);
      return { jeton: l.jeton, reprise: vue(l) };
    },
    async avancer(id, tenantId, jeton, curseur, ajout) {
      const l = trouver(id, tenantId);
      if (!l || l.jeton !== jeton || l.r.statut !== 'en_cours') return false;
      l.r.curseur = curseur;
      ajouter(l, ajout);
      l.bail = horloge.t + BAIL_REPRISE_SECONDES * 1000; toucher(l);
      return true;
    },
    async relacher(id, tenantId, jeton) {
      const l = trouver(id, tenantId);
      if (l && l.jeton === jeton) { l.bail = null; l.jeton = null; toucher(l); }
    },
    async finir(id, tenantId, jeton, statut, erreur, ajout = zero()) {
      const l = trouver(id, tenantId);
      if (!l || l.jeton !== jeton || l.r.statut !== 'en_cours') return false;
      Object.assign(l.r, { statut, erreur: erreur === null ? null : erreur.slice(0, 500), finiLe: new Date(horloge.t) });
      ajouter(l, ajout);
      l.bail = null; l.jeton = null; toucher(l);
      return true;
    },
    async annuler(id, tenantId, erreur) {
      const l = trouver(id, tenantId);
      if (!l || l.r.statut !== 'en_attente' || l.jeton !== null) return;
      Object.assign(l.r, { statut: 'erreur', erreur: erreur.slice(0, 500), finiLe: new Date(horloge.t) });
      toucher(l);
    },
    async lire(id, tenantId) { const l = trouver(id, tenantId); return l ? vue(l) : null; },
    async derniere(tenantId) {
      const l = lignes.filter((x) => x.tenantId === tenantId).at(-1);
      return l ? vue(l) : null;
    },
  };

  const pages = new Map(Object.entries(o.pages ?? {}).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const deps: DepsReprise = {
    reprises,
    boutique: async () => (o.boutique === undefined ? BOUTIQUE_REPRISE : o.boutique),
    jeton: async () => { trace.jetons += 1; return o.jeton ?? { ok: true, jeton: 'jeton-de-test' }; },
    droits: async () => {
      trace.droits += 1;
      if (o.droits !== undefined && !Array.isArray(o.droits)) return o.droits;
      return { ok: true, droits: o.droits ?? DROITS_A_JOUR };
    },
    lirePage: async (_acces, p) => {
      trace.lectures.push({ apres: p.apres, parPage: p.parPage, depuis: p.depuis.toISOString(), delaiMs: p.delaiMs });
      horloge.t += o.msParPage ?? 0;
      const file = pages.get(p.apres ?? '');
      if (!file || file.length === 0) return page([], null);
      return file.length > 1 ? file.shift()! : file[0]!;
    },
    commandesConnues: async (_t, ids) => {
      trace.connues.push([...ids]);
      return new Map(ids.flatMap((id) => (o.connues?.[id] !== undefined ? [[id, o.connues[id]!] as const] : [])));
    },
    fichesParNumeros: async (_t, numeros) => {
      trace.numeros.push([...numeros]);
      return new Map(numeros.flatMap((n) => (o.fiches?.[n] !== undefined ? [[n, o.fiches[n]!] as const] : [])));
    },
    lierCommande: async (tenantId, commandeId, clientId, contactId, details) => { trace.liees.push({ tenantId, commandeId, clientId, contactId, details }); },
    enfiler: async (job, dansSecondes) => { trace.jobs.push({ job, dansSecondes }); },
    maintenant: () => horloge.t,
  };
  return { deps, trace, horloge, lignes };
}
