/**
 * LE RAYON D'UN SCÉNARIO ET D'UNE AUTOMATION (menu « Scénario », spec
 * `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md` § 5.3).
 *
 * `general` : le Builder et les automations « Autres ». `shopify` et `hubspot` : les scénarios que lance un événement de
 * la boutique ou de HubSpot, construits sous Automation > Shopify ou HubSpot. 🔴 CLOISONNÉS DANS LES DEUX SENS : un
 * chemin qui liste, choisit ou lance un scénario ne voit que son rayon, et un scénario d'un autre rayon s'y refuse
 * exactement comme un scénario inconnu (son existence ne fuit pas). Le rayon d'un scénario est fixé à sa création et ne
 * change jamais.
 *
 * Liste FERMÉE, miroir des CHECK `workflows_rayon_chk` et `automations_rayon_chk` (migration 0293, tenue par
 * `tests/migration-0293.test.ts`).
 */
export const RAYONS = ['general', 'shopify', 'hubspot'] as const;
export type Rayon = (typeof RAYONS)[number];

export function estRayon(x: unknown): x is Rayon {
  return typeof x === 'string' && (RAYONS as readonly string[]).includes(x);
}
