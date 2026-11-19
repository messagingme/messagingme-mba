import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signRequest } from '../src/lib/signature';
import type { HubspotEventRouteDeps } from '../src/http/hubspot-events';
import type { ChampsFiche } from '../src/campaign/build';
import type { LigneHubspot } from '../src/hubspot/lignes';
import type { EvenementDeLigne } from '../src/hubspot/circuit';
import { origineHubspot } from '../src/hubspot/origine';
import type { Fonction } from '../src/offres/offres';

/**
 * Canal ENTRANT depuis le connecteur HubSpot : le changement d'étape d'un deal. C'est un endroit où un système extérieur
 * provoque un envoi WhatsApp facturé : la route reste avare. Elle vérifie la signature, valide le payload, et depuis le lot
 * 6b du menu « Scénario » sert les LIGNES d'Automation > HubSpot réglées sur l'étape (rayon `hubspot`, allumées) par leur
 * circuit (`servirLigneHubspot`), au lieu de publier un événement pour le runner du Builder (dont les automations
 * « changement d'étape » sont éteintes par la bascule). 🔴 La fiche d'un lead inconnu et les champs `hs_*` ne s'écrivent
 * que si une ligne allumée correspond (relecture de 6a) : sans elle, chaque changement d'étape du portail créerait une fiche.
 */
const SECRET = 'secret-partage-avec-le-connecteur';
const NOW = 1_786_000_000_000;

/** Les champs déclarés dans l'espace : seules ces clés s'écrivent (règle du lot 2). */
const DECLAREES = ['hs_contact_firstname', 'hs_deal_montant', 'hs_calc_conseiller'];

const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';
const ligne = (id: string, config: { pipelineId: string; stageId: string }): LigneHubspot => ({ id, famille: 'etape', config, actif: true, workflowId: `wf-${id}`, nom: 'Étape devis' });

/**
 * Par défaut : la ligne « Automations HubSpot » allumée, l'offre Entreprise (`crm`), UNE ligne allumée sur l'étape. `journal`
 * garde l'ordre des écritures (fiche, champs, envoi).
 */
function app(over: Partial<HubspotEventRouteDeps> & { lignes?: LigneHubspot[] } = {}) {
  const { lignes = [ligne(L1, { pipelineId: 'p1', stageId: 's-devis' })], ...reste } = over;
  const servis: Array<{ tenantId: string; e: EvenementDeLigne }> = [];
  const fiches: Array<{ tenantId: string; e164: string }> = [];
  const ecrits: Array<{ tenantId: string; contactId: string; champs: ChampsFiche }> = [];
  const questions: string[] = [];
  const journal: string[] = [];
  const deps: HubspotEventRouteDeps = {
    secret: SECRET,
    automationsBranchees: async () => true,
    fonctions: async () => new Set<Fonction>(['crm', 'scenarios']),
    etapesAllumees: async (t, pipelineId, stageId) => { questions.push(`${t}/${pipelineId}/${stageId}`); return lignes; },
    estBloque: async () => false,
    resoudreFiche: async (tenantId, e164) => { fiches.push({ tenantId, e164 }); journal.push('fiche'); return { ok: true, contactId: 'c1', cree: true }; },
    champsDeclares: async () => DECLAREES.map((key) => ({ key, type: 'text' as const })),
    documents: { telecharger: async () => ({ refus: 'non attendu' }), deposer: async () => 'doc_non_attendu' },
    ecrireChamps: async (tenantId, contactId, champs) => { ecrits.push({ tenantId, contactId, champs }); journal.push('champs'); },
    servir: async (tenantId, e) => { servis.push({ tenantId, e }); journal.push(`servir:${e.ligne.id}`); return 'envoye'; },
    now: () => NOW,
    ...reste,
  };
  const server = buildServer({ queue: new FakeQueue(), hubspotEvents: deps });
  return { server, servis, fiches, ecrits, questions, journal };
}

