import { test, expect } from './aide/test';
import { mockAccueil, defaultAccount } from './support/accueil';

/**
 * F2 : panneau statut WABA. Cap d'envoi 24 h (pas le débit/s), MM Lite, revue, vérif, business, bloc paiement
 * honnête vers le Business Manager. Repli honnête quand Meta n'a pas évalué le palier.
 */
test.describe('Accueil : panneau statut WhatsApp Business (F2)', () => {
  test('affiche le cap d\'envoi 24 h et PAS le débit par seconde', async ({ page }) => {
    await mockAccueil(page);
    const numero = page.getByTestId('numero-card');
    await expect(numero.getByText('Cap d’envoi 24 h')).toBeVisible();
    await expect(numero.getByText('1 000 clients / 24 h')).toBeVisible();
    // Le débit brut (identique pour tous) a été retiré.
    await expect(page.getByText('messages / seconde')).toHaveCount(0);
    await expect(page.getByText('Débit', { exact: true })).toHaveCount(0);
  });

  test('le panneau montre MM Lite approuvé + revue + vérification', async ({ page }) => {
    await mockAccueil(page);
    const panel = page.getByTestId('waba-status-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('API MM Lite')).toBeVisible();
    await expect(panel.getByText('Approuvé', { exact: true }).first()).toBeVisible();
    await expect(panel.getByText('Revue du compte')).toBeVisible();
    await expect(panel.getByText('Vérification d’entreprise')).toBeVisible();
  });

  test('🔴 le compte bloqué pour sa carte chez Meta : le bandeau et ses étapes ; sinon, rien', async ({ page }) => {
    await mockAccueil(page, { account: { ...defaultAccount, paiementMetaBloque: true } });
    const bandeau = page.getByTestId('carte-meta-a-regler');
    await expect(bandeau).toBeVisible();
    await expect(bandeau).toContainText('Ajoutez votre carte chez Meta');
    await expect(bandeau).toContainText('Paramètres de paiement');
    await page.goto('about:blank');
    await mockAccueil(page);
    await expect(page.getByTestId('waba-status-panel')).toBeVisible();
    await expect(page.getByTestId('carte-meta-a-regler')).toHaveCount(0);
  });

  test('🔴 la ligne de crédit paie Meta (jaune 3 du lot B) : la ligne active, ou l’option payée qui l’attend, taisent le bandeau ; un numéro qui garde l’application l’entend', async ({ page }) => {
    const bloque = { ...defaultAccount, paiementMetaBloque: true };
    for (const etat of ['active', 'en_attente']) {
      await mockAccueil(page, { account: bloque, etatLigne: { etat, enVente: true, avecApplication: false } });
      await expect(page.getByTestId('waba-status-panel')).toBeVisible();
      await expect(page.getByTestId('carte-meta-a-regler'), etat).toHaveCount(0);
      await page.goto('about:blank');
    }
    await mockAccueil(page, { account: bloque, etatLigne: { etat: 'en_attente', enVente: true, avecApplication: true } });
    await expect(page.getByTestId('carte-meta-a-regler')).toBeVisible();
  });

  test('🔴 un numéro connecté avec sa carte chez Meta (décision du 2026-11-13) : l’option payée ne l’attend pas, le bandeau reste ; une ligne active le tait', async ({ page }) => {
    const bloque = { ...defaultAccount, paiementMetaBloque: true };
    await mockAccueil(page, { account: bloque, etatLigne: { etat: 'en_attente', enVente: true, avecApplication: false, numeroAvecCarte: true } });
    await expect(page.getByTestId('carte-meta-a-regler')).toBeVisible();
    await page.goto('about:blank');
    await mockAccueil(page, { account: bloque, etatLigne: { etat: 'active', enVente: true, avecApplication: false, numeroAvecCarte: true } });
    await expect(page.getByTestId('waba-status-panel')).toBeVisible();
    await expect(page.getByTestId('carte-meta-a-regler')).toHaveCount(0);
  });

  test('🔴 un numéro payé par la ligne de crédit la dit, crédit restant à côté, et plus « à vérifier chez Meta » (2026-11-17)', async ({ page }) => {
    const ligne = { etat: 'active', enVente: true, avecApplication: false };
    await mockAccueil(page, { etatLigne: ligne, creditWhatsapp: { illimite: false, soldeMicroEur: 42_500_000 } });
    const moyen = page.getByTestId('moyen-de-paiement');
    await expect(moyen).toContainText('Ligne de crédit active');
    await expect(moyen).toContainText(/Crédit restant\s*42,50\s*€/);
    await expect(moyen).not.toContainText('Business Manager Meta');
    await expect(moyen.getByTestId('moyen-de-paiement-onglet')).toHaveAttribute('href', '/offre?tab=whatsapp');
    await page.goto('about:blank');
    // Une Entreprise : illimitée, rien à afficher comme solde.
    await mockAccueil(page, { etatLigne: ligne, creditWhatsapp: { illimite: true, soldeMicroEur: 0 } });
    await expect(moyen).toContainText('Illimité');
    await page.goto('about:blank');
    // L'option payée dont la ligne s'ouvre : en cours d'ouverture, sans lien vers un onglet qui n'existe pas encore.
    await mockAccueil(page, { etatLigne: { ...ligne, etat: 'en_attente' }, creditWhatsapp: { illimite: false, soldeMicroEur: 0 } });
    await expect(moyen).toContainText('Ligne de crédit en cours d’ouverture');
    await expect(moyen.getByTestId('moyen-de-paiement-onglet')).toHaveCount(0);
    await page.goto('about:blank');
    // Un solde illisible tait le montant, jamais un zéro inventé.
    await mockAccueil(page, { etatLigne: ligne });
    await expect(moyen).toContainText('Ligne de crédit active');
    await expect(moyen).not.toContainText('Crédit restant');
  });

  test('bloc paiement : renvoi honnête vers le Business Manager (lien billing_hub)', async ({ page }) => {
    await mockAccueil(page);
    const link = page.getByTestId('waba-status-panel').getByRole('link', { name: 'Business Manager Meta' });
    await expect(link).toHaveAttribute('href', /business\.facebook\.com\/billing_hub/);
  });

  test('🔴 la pastille du numéro s’affiche quand Meta en rend une', async ({ page }) => {
    // Demande de Julien du 2026-09-08 : montrer sur l'Accueil la pastille que Meta affiche dans le Business
    // Manager, à côté du numéro.
    await mockAccueil(page, { account: { ...defaultAccount, photoProfilUrl: 'https://exemple.test/pastille.png' } });
    const pastille = page.getByTestId('numero-pastille');
    await expect(pastille).toBeVisible();
    await expect(pastille).toHaveAttribute('src', 'https://exemple.test/pastille.png');
  });

  test('🔴 sans photo, AUCUN cadre vide : le numéro s’affiche seul', async ({ page }) => {
    // C'est le cas ORDINAIRE : les deux numéros du parc n'avaient pas de photo le 2026-09-08. Un cadre gris
    // ou une icône de repli se lirait comme un chargement en échec, et on chercherait une panne inexistante.
    await mockAccueil(page, { account: { ...defaultAccount, photoProfilUrl: null } });
    await expect(page.getByTestId('numero-card')).toBeVisible();
    await expect(page.getByTestId('numero-pastille')).toHaveCount(0);
  });

  test('palier non évalué -> repli honnête (pas de faux chiffre)', async ({ page }) => {
    await mockAccueil(page, { account: { ...defaultAccount, tier: null } });
    await expect(page.getByTestId('numero-card').getByText('Pas encore évalué par Meta')).toBeVisible();
  });

  test('aucun tiret cadratin dans le panneau statut', async ({ page }) => {
    await mockAccueil(page);
    const text = (await page.getByTestId('waba-status-panel').innerText()) ?? '';
    expect(text).not.toMatch(/[—–]/);
  });
});
