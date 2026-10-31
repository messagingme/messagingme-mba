import type { Offre } from '../offres/offres';
import type { AchatPermis } from '../stripe/achat-whatsapp';
import type { ConditionsCredit } from './garde';
import type { LigneCredit } from './lignes.pg';

/**
 * QUI PEUT ACHETER DU CRÉDIT WHATSAPP (plan du Crédit WhatsApp, « choix de Claude à relire ») : jamais la formule Free,
 * jamais une Entreprise en open bar (elle paie après coup), et seulement un espace qui a au moins un numéro ACTIF sur la
 * ligne (sans ligne, le crédit ne servirait à rien ; une ligne arrêtée ne laisse rien partir). La route de l'onglet et
 * l'outil `buy_credit` lisent la même règle.
 */
export interface DepsAchatPermis {
  offre(tenantId: string): Promise<Offre>;
  conditions(tenantId: string): Promise<ConditionsCredit>;
  lignes(tenantId: string): Promise<readonly LigneCredit[]>;
}

export async function achatPermis(d: DepsAchatPermis, tenantId: string): Promise<AchatPermis> {
  if ((await d.offre(tenantId)) === 'base') return 'free';
  if ((await d.conditions(tenantId)).openBar) return 'open_bar';
  return (await d.lignes(tenantId)).some((l) => l.arreteeLe === null) ? 'ok' : 'sans_ligne';
}

/**
 * L'onglet Crédit WhatsApp de la page Offre s'affiche-t-il ? Mêmes portes que l'achat, mais une ligne ARRÊTÉE suffit :
 * l'espace doit encore voir son solde et son historique (et pourquoi plus rien ne part).
 */
export async function ongletCreditWhatsapp(d: DepsAchatPermis, tenantId: string): Promise<boolean> {
  if ((await d.offre(tenantId)) === 'base') return false;
  if ((await d.conditions(tenantId)).openBar) return false;
  return (await d.lignes(tenantId)).length > 0;
}
