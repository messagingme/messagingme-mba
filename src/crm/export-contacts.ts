import { z } from 'zod';
import { waIdOf } from './identity';
import type { LigneAExporter } from './contact-store.pg';
import { CLES_BASE_DANS_LES_CHAMPS, COLONNES_BASE_EXPORT } from '../../web/lib/partage/export-contacts';

/**
 * L'export CSV d'une sélection du mini-CRM, côté serveur : la lecture du corps et la valeur de chaque colonne. Les colonnes
 * PERMISES viennent de `colonnesExportables` (`web/lib/partage/export-contacts.ts`), que la route applique.
 */

/** Le corps, hors cible (lue par `parseBulkTarget`, comme pour toute action en masse). */
export const corpsExport = z.object({
  colonnes: z.array(z.string().trim().min(1).max(64)).min(1).max(500),
});

const CLES_BASE: ReadonlySet<string> = new Set(COLONNES_BASE_EXPORT.map((c) => c.cle));

/** Les clés à lire dans `contacts.fields` : les champs perso cochés, et `prenom`, `nom_de_famille`, `email`. */
export function clesDesChamps(colonnes: readonly string[]): string[] {
  return colonnes.filter((c) => !CLES_BASE.has(c) || CLES_BASE_DANS_LES_CHAMPS.includes(c));
}

/** La valeur d'une colonne pour une fiche, en texte ; `null` = vide. Un champ non texte (nombre, booléen, json) en JSON. */
export function valeurExportee(ligne: LigneAExporter, cle: string): string | null {
  switch (cle) {
    case 'name': return ligne.profileName;
    case 'phone': return ligne.phoneE164;
    case 'bsuid': return ligne.bsuid;
    case 'wa_id': return waIdOf(ligne.phoneE164, ligne.bsuid);
    case 'opt_in': return ligne.optInStatus;
    case 'external_id': return ligne.externalId;
    case 'created_at': return ligne.createdAt;
    default: {
      const v = ligne.champs[cle];
      if (v === undefined || v === null) return null;
      return typeof v === 'string' ? v : JSON.stringify(v);
    }
  }
}
