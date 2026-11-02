import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signRequest } from '../src/lib/signature';
import type { HubspotEventRouteDeps } from '../src/http/hubspot-events';
import { parseAutomationEventJob } from '../src/automation/event-job';
import { matchesTrigger, type AutomationRow } from '../src/automation/match';
import type { ChampsFiche } from '../src/campaign/build';

/**
 * Canal ENTRANT depuis le connecteur HubSpot. C'est le SEUL endroit où un système extérieur peut provoquer un
 * envoi WhatsApp facturé : la route doit donc être avare. Elle vérifie la signature, valide le payload, et ne
 * décide de rien d'autre que « traduire en événement d'automation ».
 */
const SECRET = 'secret-partage-avec-le-connecteur';
const NOW = 1_786_000_000_000;

let baseline = 0;
beforeAll(() => { baseline = 0; });

/** Les champs déclarés dans l'espace : seules ces clés s'écrivent (règle du lot 2). */
const DECLAREES = ['hs_contact_firstname', 'hs_deal_montant', 'hs_calc_conseiller'];

/**
 * Par défaut : la ligne « Automations HubSpot » allumée, AUCUNE automation sur l'étape, un contact connu. `journal` garde
 * l'ordre des écritures (fiche, champs, publication).
 */
function app(over: Partial<HubspotEventRouteDeps> = {}) {
  const publies: Array<{ tenantId: string; ev: unknown }> = [];
  const fiches: Array<{ tenantId: string; e164: string }> = [];
  const ecrits: Array<{ tenantId: string; contactId: string; champs: ChampsFiche }> = [];
  const correspondances: unknown[] = [];
  const journal: string[] = [];
  const deps: HubspotEventRouteDeps = {
    secret: SECRET,
    automationsBranchees: async () => true,
    automationCorrespond: async (_t, ev) => { correspondances.push(ev); return false; },
    findWaId: async (_t, waId) => waId,
    estBloque: async () => false,
    resoudreFiche: async (tenantId, e164) => { fiches.push({ tenantId, e164 }); journal.push('fiche'); return { ok: true, contactId: 'c1', cree: true }; },
    champsDeclares: async () => DECLAREES,
    ecrireChamps: async (tenantId, contactId, champs) => { ecrits.push({ tenantId, contactId, champs }); journal.push('champs'); },
    publish: async (tenantId, ev) => { publies.push({ tenantId, ev }); journal.push('publish'); },
    now: () => NOW,
    ...over,
  };
  const server = buildServer({ queue: new FakeQueue(), hubspotEvents: deps });
  return { server, publies, fiches, ecrits, correspondances, journal };
}

/** Une automation allumée et permise correspond à l'étape. */
const correspond = { automationCorrespond: async () => true };

/** Signe un corps comme le fait le connecteur (même format canonique, même chemin). */
function envoi(body: unknown, secret = SECRET, ts = NOW) {
  const raw = JSON.stringify(body);
  const sig = signRequest(secret, { ts, nonce: randomBytes(8).toString('hex'), method: 'POST', path: '/hubspot/deal-stage', body: raw });
  return { headers: { 'content-type': 'application/json', 'x-mm-service-signature': sig }, payload: raw };
}

const VALIDE = { tenantId: 't1', phone: '+33612345678', stageId: 's-devis', pipelineId: 'p1', dealId: '555' };

