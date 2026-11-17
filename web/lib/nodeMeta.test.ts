import { describe, it, expect } from 'vitest';
import { AGENT_SORTIES_RESERVEES, aretesApresChangementDAgent } from './nodeMeta';

describe('aretesApresChangementDAgent', () => {
  const arete = (id: string, source: string, sourceHandle?: string) => ({ id, source, target: 'x', ...(sourceHandle ? { sourceHandle } : {}) });
  const reservees = AGENT_SORTIES_RESERVEES.map((s, i) => arete(`r${i}`, 'a1', s.handle));

  it('🔴 garde les cinq sorties réservées, que le nouvel agent ne déclare pas', () => {
    expect(aretesApresChangementDAgent(reservees, 'a1', []).map((e) => e.sourceHandle))
      .toEqual(AGENT_SORTIES_RESERVEES.map((s) => s.handle));
  });

  it('retire la règle d’arrêt que le nouvel agent ne déclare plus, et garde celle qu’il déclare', () => {
    const aretes = [arete('e1', 'a1', 'sortie:rdv_pris'), arete('e2', 'a1', 'sortie:devis'), arete('e3', 'a1')];
    expect(aretesApresChangementDAgent(aretes, 'a1', ['rdv_pris']).map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  it('ne touche pas aux arêtes des autres blocs', () => {
    const aretes = [arete('e1', 'autre', 'sortie:devis'), arete('e2', 'a1', 'sortie:devis')];
    expect(aretesApresChangementDAgent(aretes, 'a1', []).map((e) => e.id)).toEqual(['e1']);
  });
});
