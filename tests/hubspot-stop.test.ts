import { describe, it, expect } from 'vitest';
import {
  annoncerAussiAHubspot,
  creerAnnonceHubspotStop,
  creerTravailHubspotStop,
  echeanceDuLotStop,
  lotsHubspotStop,
  stopPourAnalyse,
  TAILLE_LOT_HUBSPOT_STOP,
  type ConsentementDeFiche,
  type JobHubspotStop,
} from '../src/crm/hubspot-stop';
import { HubspotServiceError, poserStopHubspot, ReconsentRequiredError } from '../src/crm/hubspot-service';
import type { HttpTransport, HttpResponse } from '../src/meta/http';

/**
 * LE DÉSABONNEMENT WHATSAPP VERS HUBSPOT (plan `docs/superpowers/plans/2026-11-12-stop-vers-hubspot.md`) : l'annonce
 * qui ne lève jamais, le travail qui relit l'état et le pose, la case que porte l'analyse, et l'appel au connecteur.
 */

const T = 't1';

describe('les lots et leur échéance', () => {
  it('dédupliqués, sans vide, découpés sans rien perdre', () => {
    const waIds = Array.from({ length: TAILLE_LOT_HUBSPOT_STOP + 3 }, (_, i) => `3360000${String(i).padStart(4, '0')}`);
    const lots = lotsHubspotStop([...waIds, waIds[0]!, ' ', '']);
    expect(lots.map((l) => l.length)).toEqual([TAILLE_LOT_HUBSPOT_STOP, 3]);
    expect(lots.flat()).toEqual(waIds);
  });

  it('🔴 l’échéance d’un lot couvre une attente du connecteur par fiche (45 s), plus une minute', () => {
    expect(echeanceDuLotStop(TAILLE_LOT_HUBSPOT_STOP)).toBe(20 * 45 + 60);
  });
});

describe('l’annonce ne lève jamais', () => {
  it('enfile un job par lot, avec son échéance', async () => {
    const enfiles: Array<{ job: JobHubspotStop; expire: number }> = [];
    await creerAnnonceHubspotStop({ enfiler: async (job, o) => { enfiles.push({ job, expire: o.expireInSeconds }); } })(T, ['33600000001', '33600000001']);
    expect(enfiles).toEqual([{ job: { tenantId: T, waIds: ['33600000001'] }, expire: echeanceDuLotStop(1) }]);
  });

  it('🔴 une file en panne est journalisée, pas propagée', async () => {
    const logs: string[] = [];
    const annonce = creerAnnonceHubspotStop({ enfiler: async () => { throw new Error('file'); }, log: (m) => logs.push(m) });
    await expect(annonce(T, ['33600000001'])).resolves.toBeUndefined();
    expect(logs).toHaveLength(1);
  });

  it('🔴 ajoutée à l’annonce d’un refus, elle part même si la première échoue', async () => {
    const hubspot: string[][] = [];
    const combinee = annoncerAussiAHubspot(async () => { throw new Error('signaux'); }, async (_t, w) => { hubspot.push([...w]); });
    await expect(combinee(T, ['33600000001'])).rejects.toThrow('signaux');
    expect(hubspot).toEqual([['33600000001']]);
  });
});

