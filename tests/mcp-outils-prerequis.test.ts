import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

// Le contexte joint au Support vient de la lecture de mise en service : ici, une lecture connue, pour le reconnaître.
vi.mock('../src/mcp/mise-en-service', async (orig) => ({
  ...(await orig<typeof import('../src/mcp/mise-en-service')>()),
  lireMiseEnService: vi.fn(async () => ({ offre: 'pro', etape_suivante: 'pret' })),
}));

import { MESSAGE_SUPPORT_MAX, OUTILS, SUJET_SUPPORT_MAX, outilsPour, type DepsMcp, type PersonneMcp } from '../src/mcp/outils';
import { MESSAGE_MAX, SUBJECT_MAX } from '../src/http/support';
import { CompteChez360dialog } from '../src/meta/credentials';

/**
 * LES PRÉREQUIS D'UNE MISE EN SERVICE (lot 1 du CSM virtuel, B7) : l'état du compte, le code et l'activation du numéro,
 * le Support. Chaque outil appelle le service de la console par ses dépendances ; ici, ce qu'il en fait : les droits,
 * les arguments transmis, la trace, les refus. Le câblage réel, en bas : la console et le MCP reçoivent les mêmes objets.
 */
const TENANT = '00000000-0000-4000-8000-0000000000b7';
const NOMS = ['get_account_status', 'request_number_code', 'activate_number', 'contact_support'];
const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
const personne = (userId: string): PersonneMcp => ({ userId, autorisationId: 'aut-1' });

function monter(o: { supportActif?: boolean; prioritaire?: boolean } = {}) {
  const journal = vi.fn(async () => {});
  const prerequis = {
    etatDuCompte: vi.fn(async () => ({ hasNumber: true, quality: 'GREEN', status: { dot: 'green', label: 'Opérationnel', reason: '' } })),
    demanderCode: vi.fn(async (_t: string, methode: 'VOICE' | 'SMS') => ({ ok: true as const, methode })),
    activer: vi.fn(async (_t: string, _code: string | undefined, tracer: (t: never) => Promise<void>) => {
      await tracer({ action: 'numero.active', phoneNumberId: 'pn-1', verificationFaite: true } as never);
      return { ok: true as const };
    }),
    support: {
      enabled: o.supportActif ?? true,
      sendSupport: vi.fn(async (_envoi: unknown) => {}),
      getUserEmail: vi.fn(async (userId: string) => `${userId}@exemple.fr`),
      prioritaire: vi.fn(async () => o.prioritaire ?? false),
    },
  };
  const couteux = { consommer: vi.fn(async () => ({ accepte: true as const, attenteMs: 0 })) };
  const deps = { prerequis, couteux, journal } as unknown as DepsMcp;
  return { deps, prerequis, couteux, journal };
}

