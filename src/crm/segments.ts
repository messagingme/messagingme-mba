import { getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString } from 'libphonenumber-js';
import metadonnees from 'libphonenumber-js/min/metadata';
import { CLES_SEGMENT, plagePosee, type CleSegment, type Plage, type PlageSurJours } from '../../web/lib/partage/segments';

/**
 * LES CRITÈRES DE SEGMENT EN SQL (spec docs/superpowers/specs/2026-10-31-segments-commandes-pays-activite-design.md) :
 * commandes Shopify, dépense, dernière commande, activité, pays. Ils arrivent dans `fieldFilters` (clé réservée,
 * opérateur `segment`, valeur JSON : `web/lib/partage/segments.ts` dit pourquoi), validés par `lireSegment`
 * (`src/crm/contact-filters.ts`) ; ce module ne fait que les traduire, pour `buildContactWhere`.
 *
 * 🔴 CHAQUE SOUS-REQUÊTE NOMME `o.tenant_id = $1` : le rôle de l'application contourne la RLS, ce filtre est le seul
 * contrôle d'isolation. Les sous-requêtes sont non corrélées (`id in (...)`), donc indifférentes à l'alias de la requête
 * qui les reçoit.
 */

/**
 * Depuis quand l'activité est complète : le déploiement de la colonne `derniere_activite_le` (migration 0273). Avant, la
 * migration n'a pu lire que les messages encore conservés par l'espace et les clics : un « inactif depuis 180 jours » lu
 * avant cette date n'est pas une certitude, et l'outil le dit.
 */
export const ACTIVITE_COMPLETE_DEPUIS = '2026-11-03';

/**
 * Ce qu'un espace permet de cibler en commandes : sa boutique (branchée ou coupée), sa devise, la date depuis laquelle
 * TOUTES ses commandes payées sont suivies, et sa coupure. `null` sans boutique : un critère de commande y est refusé.
 */
export interface SuiviSegments {
  boutique: { devise: string | null; commandesDepuis: Date; coupeeLe: Date | null } | null;
}

/** Un code pays connu (ISO alpha-2, capitales) : seul ce qui a un indicatif se cible. */
export function paysConnu(code: string): boolean {
  return /^[A-Z]{2}$/.test(code) && isSupportedCountry(code);
}

type CodePays = Parameters<typeof getCountryCallingCode>[0];

/**
 * Le pays principal de l'indicatif d'un pays (US pour +1, GB pour +44, RU pour +7), ou `null` pour un code inconnu. 🔴 Un
 * indicatif partagé ne se cible que par son pays principal, qui les vise TOUS : cibler PR viserait aussi les États-Unis
 * et le Canada, qu'on n'a pas demandés. `lireSegment` refuse donc un pays qui n'est pas le principal, en nommant celui-ci.
 */
export function paysPrincipalDe(code: string): string | null {
  if (!paysConnu(code)) return null;
  // La table des indicatifs de la bibliothèque met le pays principal en tête de chaque indicatif.
  return metadonnees.country_calling_codes[getCountryCallingCode(code as CodePays)]?.[0] ?? code;
}

/** Les indicatifs des pays, dédupliqués : le pays principal d'un indicatif partagé (+1, +7, +44) les vise tous. */
export function prefixesDesPays(pays: readonly string[]): string[] {
  return [...new Set(pays.filter(paysConnu).map((p) => `+${getCountryCallingCode(p as CodePays)}`))];
}

/** Le pays d'un numéro E.164, lu sur son numéro (un +1 du Canada rend CA) ; `null` s'il ne se lit pas. */
export function paysDuNumero(e164: string | null): string | null {
  if (!e164) return null;
  return parsePhoneNumberFromString(e164)?.country ?? null;
}

const ilYA = (jours: string): string => `now() - ${jours}::int * interval '1 day'`;

/**
 * Le nombre ou la somme des commandes d'une plage. 🔴 Un minimum qui exige au moins une commande passe par `id in`, un
 * maximum seul par `id not in` (un contact sans aucune commande a 0 commande et 0 de dépense : il doit être rendu).
 * `contact_id` n'est jamais nul dans `shopify_commandes`, donc le `not in` ne bute pas sur un nul.
 */
