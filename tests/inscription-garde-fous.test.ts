import { describe, it, expect, vi, afterEach } from 'vitest';
import { creerVerificateurTurnstile, LONGUEUR_MAX_JETON_TURNSTILE, URL_TURNSTILE } from '../src/auth/turnstile';
import { creerSuiviRetoursInscription, SEUIL_RETOURS_INSCRIPTION_PAR_JOUR } from '../src/auth/retours-inscription';
import { emailInscription, lienInscription } from '../src/auth/email-inscription';
import { renderBrandedEmail } from '../src/support/email-templates';
import { CompteurDebitMemoire } from '../src/db/debit.memoire';
import type { CompteurDebit } from '../src/db/debit';

/** Les pièces du lot identité B autour de la route : le défi, le suivi des retours, l'e-mail et son gabarit. */
afterEach(() => { vi.restoreAllMocks(); });

describe('🔴 la vérification Turnstile échoue FERMÉ', () => {
  const reponse = (ok: boolean, corps: unknown) => async () => ({ ok, json: async () => corps });

  it('un jeton valide passe ; refusé, illisible, en erreur HTTP, en panne : refusé', async () => {
    const appels: Array<{ url: string; corps: string }> = [];
    const espion = (rep: () => Promise<{ ok: boolean; json(): Promise<unknown> }>) => async (url: string, init: { body: URLSearchParams }) => {
      appels.push({ url, corps: init.body.toString() });
      return rep();
    };
    expect(await creerVerificateurTurnstile('secret', espion(reponse(true, { success: true }))).verifier('jeton', '203.0.113.7')).toBe(true);
    expect(appels[0]).toEqual({ url: URL_TURNSTILE, corps: 'secret=secret&response=jeton&remoteip=203.0.113.7' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await creerVerificateurTurnstile('secret', espion(reponse(true, { success: false }))).verifier('jeton', null)).toBe(false);
    expect(await creerVerificateurTurnstile('secret', espion(reponse(true, { autre: 1 }))).verifier('jeton', null)).toBe(false);
    expect(await creerVerificateurTurnstile('secret', espion(reponse(false, { success: true }))).verifier('jeton', null)).toBe(false);
    expect(await creerVerificateurTurnstile('secret', async () => { throw new Error('réseau'); }).verifier('jeton', null)).toBe(false);
  });

  it('un jeton vide ou trop long ne part même pas chez Cloudflare', async () => {
    const fetchImpl = vi.fn();
    const v = creerVerificateurTurnstile('secret', fetchImpl);
    expect(await v.verifier('', null)).toBe(false);
    expect(await v.verifier('x'.repeat(LONGUEUR_MAX_JETON_TURNSTILE + 1), null)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('les rebonds et plaintes des liens d’inscription', () => {
  it(`une alerte, une seule fois, au ${SEUIL_RETOURS_INSCRIPTION_PAR_JOUR}e retour du jour`, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const alertes: string[] = [];
    const noter = creerSuiviRetoursInscription(new CompteurDebitMemoire(), async (t) => { alertes.push(t); });
    for (let i = 0; i < SEUIL_RETOURS_INSCRIPTION_PAR_JOUR - 1; i++) await noter('email.bounced');
    expect(alertes).toEqual([]);
    await noter('email.complained');
    await noter('email.bounced');
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toContain('categorie=inscription');
  });

  it('un compteur en panne ne lève jamais (le webhook ne doit pas être rejoué)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const enPanne: CompteurDebit = { compter: async () => { throw new Error('base'); }, lister: async () => [] };
    await expect(creerSuiviRetoursInscription(enPanne, async () => {})('email.bounced')).resolves.toBeUndefined();
  });
});

describe('l’e-mail du lien et son gabarit', () => {
  it('le lien : la base sans barre finale, le jeton dans le chemin, la langue en paramètre', () => {
    expect(lienInscription('https://console.messagingme.app/', 'abc_DEF-1', 'en')).toBe('https://console.messagingme.app/signup/confirm/abc_DEF-1?lang=en');
  });

  it('🔴 sans « Business Agent », que le gabarit garde pour les autres e-mails', () => {
    expect(emailInscription('fr', 'https://x/signup/confirm/j?lang=fr').html).not.toContain('Business Agent');
    expect(renderBrandedEmail({ title: 'T', bodyHtml: '<p>b</p>' })).toContain('>Business Agent<');
    expect(renderBrandedEmail({ title: 'T', bodyHtml: '<p>b</p>', sousTitre: 'Équipe <x>' })).toContain('>Équipe &lt;x&gt;<');
  });
});
