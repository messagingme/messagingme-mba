import { describe, it, expect } from 'vitest';
import { parcoursHubspotEncoreVoulu } from '../src/hubspot/parcours-voulu';
import { origineHubspot, type FamilleHubspot } from '../src/hubspot/origine';
import type { LigneHubspot } from '../src/hubspot/lignes';

/**
 * « LE PARCOURS EST-IL ENCORE VOULU ? » POUR UNE ORIGINE HUBSPOT (menu « Scénario », lot 6b, relecture de 6a) : une ligne
 * éteinte ou supprimée arrête ses parcours par son préfixe, et un parcours dont la ligne n'est plus voulue ne continue pas
 * à son prochain pas, même si l'arrêt par préfixe l'a manqué (une ligne éteinte pendant qu'il naissait).
 */
const L1 = '11111111-1111-4111-8111-111111111111';
const ligne = (over: Partial<LigneHubspot> = {}): LigneHubspot => ({
  id: L1, famille: 'etape', config: { pipelineId: 'default', stageId: 'closedwon' }, actif: true, workflowId: 'wf-1', nom: 'Étape', ...over,
});
const etape = origineHubspot({ famille: 'etape', ligne: L1, deal: '42', etape: 'closedwon', le: new Date('2026-11-19T10:00:00Z') })!;
const rdv = origineHubspot({ famille: 'rdv', ligne: L1, contact: '33612345678', champ: 'hs_rdv', date: '2026-11-20T09:00:00Z' })!;

function magasin(l: LigneHubspot | null) {
  const lus: string[] = [];
  return { lus, lignes: { lire: async (t: string, id: string) => { lus.push(`${t}/${id}`); return l; } } };
}

describe('la règle « encore voulu » d’un parcours HubSpot', () => {
  it('🔴 la ligne allumée de la même famille : voulu ; lue dans l’espace du parcours, par son identifiant', async () => {
    const m = magasin(ligne());
    expect(await parcoursHubspotEncoreVoulu(m.lignes, 't1', etape)).toBe(true);
    expect(m.lus).toEqual([`t1/${L1}`]);
    expect(await parcoursHubspotEncoreVoulu(magasin(ligne({ famille: 'rdv' })).lignes, 't1', rdv)).toBe(true);
  });

  it('🔴 la ligne éteinte, supprimée (ou d’un autre espace), ou d’une autre famille : plus voulu', async () => {
    expect(await parcoursHubspotEncoreVoulu(magasin(ligne({ actif: false })).lignes, 't1', etape)).toBe(false);
    expect(await parcoursHubspotEncoreVoulu(magasin(null).lignes, 't1', etape)).toBe(false);
    expect(await parcoursHubspotEncoreVoulu(magasin(ligne({ famille: 'rdv' })).lignes, 't1', etape)).toBe(false);
    expect(await parcoursHubspotEncoreVoulu(magasin(ligne({ famille: 'workflow' })).lignes, 't1', rdv)).toBe(false);
  });

  it('🔴 chaque famille que produit le constructeur d’origine est relue : aucune ne reste voulue à vie sans lecture', async () => {
    const familles: FamilleHubspot[] = ['etape', 'rdv'];
    for (const f of familles) {
      const m = magasin(null);
      const o = f === 'etape' ? etape : rdv;
      expect(await parcoursHubspotEncoreVoulu(m.lignes, 't1', o), f).toBe(false);
      expect(m.lus, f).toHaveLength(1);
    }
  });

  it('une origine HubSpot illisible (famille inconnue, ligne qui n’est pas un identifiant) : plus voulu, sans lecture', async () => {
    for (const o of ['hubspot:workflow:' + L1 + ':x', 'hubspot:etape:ligne-1:42:s:2026-11-19', 'hubspot:', 'hubspot:etape']) {
      const m = magasin(ligne());
      expect(await parcoursHubspotEncoreVoulu(m.lignes, 't1', o), o).toBe(false);
      expect(m.lus, o).toEqual([]);
    }
  });

  it('une autre source (Shopify) n’est pas la sienne : voulu, sans rien lire', async () => {
    const m = magasin(null);
    expect(await parcoursHubspotEncoreVoulu(m.lignes, 't1', 'shopify:boutique:checkouts/create:1')).toBe(true);
    expect(m.lus).toEqual([]);
  });
});