/** Signe un corps comme le fait le connecteur (même format canonique, même chemin). */
function envoi(body: unknown, secret = SECRET, ts = NOW) {
  const raw = JSON.stringify(body);
  const sig = signRequest(secret, { ts, nonce: randomBytes(8).toString('hex'), method: 'POST', path: '/hubspot/deal-stage', body: raw });
  return { headers: { 'content-type': 'application/json', 'x-mm-service-signature': sig }, payload: raw };
}

const VALIDE = { tenantId: 't1', phone: '+33612345678', stageId: 's-devis', pipelineId: 'p1', dealId: '555' };
const JOUR = new Date(NOW);
const origineDe = (l: string, deal = '555', etape = 's-devis') => origineHubspot({ famille: 'etape', ligne: l, deal, etape, le: JOUR })!;

describe('POST /hubspot/deal-stage', () => {
  it('🔴 événement signé, une ligne allumée sur l’étape : la ligne est servie, l’origine porte la ligne, le deal, l’étape et le jour', async () => {
    const { server, servis, questions } = app();
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, triggered: true, lignes: [{ id: L1, issue: 'envoye' }] });
    expect(questions).toEqual(['t1/p1/s-devis']);
    expect(servis).toEqual([{
      tenantId: 't1',
      e: { ligne: ligne(L1, { pipelineId: 'p1', stageId: 's-devis' }), telephone: '+33612345678', waId: '33612345678', origine: origineDe(L1) },
    }]);
    await server.close();
  });

  it('deux lignes allumées correspondent (l’une sans pipeline) : chacune est servie, chacune sous sa propre origine', async () => {
    const { server, servis } = app({ lignes: [ligne(L1, { pipelineId: 'p1', stageId: 's-devis' }), ligne(L2, { pipelineId: '', stageId: 's-devis' })] });
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE) });
    expect(res.json()).toMatchObject({ triggered: true, lignes: [{ id: L1 }, { id: L2 }] });
    expect(servis.map((s) => s.e.origine)).toEqual([origineDe(L1), origineDe(L2)]);
    await server.close();
  });

  it('rien n’est parti pour aucune ligne : `triggered` faux, l’issue de chacune dite', async () => {
    const { server } = app({ servir: async () => 'plafond' });
    expect((await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE) })).json()).toEqual({ ok: true, triggered: false, lignes: [{ id: L1, issue: 'plafond' }] });
    await server.close();
  });

  it('un deal sans identifiant (connecteur ancien) : l’origine prend le contact à sa place, jamais un deal vide', async () => {
    const { server, servis } = app();
    const { dealId: _sansDeal, ...sansDeal } = VALIDE;
    await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(sansDeal) });
    expect(servis[0]?.e.origine).toBe(origineDe(L1, 'contact-33612345678'));
    await server.close();
  });

  it('🔴 AUCUNE ligne allumée sur l’étape : 200 sans déclenchement, ni fiche, ni champ, rien servi', async () => {
    // Sans ce filtre, chaque changement d'étape de chaque deal du portail créerait une fiche et entamerait la limite de
    // contacts de l'offre.
    const { server, servis, fiches, ecrits } = app({ lignes: [] });
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: { contact: { firstname: 'Claire' } } }) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, triggered: false, reason: 'aucune ligne sur cette étape' });
    expect([servis, fiches, ecrits]).toEqual([[], [], []]);
    await server.close();
  });

  it('🔴 hors de l’offre qui relie HubSpot (`crm`) : 200 sans déclenchement, rien lu ni écrit', async () => {
    const b = app({ fonctions: async () => new Set<Fonction>(['scenarios']) });
    const res = await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE) });
    expect(res.json()).toEqual({ ok: true, triggered: false, reason: 'hors offre' });
    expect([b.questions, b.journal]).toEqual([[], []]);
    await b.server.close();
  });

  it('les champs HubSpot choisis (lot 2) : validés par le contrat, un lien hors https ou un groupe inconnu refusé en 400', async () => {
    const { server, servis } = app();
    const champs = {
      contact: { firstname: 'Claire' }, deal: { montant: '' },
      calcules: { conseiller: 'Cédric Weiss', lien_agenda: '', lien_devis: 'https://app-eu1.hubspot.com/quotes/1/a', pdf_devis: '' },
    };
    expect((await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs }) })).json()).toMatchObject({ triggered: true });
    for (const faux of [{ calcules: { lien_agenda: 'http://x.fr' } }, { calcules: { lien_devis: 'http://x.fr' } }, { calcules: { pdf_devis: 'javascript:alert(1)' } }, { company: { name: 'x' } }, { prenom: 'Claire' }]) {
      expect((await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: faux }) })).statusCode, JSON.stringify(faux)).toBe(400);
    }
    expect(servis).toHaveLength(1);
    await server.close();
  });

  it('signature absente, fausse, ou d’un autre secret -> 401 et RIEN n’est servi', async () => {
    const { server, servis } = app();
    const sans = await server.inject({
      method: 'POST', url: '/hubspot/deal-stage',
      headers: { 'content-type': 'application/json' }, payload: JSON.stringify(VALIDE),
    });
    expect(sans.statusCode).toBe(401);
    const autre = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE, 'mauvais-secret') });
    expect(autre.statusCode).toBe(401);
    expect(servis).toEqual([]);
    await server.close();
  });

  it('signature PÉRIMÉE -> 401 (la fenêtre borne le rejeu)', async () => {
    const { server, servis } = app();
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE, SECRET, NOW - 10 * 60 * 1000) });
    expect(res.statusCode).toBe(401);
    expect(servis).toEqual([]);
    await server.close();
  });

  it('corps ALTÉRÉ après signature -> 401', async () => {
    const { server, servis } = app();
    const bon = envoi(VALIDE);
    const res = await server.inject({
      method: 'POST', url: '/hubspot/deal-stage',
      headers: bon.headers, payload: JSON.stringify({ ...VALIDE, stageId: 's-gagne' }),
    });
    expect(res.statusCode).toBe(401);
    expect(servis).toEqual([]);
    await server.close();
  });

  it('payload incomplet -> 400 (safeParse, jamais de champ deviné)', async () => {
    const { server, servis } = app();
    for (const mauvais of [{ tenantId: 't1' }, { ...VALIDE, stageId: '' }, { ...VALIDE, phone: '' }]) {
      const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(mauvais) });
      expect(res.statusCode, JSON.stringify(mauvais)).toBe(400);
    }
    expect(servis).toEqual([]);
    await server.close();
  });

  it('numéro inexploitable -> 200 sans déclenchement (ce n’est pas une panne)', async () => {
    const { server, servis } = app();
    const res = await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, phone: 'pas-un-numero' }) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ triggered: boolean }>().triggered).toBe(false);
    expect(servis).toEqual([]);
    await server.close();
  });

  it('pipeline absent : la question des lignes porte un pipeline vide (une ligne réglée sur un pipeline correspond encore)', async () => {
    const { server, questions } = app();
    const { pipelineId: _ignore, ...sansPipeline } = VALIDE;
    expect((await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(sansPipeline) })).statusCode).toBe(200);
    expect(questions).toEqual(['t1//s-devis']);
    await server.close();
  });

  it('numéro au format national -> normalisé comme partout ailleurs (même contact par tous les chemins)', async () => {
    const { server, servis } = app();
    await server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, phone: '06 12 34 56 78' }) });
    expect(servis[0]?.e).toMatchObject({ waId: '33612345678', telephone: '+33612345678' });
    await server.close();
  });

  describe('lot 3a du 2026-11-02 : la ligne « Automations HubSpot » (décision 5) et la fiche d’un lead inconnu (décision 7)', () => {
    const CHAMPS = { contact: { firstname: 'Claire', company: 'ACME' }, deal: { montant: '' }, calcules: { conseiller: 'Cédric Weiss' } };

    it('🔴 « Automations HubSpot » ÉTEINTE -> 200 sans déclenchement, et RIEN : ni ligne lue, ni fiche, ni champ, ni envoi', async () => {
      const b = app({ automationsBranchees: async () => false });
      const res = await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: CHAMPS }) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, triggered: false, reason: 'automations HubSpot éteintes' });
      expect([b.questions, b.journal]).toEqual([[], []]);
      await b.server.close();
    });

    it('🔴 une ligne allumée correspond -> la fiche est résolue (créée au besoin), les champs écrits AVANT l’envoi', async () => {
      const b = app();
      const res = await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: CHAMPS }) });
      expect(res.json()).toMatchObject({ ok: true, triggered: true });
      expect(b.fiches).toEqual([{ tenantId: 't1', e164: '+33612345678' }]);
      // Seules les clés déclarées : `company` n'a pas de champ dans l'espace ; un vide RETIRE le champ.
      expect(b.ecrits).toEqual([{
        tenantId: 't1', contactId: 'c1',
        champs: { poser: { hs_contact_firstname: 'Claire', hs_calc_conseiller: 'Cédric Weiss' }, retirer: ['hs_deal_montant'] },
      }]);
      expect(b.journal).toEqual(['fiche', 'champs', `servir:${L1}`]);
      await b.server.close();
    });

    it('🔴 le PDF propre au contact : l’adresse signée reçue devient le CODE de la copie sur la fiche, rangé au numéro', async () => {
      const URL_SIGNEE = 'https://f.hubspotusercontent-eu1.net/hubfs/1/Devis.pdf?Signature=SECRET';
      const recopies: string[] = [];
      const b = app({
        champsDeclares: async () => ['hs_contact_firstname', 'hs_calc_document'].map((key) => ({ key, type: 'text' as const })),
        documents: {
          telecharger: async (url) => { recopies.push(url); return { octets: Buffer.from('%PDF-1.7'), mime: 'application/pdf' }; },
          deposer: async (e) => { recopies.push(`${e.tenantId}/${e.waId}/${e.nom}`); return 'doc_copie'; },
        },
      });
      const res = await b.server.inject({
        method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: { contact: { firstname: 'Claire' }, calcules: { document: URL_SIGNEE } } }),
      });
      expect(res.json()).toMatchObject({ ok: true, triggered: true });
      expect(recopies).toEqual([URL_SIGNEE, 't1/33612345678/Devis.pdf']);
      expect(b.ecrits).toEqual([{ tenantId: 't1', contactId: 'c1', champs: { poser: { hs_contact_firstname: 'Claire', hs_calc_document: 'doc_copie' }, retirer: [] } }]);
      expect(JSON.stringify(b.ecrits)).not.toContain('Signature=SECRET');
      await b.server.close();
    });

    it('sans champs, rien n’est écrit et la ligne est servie', async () => {
      const b = app();
      await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi(VALIDE) });
      expect(b.ecrits).toEqual([]);
      expect(b.servis).toHaveLength(1);
      await b.server.close();
    });

    it('🔴 limite de contacts de l’offre atteinte -> 200 sans déclenchement, la raison dite, aucun champ ni envoi', async () => {
      const b = app({ resoudreFiche: async () => ({ ok: false, code: 'plan_limit_reached' }) });
      const res = await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: CHAMPS }) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, triggered: false, reason: 'limite de contacts atteinte' });
      expect([b.ecrits, b.servis]).toEqual([[], []]);
      await b.server.close();
    });

    it('🔴 contact BLOQUÉ -> 200 sans déclenchement : ni fiche touchée, ni champ écrit, ni envoi', async () => {
      const b = app({ estBloque: async () => true });
      const res = await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, champs: CHAMPS }) });
      expect(res.json()).toEqual({ ok: true, triggered: false, reason: 'contact bloqué' });
      expect(b.journal).toEqual([]);
      await b.server.close();
    });

    it('🔴 numéro ÉTRANGER : la fiche naît sous son vrai E.164, jamais sous un numéro français', async () => {
      const b = app();
      // Belge, écrit à l'international avec « + » puis avec « 00 » : les deux formes donnent la même fiche.
      await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, phone: '+32 470 12 34 56' }) });
      await b.server.inject({ method: 'POST', url: '/hubspot/deal-stage', ...envoi({ ...VALIDE, phone: '0032470123456' }) });
      expect(b.fiches).toEqual([{ tenantId: 't1', e164: '+32470123456' }, { tenantId: 't1', e164: '+32470123456' }]);
      expect(b.servis.map((s) => s.e.waId)).toEqual(['32470123456', '32470123456']);
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