describe('les prérequis d’une mise en service (CSM, B7)', () => {
  it('🔴 les quatre exigent une personne, dans toutes les offres : la console réserve l’Accueil aux admins, les trois autres écrivent', () => {
    expect(outil('get_account_status')).toMatchObject({ scope: 'mcp:read', exigePersonne: true, fonction: null });
    for (const nom of ['request_number_code', 'activate_number', 'contact_support']) {
      expect(outil(nom), nom).toMatchObject({ scope: 'mcp:write', exigePersonne: true, fonction: null });
      expect(outil(nom).ecran?.({}, {}), nom).toBe('/accueil');
    }
    const parCle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null } as never).map((x) => x.nom);
    for (const nom of NOMS) expect(parCle, nom).not.toContain(nom);
  });

  it('l’état du compte est la lecture de l’Accueil, telle quelle', async () => {
    const { deps, prerequis } = monter();
    expect(await outil('get_account_status').executer(deps, TENANT, {}, personne('u0'))).toMatchObject({ hasNumber: true, quality: 'GREEN' });
    expect(prerequis.etatDuCompte).toHaveBeenCalledWith(TENANT);
  });

  it('le code : l’appel vocal par défaut, le SMS au choix, rien d’autre ; la limite des opérations lourdes AVANT Meta ; les refus dits', async () => {
    const { deps, prerequis, couteux } = monter();
    expect(await outil('request_number_code').executer(deps, TENANT, {}, personne('u1'))).toMatchObject({ envoye: true, methode: 'VOICE' });
    expect(await outil('request_number_code').executer(deps, TENANT, { methode: 'SMS' }, personne('u1'))).toMatchObject({ methode: 'SMS' });
    expect(couteux.consommer).toHaveBeenCalledTimes(2);
    await expect(outil('request_number_code').executer(deps, TENANT, { methode: 'WHATSAPP' }, personne('u1'))).rejects.toMatchObject({ code: 'invalid_args' });
    expect(prerequis.demanderCode).toHaveBeenCalledTimes(2);
    prerequis.demanderCode.mockResolvedValueOnce({ ok: false, statut: 409, error: 'numéro déjà vérifié' } as never);
    await expect(outil('request_number_code').executer(deps, TENANT, {}, personne('u1'))).rejects.toMatchObject({ code: 'conflict', message: 'numéro déjà vérifié' });
    expect(prerequis.demanderCode).toHaveBeenCalledTimes(3);
    // 🔴 La limite refuse AVANT d'appeler Meta : chaque demande qui y part entame le quota de dix par 72 heures.
    couteux.consommer.mockResolvedValueOnce({ accepte: false, attenteMs: 30_000 } as never);
    await expect(outil('request_number_code').executer(deps, TENANT, {}, personne('u1'))).rejects.toMatchObject({ code: 'rate_limited' });
    expect(prerequis.demanderCode).toHaveBeenCalledTimes(3);
    // La minute entre deux codes : le délai, en chiffre.
    prerequis.demanderCode.mockResolvedValueOnce({ ok: false, statut: 429, error: 'un code vient d’être envoyé' } as never);
    await expect(outil('request_number_code').executer(deps, TENANT, {}, personne('u1')))
      .rejects.toMatchObject({ code: 'rate_limited', precisions: { reessayerDansS: 60 } });
    // Un numéro relié par 360dialog : le refus lisible de la console, pas une panne.
    prerequis.demanderCode.mockRejectedValueOnce(new CompteChez360dialog('waba-1'));
    await expect(outil('request_number_code').executer(deps, TENANT, {}, personne('u1')))
      .rejects.toMatchObject({ code: 'conflict', message: 'Cette fonction n’est pas disponible pour un numéro relié par 360dialog.' });
  });

  it('🔴 l’activation : le code transmis, la trace « numero.active » au nom de la personne, la limite avant Meta', async () => {
    const { deps, prerequis, couteux, journal } = monter();
    expect(await outil('activate_number').executer(deps, TENANT, { code: ' 123456 ' }, personne('u2'))).toEqual({ actif: true });
    expect(prerequis.activer).toHaveBeenCalledWith(TENANT, '123456', expect.any(Function));
    expect(journal).toHaveBeenCalledWith(TENANT, { userId: 'u2', email: null }, 'numero.active', { kind: 'phone_number', id: 'pn-1' }, {
      verificationFaite: true, via: 'mcp',
    });
    await outil('activate_number').executer(deps, TENANT, {}, personne('u2'));
    expect(prerequis.activer).toHaveBeenLastCalledWith(TENANT, undefined, expect.any(Function));
    prerequis.activer.mockResolvedValueOnce({ ok: false, statut: 422, error: 'code refusé par Meta' } as never);
    await expect(outil('activate_number').executer(deps, TENANT, { code: '000000' }, personne('u2'))).rejects.toMatchObject({ message: 'code refusé par Meta' });
    expect(prerequis.activer).toHaveBeenCalledTimes(3);
    couteux.consommer.mockResolvedValueOnce({ accepte: false, attenteMs: 5_000 } as never);
    await expect(outil('activate_number').executer(deps, TENANT, { code: '123456' }, personne('u2'))).rejects.toMatchObject({ code: 'rate_limited' });
    expect(prerequis.activer).toHaveBeenCalledTimes(3);
    prerequis.activer.mockRejectedValueOnce(new CompteChez360dialog('waba-1'));
    await expect(outil('activate_number').executer(deps, TENANT, { code: '123456' }, personne('u2'))).rejects.toMatchObject({ code: 'conflict' });
  });

  it('🔴 le Support : la réponse à l’adresse du compte, le contexte joint par le serveur, le sujet prioritaire d’un Business', async () => {
    const { deps, prerequis } = monter({ prioritaire: true });
    const r = await outil('contact_support').executer(deps, TENANT, { sujet: 'Numéro bloqué', message: 'Meta refuse le numéro.' }, personne('u3'));
    expect(r).toEqual({ envoye: true, reponse_a: 'u3@exemple.fr' });
    expect(prerequis.support.getUserEmail).toHaveBeenCalledWith('u3');
    const envoi = prerequis.support.sendSupport.mock.calls[0]![0] as { subject: string; message: string; email: string | null; userId: string };
    expect(envoi).toMatchObject({ subject: '[Prioritaire, Business] Numéro bloqué', email: 'u3@exemple.fr', userId: 'u3' });
    expect(envoi.message).toContain('Meta refuse le numéro.');
    expect(envoi.message).toContain('"offre": "pro"');
  });

  it('le Support : indisponible sans configuration, cinq demandes par minute et par personne, les bornes du formulaire de la console', async () => {
    await expect(outil('contact_support').executer(monter({ supportActif: false }).deps, TENANT, { sujet: 's', message: 'm' }, personne('u4')))
      .rejects.toMatchObject({ code: 'unavailable' });
    const { deps } = monter();
    for (let i = 0; i < 5; i += 1) await outil('contact_support').executer(deps, TENANT, { sujet: 's', message: 'm' }, personne('u5'));
    await expect(outil('contact_support').executer(deps, TENANT, { sujet: 's', message: 'm' }, personne('u5'))).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(outil('contact_support').executer(deps, TENANT, { sujet: 'x'.repeat(SUBJECT_MAX + 1), message: 'm' }, personne('u6')))
      .rejects.toMatchObject({ code: 'invalid_args' });
    expect([SUJET_SUPPORT_MAX, MESSAGE_SUPPORT_MAX]).toEqual([SUBJECT_MAX, MESSAGE_MAX]);
    expect(outil('contact_support').entree.properties).toMatchObject({ sujet: { maxLength: SUBJECT_MAX }, message: { maxLength: MESSAGE_MAX } });
  });

  it('le Support : un envoi en panne est journalisé avant d’être masqué, comme par la route', async () => {
    const { deps, prerequis } = monter();
    prerequis.support.sendSupport.mockRejectedValueOnce(new Error('Resend en panne'));
    const ecrit = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(outil('contact_support').executer(deps, TENANT, { sujet: 's', message: 'm' }, personne('u7'))).rejects.toMatchObject({ code: 'unavailable' });
      const lignes = ecrit.mock.calls.map((c) => String(c[0]));
      expect(lignes.some((l) => l.includes('support_send_failed') && l.includes('Resend en panne') && l.includes(TENANT))).toBe(true);
    } finally {
      ecrit.mockRestore();
    }
  });
});