describe('POST /hubspot/deal-stage', () => {
  it('événement signé -> publie l’événement d’automation avec le wa_id résolu', async () => {
    const { server, publies } = app();
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ triggered: boolean }>().triggered).toBe(true);
    expect(publies).toEqual([{ tenantId: 't1', ev: { kind: 'hubspot_deal_stage', waId: '33612345678', pipelineId: 'p1', stageId: 's-devis' } }]);
    await server.close();
  });

  it('les champs HubSpot choisis (lot 2) : acceptés et validés ; SANS automation sur l’étape, rien n’est écrit, l’événement publié tel qu’avant', async () => {
    const { server, publies, ecrits, fiches } = app();
    const champs = { contact: { firstname: 'Claire' }, deal: { montant: '' }, calcules: { conseiller: 'Cédric Weiss', lien_agenda: '' } };
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs }) });
    expect(res.json()).toEqual({ ok: true, triggered: true });
    expect(publies).toEqual([{ tenantId: 't1', ev: { kind: 'hubspot_deal_stage', waId: '33612345678', pipelineId: 'p1', stageId: 's-devis' } }]);
    expect(ecrits).toEqual([]);
    expect(fiches).toEqual([]);
    // Hors contrat : un lien qui n'est pas en https, un groupe inconnu, l'ancienne forme de l'action transaction.
    for (const faux of [{ calcules: { lien_agenda: 'http://x.fr' } }, { company: { name: 'x' } }, { prenom: 'Claire' }]) {
      expect((await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: faux }) })).statusCode, JSON.stringify(faux)).toBe(400);
    }
    expect(publies).toHaveLength(1);
    await server.close();
  });

  it('signature absente, fausse, ou d’un autre secret -> 401 et RIEN n’est publié', async () => {
    const { server, publies } = app();
    const sans = await server.inject({
      method: 'POST', url: '/hubspot/deal-stage',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(VALIDE),
    });
    expect(sans.statusCode).toBe(401);
    const autre = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE, 'mauvais-secret') });
    expect(autre.statusCode).toBe(401);
    expect(publies).toEqual([]);
    await server.close();
  });

  it('signature PÉRIMÉE -> 401 (la fenêtre borne le rejeu)', async () => {
    const { server, publies } = app();
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE, SECRET, NOW - 10 * 60 * 1000) });
    expect(res.statusCode).toBe(401);
    expect(publies).toEqual([]);
    await server.close();
  });

  it('corps ALTÉRÉ après signature -> 401', async () => {
    const { server, publies } = app();
    const bon = envoi(VALIDE);
    const res = await server.inject({
      method: 'POST', url: '/hubspot/deal-stage',
      headers: bon.headers, payload: JSON.stringify({ ...VALIDE, stageId: 's-gagne' }),
    });
    expect(res.statusCode).toBe(401);
    expect(publies).toEqual([]);
    await server.close();
  });

  it('payload incomplet -> 400 (safeParse, jamais de champ deviné)', async () => {
    const { server, publies } = app();
    for (const mauvais of [{ tenantId: 't1' }, { ...VALIDE, stageId: '' }, { ...VALIDE, phone: '' }]) {
      const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(mauvais) });
      expect(res.statusCode, JSON.stringify(mauvais)).toBe(400);
    }
    expect(publies).toEqual([]);
    await server.close();
  });

  it('🔴 contact INCONNU et AUCUNE automation sur l’étape -> 200 sans déclenchement, aucune fiche créée, aucun champ écrit', async () => {
    // Sans ce filtre, chaque changement d'étape de chaque deal du portail créerait une fiche et entamerait la limite de
    // contacts de l'offre.
    const { server, publies, fiches, ecrits } = app({ findWaId: async () => null });
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: { contact: { firstname: 'Claire' } } }) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ triggered: boolean; reason: string }>()).toMatchObject({ triggered: false, reason: 'contact inconnu' });
    expect(publies).toEqual([]);
    expect(fiches).toEqual([]);
    expect(ecrits).toEqual([]);
    await server.close();
  });

  it('numéro inexploitable -> 200 sans déclenchement (ce n’est pas une panne)', async () => {
    const { server, publies } = app();
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, phone: 'pas-un-numero' }) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ triggered: boolean }>().triggered).toBe(false);
    expect(publies).toEqual([]);
    await server.close();
  });

  it('pipeline absent -> publié vide, l’étape suffit à décider', async () => {
    const { server, publies } = app();
    const { pipelineId: _ignore, ...sansPipeline } = VALIDE;
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(sansPipeline) });
    expect(res.statusCode).toBe(200);
    expect(publies[0]?.ev).toMatchObject({ pipelineId: '' });
    await server.close();
  });

  /**
   * CHAÎNE COMPLÈTE, et c'est le test qui manquait. Chaque maillon était couvert isolément, et la chaîne était
   * pourtant MORTE : la route publiait un pipeline vide (le webhook HubSpot ne le porte pas) et l'analyseur de
   * file l'écartait. 200 partout, aucune erreur, aucune automation. Tester les maillons ne teste pas la chaîne.
   */
  it('bout en bout : ce que la route publie est ACCEPTÉ par la file ET déclenche l’automation', async () => {
    const { server, publies } = app();
    const { pipelineId: _sansPipeline, ...sansPipeline } = VALIDE;
    await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(sansPipeline) });
    expect(publies).toHaveLength(1);

    // 1) le job publié survit à l'analyseur de la file (c'est ici que tout mourait)
    const job = parseAutomationEventJob({ tenantId: publies[0]!.tenantId, event: publies[0]!.ev });
    expect(job).not.toBeNull();

    // 2) et il déclenche bien une automation réglée sur cette étape
    const automation: AutomationRow = {
      id: 'a1', tenantId: 't1', name: 'Relance devis', enabled: true,
      triggerKind: 'hubspot_deal_stage', triggerConfig: { pipelineId: 'p1', stageId: 's-devis' },
      conditionGroup: null, workflowId: 'wf1', startNodeId: null, cooldownSeconds: null,
      maxFiresPerHour: null, possedePar: null,
    };
    // Pipeline configuré côté automation MAIS absent de l'événement : ça doit passer, sinon la règle
    // « le pipeline ne restreint rien » ne vaudrait que dans un sens.
    expect(matchesTrigger(automation, job!.event)).toBe(true);
    await server.close();
  });

  it('numéro au format national -> normalisé comme partout ailleurs (même contact par tous les chemins)', async () => {
    const { server, publies } = app();
    await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, phone: '06 12 34 56 78' }) });
    expect(publies[0]?.ev).toMatchObject({ waId: '33612345678' });
    await server.close();
  });

  describe('lot 3a du 2026-11-02 : la ligne « Automations HubSpot » (décision 5) et la fiche d’un lead inconnu (décision 7)', () => {
    const CHAMPS = { contact: { firstname: 'Claire', company: 'ACME' }, deal: { montant: '' }, calcules: { conseiller: 'Cédric Weiss' } };

    it('🔴 ligne ÉTEINTE -> 200 sans déclenchement, et RIEN : ni fiche, ni champ, ni événement, même pour un contact connu', async () => {
      for (const findWaId of [async () => null, async (_t: string, w: string) => w]) {
        const b = app({ automationsBranchees: async () => false, findWaId, ...correspond });
        const res = await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: CHAMPS }) });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true, triggered: false, reason: 'automations HubSpot éteintes' });
        expect(b.journal).toEqual([]);
        await b.server.close();
      }
    });

    it('🔴 lead INCONNU et une automation allumée qui correspond -> sa fiche est créée, les champs écrits AVANT la publication', async () => {
      const b = app({ findWaId: async () => null, ...correspond });
      const res = await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: CHAMPS }) });
      expect(res.json()).toEqual({ ok: true, triggered: true });
      expect(b.fiches).toEqual([{ tenantId: 't1', e164: '+33612345678' }]);
      // Seules les clés déclarées : `company` n'a pas de champ dans l'espace ; un vide RETIRE le champ.
      expect(b.ecrits).toEqual([{
        tenantId: 't1', contactId: 'c1',
        champs: { poser: { hs_contact_firstname: 'Claire', hs_calc_conseiller: 'Cédric Weiss' }, retirer: ['hs_deal_montant'] },
      }]);
      expect(b.journal).toEqual(['fiche', 'champs', 'publish']);
      expect(b.publies).toEqual([{ tenantId: 't1', ev: { kind: 'hubspot_deal_stage', waId: '33612345678', pipelineId: 'p1', stageId: 's-devis' } }]);
      await b.server.close();
    });

    it('la question « une automation correspond ? » porte sur l’événement exact (étape, pipeline, contact)', async () => {
      const b = app();
      await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE) });
      expect(b.correspondances).toEqual([{ kind: 'hubspot_deal_stage', waId: '33612345678', pipelineId: 'p1', stageId: 's-devis' }]);
      await b.server.close();
    });

    it('contact CONNU et une automation qui correspond -> la même fiche (rien de créé ailleurs), champs puis publication ; sans champs, rien n’est écrit', async () => {
      const b = app({ ...correspond, resoudreFiche: async () => ({ ok: true, contactId: 'c-connu', cree: false }) });
      await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: CHAMPS }) });
      expect(b.ecrits.map((e) => e.contactId)).toEqual(['c-connu']);
      await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE) });
      expect(b.ecrits).toHaveLength(1);
      expect(b.publies).toHaveLength(2);
      await b.server.close();
    });

    it('🔴 limite de contacts de l’offre atteinte -> 200 sans déclenchement, la raison dite, aucun champ ni événement', async () => {
      const b = app({ findWaId: async () => null, ...correspond, resoudreFiche: async () => ({ ok: false, code: 'plan_limit_reached' }) });
      const res = await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: CHAMPS }) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, triggered: false, reason: 'limite de contacts atteinte' });
      expect(b.ecrits).toEqual([]);
      expect(b.publies).toEqual([]);
      await b.server.close();
    });

    it('🔴 contact BLOQUÉ -> 200 sans déclenchement : ni fiche touchée, ni champ écrit, ni événement', async () => {
      const b = app({ ...correspond, estBloque: async () => true });
      const res = await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: CHAMPS }) });
      expect(res.json()).toEqual({ ok: true, triggered: false, reason: 'contact bloqué' });
      expect(b.journal).toEqual([]);
      await b.server.close();
    });

    it('🔴 numéro ÉTRANGER : la fiche naît sous son vrai E.164, jamais sous un numéro français', async () => {
      const b = app({ findWaId: async () => null, ...correspond });
      // Belge, écrit à l'international avec « + » puis avec « 00 » : les deux formes donnent la même fiche.
      await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, phone: '+32 470 12 34 56' }) });
      await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, phone: '0032470123456' }) });
      expect(b.fiches).toEqual([{ tenantId: 't1', e164: '+32470123456' }, { tenantId: 't1', e164: '+32470123456' }]);
      expect(b.publies.map((p) => p.ev)).toEqual([0, 1].map(() => expect.objectContaining({ waId: '32470123456' })));
      await b.server.close();
    });
  });

  it('route NON montée sans secret partagé -> 404 (jamais une route ouverte par défaut)', async () => {
    const server = buildServer({ queue: new FakeQueue() });
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE) });
    expect(res.statusCode).toBe(404);
    await server.close();
  });
});
