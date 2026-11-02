import type { ChampHubspot, ChampsHubspotDuPortail } from './api';

/**
 * LES CHAMPS HUBSPOT À IMPORTER (lot 2 du 2026-11-02, `components/ChampsHubspot.tsx`) : la logique de l'écran, en
 * fonctions pures, testées dans `hubspot-champs.test.ts`. Le serveur tient les mêmes bornes (20 au plus, sans doublon).
 */

/** Au plus autant de champs choisis, calculés compris (le serveur refuse au-delà). */
export const CHAMPS_HUBSPOT_MAX = 20;

/** L'identifiant d'un champ dans la sélection de l'écran : son objet et sa propriété. */
export const idChamp = (c: ChampHubspot): string => `${c.objet}:${c.propriete}`;

/** Une ligne de la liste : un champ, son libellé HubSpot, et s'il peut être coché. */
export interface LigneChamp extends ChampHubspot {
  libelle: string;
  /** Le nom interne, montré sous le libellé (deux propriétés peuvent porter le même libellé). */
  nom: string;
  /** Faux pour le lien de réservation sans l'accès à l'agenda. */
  disponible: boolean;
}

export interface GroupeChamps {
  objet: ChampHubspot['objet'];
  lignes: LigneChamp[];
}

/** Pour la recherche : minuscules, sans accents. */
const plat = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Les trois groupes de l'écran (Contact, Transaction, Calculés), filtrés par la recherche sur le libellé ou le nom.
 * 🔴 Un champ déjà choisi reste visible quelle que soit la recherche : il compte dans les 20, on doit pouvoir le décocher.
 */
export function groupesDeChamps(portail: ChampsHubspotDuPortail, recherche: string, selection: ReadonlySet<string>): GroupeChamps[] {
  const q = plat(recherche.trim());
  const garde = (l: LigneChamp) => q === '' || selection.has(idChamp(l)) || plat(l.libelle).includes(q) || plat(l.nom).includes(q);
  const proprietes = (objet: 'contact' | 'deal'): LigneChamp[] =>
    portail.proprietes[objet].map((p) => ({ objet, propriete: p.nom, nom: p.nom, libelle: p.libelle, disponible: true }));
  const calcules: LigneChamp[] = portail.calcules.map((c) => ({
    objet: 'calcule', propriete: c.cle, nom: c.cle, libelle: c.libelle, disponible: c.disponible,
  }));
  // 🔴 Un champ choisi que le portail ne propose plus (supprimé, caché ou devenu sensible dans HubSpot) : montré avec
  // la raison, décochable et jamais recochable. Sans sa ligne, il resterait dans la sélection sans case, et chaque
  // enregistrement prendrait le refus `propriete_inconnue` (relecture du lot 2, 2026-11-02).
  const connus = new Set([...proprietes('contact'), ...proprietes('deal'), ...calcules].map(idChamp));
  const disparus = (objet: ChampHubspot['objet']): LigneChamp[] => portail.choisis
    .filter((c) => c.objet === objet && !connus.has(idChamp(c)))
    .map((c) => ({ objet, propriete: c.propriete, nom: c.propriete, libelle: `${c.libelle} (n’existe plus dans HubSpot)`, disponible: false }));
  return [
    { objet: 'contact' as const, lignes: [...proprietes('contact'), ...disparus('contact')].filter(garde) },
    { objet: 'deal' as const, lignes: [...proprietes('deal'), ...disparus('deal')].filter(garde) },
    { objet: 'calcule' as const, lignes: [...calcules, ...disparus('calcule')].filter(garde) },
  ];
}

/**
 * La réponse de la lecture a-t-elle la forme attendue ? Une API d'une autre version (ou un mock) qui rendrait autre chose
 * ferait tomber toute la page Intégrations : l'écran le dit à la place.
 */
export function portailLisible(p: unknown): p is ChampsHubspotDuPortail {
  const r = p as Partial<ChampsHubspotDuPortail> | null | undefined;
  return !!r && Array.isArray(r.proprietes?.contact) && Array.isArray(r.proprietes?.deal) && Array.isArray(r.calcules) && Array.isArray(r.choisis);
}

/** La sélection de départ : la liste enregistrée chez le connecteur. */
export function selectionDe(choisis: ReadonlyArray<ChampHubspot>): Set<string> {
  return new Set(choisis.map(idChamp));
}

/** La case est-elle grisée ? Au-delà de 20, seules les cases cochées restent actives ; un champ indisponible ne se coche pas. */
export function caseGrisee(selection: ReadonlySet<string>, l: LigneChamp): boolean {
  if (selection.has(idChamp(l))) return false;
  return !l.disponible || selection.size >= CHAMPS_HUBSPOT_MAX;
}

/** Coche ou décoche, sans jamais dépasser 20. */
export function basculerChamp(selection: ReadonlySet<string>, l: LigneChamp): Set<string> {
  const suivante = new Set(selection);
  const id = idChamp(l);
  if (suivante.has(id)) suivante.delete(id);
  else if (!caseGrisee(selection, l)) suivante.add(id);
  return suivante;
}

/** Le corps de `PUT .../hubspot/champs` : la sélection, sans libellé (le serveur relit ceux de HubSpot). */
export function corpsDesChamps(selection: ReadonlySet<string>): ChampHubspot[] {
  return [...selection].flatMap((id) => {
    const i = id.indexOf(':');
    const objet = id.slice(0, i);
    const propriete = id.slice(i + 1);
    return objet === 'contact' || objet === 'deal' || objet === 'calcule' ? [{ objet, propriete }] : [];
  });
}

/** La sélection diffère-t-elle de ce qui est enregistré ? Le bouton « Enregistrer » ne sert qu'alors. */
export function selectionModifiee(selection: ReadonlySet<string>, enregistree: ReadonlySet<string>): boolean {
  return selection.size !== enregistree.size || [...selection].some((id) => !enregistree.has(id));
}
