import { randomUUID } from 'node:crypto';
import type { DepsEtiquettes, JobEtiquettes } from '../src/shopify/etiquettes';
import {
  BAIL_SYNCHRO_SECONDES, RELECTURE_HEURES, SYNCHRO_PERIMEE_MINUTES, type ClientLu, type ClientTrouve, type EtatSynchroEtiquettes, type IssueSynchro,
  type MagasinEtiquettes,
} from '../src/shopify/etiquettes.pg';
import { etiquettesUtiles, type LotClients, type RechercheTelephones } from '../src/shopify/etiquettes-lues';
import type { IssueJeton } from '../src/shopify/connexion';
import type { Offre } from '../src/offres/offres';

/**
 * UN FAUX DE LA SYNCHRONISATION DES ÉTIQUETTES SHOPIFY (segments Shopify enrichis, lot 6b) : le magasin en mémoire, avec les
 * MÊMES règles que `PgEtiquettesStore` (une synchronisation vivante à la fois, le bail et le jeton, la Free une fois par
 * 24 h, les fiches ACTIVES seules écrites, un client par fiche et une fiche par client, la marque de la recherche par
 * téléphone, les étiquettes remplacées en bloc, le lien perdu d'un client disparu), et une boutique dont les clients sont
 * donnés d'avance. L'horloge est celle du faux : un test l'avance, ou la fait avancer à chaque lot (`msParLot`). Le vrai
 * magasin est éprouvé sur PGlite (`tests/integration/shopify-etiquettes.integration.test.ts`).
 */