describe('le travail relit l’état et le pose', () => {
  type Appel = { e164: string; valeur: boolean; date: string | null };
  function banc(o: {
    actif?: boolean;
    fiches?: Record<string, ConsentementDeFiche | null>;
    issue?: (waId: string) => 'ecrit' | 'contact_inconnu' | 'non_relie';
    echec?: Error;
    /** Le seul numéro dont l'appel échoue, à chaque tentative (un numéro porté par cent fiches, par exemple). */
    echecPour?: string;
  } = {}) {
    const appels: Appel[] = [];
    const lus: string[] = [];
    const logs: string[] = [];
    const travail = creerTravailHubspotStop({
      actif: async () => o.actif ?? true,
      consentement: async (_t, waId) => { lus.push(waId); return o.fiches?.[waId] ?? null; },
      poser: async (_t, e164, valeur, date) => {
        appels.push({ e164, valeur, date });
        if (o.echec) throw o.echec;
        if (o.echecPour === e164) throw new HubspotServiceError(503, 'echeance_depassee', true);
        return o.issue?.(e164) ?? 'ecrit';
      },
      log: (m) => logs.push(m),
    });
    return { travail, appels, lus, logs };
  }
  const desabonne: ConsentementDeFiche = { phoneE164: '+33600000001', desabonne: true, optOutAt: '2026-11-12T09:30:00.000Z' };
  const abonne: ConsentementDeFiche = { phoneE164: '+33600000002', desabonne: false, optOutAt: null };

  it('🔴 un désabonné : la case cochée avec la date du refus ; un abonné : décochée, sans date', async () => {
    const b = banc({ fiches: { '33600000001': desabonne, '33600000002': abonne } });
    await b.travail({ tenantId: T, waIds: ['33600000001', '33600000002'] });
    expect(b.appels).toEqual([
      { e164: '+33600000001', valeur: true, date: '2026-11-12T09:30:00.000Z' },
      { e164: '+33600000002', valeur: false, date: null },
    ]);
  });

  it('🔴 réglage éteint : rien n’est lu ni posé', async () => {
    const b = banc({ actif: false, fiches: { '33600000001': desabonne } });
    await b.travail({ tenantId: T, waIds: ['33600000001'] });
    expect([b.lus, b.appels]).toEqual([[], []]);
  });

  it('une fiche disparue, ou connue par son seul BSUID, est passée ; les autres sont posées', async () => {
    const b = banc({ fiches: { bsuid: { phoneE164: null, desabonne: true, optOutAt: null }, '33600000002': abonne } });
    await b.travail({ tenantId: T, waIds: ['disparue', 'bsuid', '33600000002'] });
    expect(b.appels.map((a) => a.e164)).toEqual(['+33600000002']);
  });

  it('aucun portail relié : le reste du lot n’est pas tenté', async () => {
    const b = banc({ fiches: { '33600000001': desabonne, '33600000002': abonne }, issue: () => 'non_relie' });
    await b.travail({ tenantId: T, waIds: ['33600000001', '33600000002'] });
    expect(b.appels).toHaveLength(1);
  });

  it('🔴 un portail à re-consentir est journalisé et laissé (le rejouer ne le réparerait pas) ; toute autre panne lève', async () => {
    const reconsent = banc({ fiches: { '33600000001': desabonne }, echec: new ReconsentRequiredError(undefined) });
    await expect(reconsent.travail({ tenantId: T, waIds: ['33600000001'] })).resolves.toBeUndefined();
    expect(reconsent.logs).toHaveLength(1);
    const panne = banc({ fiches: { '33600000001': desabonne }, echec: new HubspotServiceError(503, undefined, true) });
    await expect(panne.travail({ tenantId: T, waIds: ['33600000001'] })).rejects.toThrow();
  });

  it('🔴 un numéro qui échoue à chaque appel ne prive pas les suivants de leur case : le lot les pose tous, puis lève', async () => {
    const b = banc({ fiches: { '33600000001': desabonne, '33600000002': abonne }, echecPour: '+33600000001' });
    const err = await b.travail({ tenantId: T, waIds: ['33600000001', '33600000002'] }).then(() => null, (e: unknown) => e);
    expect(b.appels.map((a) => a.e164)).toEqual(['+33600000001', '+33600000002']);
    expect(String(err)).toContain('1 etat(s) non pose(s) sur 2');
  });

  it('un numéro hors E.164 est écarté d’emblée : le connecteur le refuserait à chaque fois', async () => {
    const b = banc({ fiches: { '0611': { phoneE164: '0611223344', desabonne: true, optOutAt: null }, '33600000002': abonne } });
    await b.travail({ tenantId: T, waIds: ['0611', '33600000002'] });
    expect(b.appels.map((a) => a.e164)).toEqual(['+33600000002']);
  });

  it('un payload invalide lève (DLQ), un lot vide ne fait rien', async () => {
    const b = banc();
    await expect(b.travail({ waIds: [] })).rejects.toThrow('payload invalide');
    await b.travail({ tenantId: T, waIds: [] });
    expect(b.appels).toEqual([]);
  });
});

