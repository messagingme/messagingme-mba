import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  AGE_MAX_MS, consentementCouvre, construireEvenement, type ConversionAEnvoyer, type EvenementGraph,
} from '../src/pub/conversions-meta';
import { creerClientConversions, creerTravailConversion, DELAIS_REESSAI_MS, ErreurConversions, type DepsTravailConversion } from '../src/pub/envoi';
import { creerEmetteurConversions } from '../src/pub/emission';
import { puisSignaler } from '../src/pub/declencheurs';

/**
 * LES CONVERSIONS ENVOYÉES À META (lot 2 du plan pixel). Ce que ces tests tiennent : aucune conversion sans accord, ni
 * pour un fait antérieur à l'accord ; l'empreinte de l'adresse seulement quand Google l'a prouvée ; le jeton jamais
 * dans l'adresse ; un échec passager repris, un refus définitif abandonné ; et un émetteur qui ne fait jamais échouer
 * le geste qui l'appelle.
 */

const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const FAIT = new Date('2026-11-02T10:00:00Z');

function conversion(p: Partial<ConversionAEnvoyer> = {}): ConversionAEnvoyer {
  return {
    id: '11111111-1111-4111-8111-111111111111', cle: 'numero:espace-1', evenement: 'NumeroConnecte', statut: 'a_envoyer',
    tentatives: 0, creeLe: FAIT, identityId: 'identite-1', email: ' Julien@Exemple.FR ', adresseProuvee: true,
    consentiLe: new Date('2026-11-01T09:00:00Z'), fbc: 'fb.1.1793300000000.essai', fbp: 'fb.1.1793300000000.123', navigateurAccord: 'Accord/1.0',
    valeurCentimes: null, devise: null, ip: '203.0.113.7', navigateur: 'Mozilla/5.0', ...p,
  };
}

describe('l’événement envoyé à Meta', () => {
  it('🔴 l’empreinte de l’adresse, en minuscules et sans espaces, seulement si l’adresse est prouvée', () => {
    expect(construireEvenement(conversion(), { urlConsole: 'https://console.messagingme.app' }).user_data.em)
      .toEqual([sha('julien@exemple.fr')]);
    expect(construireEvenement(conversion({ adresseProuvee: false }), { urlConsole: 'x' }).user_data.em).toBeUndefined();
  });

  it('l’identifiant externe est l’empreinte de l’identité, l’event_id la clé du fait', () => {
    const e = construireEvenement(conversion(), { urlConsole: 'https://console.messagingme.app/' });
    expect(e.user_data.external_id).toEqual([sha('identite-1')]);
    expect(e.event_id).toBe('numero:espace-1');
    expect(e.event_time).toBe(Math.floor(FAIT.getTime() / 1000));
    expect(e.action_source).toBe('website');
    expect(e.event_source_url).toBe('https://console.messagingme.app/');
    expect(e.user_data.fbc).toBe('fb.1.1793300000000.essai');
  });

  it('🔴 l’IP ne part que pour l’inscription ; le navigateur, exigé par Meta, est celui de l’inscription, sinon celui de l’accord', () => {
    const numero = construireEvenement(conversion(), { urlConsole: 'x' });
    expect(numero.user_data.client_ip_address).toBeUndefined();
    expect(numero.user_data.client_user_agent).toBe('Accord/1.0');
    expect(construireEvenement(conversion({ navigateurAccord: null }), { urlConsole: 'x' }).user_data.client_user_agent).toBeUndefined();
    const i = construireEvenement(conversion({ evenement: 'CompleteRegistration', cle: 'inscription:identite-1' }), { urlConsole: 'x' });
    expect(i.user_data.client_ip_address).toBe('203.0.113.7');
    expect(i.user_data.client_user_agent).toBe('Mozilla/5.0');
  });

  it('le Pro porte son montant en euros', () => {
    const e = construireEvenement(conversion({ evenement: 'Subscribe', cle: 'pro:espace-1', valeurCentimes: 4900, devise: 'EUR' }), { urlConsole: 'x' });
    expect(e.custom_data).toEqual({ value: 49, currency: 'EUR' });
  });

  it('🔴 l’accord couvre un fait qui le suit, jamais un fait qui le précède, jamais sans accord', () => {
    expect(consentementCouvre({ consentiLe: new Date('2026-11-01T00:00:00Z'), creeLe: FAIT })).toBe(true);
    expect(consentementCouvre({ consentiLe: FAIT, creeLe: FAIT })).toBe(true);
    expect(consentementCouvre({ consentiLe: new Date('2026-11-03T00:00:00Z'), creeLe: FAIT })).toBe(false);
    expect(consentementCouvre({ consentiLe: null, creeLe: FAIT })).toBe(false);
  });
});