function clausePlageCommandes(mesure: string, p: PlageSurJours, add: (v: unknown) => string, deviseSeule: boolean, type: string): string {
  const periode = p.jours !== undefined ? ` and o.payee_le >= ${ilYA(add(p.jours))}` : '';
  // La dépense ne somme que la devise de la boutique actuelle (une boutique remplacée peut en avoir eu une autre).
  const devise = deviseSeule
    ? ' and o.devise = coalesce((select b.devise from shopify_boutiques b where b.tenant_id = $1), o.devise)'
    : '';
  const de = `select o.contact_id from shopify_commandes o where o.tenant_id = $1${periode}${devise} group by o.contact_id`;
  if ((p.min ?? 0) > 0) {
    const min = `${mesure} >= ${add(p.min)}::${type}`;
    const max = p.max !== undefined ? ` and ${mesure} <= ${add(p.max)}::${type}` : '';
    return `id in (${de} having ${min}${max})`;
  }
  // « Au moins 0 » sans maximum ne restreint rien ; la validation le refuse. S'il arrive quand même : personne, jamais
  // l'espace entier (la règle de `clauseSegment`).
  if (p.max === undefined) return 'false';
  return `id not in (${de} having ${mesure} > ${add(p.max)}::${type})`;
}

/** Les jours depuis la dernière commande : exige une commande connue. */
function clauseDerniereCommande(p: Plage, add: (v: unknown) => string): string {
  const bornes = [
    ...(p.min !== undefined ? [`max(o.payee_le) <= ${ilYA(add(p.min))}`] : []),
    ...(p.max !== undefined ? [`max(o.payee_le) >= ${ilYA(add(p.max))}`] : []),
  ];
  return `id in (select o.contact_id from shopify_commandes o where o.tenant_id = $1 group by o.contact_id having ${bornes.join(' and ')})`;
}

/**
 * La clause d'un critère de segment, à joindre par `and` au `WHERE` de `buildContactWhere`. La valeur a été validée par
 * `lireSegment` ; 🔴 une valeur qui ne se lit pas ou qui ne pose rien vise PERSONNE (`false`), jamais l'espace entier.
 */
export function clauseSegment(cle: CleSegment, valeur: string, add: (v: unknown) => string): string {
  let v: unknown;
  try { v = JSON.parse(valeur) as unknown; } catch { return 'false'; }
  const plage = (x: unknown): PlageSurJours | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? x as PlageSurJours : null);
  const jours = (x: unknown): number | null => (typeof x === 'number' && Number.isInteger(x) && x > 0 ? x : null);
  switch (cle) {
    case CLES_SEGMENT.commandes: {
      const p = plage(v);
      return p && plagePosee(p) ? clausePlageCommandes('count(*)', p, add, false, 'int') : 'false';
    }
    case CLES_SEGMENT.depense: {
      const p = plage(v);
      return p && plagePosee(p) ? clausePlageCommandes('coalesce(sum(o.montant), 0)', p, add, true, 'numeric') : 'false';
    }
    case CLES_SEGMENT.derniereCommande: {
      const p = plage(v);
      return p && plagePosee(p) ? clauseDerniereCommande(p, add) : 'false';
    }
    case CLES_SEGMENT.actif: {
      const n = jours(v);
      return n === null ? 'false' : `derniere_activite_le >= ${ilYA(add(n))}`;
    }
    case CLES_SEGMENT.inactif: {
      // Jamais actif = inactif : une fiche importée qui n'a jamais rien fait est bien dans « inactif depuis 90 jours ».
      const n = jours(v);
      return n === null ? 'false' : `(derniere_activite_le is null or derniere_activite_le < ${ilYA(add(n))})`;
    }
    case CLES_SEGMENT.pays: {
      // Préfixe ancré, comme « Téléphone commence par » (index `text_pattern_ops`). Un `or` de `like`, jamais
      // `like any` : l'index ne sert pas un tableau. Aucun indicatif connu : personne.
      const prefixes = Array.isArray(v) ? prefixesDesPays(v.filter((x): x is string => typeof x === 'string')) : [];
      return prefixes.length === 0 ? 'false' : `(${prefixes.map((p) => `phone_e164 like ${add(`${p}%`)}`).join(' or ')})`;
    }
  }
}
