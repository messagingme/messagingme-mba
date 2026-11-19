import { describe, it, expect } from 'vitest';
import { bancDuFil } from './banc-du-fil';

/**
 * 🔴 LE CLIC QU'UN PARCOURS D'ÉVÉNEMENT REND (décision 34 de Julien, 2026-11-19). Le parcours « Commande payée » attend, et
 * le client clique une réponse rapide d'un AUTRE message (« Commande expédiée », parti sans parcours, ou le premier message
 * d'un événement frère). Le clic n'est pas pour le parcours, qui le rend. Un robot qui COEXISTE avec un parcours d'événement
 * (agent IA, scénario répondeur, application) lui répond, et le parcours continue d'attendre ; l'agent de Meta et l'équipe
 * ne coexistent pas (jamais deux maîtres du fil, le défaut MUTAC) : le fil ne leur va qu'une fois le parcours arrêté, ce que
 * fait l'exécuteur. Tout tourne sur le VRAI contrôle du fil, sur un faux Meta qui note chaque geste.
 */

const T = 't1';
const W = '33611223344';
const CLIC = 'wamid.clic';
/** Le fil est aux robots, et un parcours d'événement le tient. */
const tenu = { conversations: { [W]: { owner: 'app_workflow' as const } }, enAttente: true };

describe('le clic qu’un parcours d’événement rend (décision 34)', () => {
  it('🔴 sans la marque, un parcours qui tient le fil garde le message : aucun robot ne part (la règle unique d’avant)', async () => {
    const b = bancDuFil({ ...tenu, mode: 'agent', repondeurAgentId: 'ag-1' });
    await b.fil.remettreSiPersonneNeSuit(T, W, '', { rouverte: false, messageDeclencheur: CLIC });
    expect([b.demarrages, b.appels]).toEqual([[], []]);
  });

  it('🔴 agent IA : le clic lui est confié, sans un appel à Meta', async () => {
    const b = bancDuFil({ ...tenu, mode: 'agent', repondeurAgentId: 'ag-1' });
    expect(await b.fil.remettreLeClicHorsParcours(T, W, CLIC)).toBe('confie');
    expect(b.demarrages).toEqual([{ waId: W, agentId: 'ag-1', messageDeclencheur: CLIC }]);
    expect(b.appels).toEqual([]);
  });

  it('🔴 scénario répondeur : réclamé puis lancé sur le clic', async () => {
    const b = bancDuFil({ ...tenu, mode: 'scenario', repondeurWorkflowId: 'wf-rep' });
    expect(await b.fil.remettreLeClicHorsParcours(T, W, CLIC)).toBe('confie');
    expect(b.lancementsScenario).toEqual([{ waId: W, workflowId: 'wf-rep', messageDeclencheur: CLIC }]);
    expect(b.appels).toEqual([]);
  });

  it('application : la demande part à l’application, qui répond sans prendre le fil', async () => {
    const b = bancDuFil({ ...tenu, mode: 'application', repondeurAdresseId: 'ad-1' });
    expect(await b.fil.remettreLeClicHorsParcours(T, W, CLIC)).toBe('confie');
    expect(b.demandesApplication).toMatchObject([{ waId: W, adresseId: 'ad-1', messageDeclencheur: CLIC }]);
  });

  it('🔴 agent de Meta ou équipe : ils ne coexistent pas avec le parcours, rien n’est fait ici (l’exécuteur l’arrête d’abord)', async () => {
    for (const o of [{ mode: 'mba' as const }, { mode: 'equipe' as const, mbaEnabled: false }]) {
      const b = bancDuFil({ ...tenu, ...o });
      expect(await b.fil.remettreLeClicHorsParcours(T, W, CLIC), o.mode).toBe('ne_coexiste_pas');
      expect([b.appels, b.ecritures, b.demarrages], o.mode).toEqual([[], [], []]);
    }
  });

  it('🔴 une campagne qui désigne l’agent de Meta pour sa première réponse : ne coexiste pas, même en mode agent IA', async () => {
    const b = bancDuFil({ ...tenu, mode: 'agent', repondeurAgentId: 'ag-1', campagne: { nom: 'Promo', cible: 'mba' } });
    expect(await b.fil.remettreLeClicHorsParcours(T, W, CLIC)).toBe('ne_coexiste_pas');
    expect([b.appels, b.demarrages]).toEqual([[], []]);
  });

  it('🔴 la marque seule n’ouvre jamais le fil à une voie qui ne coexiste pas (la ceinture de la remise, si la voie change entre deux lectures)', async () => {
    for (const o of [{ mode: 'agent' as const, repondeurAgentId: 'ag-1', campagne: { nom: 'Promo', cible: 'mba' as const } }, { mode: 'mba' as const }]) {
      const b = bancDuFil({ ...tenu, ...o });
      await b.fil.remettreSiPersonneNeSuit(T, W, '', { rouverte: false, messageDeclencheur: CLIC, horsDuParcoursDEvenement: true });
      expect([b.appels, b.ecritures, b.demarrages], o.mode).toEqual([[], [], []]);
    }
  });
});
