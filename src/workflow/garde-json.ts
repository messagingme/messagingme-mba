import { jsonDeChamp } from '../crm/fields';
import type { UserFieldType } from '../crm/types';
import type { EcrituresDeFiche } from '../hubspot-workflow/remontee';

/**
 * 🔴 UN CHAMP `json` NE PORTE QU'UN JSON VALIDE (spec du 2026-11-11). Les écritures de fiche d'un parcours (blocs Appel
 * API, Fonction JS, Action, Question, rangement d'un formulaire) passent toutes par ici : une valeur vers un champ
 * `json` y prend sa forme compacte, et une valeur qui n'est pas un JSON valide de 16 Ko au plus VIDE le champ, comme un
 * échec. Le bloc d'extraction relit donc toujours du JSON, et « le champ est vide » reste le test d'un échec.
 *
 * Un point unique plutôt qu'une garde par bloc : la console ne propose un champ `json` qu'au bloc Appel API et à la
 * Fonction JS, mais un graphe écrit par l'API ou le MCP peut viser n'importe quel champ. Une valeur vide passe sans
 * lecture du type (vider est toujours permis), le reste coûte une lecture du référentiel des champs.
 */
export function avecGardeJson(
  fiche: EcrituresDeFiche,
  typeDuChamp: (tenantId: string, cle: string) => Promise<UserFieldType | null>,
): EcrituresDeFiche {
  return {
    setField: async (tenantId, waId, key, value) => {
      if (value === '' || (await typeDuChamp(tenantId, key)) !== 'json') return fiche.setField(tenantId, waId, key, value);
      return fiche.setField(tenantId, waId, key, jsonDeChamp(value.trim()) ?? '');
    },
    clearField: (tenantId, waId, key) => fiche.clearField(tenantId, waId, key),
  };
}