export const T_ETIQUETTES = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
export const BOUTIQUE_ETIQUETTES = { domaine: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x', pays: 'FR', etat: 'connectee' };
export const DROITS_ETIQUETTES = ['read_customers', 'read_orders', 'read_checkouts', 'read_fulfillments', 'read_products'];
export const MIDI_ETIQUETTES = Date.UTC(2026, 10, 24, 12);

/** Une fiche de l'espace : son téléphone (E.164) et si elle est active (ni supprimée ni anonymisée). */
export interface FicheFausse { telephone: string | null; active: boolean }
/** Un client de la boutique : son téléphone (`defaultPhoneNumber`) et ses étiquettes, telles que Shopify les rend. */
export interface ClientShopify { telephone: string | null; tags: unknown[] }

interface EtatFaux extends Omit<EtatSynchroEtiquettes, 'tenue'> {
  curseur: string | null;
  bail: number | null;
  jeton: string | null;
}

export function monterEtiquettes(o: {
  fiches?: Record<string, FicheFausse>;
  /**
   * Les liens déjà posés par une synchronisation précédente (`shopify_clients`) : un client Shopify et SA fiche, reliés par
   * son téléphone. 🔴 Jamais par une commande : la fiche d'une commande est celle du téléphone de livraison.
   */
  liensDeDepart?: Array<{ clientId: string; contactId: string }>;
  /** Les clients de la boutique ; un client absent est supprimé chez Shopify (nœud nul). */
  boutiqueClients?: Record<string, ClientShopify>;
  boutique?: typeof BOUTIQUE_ETIQUETTES | null;
  /** Ce que rend la boutique au fil des relectures, après la première. */
  boutiquesSuivantes?: Array<typeof BOUTIQUE_ETIQUETTES | null>;
  jeton?: IssueJeton;
  droits?: string[] | { ok: false; code: 'acces_refuse' | 'passager'; message: string };
  /** Les issues forcées des lectures par identifiant, servies dans l'ordre avant le catalogue. */
  echecsClients?: LotClients[];
  /** Les issues forcées des recherches par téléphone, servies dans l'ordre avant le catalogue. */
  echecsRecherches?: RechercheTelephones[];
  /** Une recherche rend une page incomplète tant qu'elle porte plus de téléphones que ce nombre. */
  incompleteAuDela?: number;
  msParLot?: number;
  offre?: Offre;
  /** L'état au départ ; absent : aucune ligne. */
  etat?: Partial<EtatFaux> | null;
} = {}) {
  const horloge = { t: MIDI_ETIQUETTES };
  const fiches = new Map(Object.entries(o.fiches ?? {}));
  const catalogue = new Map(Object.entries(o.boutiqueClients ?? {}));
  const liens = new Map<string, { contactId: string; vuLe: number | null }>(
    (o.liensDeDepart ?? []).map((l) => [l.clientId, { contactId: l.contactId, vuLe: null }]),
  );
  const cherchees = new Set<string>();
  const etiquettes = new Map<string, string[]>();
  const SANS_COMPTES = { clientsLus: 0, trouvesParTelephone: 0, sansFiche: 0, fichesEtiquetees: 0 };
  let etat: EtatFaux | null = o.etat === undefined || o.etat === null ? null : {
    allumee: false, synchroLe: null, demandeeLe: null, enCoursDepuis: null, majLe: null, issue: null, issueLe: null, message: null,
    comptes: { ...SANS_COMPTES }, curseur: null, bail: null, jeton: null, ...o.etat,
  };
  const trace = {
    lots: [] as string[][],
    recherches: [] as string[][],
    jobs: [] as Array<{ job: JobEtiquettes; dansSecondes: number }>,
    issues: [] as Array<{ issue: IssueSynchro; message: string | null }>,
    ecritures: 0,
    relaches: 0,
    droits: 0,
  };
  /**
   * `synchroVivante` (`src/shopify/etiquettes-garde.ts`), terme pour terme : une comparaison qui porte sur une valeur
   * nulle vaut FAUX, comme le `coalesce(..., false)` du SQL. Le faux ne dit vrai que là où la base dit vrai : un bail nul
   * ne tient rien, un progrès nul n'est pas récent (`tests/integration/shopify-etiquettes.integration.test.ts` le prouve
   * sur la base).
   */
  const coalesceFaux = (v: boolean | null): boolean => v ?? false;
  const vivante = (e: EtatFaux): boolean => e.enCoursDepuis !== null
    && (coalesceFaux(e.majLe === null ? null : e.majLe.getTime() >= horloge.t - SYNCHRO_PERIMEE_MINUTES * 60_000)
      || coalesceFaux(e.bail === null ? null : e.bail > horloge.t));
  const active = (id: string): boolean => fiches.get(id)?.active === true;
  const tient = (jeton: string): boolean => etat !== null && etat.jeton === jeton;
  const ficheLiee = (contactId: string): boolean => [...liens.values()].some((l) => l.contactId === contactId);
  const recommencer = (e: EtatFaux): EtatFaux => ({
    ...e, demandeeLe: new Date(horloge.t), enCoursDepuis: new Date(horloge.t), majLe: new Date(horloge.t), curseur: null,
    comptes: { ...e.comptes, clientsLus: 0, trouvesParTelephone: 0, sansFiche: 0 },
  });
  const nouvelEtat = (): EtatFaux => ({
    allumee: false, synchroLe: null, demandeeLe: null, enCoursDepuis: null, majLe: null, issue: null, issueLe: null, message: null,
    comptes: { ...SANS_COMPTES }, curseur: null, bail: null, jeton: null,
  });
  const avancer = (p: { clientsLus: number; trouves: number; sansFiche: number; curseur?: string }): void => {
    if (!etat) return;
    etat = {
      ...etat, majLe: new Date(horloge.t), bail: horloge.t + BAIL_SYNCHRO_SECONDES * 1000, curseur: p.curseur ?? etat.curseur,
      comptes: {
        ...etat.comptes, clientsLus: etat.comptes.clientsLus + p.clientsLus, trouvesParTelephone: etat.comptes.trouvesParTelephone + p.trouves,
        sansFiche: etat.comptes.sansFiche + p.sansFiche,
      },
    };
  };

  const magasin: MagasinEtiquettes = {
    async etat() {
      if (etat === null) return null;
      const { curseur: _c, bail, jeton: _j, ...reste } = etat;
      return { ...reste, comptes: { ...etat.comptes }, tenue: bail !== null && bail > horloge.t };
    },
    async regler(_t, allumee) { etat = { ...(etat ?? nouvelEtat()), allumee }; },
    async demander(_t, d) {
      if (etat !== null && vivante(etat)) return null;
      if (etat !== null && d.auPlusUneFoisParJour && etat.demandeeLe !== null && etat.demandeeLe.getTime() >= horloge.t - RELECTURE_HEURES * 3_600_000) return null;
      etat = recommencer(etat ?? nouvelEtat());
      return etat.demandeeLe;
    },
    async annulerDemande(_t, le) {
      if (etat && etat.jeton === null && etat.demandeeLe?.getTime() === le.getTime()) etat = { ...etat, enCoursDepuis: null, demandeeLe: null };
    },
    async dues() {
      const b = o.boutique === undefined ? BOUTIQUE_ETIQUETTES : o.boutique;
      if (etat === null || !etat.allumee || b?.etat !== 'connectee' || (o.offre ?? 'pro') === 'base' || vivante(etat)) return [];
      if (etat.demandeeLe !== null && etat.demandeeLe.getTime() >= horloge.t - RELECTURE_HEURES * 3_600_000) return [];
      etat = recommencer(etat);
      return [{ tenantId: T_ETIQUETTES, le: etat.demandeeLe! }];
    },
    async prendre() {
      if (etat === null || etat.enCoursDepuis === null || (etat.bail !== null && etat.bail > horloge.t)) return null;
      etat = { ...etat, jeton: randomUUID(), bail: horloge.t + BAIL_SYNCHRO_SECONDES * 1000, majLe: new Date(horloge.t) };
      return { jeton: etat.jeton!, curseur: etat.curseur };
    },
    async relacher(_t, jeton) {
      trace.relaches += 1;
      if (etat && etat.jeton === jeton) etat = { ...etat, bail: null, jeton: null, majLe: new Date(horloge.t) };
    },
    async aChercher(_t, n) {
      return [...fiches.entries()]
        .filter(([id, f]) => f.active && f.telephone !== null && !ficheLiee(id) && !cherchees.has(id))
        .sort(([, a], [, b]) => a.telephone!.localeCompare(b.telephone!))
        .slice(0, n)
        .map(([contactId, f]) => ({ contactId, telephone: f.telephone! }));
    },
    async ecrireRecherche(_t, jeton, r: { cherchees: readonly string[]; trouves: readonly ClientTrouve[] }) {
      if (!tient(jeton)) return null;
      trace.ecritures += 1;
      for (const id of r.cherchees) if (active(id)) cherchees.add(id);
      const aRelier = r.trouves.filter((t) => active(t.contactId));
      let relies = 0;
      for (const t of aRelier) {
        if (liens.has(t.clientId) || ficheLiee(t.contactId)) continue;
        liens.set(t.clientId, { contactId: t.contactId, vuLe: horloge.t });
        etiquettes.set(t.contactId, [...t.etiquettes]);
        relies += 1;
      }
      // Comme le vrai magasin : un client relié se compte à sa lecture par identifiant, une fois.
      avancer({ clientsLus: 0, trouves: relies, sansFiche: r.trouves.length - aRelier.length });
      return { relies };
    },
    async clientsALire(_t, curseur, n) {
      return [...liens.keys()].filter((id) => curseur === null || id > curseur).sort().slice(0, n);
    },
    async ecrireClients(_t, jeton, r: { lus: readonly ClientLu[]; curseur: string }) {
      if (!tient(jeton)) return false;
      trace.ecritures += 1;
      let presents = 0;
      let sansFiche = 0;
      for (const c of r.lus) {
        const lien = liens.get(c.clientId);
        if (!lien) continue;
        if (c.etiquettes === null || !active(lien.contactId)) {
          if (c.etiquettes !== null) sansFiche += 1;
          liens.delete(c.clientId);
          cherchees.delete(lien.contactId);
          etiquettes.delete(lien.contactId);
          continue;
        }
        liens.set(c.clientId, { ...lien, vuLe: horloge.t });
        etiquettes.set(lien.contactId, [...c.etiquettes]);
        presents += 1;
      }
      avancer({ clientsLus: presents, trouves: 0, sansFiche, curseur: r.curseur });
      return true;
    },
    async finir(_t, jeton, issue, message) {
      if (!tient(jeton)) return false;
      trace.issues.push({ issue, message });
      const le = new Date(horloge.t);
      etat = {
        ...etat!, issue, issueLe: le, message: message === null ? null : message.slice(0, 500),
        ...(issue === 'lue' ? { synchroLe: le, comptes: { ...etat!.comptes, fichesEtiquetees: [...etiquettes.values()].filter((l) => l.length > 0).length } } : {}),
        enCoursDepuis: null, curseur: null, majLe: le, bail: null, jeton: null,
      };
      return true;
    },
    async etiquettes(_t, recherche, limite) {
      const groupes = new Map<string, { etiquette: string; fiches: Set<string> }>();
      for (const [contactId, liste] of etiquettes) {
        for (const e of liste) {
          const g = groupes.get(e.toLowerCase()) ?? { etiquette: e, fiches: new Set<string>() };
          g.fiches.add(contactId);
          groupes.set(e.toLowerCase(), g);
        }
      }
      const q = recherche?.trim().toLowerCase() ?? '';
      return [...groupes.entries()]
        .filter(([cle]) => q === '' || cle.includes(q))
        .map(([, g]) => ({ etiquette: g.etiquette, fiches: g.fiches.size }))
        .sort((a, b) => b.fiches - a.fiches || a.etiquette.toLowerCase().localeCompare(b.etiquette.toLowerCase()))
        .slice(0, limite);
    },
  };

  const echecsClients = [...(o.echecsClients ?? [])];
  const echecsRecherches = [...(o.echecsRecherches ?? [])];
  const suivantes = [...(o.boutiquesSuivantes ?? [])];
  let premiereBoutique = true;
  const boutiqueCourante = () => {
    if (premiereBoutique) { premiereBoutique = false; return o.boutique === undefined ? BOUTIQUE_ETIQUETTES : o.boutique; }
    if (suivantes.length > 1) return suivantes.shift()!;
    if (suivantes.length === 1) return suivantes[0]!;
    return o.boutique === undefined ? BOUTIQUE_ETIQUETTES : o.boutique;
  };
  const deps: DepsEtiquettes = {
    magasin,
    boutique: async () => boutiqueCourante(),
    etatBoutique: async () => (o.boutique === undefined ? BOUTIQUE_ETIQUETTES : o.boutique)?.etat ?? null,
    jeton: async () => o.jeton ?? { ok: true, jeton: 'jeton-de-test' },
    droits: async () => {
      trace.droits += 1;
      if (o.droits !== undefined && !Array.isArray(o.droits)) return o.droits;
      return { ok: true, droits: o.droits ?? DROITS_ETIQUETTES };
    },
    lireClients: async (_acces, p) => {
      trace.lots.push([...p.ids]);
      horloge.t += o.msParLot ?? 0;
      const force = echecsClients.shift();
      if (force) return force;
      return {
        ok: true, illisibles: 0, cout: { demande: p.ids.length + 1, reel: p.ids.length },
        clients: p.ids.map((id) => {
          const c = catalogue.get(id);
          return { clientId: id, etiquettes: c === undefined ? null : etiquettesUtiles(c.tags).etiquettes };
        }),
      };
    },
    chercher: async (_acces, p) => {
      trace.recherches.push([...p.telephones]);
      horloge.t += o.msParLot ?? 0;
      const force = echecsRecherches.shift();
      if (force) return force;
      const trouves = p.telephones.flatMap((telephone) => {
        const clients = [...catalogue.entries()].filter(([, c]) => c.telephone === telephone);
        return clients.length === 1 ? [{ telephone, clientId: clients[0]![0], etiquettes: etiquettesUtiles(clients[0]![1].tags).etiquettes }] : [];
      });
      const complete = o.incompleteAuDela === undefined || p.telephones.length <= o.incompleteAuDela;
      return { ok: true, trouves, complete, cout: { demande: 50, reel: 10 } };
    },
    offre: async () => o.offre ?? 'pro',
    enfiler: async (job, dansSecondes) => { trace.jobs.push({ job, dansSecondes }); },
    maintenant: () => horloge.t,
  };
  return { deps, trace, horloge, fiches, liens, cherchees, etiquettes, catalogue, etat: () => etat };
}
