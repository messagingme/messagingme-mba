import { test, expect } from './aide/test';
import { mockAccueil } from './support/accueil';

/**
 * UN ESPACE RELIÉ PAR 360DIALOG (livraison D), sur l'Accueil : il masque ce qui ne parle qu'à Meta, la carte de l'agent
 * de Meta, « Renouveler la connexion Meta », la qualité. Plus aucun bouton ne relie ni ne recolle une clé 360dialog
 * (Julien, 2026-11-17) : seul `/ops/360dialog/:tenantId` rattache encore un tel numéro.
 */
const RELIE_360 = {
  hasNumber: true, phoneNumberId: 'PN360', number: null, numberStatus: null, codeVerificationStatus: null, quality: 'UNKNOWN',
  fournisseur: '360dialog', status: { dot: 'grey', label: 'Compte connecté', reason: 'Numéro relié par 360dialog : sa qualité ne se lit pas depuis la console.' },
};

test('relié par 360dialog : ni agent de Meta ni « Renouveler la connexion Meta »', async ({ page }) => {
  await mockAccueil(page, { account: RELIE_360, inscription: { complete: {} } });
  await expect(page.getByTestId('numero-card')).toBeVisible();
  await expect(page.getByTestId('numero-card')).toContainText('Numéro relié par 360dialog');
  await expect(page.getByTestId('settings-card')).toHaveCount(0);
  await expect(page.getByTestId('renouveler-connexion')).toHaveCount(0);
  await expect(page.getByTestId('waba-status-panel')).toHaveCount(0);
});
