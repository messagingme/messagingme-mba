import { test, expect } from './aide/test';
import { mockAccueil } from './support/accueil';

/**
 * 🔴 UN COMPTE WHATSAPP REVENU SANS NUMÉRO NE LAISSE PAS UN ÉCRAN MUET (relecture de la livraison A du lot 3b).
 *
 * La fenêtre de Meta peut se finir SANS numéro. L'API relie alors le compte et rend 200 avec un avertissement qui
 * dit quoi faire, au lieu de l'ancien 422. Or l'Accueil ne montrait ses avertissements que dans la carte d'un espace
 * QUI A un numéro : l'espace n'en ayant toujours pas, la zone de connexion revenait, sans un mot.
 *
 * La fenêtre de Meta est simulée par un faux SDK : `FB.login` rend un code, et aucun message n'annonce le compte
 * (le cas « code seul », que l'API repêche).
 */
const FAUX_SDK = 'window.FB={init:function(){},login:function(cb){setTimeout(function(){cb({authResponse:{code:"code-e2e"}})},10)}};';

test('🔴 compte relié SANS numéro : l’avertissement s’affiche, et la connexion reste offerte', async ({ page }) => {
  await page.route('https://connect.facebook.net/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAUX_SDK }));
  const posts: unknown[] = [];
  await mockAccueil(page, {
    account: { hasNumber: false, phoneNumberId: null, number: null, numberStatus: null, codeVerificationStatus: null, status: { dot: 'grey', label: 'Aucun numéro', reason: 'Aucun numéro connecté.' } },
    inscription: {
      complete: { connected: false, sansNumero: true, wabaId: 'w-e2e', warnings: ['Ton compte WhatsApp est relié, sans numéro pour l’instant.'] },
      posts,
    },
  });

  // La fenêtre de Meta ne s'ouvre plus de l'Accueil (2026-11-17) : par le tunnel de Connecter WhatsApp.
  await page.goto('/connecter-whatsapp');
  await page.getByTestId('carte-meta-choisir').click();
  await page.getByTestId('question-compte-oui').click();
  await page.getByTestId('choix-apporte').click();
  await page.getByTestId('ouvrir-fenetre-meta').click();

  // L'écoute attend 6 s un message de la fenêtre avant d'envoyer le code seul.
  await expect(page.getByTestId('avertissements-connexion')).toContainText('sans numéro', { timeout: 15_000 });
  expect(posts).toEqual([{ code: 'code-e2e' }]);
  await expect(page.getByTestId('ouvrir-fenetre-meta')).toBeVisible();
  // Pas « Connecté » : l'espace n'a pas de numéro.
  await expect(page.getByTestId('avertissements-connexion')).not.toContainText('Connecté');
});