describe('le client de la Conversions API', () => {
  it('🔴 le jeton part dans le corps, jamais dans l’adresse', async () => {
    const appel = vi.fn(async () => new Response('{"events_received":1}', { status: 200 }));
    await creerClientConversions({ pixelId: '123', jeton: 'jeton-secret', version: 'v25.0', fetch: appel as unknown as typeof fetch })(
      construireEvenement(conversion(), { urlConsole: 'x' }),
    );
    const [adresse, init] = appel.mock.calls[0] as unknown as [string, RequestInit];
    expect(adresse).toBe('https://graph.facebook.com/v25.0/123/events');
    expect(adresse).not.toContain('jeton-secret');
    const corps = JSON.parse(String(init.body)) as { access_token: string; data: EvenementGraph[] };
    expect(corps.access_token).toBe('jeton-secret');
    expect(corps.data).toHaveLength(1);
  });

  it('un refus de Meta remonte avec son statut et son message', async () => {
    const appel = vi.fn(async () => new Response('{"error":{"message":"Invalid parameter"}}', { status: 400 }));
    const envoyer = creerClientConversions({ pixelId: '123', jeton: 'j', version: 'v25.0', fetch: appel as unknown as typeof fetch });
    await expect(envoyer(construireEvenement(conversion(), { urlConsole: 'x' }))).rejects.toMatchObject({ status: 400, message: 'Invalid parameter' });
  });
});

function deps(c: ConversionAEnvoyer | null, p: Partial<DepsTravailConversion> = {}) {
  const d = {
    pourEnvoi: vi.fn(async () => c),
    prendre: vi.fn(async () => true),
    noterEnvoye: vi.fn(async () => {}),
    noterEchec: vi.fn(async () => {}),
    noterIgnore: vi.fn(async () => {}),
    envoyer: vi.fn(async () => {}) as DepsTravailConversion['envoyer'],
    urlConsole: 'https://console.messagingme.app',
    now: () => new Date(FAIT.getTime() + 60_000),
    ...p,
  };
  return d;
}
const job = (tentative = 0) => ({ conversionId: '11111111-1111-4111-8111-111111111111', tentative });

