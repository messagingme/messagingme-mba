import { describe, expect, it } from 'vitest';
import { donneesDEvenementLues } from '../src/workflow/evenement';
import { preparerCampagne, type PreparationCampagneDeps } from '../src/http/preparation-campagne';
import type { WorkflowGraph } from '../src/workflow/graph';
import { campagnesInertes } from './routes-inertes';

/**
 * 🔴 UNE CAMPAGNE N'A PAS DE COMMANDE DERRIÈRE ELLE (scénarios Shopify et HubSpot admis en campagne, Julien, 2026-11-26).
 * Un scénario qui lit une donnée de l'événement plus loin que son template d'ouverture est refusé à la création, la
 * donnée nommée : sans ce refus, un message rapide partait avec un trou (« Votre commande  est expédiée ») à chaque
 * contact qui cliquait (relecture du lot). Le template d'ouverture, lui, reçoit les variables de la campagne.
 */
const p = { x: 0, y: 0 };
const ouverture = { id: 't1', type: 'template', position: p, data: { templateName: 'commande_expediee', language: 'fr', variables: [{ position: 1, source: { type: 'variable', key: 'numero_commande' } }] } };
const graphe = (...suite: unknown[]): WorkflowGraph => ({
  nodes: [ouverture, ...suite] as WorkflowGraph['nodes'],
  edges: suite.map((n, i) => ({ id: `e${i}`, source: i === 0 ? 't1' : (suite[i - 1] as { id: string }).id, target: (n as { id: string }).id, sourceHandle: 'btn:0' })) as WorkflowGraph['edges'],
});
const rapide = (texte: string) => ({ id: 'q1', type: 'quickMessage', position: p, data: { text: texte } });

describe('donneesDEvenementLues', () => {
  it('le template d’ouverture ne compte pas : la campagne fournit ses variables', () => {
    expect(donneesDEvenementLues(graphe(), 't1')).toEqual([]);
  });

  it('un texte qui lit {{shopify.…}} ou {{hubspot.…}} plus loin est nommé', () => {
    expect(donneesDEvenementLues(graphe(rapide('Votre commande {{ shopify.numero_commande }} est partie, deal {{hubspot.deal_nom}}')), 't1').sort())
      .toEqual(['hubspot.deal_nom', 'shopify.numero_commande']);
  });

  it('un autre template qui lit une variable du parcours est nommé ; un champ de la fiche non', () => {
    const autre = { id: 't2', type: 'template', position: p, data: { templateName: 'suivi', language: 'fr', variables: [{ position: 1, source: { type: 'variable', key: 'lien_suivi' } }, { position: 2, source: { type: 'field', key: 'prenom' } }] } };
    expect(donneesDEvenementLues(graphe(autre), 't1')).toEqual(['lien_suivi']);
    expect(donneesDEvenementLues(graphe(rapide('Bonjour {{prenom}}')), 't1')).toEqual([]);
  });
});

describe('preparerCampagne refuse un scénario qui lit une donnée de la commande plus loin', () => {
  const deps = (g: WorkflowGraph): PreparationCampagneDeps => ({
    repo: { phoneNumberBelongsToTenant: async () => true },
    contacts: { contactIdsForTarget: async () => ['c1'] },
    identifiantsDeTousLesContacts: async () => ['c1'],
    plafondDestinataires: 10,
    rcs: { belongsToTenant: async () => true },
    emailTemplateBelongsToTenant: async () => true,
    webhookUsableByTenant: async () => true,
    getWorkflowGraph: async () => g,
    offres: campagnesInertes.offres,
    agents: campagnesInertes.agents,
  });
  const corps = { phoneNumberId: 'pn1', name: 'Relance', category: 'utility', workflowId: '3f1c6a2e-1111-4a8a-9c1d-000000000001', paramMapping: [{ position: 1, source: { type: 'field', key: 'prenom' } }] };

  it('🔴 refusé, la donnée nommée', async () => {
    const r = await preparerCampagne(corps, 't1', deps(graphe(rapide('Votre commande {{shopify.numero_commande}} est partie'))));
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(JSON.stringify(r)).toContain('shopify.numero_commande');
  });

  it('le même scénario sans donnée de la commande plus loin passe ce contrôle', async () => {
    const r = await preparerCampagne(corps, 't1', deps(graphe(rapide('Merci !'))));
    expect(JSON.stringify(r)).not.toContain('donnée de la commande');
  });
});
