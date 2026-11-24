import { randomUUID } from 'node:crypto';
import type { CommandeConnue, CommandeLue, DepsReprise, JobReprise, PageAEcrire, PageCommandes } from '../src/shopify/reprise';
import { BAIL_REPRISE_SECONDES, ERREUR_ABANDON, REPRISE_ABANDONNEE_MINUTES, type ComptesReprise, type Reprise } from '../src/shopify/reprises.pg';
import type { AttestationShopify, DetailsCommande } from '../src/shopify/store.pg';
import type { IssueJeton } from '../src/shopify/connexion';
import { schemaCommande } from '../src/shopify/donnees';
import { LimiteOffreError } from '../src/offres/refus';

/**
 * UN FAUX DU RATTRAPAGE DES COMMANDES SHOPIFY (segments Shopify enrichis, lots 5 et 5b) : les reprises en mémoire, avec
 * les MÊMES règles que `PgReprisesStore` (une seule vivante par espace, un bail et un jeton, l'abandon à 15 minutes, la fin
 * qui ajoute ses comptes), une boutique dont les pages de commandes sont données d'avance, par curseur, et les fiches de
 * l'espace : la page écrite (`ecrirePage`) y crée celles qui manquent, que les pages suivantes retrouvent. L'horloge est
 * celle du faux : un test l'avance, ou la fait avancer à chaque page lue (`msParPage`). Le vrai magasin, la vraie
 * transaction, les vraies fiches et la vraie trace des numéros effacés sont éprouvés contre Postgres
 * (`tests/integration/shopify-reprises.integration.test.ts`, `tests/integration/shopify-fiches-acheteurs.integration.test.ts`).
 */

