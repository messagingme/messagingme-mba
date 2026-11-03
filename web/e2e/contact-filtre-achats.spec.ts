import { test, expect } from './aide/test';
import { TREIZE_POUCES, pasDeDebordement } from './aide/largeur';

/**
 * Les filtres « Achats et activité » des contacts (segments, spec du 2026-10-31) : l'activité toujours, les commandes, la
 * dépense et la dernière commande si l'espace a une boutique Shopify.
 *
 * 🔴 Le cas qui compte le plus : une API qui ne répond pas à `/contacts/segments` (plus ancienne que la console, qui part
 * en production à chaque push) ne se voit proposer AUCUN de ces critères. Elle les jetterait sans rien dire, et « au
 * moins deux commandes » rendrait tout l'espace.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const CONTACT = {
  id: 'ct1', profileName: 'Anna Vip', phoneE164: '+33600000001', bsuid: null, optInStatus: 'opted_in',
  tags: ['vip'], fields: {}, createdAt: '2026-01-01T00:00:00Z',
};
const AVEC_BOUTIQUE = { boutique: { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-11-03' };
const SANS_BOUTIQUE = { boutique: null, activiteCompleteDepuis: '2026-11-03' };

/** `segments` : la réponse de la route, ou `null` pour une API qui ne la connaît pas (404). */
async function mock(page: import('@playwright/test').Page, segments: unknown): Promise<URLSearchParams[]> {
  const requetes: URLSearchParams[] = [];
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname.endsWith('/contacts/segments')) return segments === null ? json({ error: 'Not Found' }, 404) : json(segments);
    if (url.pathname.endsWith('/conversations/todo-count')) return json({ count: 0 });
    if (url.pathname.endsWith('/contacts')) { requetes.push(url.searchParams); return json({ contacts: [CONTACT], total: 1 }); }
    if (url.pathname.endsWith('/user-fields')) return json({ fields: [] });
    if (url.pathname.endsWith('/tags')) return json({ tags: [] });
    if (url.pathname.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  return requetes;
}

/** Les critères de segment d'une requête de la liste : ils voyagent dans `fields`, opérateur `segment` (clé -> valeur). */
function segments(q: URLSearchParams): Record<string, string> {
  let champs: unknown;
  try { champs = JSON.parse(q.get('fields') ?? '[]'); } catch { return {}; }
  if (!Array.isArray(champs)) return {};
  return Object.fromEntries(champs.filter((c) => c?.op === 'segment').map((c) => [String(c.key), String(c.value)]));
}

async function ouvrir(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/contacts');
  await page.getByTestId('contacts-toggle-filters').click();
}

test.describe('Contacts : les filtres d’achats et d’activité', () => {
  test.use({ viewport: TREIZE_POUCES });

  test('🔴 avec une boutique : commandes sur une période et activité partent à l’API', async ({ page }) => {
    const requetes = await mock(page, AVEC_BOUTIQUE);
    await ouvrir(page);
    await expect(page.getByTestId('filtres-achats-suivi')).toContainText('Commandes payées suivies depuis le');
    await page.getByTestId('filtre-commandes-jours').fill('90');
    await page.getByTestId('filtre-commandes-min').fill('2');
    await page.getByTestId('filtre-actif-jours').fill('30');
    await expect.poll(() => requetes.some((q) => {
      const s = segments(q);
      return s.segment_commandes === '{"min":2,"jours":90}' && s.segment_actif === '30';
    })).toBe(true);
    // La devise de la boutique est dite là où l'on saisit un montant.
    await expect(page.getByTestId('filtres-achats')).toContainText('Dépense (EUR)');
  });

  test('🔴 une saisie invalide est dite, n’est jamais envoyée, et ne retire pas le critère valide', async ({ page }) => {
    const requetes = await mock(page, AVEC_BOUTIQUE);
    await ouvrir(page);
    await page.getByTestId('filtre-commandes-min').fill('0');
    await expect(page.getByTestId('filtre-commandes-erreur')).toContainText('ne restreint rien');
    await page.getByTestId('filtre-commandes-min').fill('3');
    await expect.poll(() => requetes.some((q) => segments(q).segment_commandes === '{"min":3}')).toBe(true);
    await page.getByTestId('filtre-commandes-max').fill('2');
    await expect(page.getByTestId('filtre-commandes-erreur')).toContainText('Le minimum dépasse le maximum');
    await page.getByTestId('filtre-inactif-jours').fill('90');
    await expect.poll(() => requetes.some((q) => segments(q).segment_inactif === '90')).toBe(true);
    // Le maximum faux n'a rien envoyé, et le critère valide « au moins 3 » est resté : l'audience ne s'est pas élargie.
    const derniere = segments(requetes[requetes.length - 1]!);
    expect(derniere.segment_commandes).toBe('{"min":3}');
    expect(requetes.some((q) => 'segment_commandes' in segments(q) && segments(q).segment_commandes !== '{"min":3}')).toBe(false);
  });

  test('sans boutique : l’activité seulement', async ({ page }) => {
    await mock(page, SANS_BOUTIQUE);
    await ouvrir(page);
    await expect(page.getByTestId('filtre-actif-jours')).toBeVisible();
    await expect(page.getByTestId('filtre-commandes-min')).toHaveCount(0);
    await expect(page.getByTestId('filtre-depense-min')).toHaveCount(0);
  });

  test('🔴 une API qui ne connaît pas les segments : aucun de ces critères n’est proposé', async ({ page }) => {
    await mock(page, null);
    await ouvrir(page);
    // Le reste du panneau est là : seul ce qui dépend de l'API manque.
    await expect(page.getByTestId('filtre-joignabilite')).toBeVisible();
    await expect(page.getByTestId('filtres-achats')).toHaveCount(0);
  });

  test('sur un 13 pouces, la partie ne fait pas déborder le panneau', async ({ page }) => {
    await mock(page, AVEC_BOUTIQUE);
    await ouvrir(page);
    await expect(page.getByTestId('filtre-derniere-commande-max')).toBeVisible();
    await pasDeDebordement(page);
  });
});
