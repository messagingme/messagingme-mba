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
 * UN FAUX DE LA SYNCHRONISATION DES ÉTIQUETTES SHOPIFY (segments Shopify enrichis, lot 6b ; lot 6b bis) : le magasin en
 * mémoire, avec les MÊMES règles que `PgEtiquettesStore` (une synchronisation vivante à la fois, le bail et le jeton, la Free
 * une fois par 24 h, les fiches ACTIVES seules écrites, des liens plusieurs à plusieurs entre clients et fiches, les
 * étiquettes par couple fiche-client remplacées en bloc, la marque de la recherche par téléphone effacée par le geste du
 * marchand, les liens d'une fiche remplacés par une recherche complète, les liens perdus d'un client disparu), et une
 * boutique dont les clients sont donnés d'avance. L'horloge est celle du faux : un test l'avance, ou la fait avancer à chaque lot (`msParLot`). Le vrai
 * magasin est éprouvé sur PGlite (`tests/integration/shopify-etiquettes.integration.test.ts`).
 */

export const T_ETIQUETTES = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
export const BOUTIQUE_ETIQUETTES = { domaine: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x', pays: 'FR', etat: 'connectee' };
export const DROITS_ETIQUETTES = ['read_customers', 'read_orders', 'read_checkouts', 'read_fulfillments', 'read_products'];
export const MIDI_ETIQUETTES = Date.UTC(2026, 10, 24, 12);

/** Une fiche de l'espace : son téléphone (E.164) et si elle est active (ni supprimée ni anonymisée). */
export interface FicheFausse { telephone: string | null; active: boolean }
/**
 * Un client de la boutique : son téléphone (`defaultPhoneNumber`), ses autres numéros (`numeros` : ses adresses et sa
 * dernière commande, que la recherche trouve aussi depuis le lot 6b bis) et ses étiquettes, telles que Shopify les rend.
 */
export interface ClientShopify { telephone: string | null; tags: unknown[]; numeros?: string[] }

interface EtatFaux extends Omit<EtatSynchroEtiquettes, 'tenue'> {
  curseur: string | null;
  bail: number | null;
  jeton: string | null;
}

export function monterEtiquettes(o: {
  fiches?: Record<string, FicheFausse>;
  /**
   * Les liens déjà posés par une synchronisation précédente (`shopify_clients`) : un client Shopify et une fiche de l'un de
   * ses numéros, avec les étiquettes de ce couple s'il y en a.
   */
  liensDeDepart?: Array<{ clientId: string; contactId: string; etiquettes?: string[] }>;
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
  /** La clé d'un lien (et de ses étiquettes) : le couple client-fiche. */
  const cle = (clientId: string, contactId: string): string => `${clientId} ${contactId}`;
  const liens = new Map<string, { clientId: string; contactId: string; vuLe: number | null }>(
    (o.liensDeDepart ?? []).map((l) => [cle(l.clientId, l.contactId), { clientId: l.clientId, contactId: l.contactId, vuLe: null }]),
  );
  /** Les étiquettes de chaque couple client-fiche (`shopify_etiquettes` et son `client_id`, migration 0326). */
  const parCouple = new Map<string, string[]>(
    (o.liensDeDepart ?? []).filter((l) => l.etiquettes !== undefined).map((l) => [cle(l.clientId, l.contactId), [...l.etiquettes!]]),
  );
  const cherchees = new Set<string>();
  /** Un lien défait emporte ses étiquettes, comme la cascade de la 0326. */
  const defaire = (clientId: string, contactId: string): void => { liens.delete(cle(clientId, contactId)); parCouple.delete(cle(clientId, contactId)); };
  const fichesDuClient = (clientId: string): string[] => [...liens.values()].filter((l) => l.clientId === clientId).map((l) => l.contactId);
  /** Les étiquettes d'une fiche : l'union de celles de ses clients, dans l'ordre des liens ; `undefined` sans aucune lue. */
  const etiquettesDeFiche = (contactId: string): string[] | undefined => {
    const couples = [...liens.values()].filter((l) => l.contactId === contactId && parCouple.has(cle(l.clientId, l.contactId)));
    return couples.length === 0 ? undefined : [...new Set(couples.flatMap((l) => parCouple.get(cle(l.clientId, l.contactId))!))];
  };
  /** La vue par fiche des étiquettes, comme l'onglet Shopify de la fiche la lit : `get`, `size`, `values`, `entries`. */
  const etiquettes = {
    get: (contactId: string): string[] | undefined => etiquettesDeFiche(contactId),
    /** Pose les étiquettes d'une fiche comme si UN client (`seme-<fiche>`) les lui donnait : les tests qui sèment la liste. */
    set: (contactId: string, liste: readonly string[]): void => {
      const c = `seme-${contactId}`;
      liens.set(cle(c, contactId), { clientId: c, contactId, vuLe: null });
      parCouple.set(cle(c, contactId), [...liste]);
    },
    fiches: (): string[] => [...new Set([...liens.values()].filter((l) => parCouple.has(cle(l.clientId, l.contactId))).map((l) => l.contactId))],
    get size(): number { return etiquettes.fiches().length; },
    values: (): string[][] => etiquettes.fiches().map((x) => etiquettesDeFiche(x)!),
    entries: (): Array<[string, string[]]> => etiquettes.fiches().map((x) => [x, etiquettesDeFiche(x)!]),
  };
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
      // Le geste du marchand : toutes les fiches seront cherchées de nouveau (lot 6b bis).
      cherchees.clear();
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
    async aChercher(_t, n, apres) {
      return [...fiches.entries()]
        .filter(([id, f]) => f.active && f.telephone !== null && !cherchees.has(id) && (apres === null || f.telephone > apres))
        .sort(([, a], [, b]) => a.telephone!.localeCompare(b.telephone!))
        .slice(0, n)
        .map(([contactId, f]) => ({ contactId, telephone: f.telephone! }));
    },
    async ecrireRecherche(_t, jeton, r: { cherchees: readonly string[]; trouves: readonly ClientTrouve[]; complete: boolean }) {
      if (!tient(jeton)) return null;
      trace.ecritures += 1;
      const marquees = r.cherchees.filter((id) => active(id));
      for (const id of marquees) cherchees.add(id);
      const aRelier = r.trouves.filter((t) => active(t.contactId));
      // Une recherche complète dit tous les clients du numéro de chaque fiche cherchée : ses autres liens se défont.
      if (r.complete) {
        for (const l of [...liens.values()]) {
          if (marquees.includes(l.contactId) && !aRelier.some((t) => t.clientId === l.clientId && t.contactId === l.contactId)) defaire(l.clientId, l.contactId);
        }
      }
      const nouvelles = new Set<string>();
      for (const t of aRelier) {
        if (!liens.has(cle(t.clientId, t.contactId))) nouvelles.add(t.contactId);
        liens.set(cle(t.clientId, t.contactId), { clientId: t.clientId, contactId: t.contactId, vuLe: horloge.t });
        parCouple.set(cle(t.clientId, t.contactId), [...t.etiquettes]);
      }
      // Comme le vrai magasin : un client relié se compte à sa lecture par identifiant, une fois.
      const relies = new Set(aRelier.map((t) => t.clientId));
      avancer({ clientsLus: 0, trouves: nouvelles.size, sansFiche: new Set(r.trouves.filter((t) => !relies.has(t.clientId)).map((t) => t.clientId)).size });
      return { relies: nouvelles.size };
    },
    async clientsALire(_t, curseur, n) {
      return [...new Set([...liens.values()].map((l) => l.clientId))].filter((id) => curseur === null || id > curseur).sort().slice(0, n);
    },
    async ecrireClients(_t, jeton, r: { lus: readonly ClientLu[]; curseur: string }) {
      if (!tient(jeton)) return false;
      trace.ecritures += 1;
      let lus = 0;
      let sansFiche = 0;
      for (const c of r.lus) {
        const sesFiches = fichesDuClient(c.clientId);
        if (sesFiches.length === 0) continue;
        if (c.etiquettes === null) {
          // Disparu chez Shopify : tous ses liens se défont, ses fiches redeviennent à chercher.
          for (const contactId of sesFiches) { defaire(c.clientId, contactId); cherchees.delete(contactId); }
          continue;
        }
        let vivantes = 0;
        for (const contactId of sesFiches) {
          if (!active(contactId)) { defaire(c.clientId, contactId); continue; }
          liens.set(cle(c.clientId, contactId), { clientId: c.clientId, contactId, vuLe: horloge.t });
          parCouple.set(cle(c.clientId, contactId), [...c.etiquettes]);
          vivantes += 1;
        }
        if (vivantes > 0) lus += 1; else sansFiche += 1;
      }
      avancer({ clientsLus: lus, trouves: 0, sansFiche, curseur: r.curseur });
      return true;
    },
    async finir(_t, jeton, issue, message) {
      if (!tient(jeton)) return false;
      trace.issues.push({ issue, message });
      const le = new Date(horloge.t);
      etat = {
        ...etat!, issue, issueLe: le, message: message === null ? null : message.slice(0, 500),
        ...(issue === 'lue' ? { synchroLe: le, comptes: { ...etat!.comptes, fichesEtiquetees: etiquettes.values().filter((l) => l.length > 0).length } } : {}),
        enCoursDepuis: null, curseur: null, majLe: le, bail: null, jeton: null,
      };
      return true;
    },
    async etiquettes(_t, recherche, limite) {
      const groupes = new Map<string, { etiquette: string; fiches: Set<string> }>();
      for (const [contactId, liste] of etiquettes.entries()) {
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
      // Comme `chercherParTelephones` : chaque client qui porte le numéro parmi les siens, tous les clients d'un numéro.
      const trouves = p.telephones.flatMap((telephone) => [...catalogue.entries()]
        .filter(([, c]) => c.telephone === telephone || (c.numeros ?? []).includes(telephone))
        .map(([clientId, c]) => ({ telephone, clientId, etiquettes: etiquettesUtiles(c.tags).etiquettes })));
      const complete = o.incompleteAuDela === undefined || p.telephones.length <= o.incompleteAuDela;
      return { ok: true, trouves, complete, cout: { demande: 50, reel: 10 } };
    },
    offre: async () => o.offre ?? 'pro',
    enfiler: async (job, dansSecondes) => { trace.jobs.push({ job, dansSecondes }); },
    maintenant: () => horloge.t,
  };
  return { deps, trace, horloge, fiches, liens, cherchees, etiquettes, catalogue, fichesDuClient, etat: () => etat };
}
