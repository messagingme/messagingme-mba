import { SYSTEM_FIELD_LABELS } from './champs';

/**
 * L'EXPORT CSV D'UNE SÉLECTION DE CONTACTS (action en masse du mini-CRM, demande de Julien du 2026-11-24). Module pur
 * partagé : la console en tire une case par colonne, le serveur refuse toute colonne qui n'en sort pas.
 *
 * 🔴 CE QUI N'EST PAS EXPORTABLE, POUR L'INSTANT : les étiquettes, les données des intégrations (les champs HubSpot,
 * clés en `hs_`, et Shopify, clés en `shopify_`), l'analyse des conversations et le risque. L'export porte les données
 * de base et les champs personnalisés, rien d'autre. Chaque colonne se coche une à une : rien ne part par défaut.
 */

export interface ColonneExport {
  cle: string;
  /** [français, anglais]. */
  libelle: readonly [string, string];
}

/** Les données de base, dans l'ordre du fichier. `prenom`, `nom_de_famille` et `email` vivent dans les champs de la fiche. */
export const COLONNES_BASE_EXPORT: readonly ColonneExport[] = [
  { cle: 'name', libelle: SYSTEM_FIELD_LABELS.name },
  { cle: 'prenom', libelle: SYSTEM_FIELD_LABELS.prenom },
  { cle: 'nom_de_famille', libelle: SYSTEM_FIELD_LABELS.nom_de_famille },
  { cle: 'phone', libelle: SYSTEM_FIELD_LABELS.phone },
  { cle: 'bsuid', libelle: SYSTEM_FIELD_LABELS.bsuid },
  { cle: 'wa_id', libelle: SYSTEM_FIELD_LABELS.wa_id },
  { cle: 'email', libelle: SYSTEM_FIELD_LABELS.email },
  { cle: 'opt_in', libelle: ['Opt-in', 'Opt-in'] },
  { cle: 'external_id', libelle: ['Identifiant externe', 'External ID'] },
  { cle: 'created_at', libelle: ['Date de création', 'Created at'] },
];

/** Les colonnes de base que le serveur lit dans `contacts.fields`, et non dans une colonne de la table. */
export const CLES_BASE_DANS_LES_CHAMPS: readonly string[] = ['prenom', 'nom_de_famille', 'email'];

/** Au-delà, l'export est refusé : la réponse se construit en mémoire. On affine alors la sélection par les filtres. */
export const EXPORT_CONTACTS_MAX = 50_000;

/**
 * Un champ écrit par une intégration : HubSpot (`hs_contact_`, `hs_deal_`, `hs_calc_`, `src/hubspot-workflow/champs.ts`)
 * ou Shopify (`shopify_lien_suivi`, `src/shopify/traitement.ts`). Par préfixe : un champ que l'une d'elles ajoutera
 * demain reste dehors sans qu'on y pense.
 */
export function estChampIntegration(cle: string): boolean {
  return cle.startsWith('hs_') || cle.startsWith('shopify_');
}

/** Les colonnes proposées pour un espace : la base, puis ses champs personnalisés hors intégrations. */
export function colonnesExportables(champs: ReadonlyArray<{ key: string; label: string }>): ColonneExport[] {
  const base = new Set(COLONNES_BASE_EXPORT.map((c) => c.cle));
  const perso = champs
    .filter((c) => !base.has(c.key) && !estChampIntegration(c.key))
    .map((c): ColonneExport => ({ cle: c.key, libelle: [c.label, c.label] }));
  return [...COLONNES_BASE_EXPORT, ...perso];
}
