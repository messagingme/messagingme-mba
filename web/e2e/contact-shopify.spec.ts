import { test, expect } from './aide/test';
import { TREIZE_POUCES, pasDeDebordement } from './aide/largeur';

/**
 * L'onglet « Shopify » de la fiche contact (plan 2026-11-16) : présent quand l'espace a une boutique, avec les commandes
 * du client et ce que WhatsApp en a rapporté ; absent sans boutique. 🔴 Une API qui ne connaît pas encore la route (404,
 * la console part en production avant l'API) dit « indisponible », jamais « aucune commande ».
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const CONTACT = {
  id: '0b5f1c8e-7a52-4c1e-9d2a-3f6b8e1a2c4d', profileName: 'Anna Vip', phoneE164: '+33600000001', bsuid: null, optInStatus: 'opted_in',
  tags: [], fields: {}, createdAt: '2026-01-01T00:00:00Z',
};
const AVEC_BOUTIQUE = { boutique: { devise: 'EUR', commandesDepuis: '2026-11-01T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-11-03' };
const SANS_BOUTIQUE = { boutique: null, activiteCompleteDepuis: '2026-11-03' };
const ACHATS = {
  boutique: { nom: 'Boutique démo', domaine: 'demo.myshopify.com', devise: 'EUR', commandesDepuis: '2026-11-01T10:00:00.000Z', coupeeLe: null },
  resume: { commandes: 2, commandesTest: 1, depense: '69.9', derniereLe: '2026-11-03T10:00:00.000Z' },
  rapporte: [{ devise: 'EUR', montant: '49.9', prouve: '49.9', commandes: 1 }],
  commandes: [
    { commandeId: '1002', payeeLe: '2026-11-03T10:00:00.000Z', montant: '20', devise: 'EUR', test: true, attribution: null },
    { commandeId: '1001', payeeLe: '2026-11-02T10:00:00.000Z', montant: '49.9', devise: 'EUR', test: false,
      attribution: { source: 'campagne', campagne: 'Soldes', preuve: 'utm' } },
  ],
  paniers: [{ ouvertLe: '2026-11-10T10:00:00.000Z', relanceLe: '2026-11-10T11:00:00.000Z', fermeLe: null, issue: 'envoye' }],
};

/** `achats` : la réponse de la route de la fiche, ou `null` pour une API qui ne la connaît pas (404). */
async function mock(page: import('@playwright/test').Page, segments: unknown, achats: unknown): Promise<void> {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname.endsWith('/contacts/segments')) return json(segments);
    if (url.pathname.endsWith(`/contacts/${CONTACT.id}/shopify`)) return achats === null ? json({ error: 'Not Found' }, 404) : json(achats);
    if (url.pathname.endsWith('/conversations/todo-count')) return json({ count: 0 });
    if (url.pathname.endsWith('/contacts')) return json({ contacts: [CONTACT], total: 1 });
    if (url.pathname.endsWith('/user-fields')) return json({ fields: [] });
    if (url.pathname.endsWith('/tags')) return json({ tags: [] });
    if (url.pathname.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
}

async function ouvrirFiche(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/contacts');
  await page.getByText('Anna Vip').first().click();
  await expect(page.getByTestId('fiche-onglet-historique')).toBeVisible();
}

test.describe('Fiche contact : l’onglet Shopify', () => {
  test.use({ viewport: TREIZE_POUCES });

  test('🔴 avec une boutique : l’onglet montre ses commandes et ce que WhatsApp a rapporté', async ({ page }) => {
    await mock(page, AVEC_BOUTIQUE, ACHATS);
    await ouvrirFiche(page);
    await page.getByTestId('fiche-onglet-shopify').click();
    const onglet = page.getByTestId('fiche-shopify');
    await expect(onglet).toContainText('commandes payées suivies depuis le');
    await expect(page.getByTestId('fiche-shopify-resume')).toContainText('(dont 1 de test)');
    await expect(page.getByTestId('fiche-shopify-commande')).toHaveCount(2);
    await expect(page.getByTestId('fiche-shopify-commandes')).toContainText('Campagne « Soldes »');
    await expect(page.getByTestId('fiche-shopify-commandes')).toContainText('test');
    await expect(page.getByTestId('fiche-shopify-rapporte')).toContainText('sur 1 commande');
    await expect(page.getByTestId('fiche-shopify-paniers')).toContainText('Relancé sur WhatsApp le');
    await pasDeDebordement(page);
  });

  test('🔴 seules des commandes de test sont attribuées : « aucune vente réelle », et la raison est dite', async ({ page }) => {
    // Le cas de l'essai réel du 2026-11-16 (espace de démonstration) : le rapporté exclut les commandes de test, et la
    // phrase « aucune commande attribuée » contredisait la liste, où elles portent leur source.
    await mock(page, AVEC_BOUTIQUE, {
      ...ACHATS,
      rapporte: [],
      commandes: [{ commandeId: '1002', payeeLe: '2026-11-03T10:00:00.000Z', montant: '20', devise: 'EUR', test: true,
        attribution: { source: 'relance_panier', campagne: null, preuve: 'panier' } }],
    });
    await ouvrirFiche(page);
    await page.getByTestId('fiche-onglet-shopify').click();
    await expect(page.getByTestId('fiche-shopify-rapporte')).toContainText('Aucune vente réelle attribuée à WhatsApp');
    await expect(page.getByTestId('fiche-shopify-rapporte-test')).toContainText('ne comptent pas dans ce chiffre');
    await expect(page.getByTestId('fiche-shopify-commandes')).toContainText('Relance de panier');
  });

  test('🔴 sans boutique : pas d’onglet Shopify', async ({ page }) => {
    await mock(page, SANS_BOUTIQUE, ACHATS);
    await ouvrirFiche(page);
    await expect(page.getByTestId('fiche-onglet-shopify')).toHaveCount(0);
  });

  test('🔴 une API qui ne connaît pas la route : « indisponible », jamais « aucune commande »', async ({ page }) => {
    await mock(page, AVEC_BOUTIQUE, null);
    await ouvrirFiche(page);
    await page.getByTestId('fiche-onglet-shopify').click();
    await expect(page.getByTestId('fiche-shopify-indisponible')).toBeVisible();
    await expect(page.getByTestId('fiche-shopify-aucune-commande')).toHaveCount(0);
  });
});
