import { NIVEAUX_RISQUE, type NiveauRisque } from '../engagement/risque';
import { isContactFieldOp, type ContactFieldFilter, type ContactFilters } from './contact-store.pg';
import { champFiche } from './champs-fiche';
import { estCleFiltrable, estOperateurFicheSeul, lireFiltreFiche } from './filtre-fiche';
import { paysConnu, paysPrincipalDe } from './segments';
import {
  BORNES_SEGMENTS, CLES_SEGMENT, OP_SEGMENT, estCleSegment, type CleSegment, type PlageSurJours,
} from '../../web/lib/partage/segments';

/**
 * Construction d'un `ContactFilters` à partir de données non fiables. Deux entrées : les query params d'une URL
 * (`parseFilters`) et le corps JSON d'une action en masse (`normalizeContactFilters`). Le décodage diffère, les
 * règles (bornes, opérateurs, plafonds) sont ici, communes : sinon un même filtre affiché viserait deux
 * populations différentes.
 */

/** Plafonds : ils bornent une donnée cliente, pas un choix d'ergonomie. */
export const MAX_TAGS = 50;
export const MAX_FIELD_FILTERS = 20;
const MAX_FIELD_KEY = 120;
const MAX_FIELD_VALUE = 500;

/** Chaîne utile (non vide après trim), sinon undefined. */
export function texteFiltre(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

/** Liste de tags dédupliquée, sans vides, plafonnée. */
export function tagsFiltre(v: string[]): string[] {
  return [...new Set(v.map(String).map((s) => s.trim()).filter((s) => s !== ''))].slice(0, MAX_TAGS);
}

/**
 * Filtres de champ normalisés. Chaque élément doit être un objet portant une `key` texte. Les éléments non-objets
 * (`[null]` d'un corps JSON hostile) sont écartés avant lecture, sinon la route tombe en 500 sur `f.key`.
 *
 * Deux régimes. Un champ PERSO : un opérateur inconnu retombe sur `eq`, et `empty`/`not_empty` n'ont pas de valeur.
 * Un champ de la DERNIÈRE ANALYSE : 🔴 rien n'est deviné, un opérateur ou une valeur invalide lève
 * `FiltreContactInvalide` (400), comme le niveau de risque. Ramené à `eq`, « urgence au moins 7 » deviendrait
 * « urgence égale à 7 », et une valeur jetée rendrait tout l'espace. Le sujet (texte libre) n'est pas filtrable, et
 * un opérateur de colonne n'a pas de sens sur un champ perso : refusés aussi.
 */
export function normalizeFieldFilters(raw: unknown[]): ContactFieldFilter[] {
  const lus = raw
    .filter((f): f is { key?: unknown; op?: unknown; value?: unknown } => f !== null && typeof f === 'object' && !Array.isArray(f))
    .filter((f) => typeof f.key === 'string');
  // 🔴 Un critère de segment n'est jamais tronqué : au-delà du plafond, la liste est refusée (jetés, ils élargiraient
  // l'audience). Sans segment, la troncature historique reste.
  if (lus.length > MAX_FIELD_FILTERS && lus.some((f) => estCleSegment(f.key))) {
    throw new FiltreContactInvalide(`${MAX_FIELD_FILTERS} filtres de champ au plus, critères d’achats et d’activité compris`);
  }
  return lus
    .slice(0, MAX_FIELD_FILTERS)
    .map((f): ContactFieldFilter => {
      const key = String(f.key).slice(0, MAX_FIELD_KEY);
      if (estCleSegment(key)) {
        if (f.op !== OP_SEGMENT) throw new FiltreContactInvalide(`filtre « ${NOMS_SEGMENT[key]} » : l’opérateur « segment » est attendu`);
        return { key, op: OP_SEGMENT, value: JSON.stringify(lireSegment(key, f.value)) };
      }
      if (f.op === OP_SEGMENT) throw new FiltreContactInvalide(`opérateur « segment » réservé aux critères d’achats, d’activité et de pays`);
      if (estCleFiltrable(key)) {
        const lu = lireFiltreFiche(key, f.op, typeof f.value === 'string' ? f.value.slice(0, MAX_FIELD_VALUE) : f.value);
        if (!lu.ok) throw new FiltreContactInvalide(lu.raison);
        return { key, op: lu.filtre.op, value: lu.filtre.valeur };
      }
      if (champFiche(key)?.provenance === 'analyse') {
        throw new FiltreContactInvalide(`« ${champFiche(key)!.libelle[0]} » n’est pas filtrable`);
      }
      if (estOperateurFicheSeul(f.op)) {
        throw new FiltreContactInvalide(`opérateur « ${f.op} » réservé aux champs de la dernière analyse`);
      }
      return {
        key,
        op: isContactFieldOp(f.op) ? f.op : 'eq',
        value: typeof f.value === 'string' ? String(f.value).slice(0, MAX_FIELD_VALUE) : '',
      };
    });
}

/** Le nom d'un critère de segment dans la phrase d'un refus. */
const NOMS_SEGMENT: Record<CleSegment, string> = {
  [CLES_SEGMENT.commandes]: 'commandes', [CLES_SEGMENT.depense]: 'dépense', [CLES_SEGMENT.derniereCommande]: 'dernière commande',
  [CLES_SEGMENT.actif]: 'actif', [CLES_SEGMENT.inactif]: 'inactif', [CLES_SEGMENT.pays]: 'pays',
};

/**
 * La valeur d'un critère de segment (son JSON), lue et ramenée à sa forme canonique. 🔴 Refusée au moindre défaut, jamais
 * ignorée : JSON illisible, clé inconnue, borne hors plage, minimum au-dessus du maximum, pays inconnu, et pour le nombre
 * de commandes et la dépense « au moins 0 » sans maximum, qui viserait tout l'espace.
 */
export function lireSegment(cle: CleSegment, brut: unknown): PlageSurJours | number | string[] {
  const nom = NOMS_SEGMENT[cle];
  let v: unknown;
  try { v = typeof brut === 'string' ? JSON.parse(brut) as unknown : undefined; } catch { v = undefined; }
  if (v === undefined) throw new FiltreContactInvalide(`filtre « ${nom} » : valeur illisible`);
  switch (cle) {
    case CLES_SEGMENT.commandes: return lirePlage(v, nom, { max: BORNES_SEGMENTS.commandesMax, entier: true, avecJours: true, restreint: true });
    case CLES_SEGMENT.depense: return lirePlage(v, nom, { max: BORNES_SEGMENTS.depenseMax, entier: false, avecJours: true, restreint: true });
    case CLES_SEGMENT.derniereCommande: return lirePlage(v, nom, { max: BORNES_SEGMENTS.joursMax, entier: true, avecJours: false, restreint: false });
    case CLES_SEGMENT.actif:
    case CLES_SEGMENT.inactif: return lireJours(v, nom);
    case CLES_SEGMENT.pays: return lirePays(v);
  }
}

/** Un nombre de jours : entier de 1 à `joursMax`. */
function lireJours(v: unknown, nom: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > BORNES_SEGMENTS.joursMax) {
    throw new FiltreContactInvalide(`filtre « ${nom} » : un nombre entier de jours, de 1 à ${BORNES_SEGMENTS.joursMax}`);
  }
  return v;
}

