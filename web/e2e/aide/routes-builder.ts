/**
 * LES LECTURES DU BUILDER, pour un banc e2e qui ouvre un scénario hors de la page des scénarios (déplié sous les
 * automations Shopify et HubSpot, 2026-11-20). Un `{}` générique ferait planter le builder, qui attend des listes :
 * chaque lecture rend sa liste vide. `undefined` : ce chemin n'est pas une lecture du builder.
 */
export function reponseDuBuilder(chemin: string): unknown {
  if (/\/workflows\/[^/]+\/modeles$/.test(chemin)) return { modeles: [], programmee: null };
  if (/\/nodes$/.test(chemin)) return { nodes: [] };
  if (chemin.includes('/param-hints')) return { hints: [] };
  if (chemin.includes('/email/accounts')) return { accounts: [] };
  if (chemin.includes('/email/templates')) return { templates: [] };
  if (chemin.endsWith('/templates')) return { templates: [] };
  if (chemin.includes('/flows')) return { flows: [] };
  if (chemin.endsWith('/tags')) return { tags: [] };
  if (chemin.includes('/user-fields/usage')) return { total: 0, parChamp: {} };
  if (chemin.endsWith('/user-fields')) return { fields: [] };
  if (chemin.endsWith('/users')) return { users: [] };
  if (chemin.endsWith('/agent-requetes')) return { requetes: [] };
  if (chemin.endsWith('/agent-sources')) return { sources: [] };
  return undefined;
}
