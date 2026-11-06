import type { GrilleMeta } from '../credit-whatsapp/grille';
import { marcheDuPays } from '../credit-whatsapp/marches-meta';

/**
 * LE PRIX D'UN MESSAGE CHEZ META, TEL QUE CLAUDE LE DIT (plan `docs/superpowers/plans/2026-11-06-prix-et-categories-modeles.md`).
 *
 * Vécu par Johan, bêta-testeur : « c'est quoi le tarif Meta pour chaque message welcome envoyé ? », et Claude ne savait
 * pas. Le plugin interdisait tout chiffre, faute de source : un prix écrit dans une skill serait faux au trimestre suivant
 * (Meta change sa grille au 1er d'un trimestre). La source existe pourtant : la grille de Meta en euros que `/ops` charge
 * pour le Crédit WhatsApp (`grilles_meta`). Claude la lit ici, au moment de répondre.
 *
 * 🔴 Ce sont les tarifs de BASE de META, sans aucune commission de notre part et avant tout palier de volume : ce que Meta
 * facture sur la carte du compte Meta Business. Le prix du Crédit WhatsApp (commission comprise) se calcule ailleurs
 * (`prixMessage`, `src/credit-whatsapp/grille.ts`), jamais ici.
 * 🔴 Le marché est la France, nommée : nos clients écrivent surtout à des numéros français, et Meta facture selon le pays
 * du DESTINATAIRE. Sans tarif français dans la grille, rien n'est rendu : jamais le tarif d'un autre marché (« Other »,
 * celui de `prixMessage`) sous le nom de la France.
 */

/** Les catégories dont Claude dit le prix : celles d'un modèle, et la réponse dans la fenêtre de 24 heures (`service`). */
export const CATEGORIES_PRIX = ['marketing', 'utility', 'authentication', 'service'] as const;
export type CategoriePrix = (typeof CATEGORIES_PRIX)[number];

export interface PrixMeta {
  marche: 'France';
  /** La date d'entrée en vigueur de la grille lue ('AAAA-MM-JJ'). */
  grille_du: string;
  devise: 'EUR';
  hors_taxes: true;
  /** Le tarif de base de Meta par message LIVRÉ, en euros, pour chaque catégorie que la grille porte. */
  par_message_livre: Partial<Record<CategoriePrix, number>>;
}

/** Des micro-euros en euros, à quatre décimales (la précision de la grille de Meta). */
const euros = (micro: number): number => Math.round(micro / 100) / 10_000;

/** Les tarifs de base de Meta pour la France, ou `null` sans grille ou sans aucun tarif français. */
export function prixMetaFrance(grille: GrilleMeta | null): PrixMeta | null {
  if (grille === null) return null;
  const marche = marcheDuPays('FR');
  const par_message_livre: Partial<Record<CategoriePrix, number>> = {};
  for (const categorie of CATEGORIES_PRIX) {
    const t = grille.tarifs.find((x) => x.marche === marche && x.categorie === categorie && x.palier === 0);
    if (t) par_message_livre[categorie] = euros(t.prixMicroEur);
  }
  if (Object.keys(par_message_livre).length === 0) return null;
  return { marche: 'France', grille_du: grille.enVigueurLe, devise: 'EUR', hors_taxes: true, par_message_livre };
}

/** La catégorie d'un modèle, telle que Meta l'écrit (`UTILITY`), ramenée à une catégorie de prix ; `null` sinon. */
export function categorieDePrix(categorie: string | null | undefined): CategoriePrix | null {
  const c = typeof categorie === 'string' ? categorie.trim().toLowerCase() : '';
  return (CATEGORIES_PRIX as readonly string[]).includes(c) ? (c as CategoriePrix) : null;
}
