import { describe, it, expect } from 'vitest';
import { ETAPES, progression } from './bien-demarrer';

const tout = () => true;
const RIEN = { numero: false, outil: false, scenarioOuCampagne: false, agent: false, bulle: false };

describe('« Bien démarrer » (plan 2026-11-24-guide-demarrage)', () => {
  it('l’ordre de Julien : numéro, outil, scénario ou campagne, agent IA, bulle', () => {
    expect(ETAPES.map((e) => e.cle)).toEqual(['numero', 'outil', 'scenarioOuCampagne', 'agent', 'bulle']);
  });

  it('coche d’après l’état, compte et désigne la prochaine étape', () => {
    const p = progression({ ...RIEN, numero: true, agent: true }, tout);
    expect(p.etapes.map((e) => e.faite)).toEqual([true, false, false, true, false]);
    expect(p).toMatchObject({ faites: 2, total: 5, prochaine: 'outil', complete: false });
  });

  it('🔴 un état inconnu (route absente, panne) ne coche rien, sans erreur', () => {
    expect(progression(null, tout)).toMatchObject({ faites: 0, prochaine: 'numero', complete: false });
  });

  it('tout fait : complète, sans prochaine étape', () => {
    const p = progression({ numero: true, outil: true, scenarioOuCampagne: true, agent: true, bulle: true }, tout);
    expect(p).toMatchObject({ faites: 5, prochaine: null, complete: true });
  });

  it('🔴 une offre sans scénarios ne propose que la campagne', () => {
    const p = progression(RIEN, (f) => f !== 'scenarios');
    expect(p.etapes.find((e) => e.cle === 'scenarioOuCampagne')!.gestes.map((g) => g.cle)).toEqual(['campagne']);
    expect(progression(RIEN, tout).etapes.find((e) => e.cle === 'scenarioOuCampagne')!.gestes.map((g) => g.cle)).toEqual(['scenario', 'campagne']);
  });
});