describe('la case que porte l’analyse : « désabonné » seulement', () => {
  function stop(o: { actif?: boolean; fiche?: ConsentementDeFiche | null }) {
    const lus: string[] = [];
    const f = stopPourAnalyse({
      actif: async () => o.actif ?? true,
      consentement: async (_t, waId) => { lus.push(waId); return o.fiche ?? null; },
    });
    return { f, lus };
  }

  it('🔴 un désabonné : la date du refus (lu par son wa_id, sans le +) ; sans date : la case seule', async () => {
    const avec = stop({ fiche: { phoneE164: '+33600000001', desabonne: true, optOutAt: '2026-11-12T09:30:00.000Z' } });
    expect(await avec.f(T, '+33600000001')).toEqual({ date: '2026-11-12T09:30:00.000Z' });
    expect(avec.lus).toEqual(['33600000001']);
    expect(await stop({ fiche: { phoneE164: '+33600000001', desabonne: true, optOutAt: null } }).f(T, '+33600000001')).toEqual({});
  });

  it('🔴 jamais « réabonné », ni réglage éteint, ni contact connu par son seul BSUID (le flag ne pourrait pas décocher)', async () => {
    expect(await stop({ fiche: { phoneE164: '+33600000001', desabonne: false, optOutAt: null } }).f(T, '+33600000001')).toBeNull();
    expect(await stop({ actif: false, fiche: { phoneE164: '+33600000001', desabonne: true, optOutAt: null } }).f(T, '+33600000001')).toBeNull();
    const bsuid = stop({ fiche: { phoneE164: null, desabonne: true, optOutAt: null } });
    expect(await bsuid.f(T, 'US.13491208655302741918')).toBeNull();
    expect(bsuid.lus).toEqual([]);
  });
});

describe('poserStopHubspot : l’appel au connecteur', () => {
  class FauxConnecteur implements HttpTransport {
    readonly posts: Array<{ url: string; body: unknown }> = [];
    constructor(private readonly reponse: HttpResponse) {}
    async post(url: string, body: unknown): Promise<HttpResponse> {
      this.posts.push({ url, body });
      return this.reponse;
    }
  }
  const deps = (t: HttpTransport) => ({ baseUrl: 'http://connecteur', secret: 'svc-secret', transport: t });

  it('🔴 le corps : la date seulement pour un désabonnement qui en a une ; la réponse lue', async () => {
    const t = new FauxConnecteur({ status: 200, json: { issue: 'ecrit', fiches: 2 } });
    expect(await poserStopHubspot(deps(t), T, '+33600000001', true, '2026-11-12T09:30:00.000Z')).toBe('ecrit');
    expect(await poserStopHubspot(deps(t), T, '+33600000001', true, null)).toBe('ecrit');
    expect(await poserStopHubspot(deps(t), T, '+33600000001', false, '2026-11-12T09:30:00.000Z')).toBe('ecrit');
    expect(t.posts.map((p) => p.body)).toEqual([
      { tenantId: T, e164: '+33600000001', flag: 'stop', valeur: true, date: '2026-11-12T09:30:00.000Z' },
      { tenantId: T, e164: '+33600000001', flag: 'stop', valeur: true },
      { tenantId: T, e164: '+33600000001', flag: 'stop', valeur: false },
    ]);
    expect(t.posts[0]!.url).toBe('http://connecteur/service/contact-flag');
  });

  it('aucune fiche : `contact_inconnu` ; aucun portail relié (404) : `non_relie`', async () => {
    expect(await poserStopHubspot(deps(new FauxConnecteur({ status: 200, json: { issue: 'contact_inconnu' } })), T, '+33600000001', true, null)).toBe('contact_inconnu');
    expect(await poserStopHubspot(deps(new FauxConnecteur({ status: 404, json: { error: 'tenant_not_connected' } })), T, '+33600000001', true, null)).toBe('non_relie');
  });

  it('🔴 un seul essai : une panne lève sans relance (la file rejoue) ; une réponse illisible lève ; un re-consentement aussi', async () => {
    const panne = new FauxConnecteur({ status: 503, json: { error: 'echeance_depassee' } });
    await expect(poserStopHubspot(deps(panne), T, '+33600000001', true, null)).rejects.toBeInstanceOf(HubspotServiceError);
    expect(panne.posts).toHaveLength(1);
    await expect(poserStopHubspot(deps(new FauxConnecteur({ status: 200, json: { issue: 'refuse' } })), T, '+33600000001', true, null))
      .rejects.toBeInstanceOf(HubspotServiceError);
    await expect(poserStopHubspot(deps(new FauxConnecteur({ status: 409, json: { error: 'reconsent_required' } })), T, '+33600000001', true, null))
      .rejects.toBeInstanceOf(ReconsentRequiredError);
  });
});
