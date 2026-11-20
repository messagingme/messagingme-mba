import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import type { ShopifyRouteDeps } from '../src/http/shopify';
import type { Connexion, VueBoutique } from '../src/shopify/store.pg';
import { monterLignes } from './shopify-lignes-faux';
import { TEXTE_ATTESTATION_SHOPIFY } from '../web/lib/partage/shopify-messages';

/**
 * LES ROUTES DE PARAMÈTRES > INTÉGRATIONS > SHOPIFY (conception 2026-10-22), montées par le REGISTRE (qui pose l'étape
 * d'espace) : admin seulement, corps stricts, le branchement de la console abonne les webhooks, chaque écriture est
 * journalisée.
 */
const SECRET = 'test-secret';
let admin = '';
let agent = '';
let autreEspace = '';
beforeAll(async () => {
  admin = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET);
  agent = await signSession({ userId: 'u2', tenantId: 't1', role: 'agent' }, SECRET);
  autreEspace = await signSession({ userId: 'u3', tenantId: 't2', role: 'admin' }, SECRET);
});
const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
const en = (jeton: string) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` } });
const URL_T1 = '/tenants/t1/integrations/shopify';
const CIBLE = { kind: 'integration', id: 'shopify' };
const VUE: VueBoutique = {
  domaine: 'b.myshopify.com', nom: 'Essai', pays: 'FR', devise: 'EUR', etat: 'connectee', motifCoupure: null, coupeeLe: null,
  connecteeLe: '2026-10-22T00:00:00.000Z', dernierEvenementLe: null, delaiPanierMinutes: 60, origine: 'console', pauseLe: null,
};

function monter() {
  const trace = { connexions: [] as Connexion[], abonnements: [] as unknown[], audit: [] as Array<{ action: string; cible: unknown; detail: unknown }> };
  // La boutique vit dans le faux des lignes : la gestion, les lignes et la pause lisent la MÊME.
  const lignes = monterLignes({ vue: null });
  const non = async (): Promise<never> => { throw new Error('hors de ce test'); };
  const store = {
    lire: () => lignes.store.lire(),
    connecter: async (_t: string, c: Connexion) => { trace.connexions.push(c); lignes.store.vue = { ...VUE, domaine: c.domaine }; return 'ok' as const; },
    couper: non, messages: async () => [], compteurs: async () => ({}),
    compteursPaniers: async () => ({ relances: {}, fermesATemps: 0, enAttente: 0 }), acces: async () => null, attentes: async () => [],
  };
  const deps: ShopifyRouteDeps = {
    gestion: {
      store,
      verifier: async () => ({ ok: true, nom: 'Essai', pays: 'FR', devise: 'EUR' }),
      lireModele: non,
      chiffrementPret: true,
      jeton: async () => ({ ok: true, jeton: 'jeton' }),
      lireClients: non,
      places: non,
      importer: non,
      abonner: async (a) => { trace.abonnements.push(a); return { ok: true, abonnes: ['ORDERS_PAID'], deja: [] }; },
      filiere: async () => 'api',
      chiffreVentes: async (_t, periode) => ({
        periode, reel: { totaux: [], sources: [] }, test: { totaux: [], sources: [] },
        paniers: { relances: 0, recuperes: 0, montants: [], recuperesTest: 0 },
      }),
      lignes: lignes.deps,
    },
    audit: async (_t, _acteur, action, cible, detail) => { trace.audit.push({ action, cible, detail }); },
  };
  const app = buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, shopify: deps });
  return { app, trace, lignes, brancher: () => { lignes.store.vue = VUE; } };
}

describe('le branchement depuis la console', () => {
  it('🔴 origine console : branchée, les webhooks abonnés, le journal nomme la boutique', async () => {
    const { app, trace } = monter();
    const r = await app.inject({ method: 'POST', url: URL_T1, ...en(admin), payload: { boutique: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x' } });
    expect(r.statusCode).toBe(200);
    expect(trace.connexions).toMatchObject([{ domaine: 'b.myshopify.com', origine: 'console', par: 'u1' }]);
    expect(trace.abonnements).toEqual([{ domaine: 'b.myshopify.com', jeton: 'jeton' }]);
    expect(trace.audit).toEqual([{ action: 'shopify.branchee', cible: CIBLE, detail: { boutique: 'b.myshopify.com', origine: 'console' } }]);
    expect(JSON.stringify(r.json())).not.toContain('shpss_x');
  });

  it('🔴 un agent et l’espace d’un autre client sont refusés, sans rien brancher', async () => {
    const { app, trace } = monter();
    const corps = { boutique: 'b.myshopify.com', clientId: 'cid', secret: 'shpss_x' };
    expect((await app.inject({ method: 'POST', url: URL_T1, ...en(agent), payload: corps })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: URL_T1, ...en(autreEspace), payload: corps })).statusCode).toBe(403);
    expect(trace.connexions).toEqual([]);
  });

  it('un corps hors contrat est refusé (clé inconnue, type)', async () => {
    const { app } = monter();
    expect((await app.inject({ method: 'POST', url: URL_T1, ...en(admin), payload: { boutique: 'b', clientId: 'c', secret: 's', autre: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: URL_T1, ...en(admin), payload: { boutique: 1, clientId: 'c', secret: 's' } })).statusCode).toBe(400);
  });
});

/**
 * LES AUTOMATIONS SHOPIFY (menu « Scénario », lot 5, tâche 8) : la pause de la boutique et l'interrupteur de chaque ligne.
 * 🔴 L'ancien assistant (préparer un message, son modèle créé chez Meta) est RETIRÉ : sa route refuse avec la phrase qui
 * dit où les messages se règlent désormais, parce qu'un onglet resté sur l'ancienne console l'appelle encore.
 */
describe('les automations et l’ancien assistant', () => {
  it('🔴 l’ancien assistant refuse avec la phrase (410), sans rien créer ni journaliser', async () => {
    const { app, trace, lignes, brancher } = monter();
    brancher();
    const r = await app.inject({
      method: 'POST', url: `${URL_T1}/messages`, ...en(admin),
      payload: { evenement: 'checkout_abandoned', texte: 'Votre panier vous attend : {{checkout_url}}', langue: 'fr', delaiMinutes: 60 },
    });
    expect(r.statusCode).toBe(410);
    expect(r.json().error).toMatch(/scénarios.*Automation, section Shopify/);
    expect([trace.audit, lignes.workflows.parId.size]).toEqual([[], 0]);
  });

  it('🔴 l’interrupteur d’une ligne : allumer crée son scénario, éteindre arrête ses parcours ; chaque geste est journalisé', async () => {
    const { app, trace, lignes, brancher } = monter();
    brancher();
    const allume = await app.inject({ method: 'PUT', url: `${URL_T1}/lignes/order_paid`, ...en(admin), payload: { actif: true } });
    expect(allume.statusCode).toBe(200);
    expect(allume.json()).toMatchObject({ ligne: { evenement: 'order_paid', actif: true } });
    expect(lignes.workflows.parId.size).toBe(1);
    const eteint = await app.inject({ method: 'PUT', url: `${URL_T1}/lignes/order_paid`, ...en(admin), payload: { actif: false } });
    expect(eteint.statusCode).toBe(200);
    expect(lignes.parcours.arrets).toEqual([{ prefixe: 'shopify:b.myshopify.com:orders/paid:', motif: 'ligne éteinte' }]);
    expect(trace.audit).toEqual([
      { action: 'shopify.ligne', cible: CIBLE, detail: { evenement: 'order_paid', actif: true } },
      { action: 'shopify.ligne', cible: CIBLE, detail: { evenement: 'order_paid', actif: false } },
    ]);
  });

  it('le délai du panier se règle avec sa ligne ; un événement inconnu ou un corps hors contrat est refusé ; sans boutique, 409', async () => {
    const { app, lignes, brancher } = monter();
    expect((await app.inject({ method: 'PUT', url: `${URL_T1}/lignes/order_paid`, ...en(admin), payload: { actif: true } })).statusCode).toBe(409);
    brancher();
    expect((await app.inject({ method: 'PUT', url: `${URL_T1}/lignes/checkout_abandoned`, ...en(admin), payload: { actif: true, delaiMinutes: 30 } })).statusCode).toBe(200);
    expect(lignes.store.gestes).toEqual(['allumer:checkout_abandoned', 'delai:30']);
    const refuses: Array<[string, Record<string, unknown>]> = [
      ['inconnu', { actif: true }], ['order_paid', { actif: 'oui' }], ['order_paid', { actif: true, autre: 1 }],
      ['order_paid', { actif: true, delaiMinutes: 30 }], ['order_paid', {}],
    ];
    for (const [evenement, corps] of refuses) {
      const r = await app.inject({ method: 'PUT', url: `${URL_T1}/lignes/${evenement}`, ...en(admin), payload: corps });
      expect(r.statusCode, `${evenement} ${JSON.stringify(corps)}`).toBe(400);
    }
  });

  it('🔴 la pause arrête les parcours de la boutique ; pause et reprise sont journalisées une fois chacune', async () => {
    const { app, trace, lignes, brancher } = monter();
    brancher();
    const pause = () => app.inject({ method: 'PATCH', url: URL_T1, ...en(admin), payload: { pause: true } });
    expect((await pause()).json()).toEqual({ changee: true });
    expect((await pause()).json()).toEqual({ changee: false });
    expect(lignes.parcours.arrets).toEqual([{ prefixe: 'shopify:b.myshopify.com:', motif: 'boutique en pause' }]);
    expect((await app.inject({ method: 'PATCH', url: URL_T1, ...en(admin), payload: { pause: false } })).json()).toEqual({ changee: true });
    expect(trace.audit.map((a) => a.action)).toEqual(['shopify.pause', 'shopify.reprise']);
    expect((await app.inject({ method: 'PATCH', url: URL_T1, ...en(admin), payload: { pause: 'oui' } })).statusCode).toBe(400);
  });

  it('🔴 un agent et l’espace d’un autre client sont refusés sur la pause et l’interrupteur', async () => {
    const { app, lignes, brancher } = monter();
    brancher();
    for (const jeton of [agent, autreEspace]) {
      expect((await app.inject({ method: 'PATCH', url: URL_T1, ...en(jeton), payload: { pause: true } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'PUT', url: `${URL_T1}/lignes/order_paid`, ...en(jeton), payload: { actif: true } })).statusCode).toBe(403);
    }
    expect([lignes.store.pause, lignes.workflows.parId.size]).toEqual([false, 0]);
  });
});

describe('les réglages d’avant', () => {
  it('🔴 un onglet resté sur l’ancienne console envoie encore consentementAffirme : accepté, ignoré, absent du journal', async () => {
    const { app, trace, lignes, brancher } = monter();
    brancher();
    for (const consentementAffirme of [true, false]) {
      const regle = await app.inject({ method: 'PATCH', url: `${URL_T1}/messages/checkout_abandoned`, ...en(admin), payload: { delaiMinutes: 90, consentementAffirme } });
      expect(regle.statusCode, String(consentementAffirme)).toBe(200);
      expect(regle.json()).toEqual({});
    }
    expect(lignes.store.gestes).toEqual(['delai:90', 'delai:90']);
    expect(JSON.stringify(trace.audit)).not.toContain('consentement');
    expect(trace.audit.map((a) => a.detail)).toMatchObject([{ evenement: 'checkout_abandoned', delaiMinutes: 90 }, { evenement: 'checkout_abandoned', delaiMinutes: 90 }]);
  });

  it('l’import exige le nombre choisi, entier', async () => {
    const { app } = monter();
    expect((await app.inject({ method: 'POST', url: `${URL_T1}/clients/import`, ...en(admin), payload: { maximum: '3' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `${URL_T1}/clients/import`, ...en(admin), payload: {} })).statusCode).toBe(400);
  });
});

describe('l’attestation du consentement des clients (2026-11-20)', () => {
  it('🔴 un admin coche : l’historique reçoit la phrase de la langue demandée, sa personne, la console ; le journal le dit', async () => {
    const { app, trace, lignes, brancher } = monter();
    brancher();
    const r = await app.inject({ method: 'POST', url: `${URL_T1}/attestation`, ...en(admin), payload: { coche: true, langue: 'en' } });
    expect(r.statusCode).toBe(200);
    expect(lignes.store.attestations).toEqual([{ domaine: 'b.myshopify.com', coche: true, texte: TEXTE_ATTESTATION_SHOPIFY.en, par: 'u1', origine: 'console' }]);
    expect(r.json().attestation).toMatchObject({ coche: true });
    expect(trace.audit).toEqual([{ action: 'shopify.attestation', cible: CIBLE, detail: { coche: true } }]);
  });

  it('🔴 un agent, l’espace d’un autre client, un texte envoyé, ou sans boutique : refusé, rien d’historisé', async () => {
    const { app, lignes, brancher } = monter();
    expect((await app.inject({ method: 'POST', url: `${URL_T1}/attestation`, ...en(admin), payload: { coche: true } })).statusCode).toBe(409);
    brancher();
    expect((await app.inject({ method: 'POST', url: `${URL_T1}/attestation`, ...en(agent), payload: { coche: true } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${URL_T1}/attestation`, ...en(autreEspace), payload: { coche: true } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${URL_T1}/attestation`, ...en(admin), payload: { coche: true, texte: 'autre chose' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `${URL_T1}/attestation`, ...en(admin), payload: { coche: 'oui' } })).statusCode).toBe(400);
    expect(lignes.store.attestations).toEqual([]);
  });
});
