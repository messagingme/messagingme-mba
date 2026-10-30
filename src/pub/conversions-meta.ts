import { createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * LES CONVERSIONS DE NOS PUBLICITÉS, ENVOYÉES À META PAR LA CONVERSIONS API (lot 2 du plan
 * docs/superpowers/plans/2026-10-30-pixel-meta.md, spec docs/superpowers/specs/2026-10-30-pixel-meta-design.md).
 *
 * Trois faits, chacun une fois : la création d'une identité NEUVE (`CompleteRegistration`), le premier numéro vérifié
 * d'un espace (`NumeroConnecte`, la graine des look-alike) et le premier paiement du Pro (`Subscribe`). Un fait est
 * RÉSERVÉ dans le journal `conversions_meta` (migration 0265), dont la clé unique est le dédoublonnage et l'`event_id`
 * envoyé à Meta, puis un job de la file `conversions-meta` l'envoie. Ce fichier ne fait aucun appel : il dit quoi
 * envoyer, et à quelle condition.
 *
 * 🔴 AUCUN ÉVÉNEMENT SANS ACCORD. L'accord se relit AU MOMENT D'ENVOYER (`consentementCouvre`), jamais à la
 * réservation : un retrait entre les deux est respecté. Et un fait antérieur à l'accord ne part jamais (pas de
 * rattrapage) : `cree_le`, l'heure du fait, doit suivre l'accord.
 */

export const FILE_CONVERSIONS_META = 'conversions-meta';

export const EVENEMENTS_META = ['CompleteRegistration', 'NumeroConnecte', 'Subscribe'] as const;
export type EvenementMeta = (typeof EVENEMENTS_META)[number];

/** Le job de la file : une conversion du journal, pour UNE tentative (voir `PgConversionsMetaStore.prendre`). */
export const jobConversionSchema = z.object({
  conversionId: z.uuid(),
  tentative: z.number().int().min(0),
});
export type JobConversion = z.infer<typeof jobConversionSchema>;

/**
 * Un fait à réserver. La personne d'une inscription se désigne par son adresse (la route la connaît, pas toujours son
 * identifiant) ; celle d'un fait d'espace est l'admin le plus ancien de l'espace, résolu à la réservation.
 */
export type Fait =
  | { evenement: 'CompleteRegistration'; adresse: string; ip?: string; navigateur?: string }
  | { evenement: 'NumeroConnecte'; tenantId: string }
  | { evenement: 'Subscribe'; tenantId: string; valeurCentimes: number; devise: string };

/** Une conversion relue pour l'envoyer, avec ce qu'il faut savoir de la personne À CET INSTANT. */
export interface ConversionAEnvoyer {
  id: string;
  cle: string;
  evenement: EvenementMeta;
  statut: 'a_envoyer' | 'envoye' | 'echec' | 'ignore';
  tentatives: number;
  /** L'heure du fait. */
  creeLe: Date;
  identityId: string;
  email: string;
  adresseProuvee: boolean;
  consentiLe: Date | null;
  fbc: string | null;
  fbp: string | null;
  /** Le navigateur de la personne au moment de son accord (`identities.pub_navigateur`). */
  navigateurAccord: string | null;
  valeurCentimes: number | null;
  devise: string | null;
  ip: string | null;
  navigateur: string | null;
}

/** Meta refuse un événement de plus de sept jours : on renonce un peu avant, l'horloge de Meta n'est pas la nôtre. */
export const AGE_MAX_MS = 7 * 24 * 3600_000 - 3600_000;

/** L'accord couvre-t-il ce fait ? Présent, et donné au plus tard au moment du fait (pas de rattrapage). */
export function consentementCouvre(c: Pick<ConversionAEnvoyer, 'consentiLe' | 'creeLe'>): boolean {
  return c.consentiLe !== null && c.consentiLe.getTime() <= c.creeLe.getTime();
}

export const empreinte = (texte: string): string => createHash('sha256').update(texte).digest('hex');

/** L'adresse telle que Meta la hache : sans espaces autour, en minuscules. */
export const adresseNormalisee = (adresse: string): string => adresse.trim().toLowerCase();

/** L'événement tel que la Conversions API l'attend dans `data`. */
export interface EvenementGraph {
  event_name: EvenementMeta;
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url: string;
  user_data: {
    external_id: string[];
    em?: string[];
    fbc?: string;
    fbp?: string;
    client_ip_address?: string;
    client_user_agent?: string;
  };
  custom_data?: { value: number; currency: string };
}

/** La page de la console où chaque fait se produit : ce que Meta rattache au domaine vérifié. */
const PAGES: Record<EvenementMeta, string> = {
  CompleteRegistration: '/signup',
  NumeroConnecte: '/',
  Subscribe: '/parametres/offre',
};

/**
 * Construit l'événement. 🔴 L'empreinte de l'adresse ne part que pour une adresse PROUVÉE (Google) : une inscription
 * par e-mail peut porter l'adresse d'un tiers. L'IP ne part que pour l'inscription, la seule requête où elle est celle
 * de la personne. Le navigateur, que Meta exige pour un événement de site web, est celui de la requête d'inscription,
 * sinon celui de la personne au moment de son accord.
 */
export function construireEvenement(c: ConversionAEnvoyer, opts: { urlConsole: string }): EvenementGraph {
  const user_data: EvenementGraph['user_data'] = { external_id: [empreinte(c.identityId)] };
  if (c.adresseProuvee) user_data.em = [empreinte(adresseNormalisee(c.email))];
  if (c.fbc) user_data.fbc = c.fbc;
  if (c.fbp) user_data.fbp = c.fbp;
  const inscription = c.evenement === 'CompleteRegistration';
  if (inscription && c.ip) user_data.client_ip_address = c.ip;
  const navigateur = (inscription ? c.navigateur : null) ?? c.navigateurAccord;
  if (navigateur) user_data.client_user_agent = navigateur;
  const evenement: EvenementGraph = {
    event_name: c.evenement,
    event_time: Math.floor(c.creeLe.getTime() / 1000),
    event_id: c.cle,
    action_source: 'website',
    event_source_url: `${opts.urlConsole.replace(/\/+$/, '')}${PAGES[c.evenement]}`,
    user_data,
  };
  if (c.evenement === 'Subscribe' && c.valeurCentimes !== null && c.devise !== null) {
    evenement.custom_data = { value: c.valeurCentimes / 100, currency: c.devise };
  }
  return evenement;
}