describe('le travail de la file conversions-meta', () => {
  it('envoie, puis note la conversion partie', async () => {
    const d = deps(conversion());
    await creerTravailConversion(d)(job());
    expect(d.envoyer).toHaveBeenCalledTimes(1);
    expect(d.noterEnvoye).toHaveBeenCalledWith(conversion().id);
  });

  it('🔴 accord retiré : rien ne part, la conversion est ignorée', async () => {
    const d = deps(conversion({ consentiLe: null }));
    await creerTravailConversion(d)(job());
    expect(d.envoyer).not.toHaveBeenCalled();
    expect(d.prendre).not.toHaveBeenCalled();
    expect(d.noterIgnore).toHaveBeenCalledWith(conversion().id, 'sans_accord');
  });

  it('🔴 accord donné après le fait : rien ne part (pas de rattrapage)', async () => {
    const d = deps(conversion({ consentiLe: new Date(FAIT.getTime() + 1000) }));
    await creerTravailConversion(d)(job());
    expect(d.envoyer).not.toHaveBeenCalled();
    expect(d.noterIgnore).toHaveBeenCalledWith(conversion().id, 'sans_accord');
  });

  it('un fait de plus de sept jours est ignoré sans appel', async () => {
    const d = deps(conversion(), { now: () => new Date(FAIT.getTime() + AGE_MAX_MS + 1000) });
    await creerTravailConversion(d)(job());
    expect(d.envoyer).not.toHaveBeenCalled();
    expect(d.noterIgnore).toHaveBeenCalledWith(conversion().id, 'trop_ancien');
  });

  it('fonction éteinte : ignorée sans appel', async () => {
    const d = deps(conversion(), { envoyer: null });
    await creerTravailConversion(d)(job());
    expect(d.noterIgnore).toHaveBeenCalledWith(conversion().id, 'eteint');
  });

  it('un échec passager est repris plus tard, puis abandonné au troisième', async () => {
    const panne = vi.fn(async () => { throw new ErreurConversions(500, 'indisponible'); });
    const d1 = deps(conversion(), { envoyer: panne });
    await creerTravailConversion(d1)(job(0));
    expect(d1.noterEchec).toHaveBeenCalledWith(conversion().id, 'meta 500 : indisponible', new Date(FAIT.getTime() + 60_000 + DELAIS_REESSAI_MS[0]!));
    const d3 = deps(conversion({ tentatives: 2 }), { envoyer: panne });
    await creerTravailConversion(d3)(job(2));
    expect(d3.noterEchec).toHaveBeenCalledWith(conversion().id, 'meta 500 : indisponible', null);
  });

  it('un refus définitif de Meta (400) est abandonné sans reprise', async () => {
    const d = deps(conversion(), { envoyer: vi.fn(async () => { throw new ErreurConversions(400, 'Invalid parameter'); }) });
    await creerTravailConversion(d)(job());
    expect(d.noterEchec).toHaveBeenCalledWith(conversion().id, 'meta 400 : Invalid parameter', null);
  });

  it('un job périmé (autre tentative, déjà partie) ne fait rien', async () => {
    const d = deps(conversion({ tentatives: 1 }));
    await creerTravailConversion(d)(job(0));
    const e = deps(conversion({ statut: 'envoye' }));
    await creerTravailConversion(e)(job(0));
    expect(d.envoyer).not.toHaveBeenCalled();
    expect(e.envoyer).not.toHaveBeenCalled();
  });
});

describe('l’émetteur', () => {
  it('🔴 réserve puis enfile, sans dépendre d’aucune configuration (le journal note chaque fait à son heure)', async () => {
    const reserver = vi.fn(async () => 'id');
    const enfiler = vi.fn(async () => {});
    await creerEmetteurConversions({ reserver, enfiler }).signaler({ evenement: 'NumeroConnecte', tenantId: 't' });
    expect(reserver).toHaveBeenCalledWith({ evenement: 'NumeroConnecte', tenantId: 't' });
    expect(enfiler).toHaveBeenCalledWith({ conversionId: 'id', tentative: 0 });
  });

  it('un fait déjà réservé n’est pas renfilé', async () => {
    const enfiler = vi.fn(async () => {});
    await creerEmetteurConversions({ reserver: async () => null, enfiler }).signaler({ evenement: 'NumeroConnecte', tenantId: 't' });
    expect(enfiler).not.toHaveBeenCalled();
  });

  it('🔴 une réservation ou une file en panne ne fait jamais échouer le geste', async () => {
    const enPanne = async (): Promise<never> => { throw new Error('base indisponible'); };
    await expect(creerEmetteurConversions({ reserver: enPanne, enfiler: async () => {} })
      .signaler({ evenement: 'NumeroConnecte', tenantId: 't' })).resolves.toBeUndefined();
    await expect(creerEmetteurConversions({ reserver: async () => 'id', enfiler: enPanne })
      .signaler({ evenement: 'NumeroConnecte', tenantId: 't' })).resolves.toBeUndefined();
  });
});

describe('le signal après un geste qui existe (NumeroConnecte)', () => {
  it('le geste d’abord, puis le signal avec les mêmes arguments, et le résultat du geste rendu', async () => {
    const ordre: string[] = [];
    const geste = puisSignaler(async (t: string, numero: string) => { ordre.push(`geste ${t} ${numero}`); return 7; }, async (t) => { ordre.push(`signal ${t}`); });
    await expect(geste('espace-1', 'pn-1')).resolves.toBe(7);
    expect(ordre).toEqual(['geste espace-1 pn-1', 'signal espace-1']);
  });

  it('🔴 un geste qui lève relève tel quel, sans signal', async () => {
    const signal = vi.fn(async () => {});
    const geste = puisSignaler(async (_t: string) => { throw new Error('Meta refuse'); }, signal);
    await expect(geste('espace-1')).rejects.toThrow('Meta refuse');
    expect(signal).not.toHaveBeenCalled();
  });
});