/** Une plage `{ min, max }` (et `jours` si `avecJours`), sans clé inconnue. */
function lirePlage(v: unknown, nom: string, o: { max: number; entier: boolean; avecJours: boolean; restreint: boolean }): PlageSurJours {
  const refus = (raison: string): never => { throw new FiltreContactInvalide(`filtre « ${nom} » : ${raison}`); };
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return refus('un objet { min, max } est attendu');
  const brut = v as Record<string, unknown>;
  const permises = o.avecJours ? ['min', 'max', 'jours'] : ['min', 'max'];
  const inconnues = Object.keys(brut).filter((k) => !permises.includes(k));
  if (inconnues.length > 0) refus(`clé inconnue (${inconnues.join(', ')}) ; seules ${permises.join(', ')}`);
  const borne = (k: 'min' | 'max'): number | undefined => {
    const x = brut[k];
    if (x === undefined || x === null) return undefined;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > o.max || (o.entier && !Number.isInteger(x))) {
      return refus(`« ${k} » : ${o.entier ? 'un entier' : 'un nombre'} de 0 à ${o.max}`);
    }
    return x;
  };
  const min = borne('min');
  const max = borne('max');
  if (min === undefined && max === undefined) refus('au moins une borne, min ou max');
  if (min !== undefined && max !== undefined && min > max) refus('le minimum dépasse le maximum');
  if (o.restreint && (min ?? 0) === 0 && max === undefined) refus('« au moins 0 » ne restreint rien : un minimum au-dessus de 0, ou un maximum');
  const jours = o.avecJours && brut.jours !== undefined && brut.jours !== null ? lireJours(brut.jours, nom) : undefined;
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(jours !== undefined ? { jours } : {}) };
}

