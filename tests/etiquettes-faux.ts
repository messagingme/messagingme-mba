import { randomUUID } from 'node:crypto';
import type { DepsEtiquettes, JobEtiquettes } from '../src/shopify/etiquettes';
import {
  BAIL_SYNCHRO_SECONDES, RELECTURE_HEURES, SYNCHRO_PERIMEE_MINUTES, type ClientLu, type ClientTrouve, type EtatSynchroEtiquettes, type IssueSynchro,
  type MagasinEtiquettes,
} from '../src/shopify/etiquettes.pg';
import { etiquettesUtiles, type LotClients, type RechercheTelephones } from '../src/shopify/etiquettes-lues';
import type { ListeSegments, PageMembres, SuiviRequete } from '../src/shopify/segments-lues';
import type { IssueAbonnement } from '../src/shopify/abonnements';
import type { OrigineBoutique } from '../src/shopify/store.pg';
import { BORNES_SEGMENTS, type SegmentShopifyVue } from '../web/lib/partage/segments';
import type { IssueJeton } from '../src/shopify/connexion';
import type { Offre } from '../src/offres/offres';

/**
 * UN FAUX DE LA SYNCHRONISATION DES ÉTIQUETTES SHOPIFY (segments Shopify enrichis, lot 6b ; lot 6b bis) : le magasin en
 * mémoire, avec les MÊMES règles que `PgEtiquettesStore` (une synchronisation vivante à la fois, le bail et le jeton, la Free
 * une fois par 24 h, les fiches ACTIVES seules écrites, des liens plusieurs à plusieurs entre clients et fiches, les
 * étiquettes par couple fiche-client remplacées en bloc, la marque de la recherche par téléphone effacée par le geste du
 * marchand, les liens d'une fiche remplacés par une recherche complète, les liens perdus d'un client disparu ; lot 6c :
 * les segments, leur suivi, leur lecture page par page et ses appartenances remplacées à la dernière page), et une
 * boutique dont les clients et les segments sont donnés d'avance. Comme `now()` en base, l'horloge doit AVANCER entre deux
 * synchronisations : une lecture de segment datée du début d'une synchronisation n'en fait pas partie. L'horloge est celle du faux : un test l'avance, ou la fait avancer à chaque lot (`msParLot`). Le vrai
 * magasin est éprouvé sur PGlite (`tests/integration/shopify-etiquettes.integration.test.ts`).
 */