/** Les droits d'une app à jour (2026-11-24) : ceux d'avant, plus `read_products`. */
export const DROITS_A_JOUR = ['read_customers', 'read_orders', 'read_checkouts', 'read_fulfillments', 'read_products'];
export const BOUTIQUE_REPRISE = { domaine: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x', pays: 'FR', devise: 'EUR', etat: 'connectee' };
/** Le 2026-11-23 à midi (UTC) : la fenêtre commence le 2026-09-24 à minuit. */
export const MIDI_REPRISE = Date.UTC(2026, 10, 23, 12);
/** L'attestation du marchand, en vigueur pour la boutique du faux. */
export const ATTESTATION_REPRISE: AttestationShopify = {
  coche: true, texte: 'J’atteste…', email: 'moi@test', le: '2026-11-20T09:00:00.000Z', domaine: BOUTIQUE_REPRISE.domaine,
};
/** La trace du consentement d'une fiche créée par le rattrapage du faux (`sourceDuConsentement`). */
export const SOURCE_REPRISE = 'rattrapage Shopify, attestation du 2026-11-20 pour b.myshopify.com';

/** Une commande payée lue chez Shopify, dans la forme du webhook (`versCorpsWebhook` la produit ainsi). */
export function commandeLue(id: number, o: {
  /** Le numéro que la commande porte pour son client (`phone`), le deuxième candidat de l'acheteur. */
  telephone?: string | null; client?: number; lignes?: number; tronquees?: boolean;
  /** Le numéro du client Shopify (`customer.phone`), le premier candidat de l'acheteur ; il exige `client`. */
  clientTelephone?: string;
  /** Le numéro et le nom de l'adresse de livraison (le premier candidat de `telephoneDeCommande`, jamais de l'acheteur). */
  livraison?: { telephone: string | null; prenom?: string; nom?: string };
  /** Le numéro et le nom de l'adresse de facturation (le dernier candidat de l'acheteur). */
  facturation?: { telephone: string | null; prenom?: string; nom?: string };
  /** La date du paiement chez Shopify (`processed_at`) ; `null` : illisible. */
  payeeLe?: string | null;
} = {}): CommandeLue {
  const adresse = (a: { telephone: string | null; prenom?: string; nom?: string } | undefined) =>
    a ? { phone: a.telephone, country_code: 'FR', first_name: a.prenom ?? null, last_name: a.nom ?? null } : null;
  const corps = schemaCommande.safeParse({
    id, name: `#${id}`, phone: o.telephone === undefined ? '+33612345678' : o.telephone,
    customer: o.client ? { id: o.client, phone: o.clientTelephone ?? null, first_name: 'Camille', last_name: 'Martin' } : null,
    shipping_address: adresse(o.livraison),
    billing_address: adresse(o.facturation),
    total_price_set: { shop_money: { amount: '42.00', currency_code: 'EUR' } },
    processed_at: o.payeeLe === undefined ? '2026-11-01T10:00:00Z' : o.payeeLe, test: false,
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
  /** L'attestation en vigueur ; `null` : aucune (jamais cochée, décochée, ou d'une autre boutique). */
  attestation?: AttestationShopify | null;
  /** Les pages par curseur (`''` : la première). Une liste se sert dans l'ordre, sa dernière ensuite ; aucune : page vide et finale. */
  pages?: Record<string, PageCommandes | PageCommandes[]>;
  /** Les commandes déjà notées. */
  connues?: Record<string, CommandeConnue>;
  /**
   * Les fiches ACTIVES de l'espace : numéro vers identifiant. Une fiche supprimée n'y est pas : la purge, seul chemin qui
   * supprime, anonymise son numéro ; elle laisse sa trace (`effacements`).
   */
  fiches?: Record<string, string>;
  /** Les numéros d'une fiche effacée en STOP (la liste de refus). */
  refus?: string[];
  /** La trace des numéros effacés : numéro vers la date (ISO) de la dernière purge d'une fiche qui le portait. */
  effacements?: Record<string, string>;
  /** Les commandes dont un message Shopify a échoué en 131026 sur une fiche supprimée depuis. */
  sansWhatsapp?: string[];
  /** La limite de contacts de l'offre (`null` ou absente : sans limite), et les fiches comptées hors de celles du faux. */
  limite?: number | null;
  autresFiches?: number;
  /** L'offre compte tous les contacts (Free, Pro, Business) ; par défaut oui, `false` : l'Entreprise. */
  toutesOrigines?: boolean;
  /** Le temps que prend chaque page lue, sur l'horloge du faux. */
  msParPage?: number;
} = {}) {
  const horloge = { t: MIDI_REPRISE };
  const lignes: LigneFaux[] = [];
  const fiches = new Map<string, string>(Object.entries(o.fiches ?? {}));
  /** Les commandes qu'une page a écrites, vers leur fiche. */
  const ecrites = new Map<string, string>();
  const trace = {
    lectures: [] as Array<{ apres: string | null; parPage: number; depuis: string; delaiMs: number }>,
    jobs: [] as Array<{ job: JobReprise; dansSecondes: number }>,
    liees: [] as Array<{ tenantId: string; commandeId: string; clientId: string | null; contactId: string; details: DetailsCommande }>,
    /** Les fiches créées par une page écrite : leur numéro, leur nom et la trace de leur consentement. */
    creees: [] as Array<{ numero: string; nom: string | null; source: string; contactId: string }>,
    /** Chaque page écrite, telle que le rattachement la demande. */
    ecrites: [] as PageAEcrire[],
    connues: [] as string[][],
    numeros: [] as string[][],
    refus: [] as string[][],
    effacements: [] as string[][],
    sansWhatsapp: [] as string[][],
    places: 0,
    jetons: 0,
    droits: 0,
  };
  const tenue = (l: LigneFaux) => l.bail !== null && l.bail > horloge.t;
  const vue = (l: LigneFaux): Reprise => ({ ...l.r, comptes: { ...l.r.comptes }, tenue: tenue(l) });
  const vivante = (l: LigneFaux) => l.r.statut === 'en_attente' || l.r.statut === 'en_cours';
  const trouver = (id: string, tenantId: string) => lignes.find((l) => l.r.id === id && l.tenantId === tenantId);
  const toucher = (l: LigneFaux) => { l.r.majLe = new Date(horloge.t); };
  const zero = (): ComptesReprise => ({ lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0, fichesCreees: 0, horsPlafond: 0 });
  const ajouter = (l: LigneFaux, ajout: ComptesReprise) => {
    for (const k of Object.keys(ajout) as Array<keyof ComptesReprise>) l.r.comptes[k] += ajout[k];
  };
  const comptees = () => fiches.size + (o.autresFiches ?? 0);

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
    attestation: async (_t, domaine) => {
      const a = o.attestation === undefined ? ATTESTATION_REPRISE : o.attestation;
      return a !== null && a.domaine === domaine ? a : null;
    },
    lirePage: async (_acces, p) => {
      trace.lectures.push({ apres: p.apres, parPage: p.parPage, depuis: p.depuis.toISOString(), delaiMs: p.delaiMs });
      horloge.t += o.msParPage ?? 0;
      const file = pages.get(p.apres ?? '');
      if (!file || file.length === 0) return page([], null);
      return file.length > 1 ? file.shift()! : file[0]!;
    },
    // Une commande écrite par une page devient connue, avec ses lignes : relancé, le rattrapage la compte « déjà connue ».
    commandesConnues: async (_t, ids) => {
      trace.connues.push([...ids]);
      return new Map(ids.flatMap((id) => {
        const c = o.connues?.[id] ?? (ecrites.has(id) ? connue(ecrites.get(id)!) : undefined);
        return c !== undefined ? [[id, c] as const] : [];
      }));
    },
    fichesParNumeros: async (_t, numeros) => {
      trace.numeros.push([...numeros]);
      return new Map(numeros.flatMap((n) => { const id = fiches.get(n); return id !== undefined ? [[n, id] as const] : []; }));
    },
    numerosEnRefus: async (_t, numeros) => {
      trace.refus.push([...numeros]);
      return new Set(numeros.filter((n) => o.refus?.includes(n)));
    },
    effacements: async (_t, numeros) => {
      trace.effacements.push([...numeros]);
      return new Map(numeros.flatMap((n) => { const le = o.effacements?.[n]; return le !== undefined ? [[n, new Date(le)] as const] : []; }));
    },
    commandesSansWhatsapp: async (_t, ids) => {
      trace.sansWhatsapp.push([...ids]);
      return new Set(ids.filter((id) => o.sansWhatsapp?.includes(id)));
    },
    places: async () => { trace.places += 1; return { limite: o.limite ?? null, comptees: comptees(), toutesOrigines: o.toutesOrigines ?? true }; },
    ecrirePage: async (tenantId, p) => {
      trace.ecrites.push(p);
      // Le filet de `upsertManyByPhone` : la limite revérifiée sur les numéros sans fiche active.
      const nouveaux = p.fiches.filter((f) => !fiches.has(f.numero));
      if (o.limite !== undefined && o.limite !== null && nouveaux.length > 0 && comptees() + nouveaux.length > o.limite) {
        throw new LimiteOffreError(tenantId, 'contacts', o.limite);
      }
      let creees = 0;
      for (const f of p.fiches) {
        if (fiches.has(f.numero)) continue;
        const id = `fiche-${f.numero}`;
        fiches.set(f.numero, id);
        trace.creees.push({ numero: f.numero, nom: f.nom, source: p.source, contactId: id });
        creees += 1;
      }
      for (const l of p.liaisons) {
        const contactId = 'contactId' in l ? l.contactId : fiches.get(l.numero);
        if (contactId === undefined) throw new Error('fiche introuvable');
        trace.liees.push({ tenantId, commandeId: l.commandeId, clientId: l.clientId, contactId, details: l.details });
        ecrites.set(l.commandeId, contactId);
      }
      return { creees };
    },
    enfiler: async (job, dansSecondes) => { trace.jobs.push({ job, dansSecondes }); },
    maintenant: () => horloge.t,
  };
  return { deps, trace, horloge, lignes, fiches };
}
