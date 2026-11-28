import { describe, it, expect } from 'vitest';
import { OUTILS } from '../src/mcp/outils';

/**
 * UN CHAMP OMIS N'EST PAS TOUCHÉ, ET CHAQUE OUTIL DE MODIFICATION LE DIT (lot 1 du CSM virtuel, B0d, plan
 * `docs/superpowers/plans/2026-11-24-csm-lot1-b0-contrats.md`).
 *
 * Un agent qui retouche un objet doit savoir si ce qu'il ne renvoie pas est gardé ou effacé : une modification partielle
 * garde ce qu'on omet, un remplacement efface ce qu'on ne renvoie pas. Les deux existent ; chaque outil dit lequel il est,
 * et un outil de modification ajouté demain doit choisir sa famille ici.
 */
const PARTIELS = ['update_agent', 'set_agent_limits', 'update_widget', 'update_webhook_endpoint', 'update_field', 'update_conversation', 'update_inbox_settings', 'update_agent_tool', 'update_knowledge', 'update_connector_system', 'update_connector_call', 'update_mcp_tool'] as const;
const REMPLACEMENTS = ['update_template', 'update_scenario'] as const;
const description = (nom: string): string => OUTILS.find((o) => o.nom === nom)?.description.replace(/\s+/g, ' ') ?? '';

describe('un champ omis, un champ vidé, un objet remplacé : chaque outil de modification le dit (B0d)', () => {
  it('🔴 chaque outil de modification a choisi sa famille', () => {
    const modifications = OUTILS.filter((o) => o.scope === 'mcp:write' && /^(update|set_agent_limits)/.test(o.nom)).map((o) => o.nom).sort();
    expect(modifications).toEqual([...PARTIELS, ...REMPLACEMENTS].sort());
  });

  it('🔴 une modification partielle dit que seuls les champs fournis changent', () => {
    for (const nom of PARTIELS) expect(description(nom), nom).toMatch(/only the (fields|limits) provided change/i);
  });

  it('🔴 un remplacement dit qu’il remplace tout, et ce qu’il faut donc renvoyer', () => {
    for (const nom of REMPLACEMENTS) expect(description(nom), nom).toMatch(/\breplace/i);
  });

  it('un champ vidé : null, là où l’outil le permet, et le schéma l’annonce', () => {
    expect(description('update_widget')).toMatch(/null clears an optional field/);
    const libelle = OUTILS.find((o) => o.nom === 'update_widget')!.entree.properties.libelle;
    expect(libelle?.type).toContain('null');
  });

  it('le champ visé par une écriture de valeur doit exister, et l’outil le dit', () => {
    expect(description('set_contact_field')).toMatch(/must exist/);
  });
});
