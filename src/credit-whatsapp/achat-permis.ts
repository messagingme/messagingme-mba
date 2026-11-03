import type { Offre } from '../offres/offres';
import type { AchatPermis } from '../stripe/achat-whatsapp';
import type { ConditionsCredit } from './garde';
import type { LigneCredit } from './lignes.pg';

/**
 * QUI PEUT ACHETER DU CRÉDIT WHATSAPP (plan du Crédit WhatsApp, « choix de Claude à relire ») : jamais la formule Free,
 * jamais une Entreprise (illimitée, facturée au contrat : décision du 2026-11-02), et seulement un espace qui a au moins
 * un numéro ACTIF sur la ligne (sans ligne, le crédit ne servirait à rien ; une ligne arrêtée ne laisse rien partir). La
 * route de l'onglet et l'outil `buy_credit` lisent la même règle.
 */
export interface DepsAchatPermis {
  offre(tenantId: string): Promise<Offre>;
  conditions(tenantId: string): Promise<ConditionsCredit>;
  lignes(tenantId: string): Promise<readonly LigneCredit[]>;
  /**
   * L'option du Crédit WhatsApp est-elle en vente (Stripe configuré et `STRIPE_PRIX_OPTION_WA` posé, lot 4a) ? Un Pro ou
   * un Business sans ligne voient alors l'onglet, pour la prendre. Poser le prix ouvre la vente à tous.
   */
  optionEnVente: boolean;
}

export async function achatPermis(d: DepsAchatPermis, tenantId: string): Promise<AchatPermis> {
  if ((await d.offre(tenantId)) === 'base') return 'free';
  if ((await d.conditions(tenantId)).openBar) return 'open_bar';
  return (await d.lignes(tenantId)).some((l) => l.arreteeLe === null) ? 'ok' : 'sans_ligne';
}

/**
 * L'onglet Crédit WhatsApp de la page Offre s'affiche-t-il ? Jamais en Free ; sinon dès qu'un numéro de l'espace est sur
 * la ligne, même ARRÊTÉE (l'espace doit encore voir son historique, et pourquoi plus rien ne part). Une Entreprise le voit
 * aussi depuis le 2026-11-02 : « Illimité » et sa consommation du mois, sans rien à acheter (`achatPermis` le refuse).
 */
export async function ongletCreditWhatsapp(d: DepsAchatPermis, tenantId: string): Promise<boolean> {
  const offre = await d.offre(tenantId);
  if (offre === 'base') return false;
  if ((await d.lignes(tenantId)).length > 0) return true;
  // L'option (lot 4a) : un Pro ou un Business la voient dès qu'elle est en vente, pour la prendre ; jamais une Entreprise.
  return d.optionEnVente && (offre === 'pro' || offre === 'business');
}

/**
 * Un numéro de l'espace est-il sur la ligne (hors Free, même arrêtée) ? Ce que l'onglet disait avant l'option : Claude (le
 * MCP) ne parle du Crédit WhatsApp qu'à un espace dont il paie les messages, jamais à un Pro qui voit l'onglet pour prendre
 * l'option (relecture du lot 4a : son solde à zéro y passait pour des envois coupés).
 */
export async function surLaLigne(d: Pick<DepsAchatPermis, 'offre' | 'lignes'>, tenantId: string): Promise<boolean> {
  return (await d.offre(tenantId)) !== 'base' && (await d.lignes(tenantId)).length > 0;
}
