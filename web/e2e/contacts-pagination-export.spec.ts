import { readFileSync } from 'node:fs';
import { test, expect } from './aide/test';

/**
 * E2E mini-CRM (2026-11-24) : la liste par pages de 20, 50 ou 100, et l'export CSV d'une sélection, colonne par colonne.
 *
 * Ce que seul un clic prouve : la page part à 20 et demande la suivante au bon décalage ; la modale d'export ne coche
 * RIEN d'avance, ne propose ni étiquettes ni champ HubSpot ou Shopify, et le fichier téléchargé porte les seules
 * colonnes cochées, en clair. Backend intercepté, aucune base requise.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const TOTAL = 46;
const contact = (i: number) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, phoneE164: `+336000000${String(i).padStart(2, '0')}`, bsuid: null,
  profileName: `Contact ${i}`, optInStatus: i % 2 === 0 ? 'opted_in' : 'unknown', fields: { ville: 'Lyon' }, tags: ['vip'],
  createdAt: '2026-11-01T09:00:00.000Z',
});
const CHAMPS = [
  { key: 'ville', label: 'Ville', type: 'text' },
  { key: 'hs_contact_secteur', label: 'Secteur (HubSpot)', type: 'text' },
  { key: 'shopify_lien_suivi', label: 'Lien de suivi (Shopify)', type: 'url' },
];

async function monter(page: import('@playwright/test').Page) {
  const listes: URLSearchParams[] = [];
  const exports: Array<Record<string, unknown>> = [];
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'POST' && url.pathname.endsWith('/contacts/export')) {
      const corps = (req.postDataJSON() ?? {}) as { colonnes: string[] };
      exports.push(corps);
      // Une ligne : le numéro, puis l'opt-in en code, comme l'API le rend.
      return json({ colonnes: corps.colonnes, lignes: [corps.colonnes.map((c) => (c === 'opt_in' ? 'opted_in' : c === 'phone' ? '+33600000001' : 'Lyon'))] });
    }
    if (url.pathname.endsWith('/contacts/count')) return json({ total: TOTAL });
    if (url.pathname.endsWith('/user-fields')) return json({ fields: CHAMPS });
    if (url.pathname.endsWith('/tags')) return json({ tags: [] });
    if (url.pathname.endsWith('/contacts')) {
      listes.push(url.searchParams);
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return json({ contacts: Array.from({ length: Math.max(0, Math.min(limit, TOTAL - offset)) }, (_, i) => contact(offset + i + 1)) });
    }
    if (url.pathname.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  await page.goto('/contacts');
  await expect(page.getByTestId('contacts-pagination')).toBeVisible();
  return { listes, exports };
}

test.describe('mini-CRM : pages et export CSV', () => {
  test('la liste part à 20, avec le total, et se parcourt page par page ; 50 par page repart du début', async ({ page }) => {
    const { listes } = await monter(page);
    await expect(page.getByRole('heading', { name: `Contacts (${TOTAL})` })).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(20);
    await expect(page.getByTestId('contacts-pagination')).toContainText(`1 à 20 sur ${TOTAL}`);
    await expect(page.getByTestId('contacts-page-precedente')).toBeDisabled();

    await page.getByTestId('contacts-page-suivante').click();
    await expect(page.getByTestId('contacts-pagination')).toContainText(`21 à 40 sur ${TOTAL}`);
    await page.getByTestId('contacts-page-suivante').click();
    await expect(page.getByTestId('contacts-pagination')).toContainText(`41 à 46 sur ${TOTAL}`);
    await expect(page.locator('tbody tr')).toHaveCount(6);
    await expect(page.getByTestId('contacts-page-suivante')).toBeDisabled();
    expect(listes.at(-1)?.get('offset')).toBe('40');

    await page.getByTestId('contacts-taille-page').selectOption('50');
    await expect(page.locator('tbody tr')).toHaveCount(TOTAL);
    expect(listes.at(-1)?.get('limit')).toBe('50');
    expect(listes.at(-1)?.get('offset')).toBe('0');
    await expect(page.getByTestId('contacts-taille-page').locator('option')).toHaveText(['20', '50', '100']);
  });

  test('🔴 la case d’en-tête d’une page ne décoche pas ce qui a été coché sur une autre page', async ({ page }) => {
    await monter(page);
    await page.locator('tbody input[type="checkbox"]').first().check();
    await expect(page.getByText('1 sélectionné(s)')).toBeVisible();
    await page.getByTestId('contacts-page-suivante').click();
    await expect(page.getByTestId('contacts-pagination')).toContainText(`21 à 40 sur ${TOTAL}`);
    await page.getByTestId('contacts-select-all').check();
    await expect(page.getByText('21 sélectionné(s)')).toBeVisible();
    await page.getByTestId('contacts-select-all').uncheck();
    await expect(page.getByText('1 sélectionné(s)')).toBeVisible();
  });

  test('🔴 l’export : rien de coché d’avance, ni étiquettes ni HubSpot ni Shopify, et le fichier porte les seules colonnes cochées', async ({ page }) => {
    const { exports } = await monter(page);
    await page.getByTestId('contacts-select-all').check();
    await page.getByTestId('contacts-action').click();
    await page.getByTestId('contacts-action-export').click();

    const colonnes = page.getByTestId('export-colonnes');
    await expect(colonnes.locator('input[type="checkbox"]:checked')).toHaveCount(0);
    await expect(page.getByTestId('bulk-submit')).toBeDisabled();
    await expect(page.getByTestId('export-colonne-ville')).toBeVisible();
    await expect(colonnes).not.toContainText('HubSpot');
    await expect(colonnes).not.toContainText('Shopify');
    await expect(colonnes).not.toContainText('Étiquettes');

    await page.getByTestId('export-colonne-phone').check();
    await page.getByTestId('export-colonne-opt_in').check();
    await page.getByTestId('export-colonne-ville').check();
    const [telechargement] = await Promise.all([page.waitForEvent('download'), page.getByTestId('bulk-submit').click()]);

    expect(exports).toHaveLength(1);
    expect(exports[0]!.colonnes).toEqual(['phone', 'opt_in', 'ville']);
    expect((exports[0]!.target as { ids: string[] }).ids).toHaveLength(20);
    expect(telechargement.suggestedFilename()).toMatch(/^contacts-\d{4}-\d{2}-\d{2}\.csv$/);
    const contenu = readFileSync((await telechargement.path())!, 'utf8').replace(/^﻿/, '');
    expect(contenu).toBe('Téléphone,Opt-in,Ville\r\n+33600000001,opt-in,Lyon');
    await expect(page.getByTestId('contact-info')).toContainText('1 contact(s) exporté(s).');
  });
});
