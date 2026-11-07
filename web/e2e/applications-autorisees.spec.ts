import { test, expect, type Page } from './aide/test';
import { repondre } from './aide/confirmation';

/**
 * « APPLICATIONS AUTORISÉES », SUR LA PAGE DES CLÉS D'API (spec `2026-10-03-oauth-mcp-design.md`, section 6).
 *
 * 🔴 CE QUE CES TESTS TIENNENT : une ligne par autorisation (client, personne, date, dernier usage) ; « Révoquer »
 * passe par la fenêtre de confirmation de la console, et rien ne part sans elle ; une autorisation révoquée disparaît
 * de la liste, relue sur le serveur ; l'état vide le dit. La révocation elle-même (l'appel suivant de Claude en 401)
 * est au serveur, `tests/http-oauth.test.ts`.
 */

const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

const ligne = (id: string, nom: string | null, dernierUsageLe: string | null) => ({
  id, clientId: 'https://claude.ai/oauth/claude-code-client-metadata', client: 'Claude Code', userId: `u-${id}`,
  email: `${id}@e2e.test`, nom, scopes: ['mcp:read', 'mcp:write'], creeLe: '2026-10-03T08:00:00.000Z', dernierUsageLe,
});

async function monter(page: Page, depart: unknown[], cles: unknown[] = []): Promise<string[]> {
  let lignes = depart;
  const revocations: string[] = [];
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname.replace('/api/backend', '');
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Admin', role: 'admin' });
    if (chemin.endsWith('/api-keys')) return json({ keys: cles });
    const revoque = /\/oauth\/autorisations\/([^/]+)$/.exec(chemin);
    if (revoque && req.method() === 'DELETE') {
      revocations.push(revoque[1]!);
      lignes = lignes.filter((l) => (l as { id: string }).id !== revoque[1]);
      return json({ id: revoque[1], revoked: true });
    }
    if (chemin.endsWith('/oauth/autorisations')) return json({ autorisations: lignes });
    return json({});
  });
  return revocations;
}

test.describe('Clés d’API : les applications autorisées', () => {
  test('🔴 une ligne par autorisation, et « Révoquer » passe par la confirmation', async ({ page }) => {
    const revocations = await monter(page, [ligne('a1', 'Léa Martin', null), ligne('a2', null, '2026-10-03T09:30:00.000Z')]);
    await page.goto('/developers/keys');
    const section = page.getByTestId('applications-autorisees');
    await expect(section.getByRole('heading', { name: 'Applications autorisées' })).toBeVisible();
    await expect(section.getByRole('row')).toHaveCount(3);
    await expect(section.getByRole('row').nth(1)).toContainText('Claude Code');
    await expect(section.getByRole('row').nth(1)).toContainText('Léa Martin');
    await expect(section.getByRole('row').nth(1)).toContainText('jamais');
    // Sans nom affiché, la personne est son adresse.
    await expect(section.getByRole('row').nth(2)).toContainText('a2@e2e.test');

    // Annuler : rien ne part.
    await section.getByTestId('revoquer-a1').click();
    await repondre(page, false, 'Révoquer l’accès de « Claude Code », autorisé par Léa Martin');
    expect(revocations).toEqual([]);

    await section.getByTestId('revoquer-a1').click();
    await repondre(page, true);
    await expect(section.getByRole('row')).toHaveCount(2);
    await expect(section).not.toContainText('Léa Martin');
    expect(revocations).toEqual(['a1']);
  });

  test('🔴 lot D de l’audit : la boîte nomme ce que l’application a créé, une application déconnectée reste listée, la clé dit sa provenance', async ({ page }) => {
    const creations = { cles: [{ id: 'k1', name: 'Mon application' }], adresses: [{ id: 'w1', url: 'https://app.client.fr/hook' }] };
    await monter(page, [
      { ...ligne('a1', 'Léa Martin', null), connectee: true, creations },
      { ...ligne('a2', 'Paul Durand', null), connectee: false, creations: { cles: [{ id: 'k2', name: 'Ancienne' }], adresses: [] } },
    ], [{
      id: 'k1', name: 'Mon application', scopes: ['contacts:write'], createdAt: '2026-11-06T10:00:00.000Z', lastUsedAt: null, revokedAt: null,
      application: { nom: 'Claude Code', marque: 'epingle', hote: null },
    }]);
    await page.goto('/developers/keys');
    const section = page.getByTestId('applications-autorisees');
    await expect(section).toContainText('Les clés d’API et les webhooks qu’une application a créés s’arrêtent avec elle.');
    await expect(section.getByTestId('application-deconnectee-a2')).toContainText('déconnectée');
    await expect(section.getByTestId('application-deconnectee-a1')).toHaveCount(0);
    await expect(page.getByTestId('cle-provenance-k1')).toHaveText('Créée par Claude Code');

    await section.getByTestId('revoquer-a1').click();
    await repondre(page, false, 'la clé d’API « Mon application » sera révoquée et le webhook https://app.client.fr/hook sera mis en pause');
    await section.getByTestId('revoquer-a2').click();
    await repondre(page, false, '« Claude Code », autorisé par Paul Durand, n’est plus connecté, mais ce qu’il a créé vit encore.');
  });

  test('aucune autorisation : la section le dit', async ({ page }) => {
    await monter(page, []);
    await page.goto('/developers/keys');
    await expect(page.getByTestId('applications-vide')).toContainText('Aucune application autorisée');
  });
});
