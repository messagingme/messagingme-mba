import { request } from './http';
import { SOURCES_VENTES, type SourceVente } from './ventes';
import type { AchatsShopifyVue, CommandeShopifyVue, PanierShopifyVue } from './partage/achats-shopify';

/**
 * L'onglet « Shopify » de la fiche contact (plan 2026-11-16) : la réponse de `GET .../contacts/:id/shopify`, lue
 * défensivement. 🔴 `null` pour une réponse illisible : l'écran dit « indisponible », jamais « aucune commande », qui
 * mentirait sur un client qui a commandé. Les montants restent des décimaux en texte, jamais additionnés ici.
 */
type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);
const texte = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const decimal = (v: unknown): string | null => (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? v : null);
const entier = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const liste = <X>(v: unknown, lire: (x: unknown) => X | null): X[] =>
  (Array.isArray(v) ? v : []).map(lire).filter((x): x is X => x !== null);

function lireCommande(v: unknown): CommandeShopifyVue | null {
  if (!estObjet(v) || typeof v.commandeId !== 'string' || typeof v.payeeLe !== 'string') return null;
  const a = v.attribution;
  const attribution = estObjet(a) && (SOURCES_VENTES as readonly unknown[]).includes(a.source)
    ? { source: a.source as SourceVente, campagne: texte(a.campagne), preuve: a.preuve === 'panier' ? 'panier' as const : a.preuve === 'utm' ? 'utm' as const : null }
    : null;
  return { commandeId: v.commandeId, payeeLe: v.payeeLe, montant: decimal(v.montant), devise: texte(v.devise), test: v.test === true, attribution };
}

function lirePanier(v: unknown): PanierShopifyVue | null {
  if (!estObjet(v) || typeof v.ouvertLe !== 'string') return null;
  return { ouvertLe: v.ouvertLe, relanceLe: texte(v.relanceLe), fermeLe: texte(v.fermeLe), issue: texte(v.issue) };
}

export function lireAchatsShopify(brut: unknown): AchatsShopifyVue | null {
  if (!estObjet(brut) || !estObjet(brut.resume)) return null;
  const b = brut.boutique;
  const boutique = estObjet(b) && typeof b.domaine === 'string' && typeof b.commandesDepuis === 'string'
    ? { nom: texte(b.nom), domaine: b.domaine, devise: texte(b.devise), commandesDepuis: b.commandesDepuis, coupeeLe: texte(b.coupeeLe) }
    : null;
  if (b !== null && boutique === null) return null;
  const r = brut.resume;
  return {
    boutique,
    resume: { commandes: entier(r.commandes), commandesTest: entier(r.commandesTest), depense: decimal(r.depense) ?? '0', derniereLe: texte(r.derniereLe) },
    rapporte: liste(brut.rapporte, (x) => {
      if (!estObjet(x) || typeof x.devise !== 'string') return null;
      const montant = decimal(x.montant);
      return montant === null ? null : { devise: x.devise, montant, prouve: decimal(x.prouve) ?? '0', commandes: entier(x.commandes) };
    }),
    commandes: liste(brut.commandes, lireCommande),
    paniers: liste(brut.paniers, lirePanier),
  };
}

export async function getAchatsShopify(tenantId: string, contactId: string): Promise<AchatsShopifyVue | null> {
  return lireAchatsShopify(await request<unknown>(`/tenants/${tenantId}/contacts/${encodeURIComponent(contactId)}/shopify`));
}