/**
 * 🔴 LE CÂBLAGE RÉEL (`src/index.ts`). Les tests ci-dessus montent de faux services : si le MCP recevait d'autres objets
 * que les routes (un second `verrous`, d'autres dépendances du Support), toute la suite passerait, et le quota de Meta ou
 * le plafond ne seraient plus partagés avec la console. Ce test lit les quatre lignes.
 */
describe('🔴 le câblage : la console et le MCP reçoivent les mêmes dépendances', () => {
  it('src/index.ts passe aux outils les constantes que reçoivent les routes', () => {
    const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(index).toMatch(new RegExp([
      'prerequis: \\{',
      'etatDuCompte: \\(tenant\\) => lireEtatDuCompte\\(depsAccount, tenant\\),',
      'demanderCode: \\(tenant, methode\\) => demanderCodeNumero\\(depsEmbeddedSignup, \\{ tenantId: tenant, methode \\}\\),',
      'activer: \\(tenant, code, tracer\\) => activerNumero\\(depsEmbeddedSignup, \\{ tenantId: tenant, \\.\\.\\.\\(code === undefined \\? \\{\\} : \\{ code \\}\\) \\}, tracer\\),',
      'support: depsSupport,',
      '\\},',
    ].join('\\s*')));
    expect(index).toContain('embeddedSignup: depsEmbeddedSignup,');
    expect(index).toContain('account: depsAccount,');
    expect(index.split('support: depsSupport,').length - 1).toBe(2);
  });
});
