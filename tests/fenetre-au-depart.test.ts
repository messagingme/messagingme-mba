import { describe, it, expect } from 'vitest';
import { AUTOMATION_TRIGGER_KINDS, FENETRE_AU_DEPART } from '../web/lib/partage/automations';
import { kindsFor } from '../src/automation/runner';
import type { AutomationEvent } from '../src/automation/match';
import { analyserFenetreDuMoteur, avertissementDeLAutomation } from '../src/workflow/fenetre-moteur';
import type { WorkflowGraph, WorkflowNodeType } from '../src/workflow/graph';

/**
 * LA FENÊTRE AU DÉPART D'UN SCÉNARIO SELON SON DÉCLENCHEUR (menu « Scénario », lot 2, décisions 11 et 17).
 *
 * 🔴 ALIGNÉE SUR LE MOTEUR, PAS ÉCRITE À CÔTÉ : le runner ne prouve la fenêtre que pour un message WhatsApp du client
 * (\`windowOpen\`, \`src/automation/runner.ts\`). Un déclencheur qu'un message active part donc ouvert ; tous les autres
 * partent fermés. Un déclencheur ajouté sans sa ligne ne compile pas (\`Record\`), et ce test refuse une ligne fausse.
 */
const EXEMPLES: AutomationEvent[] = [
  { kind: 'message', waId: '1', body: 'x', isNewContact: false, channel: 'whatsapp' },
  { kind: 'tag_added', waId: '1', tag: 'x' },
  { kind: 'analysis', waId: '1', sentiment: 'neutre', resolved: true },
  { kind: 'hubspot_deal_stage', waId: '1', pipelineId: 'p', stageId: 's' },
  { kind: 'webhook', waId: '1', webhookId: 'w' },
  { kind: 'avant_date', waId: '1', automationId: 'a', valeur: '2026-11-18T10:00:00Z' },
  { kind: 'risque_eleve', waId: '1' },
  { kind: 'agent_action', waId: '1', actionId: 'x' },
];

describe('🔴 la fenêtre au départ, alignée sur le moteur des automations', () => {
  it('chaque déclencheur qu’un message active part ouvert, tous les autres fermés', () => {
    const parMessage = new Set(kindsFor(EXEMPLES[0]!));
    const couverts = new Set(EXEMPLES.flatMap((ev) => kindsFor(ev)));
    for (const kind of AUTOMATION_TRIGGER_KINDS) {
      expect(couverts.has(kind), `${kind} n’est activé par aucun événement de l’exemple`).toBe(true);
      expect(FENETRE_AU_DEPART[kind], kind).toBe(parMessage.has(kind) ? 'ouverte' : 'fermee');
    }
  });
});

const n = (id: string, type: WorkflowNodeType, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (id: string, source: string, target: string, sourceHandle?: string) => ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) });

describe('les règles du moteur et l’avertissement d’une automation (décision 17 : prévenir, jamais refuser)', () => {
  const ouvreParMessageRapide: WorkflowGraph = { nodes: [n('r', 'quick_message', { body: 'Bonjour {{prenom}}', name: 'Accueil' })], edges: [] };
  const ouvreParTemplate: WorkflowGraph = {
    nodes: [n('t', 'template', { templateName: 'relance', language: 'fr', templateButtons: [{ type: 'QUICK_REPLY', text: 'Oui' }] }), n('r', 'quick_message', { body: 'Merci' })],
    edges: [e('e1', 't', 'r', 'btn:0')],
  };

  it('une automation de date sur un scénario qui commence par un message rapide : la phrase nomme le bloc et dit quoi faire', () => {
    const phrase = avertissementDeLAutomation('avant_date', null, ouvreParMessageRapide);
    expect(phrase).toContain('« Accueil »');
    expect(phrase).toContain('template');
  });

  it('le même scénario lancé par un mot-clé : aucun avertissement (le client vient d’écrire)', () => {
    expect(avertissementDeLAutomation('keyword', null, ouvreParMessageRapide)).toBeNull();
  });

  it('un scénario qui commence par un template, et dont le message rapide suit un clic : aucun avertissement', () => {
    expect(avertissementDeLAutomation('avant_date', null, ouvreParTemplate)).toBeNull();
  });

  it('les règles du moteur : un message rapide sans texte n’envoie rien, donc aucun constat', () => {
    const vide: WorkflowGraph = { nodes: [n('r', 'quick_message', { body: '' })], edges: [] };
    expect(analyserFenetreDuMoteur(vide, [{ noeudId: null, fenetre: 'fermee', raison: 'une date' }])).toEqual([]);
  });
});