/** Des pays ISO alpha-2 : mis en capitales, dédupliqués ; un code sans indicatif connu est refusé, nommé. */
function lirePays(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((p) => typeof p === 'string')) throw new FiltreContactInvalide('filtre « pays » : une liste de codes ISO (FR, BE) est attendue');
  const pays = [...new Set((v as string[]).map((p) => p.trim().toUpperCase()).filter((p) => p !== ''))];
  if (pays.length === 0) throw new FiltreContactInvalide('filtre « pays » : au moins un code ISO (FR, BE)');
  if (pays.length > BORNES_SEGMENTS.paysMax) throw new FiltreContactInvalide(`filtre « pays » : ${BORNES_SEGMENTS.paysMax} pays au plus`);
  const inconnus = pays.filter((p) => !paysConnu(p));
  if (inconnus.length > 0) throw new FiltreContactInvalide(`filtre « pays » : code inconnu (${inconnus.join(', ')}) ; un code ISO à deux lettres, GB pour le Royaume-Uni`);
  // Un indicatif partagé ne distingue pas ses pays : seul son pays principal le cible, et il les vise tous.
  const partages = pays.filter((p) => paysPrincipalDe(p) !== p);
  if (partages.length > 0) {
    throw new FiltreContactInvalide(`filtre « pays » : ${partages.map((p) => `${p} partage son indicatif avec ${paysPrincipalDe(p)}`).join(', ')} `
      + `; le numéro ne les distingue pas, ciblez ${[...new Set(partages.map(paysPrincipalDe))].join(', ')}, qui les vise tous`);
  }
  return pays;
}

/** Entrées déjà décodées par l'appelant (chacun sait lire sa forme), avant les règles communes. */
export interface EntreesFiltres {
  tags: string[];
  tagMode: unknown;
  tagsExclude: string[];
  optIn: unknown;
  phonePrefix: unknown;
  phoneContains: unknown;
  nameSearch: unknown;
  joignabilite: unknown;
  risque: unknown;
  fieldFilters: ContactFieldFilter[];
}

/**
 * Un filtre de contacts refusé plutôt qu'ignoré. `statusCode` le fait rendre en 400 par le gestionnaire
 * d'erreurs de `src/server.ts`, avec ce message, par toutes les routes qui lisent des filtres : aucune ne peut
 * l'oublier et rendre une liste.
 */
export class FiltreContactInvalide extends Error {
  readonly statusCode = 400;
}

/**
 * Le niveau de risque demandé : absent, ou l'un des quatre niveaux. 🔴 Toute autre valeur est refusée, à
 * l'inverse du reste du module : un niveau mal orthographié jeté en silence rendrait tout l'espace à qui
 * demandait « risque élevé », et une campagne construite dessus partirait à tout le monde. Chaîne vide = « tous ».
 */
function risqueFiltre(v: unknown): NiveauRisque | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const estNiveau = (x: unknown): x is NiveauRisque => typeof x === 'string' && (NIVEAUX_RISQUE as readonly string[]).includes(x);
  if (estNiveau(v)) return v;
  throw new FiltreContactInvalide(`filtre de risque invalide : ${NIVEAUX_RISQUE.join(', ')}, ou rien`);
}

/** Assemble le `ContactFilters` final : seules les clés réellement renseignées y figurent. */
export function buildContactFilters(e: EntreesFiltres): ContactFilters {
  const optIn = texteFiltre(e.optIn);
  const tags = tagsFiltre(e.tags);
  const tagsExclude = tagsFiltre(e.tagsExclude);
  const risque = risqueFiltre(e.risque);
  return {
    ...(tags.length > 0 ? { tags } : {}),
    ...(e.tagMode === 'or' ? { tagMode: 'or' as const } : {}),
    ...(tagsExclude.length > 0 ? { tagsExclude } : {}),
    ...(optIn === 'opted_in' || optIn === 'opted_out' || optIn === 'unknown' ? { optIn } : {}),
    ...(texteFiltre(e.phonePrefix) ? { phonePrefix: texteFiltre(e.phonePrefix) } : {}),
    ...(texteFiltre(e.phoneContains) ? { phoneContains: texteFiltre(e.phoneContains) } : {}),
    ...(texteFiltre(e.nameSearch) ? { nameSearch: texteFiltre(e.nameSearch) } : {}),
    // Une seule valeur reconnue, le reste est jeté : une donnée à moitié comprise viserait la mauvaise population.
    // Seul le niveau de risque refuse au lieu de jeter (cf. `risqueFiltre`).
    ...(e.joignabilite === 'connu_injoignable' ? { joignabiliteWhatsApp: 'connu_injoignable' as const } : {}),
    ...(risque !== undefined ? { risque } : {}),
    ...(e.fieldFilters.length > 0 ? { fieldFilters: e.fieldFilters } : {}),
  };
}
