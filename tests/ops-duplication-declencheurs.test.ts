import { describe, it, expect } from 'vitest';
import { copierDeclencheurs } from '../src/ops/duplication/declencheurs';
import type { AutomationRow } from '../src/automation/match';
import { AUTOMATION_TRIGGER_KINDS } from '../web/lib/partage/automations';

/**
 * LES DÉCLENCHEURS D'UN SCÉNARIO DUPLIQUÉ (lot 1, tâche 2 du plan `docs/superpowers/plans/2026-11-16-duplication-scenario-lot-1.md`).
 *
 * Tout ce qui suit arrive ÉTEINT et sans accord marketing (il engage une personne de la source). Un mot-clé déjà pris
 * dans la destination est retiré ; un « nouveau contact » en double ne suit pas ; un déclencheur lié à un objet de la
 * source (webhook entrant, étape HubSpot, publicité, action d'agent, automation possédée) ne suit pas.
 */

const auto = (id: string, over: Partial<AutomationRow> = {}): AutomationRow => ({ rayon: 'general',
  id, tenantId: 't-src', name: `auto ${id}`, enabled: true, triggerKind: 'keyword', triggerConfig: { keywords: ['bonjour'] },
  conditionGroup: null, workflowId: 'wf-src', startNodeId: null, possedePar: null, cooldownSeconds: null, maxFiresPerHour: null,
  accordMarketing: null, ...over,
});

describe('copierDeclencheurs', () => {
  it('toute copie arrive éteinte, sans accord marketing ni propriétaire, réglages gardés', () => {
    const r = copierDeclencheurs([auto('a', {
      triggerKind: 'tag_added', triggerConfig: { tag: 'VIP' }, startNodeId: 'q1', cooldownSeconds: 60, maxFiresPerHour: 5,
      conditionGroup: { match: 'all', clauses: [] }, accordMarketing: { par: 'u-1', email: 'x@y.fr', le: new Date() },
    })], []);
    expect(r.copies).toEqual([{
      name: 'auto a', triggerKind: 'tag_added', triggerConfig: { tag: 'VIP' }, conditionGroup: { match: 'all', clauses: [] },
      startNodeId: 'q1', cooldownSeconds: 60, maxFiresPerHour: 5, enabled: false, possedePar: null, accordMarketing: null, rayon: 'general',
    }]);
    expect(r.retires).toEqual([]);
  });

  it('mots-clés : ceux déjà pris dans la destination sont retirés, comparés sans casse ni accents', () => {
    const r = copierDeclencheurs(
      [auto('a', { triggerConfig: { keywords: ['Promo', 'Été', 'rdv'], mode: 'equals' } })],
      [auto('d1', { tenantId: 't-dst', triggerConfig: { keywords: ['promo'] } }), auto('d2', { tenantId: 't-dst', enabled: false, triggerConfig: { keywords: ['ete'] } })],
    );
    expect(r.copies.map((c) => c.triggerConfig)).toEqual([{ keywords: ['rdv'], mode: 'equals' }]);
    expect(r.motsRetires).toEqual([{ nom: 'auto a', mots: ['Promo', 'Été'] }]);
  });

  it('mots-clés : tous pris, le déclencheur ne suit pas', () => {
    const r = copierDeclencheurs([auto('a', { triggerConfig: { keywords: ['stop'] } })], [auto('d', { triggerConfig: { keywords: ['STOP'] } })]);
    expect(r.copies).toEqual([]);
    expect(r.retires).toEqual([{ nom: 'auto a', raison: 'mot_cle_pris' }]);
  });

  it('« nouveau contact » : ne suit pas si la destination en a déjà un, allumé ou non', () => {
    const src = [auto('a', { triggerKind: 'new_contact', triggerConfig: {} })];
    expect(copierDeclencheurs(src, [auto('d', { triggerKind: 'new_contact', enabled: false, triggerConfig: {} })]).retires)
      .toEqual([{ nom: 'auto a', raison: 'nouveau_contact_existe' }]);
    expect(copierDeclencheurs(src, []).copies).toHaveLength(1);
  });

  it('les déclencheurs liés à un objet de la source ne suivent pas', () => {
    const r = copierDeclencheurs([
      auto('w', { triggerKind: 'webhook', triggerConfig: { webhookId: 'wh-1' } }),
      auto('h', { triggerKind: 'hubspot_deal_stage', triggerConfig: { stageId: '42' } }),
      auto('p', { triggerKind: 'ctwa_ad', triggerConfig: { adId: '99' } }),
      auto('g', { triggerKind: 'agent_action', triggerConfig: { actionId: 'act-1' } }),
      auto('c', { triggerKind: 'keyword', possedePar: 'channelsme_link' }),
    ], []);
    expect(r.copies).toEqual([]);
    expect(r.retires.map((x) => [x.nom, x.raison])).toEqual([
      ['auto w', 'lie_a_la_source'], ['auto h', 'lie_a_la_source'], ['auto p', 'lie_a_la_source'], ['auto g', 'lie_a_la_source'],
      ['auto c', 'lie_a_la_source'],
    ]);
  });

  it('les autres types suivent tels quels', () => {
    const kinds = ['conversation_analyzed', 'analyse_devient', 'risque_eleve', 'avant_date', 'tag_added'] as const;
    const r = copierDeclencheurs(kinds.map((k) => auto(k, { triggerKind: k, triggerConfig: { x: 1 } })), []);
    expect(r.copies.map((c) => c.triggerKind)).toEqual([...kinds]);
  });

  it('chaque type de déclencheur a une règle (aucun ne lève)', () => {
    for (const k of AUTOMATION_TRIGGER_KINDS) expect(() => copierDeclencheurs([auto(k, { triggerKind: k })], [])).not.toThrow();
  });

  it('clés et tags à recréer : conditions, date d’un « avant une date », tag d’un « tag ajouté »', () => {
    const r = copierDeclencheurs([
      auto('a', { triggerKind: 'avant_date', triggerConfig: { fieldKey: 'date_rdv', delai: 1, unite: 'jours' } }),
      auto('b', { triggerKind: 'tag_added', triggerConfig: { tag: 'Relancé' } }),
      auto('c', { conditionGroup: { match: 'any', clauses: [{ kind: 'field', key: 'score', op: 'gt', value: '2' }, { kind: 'field', key: 'prenom', op: 'not_empty' }] } }),
    ], []);
    expect([...r.clesDeChamp].sort()).toEqual(['date_rdv', 'score']);
    expect(r.tags).toHaveLength(1);
  });
});
