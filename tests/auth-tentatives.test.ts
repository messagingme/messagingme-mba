import { describe, expect, it, vi } from 'vitest';
import { MESSAGE_PLAFOND_INDISPONIBLE } from '../src/auth/plafond-partage';
import {
  compterEssai, empreinteTentative, MESSAGE_DEFI_REQUIS, MESSAGE_TROP_DE_TENTATIVES, verifierTentative,
  type EssaiDeMotDePasse, type ReglageEssais,
} from '../src/auth/tentatives';
import { MESSAGE_DEFI_ECHOUE, type VerificateurTurnstile } from '../src/auth/turnstile';
import { memoireDesPleines, type CompteurDebit } from '../src/db/debit';
import { CompteurDebitMemoire } from '../src/db/debit.memoire';

describe('tentatives d’authentification', () => {
  it('produit une empreinte stable et bornée sans conserver l’adresse ni le jeton', () => {
    const premiere = empreinteTentative({ ip: '203.0.113.10' }, 'secret-google');
    expect(premiere).toBe(empreinteTentative({ ip: '203.0.113.10' }, 'secret-google'));
    expect(premiere).toHaveLength(64);
    expect(premiere).not.toContain('203.0.113.10');
    expect(premiere).not.toContain('secret-google');
  });

  it('distingue une limite atteinte d’un compteur indisponible', async () => {
    const consommer = vi.fn()
      .mockResolvedValueOnce({ accepte: true, indisponible: false, attenteMs: 0 })
      .mockResolvedValueOnce({ accepte: false, indisponible: false, attenteMs: 12_000 })
      .mockResolvedValueOnce({ accepte: false, indisponible: true, attenteMs: 5_000 })
      .mockResolvedValueOnce({ accepte: false, indisponible: false, attenteMs: 1_000 });
    const plafond = { consommer };

    expect(await verifierTentative(plafond, 'cle')).toEqual({ acceptee: true });
    expect(await verifierTentative(plafond, 'cle')).toEqual({
      acceptee: false,
      attenteMs: 12_000,
      message: 'trop de tentatives, réessaie plus tard',
    });
    expect(await verifierTentative(plafond, 'cle')).toEqual({
      acceptee: false,
      attenteMs: 5_000,
      message: MESSAGE_PLAFOND_INDISPONIBLE,
    });
    // Un plafond qui a son propre message (les liens de réinitialisation) le garde, sauf base muette.
    expect(await verifierTentative(plafond, 'cle', 'message propre')).toEqual({ acceptee: false, attenteMs: 1_000, message: 'message propre' });
  });
});

/**
 * LES ESSAIS DE MOT DE PASSE (lot E de l'audit) : le réseau du client et l'adresse, plus le filet de l'adresse, puis le
 * défi quand le filet est plein. Le compteur en mémoire suit les règles de la base (toutes les fenêtres ou aucune).
 */