export const T_ETIQUETTES = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
export const BOUTIQUE_ETIQUETTES = { domaine: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x', pays: 'FR', etat: 'connectee', origine: 'console' as OrigineBoutique };
export const DROITS_ETIQUETTES = ['read_customers', 'read_orders', 'read_checkouts', 'read_fulfillments', 'read_products'];
export const MIDI_ETIQUETTES = Date.UTC(2026, 10, 24, 12);

/** Une fiche de l'espace : son téléphone (E.164) et si elle est active (ni supprimée ni anonymisée). */
export interface FicheFausse { telephone: string | null; active: boolean }
/**
 * Un client de la boutique : son téléphone (`defaultPhoneNumber`), ses autres numéros (`numeros` : ses adresses et sa
 * dernière commande, que la recherche trouve aussi depuis le lot 6b bis) et ses étiquettes, telles que Shopify les rend.
 */
export interface ClientShopify { telephone: string | null; tags: unknown[]; numeros?: string[] }
/**
 * Un segment de la boutique (lot 6c) : ses membres (les numéros de leurs clients) ; `asynchrone`, il se lit par une requête
 * asynchrone, prête au `pretApres`-ième suivi (0 : prête à sa création).
 */
export interface SegmentBoutique { nom: string; requete?: string | null; membres: string[]; asynchrone?: boolean; pretApres?: number }
/** Un segment connu de l'espace (`shopify_segments`), tel que le faux le garde. */
export interface SegmentFaux {
  nom: string; requete: string | null; suivi: boolean; absentLe: number | null; luLe: number | null; partiel: boolean; membres: number;
  fiches: number; lectureDebut: number | null; curseur: string | null; requeteAsynchrone: string | null; lectureMembres: number;
}
const SANS_LECTURE = { lectureDebut: null, curseur: null, requeteAsynchrone: null, lectureMembres: 0 } as const;

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
  /** Lot 6c : les segments de la boutique, par identifiant. */
  boutiqueSegments?: Record<string, SegmentBoutique>;
  /** Les segments déjà connus de l'espace, et les fiches déjà dans chacun (`fichesMembres`, vues la veille). */
  segmentsDeDepart?: Array<Partial<SegmentFaux> & { segmentId: string; nom: string; fichesMembres?: string[] }>;
  /** La liste des segments rendue incomplète (plus de 250, ou un nœud illisible). */
  listeIncomplete?: boolean;
  /** Les issues forcées de la liste, des pages de membres et des suivis de requête, servies dans l'ordre ; `null` : l'appel suit la boutique. */
  echecsListe?: Array<ListeSegments | null>;
  echecsMembres?: Array<PageMembres | null>;
  echecsSuivis?: Array<SuiviRequete | null>;
  /** Une requête asynchrone que Shopify oublie : son suivi la dit perdue. */
  requetesOubliees?: boolean;
  /** La taille d'une page de membres (1 000 chez Shopify). */
  membresParPage?: number;
  /** Lot 6d : ce que rend l'abonnement des sujets d'étiquettes (`ok` par défaut), ou `leve` pour une panne. */
  abonnement?: IssueAbonnement | 'leve';
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
  /** Les segments connus de l'espace et leurs appartenances (`shopify_segment_membres` : la fiche et son `vu_le`). */
  const segs = new Map<string, SegmentFaux>((o.segmentsDeDepart ?? []).map(({ segmentId, fichesMembres: _f, ...x }) => [segmentId, {
    requete: null, suivi: false, absentLe: null, luLe: null, partiel: false, membres: 0, fiches: 0, ...SANS_LECTURE, ...x,
  }]));
  const appartenances = new Map<string, Map<string, number>>((o.segmentsDeDepart ?? []).filter((x) => x.fichesMembres !== undefined)
    .map((x) => [x.segmentId, new Map(x.fichesMembres!.map((c) => [c, MIDI_ETIQUETTES - 86_400_000]))]));
  /** Les fiches d'un segment, comme le critère les lit. */
  const membresDe = (segmentId: string): string[] => [...(appartenances.get(segmentId)?.keys() ?? [])].sort();
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
    listes: 0,
    pages: [] as Array<{ segmentId: string; requete: string | null; apres: string | null }>,
    requetesCreees: [] as string[],
    suivis: [] as string[],
    /** Lot 6d : les sujets abonnés, appel par appel. */
    abonnements: [] as string[][],
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
      if (issue !== 'lue') for (const [id, x] of segs) if (x.lectureDebut !== null) segs.set(id, { ...x, partiel: true });
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
    async ecrireSegments(_t, jeton, l) {
      if (!tient(jeton)) return false;
      for (const x of l.segments) {
        const avant = segs.get(x.segmentId);
        segs.set(x.segmentId, avant ? { ...avant, nom: x.nom, requete: x.requete, absentLe: null } : {
          nom: x.nom, requete: x.requete, suivi: false, absentLe: null, luLe: null, partiel: false, membres: 0, fiches: 0, ...SANS_LECTURE,
        });
      }
      if (l.complete) {
        for (const [id, x] of segs) {
          if (x.absentLe !== null || l.segments.some((y) => y.segmentId === id)) continue;
          segs.set(id, { ...x, absentLe: horloge.t, luLe: null, partiel: false, membres: 0, fiches: 0, ...SANS_LECTURE });
          appartenances.delete(id);
        }
      }
      return true;
    },
    async suivreSegments(_t, ids) {
      const uniques = [...new Set(ids)].slice(0, BORNES_SEGMENTS.segmentsShopifyMax);
      const inconnus = uniques.filter((id) => segs.get(id)?.absentLe !== null);
      if (inconnus.length > 0) return { inconnus };
      for (const [id, x] of segs) {
        if (!x.suivi || uniques.includes(id)) continue;
        segs.set(id, { ...x, suivi: false, luLe: null, partiel: false, membres: 0, fiches: 0, ...SANS_LECTURE });
        appartenances.delete(id);
      }
      for (const id of uniques) segs.set(id, { ...segs.get(id)!, suivi: true });
      return { inconnus: [] };
    },
    async prochainSegment(_t, jeton, sauf) {
      if (!tient(jeton)) return 'perdu';
      // `DEBUT_SYNCHRO` : le début de la synchronisation tenue ; une comparaison à une valeur nulle vaut faux, comme en SQL.
      const debut = etat!.enCoursDepuis?.getTime() ?? null;
      for (const [id, x] of segs) if (x.lectureDebut !== null && debut !== null && x.lectureDebut < debut) segs.set(id, { ...x, ...SANS_LECTURE });
      const suivant = [...segs.entries()]
        .filter(([id, x]) => x.suivi && x.absentLe === null && (x.luLe === null || (debut !== null && x.luLe < debut)) && !sauf.includes(id))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))[0];
      if (!suivant) return null;
      const [segmentId, x] = suivant;
      return { segmentId, nom: x.nom, curseur: x.curseur, requete: x.requeteAsynchrone, lectureDebut: x.lectureDebut === null ? null : new Date(x.lectureDebut) };
    },
    async noterRequeteSegment(_t, jeton, segmentId, requete) {
      if (!tient(jeton)) return false;
      const x = segs.get(segmentId);
      if (x && x.suivi && x.absentLe === null) {
        segs.set(segmentId, {
          ...x, requeteAsynchrone: requete, curseur: null, lectureMembres: 0, lectureDebut: requete === null ? x.lectureDebut : (x.lectureDebut ?? horloge.t),
        });
      }
      return true;
    },
    async ecrirePageSegment(_t, jeton, segmentId, p) {
      if (!tient(jeton)) return false;
      trace.ecritures += 1;
      const x = segs.get(segmentId);
      // Comme `curseur is not distinct from $5` : la page s'écrit seulement si la lecture en est à elle.
      if (!x || !x.suivi || x.absentLe !== null || x.curseur !== p.apres) return true;
      const lectureDebut = x.lectureDebut ?? horloge.t;
      let apres: SegmentFaux = { ...x, lectureDebut, lectureMembres: x.lectureMembres + p.clients.length, curseur: p.suivant };
      const m = appartenances.get(segmentId) ?? new Map<string, number>();
      for (const contactId of new Set(p.clients.flatMap((c) => fichesDuClient(c)))) if (active(contactId)) m.set(contactId, horloge.t);
      appartenances.set(segmentId, m);
      if (p.suivant === null) {
        for (const [contactId, vu] of [...m]) if (vu < lectureDebut) m.delete(contactId);
        apres = { ...apres, luLe: horloge.t, partiel: false, membres: apres.lectureMembres, fiches: m.size, ...SANS_LECTURE };
      }
      segs.set(segmentId, apres);
      avancer({ clientsLus: 0, trouves: 0, sansFiche: 0 });
      return true;
    },
    async segments() {
      return [...segs.entries()]
        .sort(([ia, a], [ib, b]) => Number(a.absentLe !== null) - Number(b.absentLe !== null) || Number(b.suivi) - Number(a.suivi)
          || a.nom.toLowerCase().localeCompare(b.nom.toLowerCase()) || (ia < ib ? -1 : ia > ib ? 1 : 0))
        .map(([segmentId, x]): SegmentShopifyVue => ({
          segmentId, nom: x.nom, requete: x.requete, suivi: x.suivi, absent: x.absentLe !== null,
          luLe: x.luLe === null ? null : new Date(x.luLe).toISOString(), partiel: x.partiel || x.lectureDebut !== null, membres: x.membres, fiches: x.fiches,
        }));
    },
  };

  const echecsListe = [...(o.echecsListe ?? [])];
  const echecsMembres = [...(o.echecsMembres ?? [])];
  const echecsSuivis = [...(o.echecsSuivis ?? [])];
  const boutiqueSegments = new Map(Object.entries(o.boutiqueSegments ?? {}));
  /** Les requêtes asynchrones créées chez la fausse boutique : leur segment et combien de fois elles ont été suivies. */
  const requetes = new Map<string, { segmentId: string; suivis: number }>();
  const prete = (q: { segmentId: string; suivis: number }): boolean => q.suivis >= (boutiqueSegments.get(q.segmentId)?.pretApres ?? 0);
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
    listerSegments: async () => {
      trace.listes += 1;
      const force = echecsListe.shift();
      if (force) return force;
      return {
        ok: true, complete: !o.listeIncomplete, cout: { demande: 13, reel: 3 },
        segments: [...boutiqueSegments.entries()].map(([segmentId, x]) => ({ segmentId, nom: x.nom, requete: x.requete ?? null })),
      };
    },
    lireMembres: async (_acces, p) => {
      trace.pages.push({ segmentId: p.segmentId, requete: p.requete, apres: p.apres });
      horloge.t += o.msParLot ?? 0;
      const force = echecsMembres.shift();
      if (force) return force;
      const x = boutiqueSegments.get(p.segmentId);
      if (!x) return { ok: false, code: 'passager', message: 'Segment inconnu de la fausse boutique.' };
      if (x.asynchrone && p.requete === null) return { ok: false, code: 'asynchrone', message: 'Shopify demande une requête asynchrone pour ce segment.' };
      if (p.requete !== null) {
        const q = requetes.get(p.requete);
        if (!q || !prete(q)) return { ok: false, code: 'pas_fini', message: 'La requête asynchrone de Shopify n’est pas encore prête.' };
      }
      const n = o.membresParPage ?? 1000;
      const depart = p.apres === null ? 0 : Number(p.apres);
      return {
        ok: true, clients: x.membres.slice(depart, depart + n), suivant: depart + n < x.membres.length ? String(depart + n) : null,
        cout: { demande: 140, reel: 20 },
      };
    },
    creerRequete: async (_acces, p) => {
      trace.requetesCreees.push(p.segmentId);
      const id = `gid://shopify/CustomerSegmentMembersQuery/${trace.requetesCreees.length}`;
      const q = { segmentId: p.segmentId, suivis: 0 };
      requetes.set(id, q);
      return { ok: true, requete: id, fini: prete(q) };
    },
    suivreRequete: async (_acces, p) => {
      trace.suivis.push(p.requete);
      const force = echecsSuivis.shift();
      if (force) return force;
      const q = requetes.get(p.requete);
      if (!q || o.requetesOubliees) return { ok: true, etat: 'perdue' };
      q.suivis += 1;
      return { ok: true, etat: prete(q) ? 'prete' : 'en_cours' };
    },
    abonner: async (_acces, sujets) => {
      trace.abonnements.push([...sujets]);
      if (o.abonnement === 'leve') throw new Error('Shopify absent');
      return o.abonnement ?? { ok: true, abonnes: [...sujets], deja: [] };
    },
    offre: async () => o.offre ?? 'pro',
    enfiler: async (job, dansSecondes) => { trace.jobs.push({ job, dansSecondes }); },
    maintenant: () => horloge.t,
  };
  return { deps, trace, horloge, fiches, liens, cherchees, etiquettes, catalogue, fichesDuClient, segs, membresDe, boutiqueSegments, etat: () => etat };
}