describe('compterEssai', () => {
  const reglage: ReglageEssais = { parReseau: { max: 2, dureeMs: 60_000 }, parAdresse: { max: 3, dureeMs: 600_000 } };
  const essai = (reseau: string, jeton = ''): EssaiDeMotDePasse => ({ reseau, adresse: 'a@b.co', jeton, ip: reseau });
  const defi = () => ({ verifier: vi.fn(async (jeton: string, _ip: string | null) => jeton === 'bon') });

  it('accepte tant que les deux fenêtres ont de la place', async () => {
    const c = new CompteurDebitMemoire();
    expect(await compterEssai(c, reglage, essai('198.51.100.1'), undefined)).toEqual({ verdict: 'accepte' });
    expect(await compterEssai(c, reglage, essai('198.51.100.1'), undefined)).toEqual({ verdict: 'accepte' });
  });

  it('🔴 un réseau qui insiste est refusé, et ses refus ne remplissent pas le filet (toutes les fenêtres ou aucune)', async () => {
    const c = new CompteurDebitMemoire();
    const t = defi();
    const verdicts = [];
    for (let i = 0; i < 6; i++) verdicts.push((await compterEssai(c, reglage, essai('198.51.100.1'), t)).verdict);
    expect(verdicts).toEqual(['accepte', 'accepte', 'refuse', 'refuse', 'refuse', 'refuse']);
    // Le filet n'a compté que les deux essais acceptés : un autre réseau passe encore une fois, puis le défi.
    expect((await compterEssai(c, reglage, essai('203.0.113.9'), t)).verdict).toBe('accepte');
    expect(await compterEssai(c, reglage, essai('203.0.113.9'), t)).toEqual({ verdict: 'defi', message: MESSAGE_DEFI_REQUIS });
    expect(t.verifier).not.toHaveBeenCalled();
  });

  it('le refus d’un réseau dit son attente et le message d’avant le lot', async () => {
    const c = new CompteurDebitMemoire();
    await compterEssai(c, reglage, essai('198.51.100.1'), undefined);
    await compterEssai(c, reglage, essai('198.51.100.1'), undefined);
    const v = await compterEssai(c, reglage, essai('198.51.100.1'), undefined);
    expect(v).toMatchObject({ verdict: 'refuse', message: MESSAGE_TROP_DE_TENTATIVES });
    expect(v.verdict === 'refuse' && v.attenteMs > 0 && v.attenteMs <= 60_000).toBe(true);
  });

  /** Remplit le filet (3) depuis trois réseaux distincts. */
  async function filetPlein(c: CompteurDebit, t?: VerificateurTurnstile): Promise<void> {
    for (const r of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
      expect((await compterEssai(c, reglage, essai(r), t)).verdict).toBe('accepte');
    }
  }

  it('filet plein sans vérificateur (clé secrète absente) : refus, sur l’attente du filet', async () => {
    const c = new CompteurDebitMemoire();
    await filetPlein(c);
    const v = await compterEssai(c, reglage, essai('203.0.113.9', 'bon'), undefined);
    expect(v).toMatchObject({ verdict: 'refuse', message: MESSAGE_TROP_DE_TENTATIVES });
    expect(v.verdict === 'refuse' && v.attenteMs > 60_000).toBe(true);
  });

  it('🔴 filet plein : sans jeton, le défi, sans rien compter ; le jeton valable passe, le faux non', async () => {
    const c = new CompteurDebitMemoire();
    const t = defi();
    await filetPlein(c, t);
    // Sans jeton : le défi, autant de fois qu'on veut, sans entamer le plafond du réseau.
    for (let i = 0; i < 5; i++) expect((await compterEssai(c, reglage, essai('203.0.113.9'), t)).verdict).toBe('defi');
    expect(t.verifier).not.toHaveBeenCalled();
    expect(await compterEssai(c, reglage, essai('203.0.113.9', 'faux'), t)).toEqual({ verdict: 'defi', message: MESSAGE_DEFI_ECHOUE });
    expect(await compterEssai(c, reglage, essai('203.0.113.9', 'bon'), t)).toEqual({ verdict: 'accepte' });
    expect(t.verifier).toHaveBeenCalledTimes(2);
    expect(t.verifier).toHaveBeenLastCalledWith('bon', '203.0.113.9');
  });

  it('🔴 filet plein : le réseau se compte AVANT Cloudflare, une rafale de faux jetons reste bornée par lui', async () => {
    const c = new CompteurDebitMemoire();
    const t = defi();
    await filetPlein(c, t);
    const verdicts = [];
    for (let i = 0; i < 6; i++) verdicts.push((await compterEssai(c, reglage, essai('203.0.113.9', 'faux'), t)).verdict);
    expect(verdicts).toEqual(['defi', 'defi', 'refuse', 'refuse', 'refuse', 'refuse']);
    expect(t.verifier).toHaveBeenCalledTimes(2);
    // Un réseau à bout de son plafond reçoit le refus, pas un défi qu'il résoudrait pour rien.
    expect((await compterEssai(c, reglage, essai('203.0.113.9'), t)).verdict).toBe('refuse');
  });

  it('le jeton n’est pas vérifié tant que le filet a de la place', async () => {
    const c = new CompteurDebitMemoire();
    const t = defi();
    expect((await compterEssai(c, reglage, essai('198.51.100.1', 'faux'), t)).verdict).toBe('accepte');
    expect(t.verifier).not.toHaveBeenCalled();
  });

  it('le filet plein reste un défi quand la copie le sait plein de mémoire (`memoireDesPleines`)', async () => {
    const c = memoireDesPleines(new CompteurDebitMemoire());
    const t = defi();
    await filetPlein(c, t);
    expect((await compterEssai(c, reglage, essai('203.0.113.9'), t)).verdict).toBe('defi');
    // La mémoire a retenu le filet plein : l'appel suivant ne va plus en base, et le verdict ne change pas.
    expect((await compterEssai(c, reglage, essai('203.0.113.10'), t)).verdict).toBe('defi');
    expect(await compterEssai(c, reglage, essai('203.0.113.10', 'bon'), t)).toEqual({ verdict: 'accepte' });
  });

  it('🔴 base muette : refus, au premier comptage comme à celui du défi', async () => {
    const enPanne: CompteurDebit = { compter: async () => { throw new Error('base muette'); }, lister: async () => [] };
    expect(await compterEssai(enPanne, reglage, essai('198.51.100.1'), defi())).toEqual({
      verdict: 'refuse', attenteMs: 5_000, message: MESSAGE_PLAFOND_INDISPONIBLE,
    });
    // Le filet est plein, puis la base tombe au comptage du réseau qui précède Cloudflare.
    const c = new CompteurDebitMemoire();
    const t = defi();
    await filetPlein(c, t);
    let appels = 0;
    const panneAuSecond: CompteurDebit = {
      compter: async (f) => { appels += 1; if (appels === 2) throw new Error('base muette'); return c.compter(f); },
      lister: async () => [],
    };
    expect(await compterEssai(panneAuSecond, reglage, essai('203.0.113.9', 'bon'), t)).toEqual({
      verdict: 'refuse', attenteMs: 5_000, message: MESSAGE_PLAFOND_INDISPONIBLE,
    });
    expect(t.verifier).not.toHaveBeenCalled();
  });

  it('une fenêtre à 0 est retirée (la convention du dépôt), les deux à 0 acceptent tout', async () => {
    const c = new CompteurDebitMemoire();
    const sansFilet: ReglageEssais = { parReseau: { max: 1, dureeMs: 60_000 }, parAdresse: { max: 0, dureeMs: 600_000 } };
    expect((await compterEssai(c, sansFilet, essai('198.51.100.1'), defi())).verdict).toBe('accepte');
    expect((await compterEssai(c, sansFilet, essai('198.51.100.1'), defi())).verdict).toBe('refuse');
    const rien: ReglageEssais = { parReseau: { max: 0, dureeMs: 60_000 }, parAdresse: { max: 0, dureeMs: 600_000 } };
    for (let i = 0; i < 5; i++) expect((await compterEssai(c, rien, essai('198.51.100.1'), undefined)).verdict).toBe('accepte');
  });
});
