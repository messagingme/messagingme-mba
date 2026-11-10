import { test, expect } from './aide/test';

/**
 * 🔴 UN GESTE DE RANGEMENT SE VOIT DANS L'EN-TÊTE DE LA CONVERSATION (Julien, 2026-11-10 : « quand on met Traité dans
 * une conversation, il faut qu'on voie un badge Traité, sinon on a l'impression qu'il ne s'est rien passé »).
 *
 * Ce que seul un test de bout en bout voit : le menu « Ranger dans… » retombe sur son libellé, et depuis « À traiter »
 * la conversation QUITTE la liste rechargée, qui ne peut donc plus rien dire d'elle. Le faux serveur suit l'état comme
 * le vrai : une conversation traitée ou archivée sort des dossiers qui l'excluent.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const CONV = {
  id: 'c1', waId: '33600000001', profileName: 'Alice', lastPreview: 'bonjour',
  lastMessageAt: '2026-11-10T10:00:00Z', controlOwner: 'app_human', unread: false,
  curseur: '2026-11-10T10:00:00Z',
};

async function monter(page: import('@playwright/test').Page, dossier?: string) {
  const etat = { traitee: false, urgente: false, signaleeMain: false, archivee: false };
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (/\/conversations\/counts/.test(url)) return json({ tout: 1, aTraiter: 1, signalees: 0, archivees: 0, nonAffectees: 1, parMembre: [] });
    if (req.method() === 'POST' && /\/c1\/traiter$/.test(url)) { etat.traitee = true; etat.urgente = false; return json({ traitee: true }); }
    if (req.method() === 'POST' && /\/c1\/signaler$/.test(url)) { etat.signaleeMain = true; return json({ signalee: true }); }
    if (req.method() === 'POST' && /\/c1\/urgent$/.test(url)) { etat.urgente = true; return json({ urgente: true }); }
    if (req.method() === 'POST' && /\/c1\/archive$/.test(url)) { etat.archivee = true; etat.urgente = false; return json({ archived: true }); }
    if (url.endsWith('/c1/messages')) return json({ messages: [], windowOpen: true, controlOwner: 'app_human' });
    if (/\/conversations\?|\/conversations$/.test(url)) {
      // « À traiter » exclut les traitées, tout dossier ordinaire exclut les archivées : la conversation SORT de la liste.
      const exclue = etat.archivee || (url.includes('aTraiter=1') && etat.traitee);
      const visible = { traitee: etat.traitee, urgente: etat.urgente, signaleeMain: etat.signaleeMain };
      return json({ conversations: exclue ? [] : [{ ...CONV, ...visible }] });
    }
    if (url.includes('/users')) return json({ users: [] });
    if (url.includes('/unread-count')) return json({ count: 0 });
    if (url.endsWith('/me')) return json({ email: SESSION.email, name: 'Jean Test', role: 'admin' });
    return json({});
  });
  await page.goto('/inbox');
  if (dossier) await page.getByTestId(`dossier-${dossier}`).click();
  await page.getByRole('button', { name: /Ouvrir la conversation|Open conversation/ }).first().click();
  await page.getByTestId('ranger-dans').waitFor();
}

test.describe('Inbox : la pastille du statut dans l’en-tête', () => {
  test('🔴 « Traité » depuis « À traiter » : la conversation quitte la liste, sa pastille apparaît quand même', async ({ page }) => {
    await monter(page, 'aTraiter');
    await expect(page.getByTestId('thread-traitee')).toHaveCount(0);
    await page.getByTestId('ranger-dans').selectOption('traiter');
    await expect(page.getByTestId('thread-traitee')).toBeVisible();
    // Le menu propose désormais le geste inverse, plus « Traité » une seconde fois.
    const options = (await page.getByTestId('ranger-dans').locator('option').allTextContents()).slice(1);
    expect(options).toContain('Ne plus marquer traité');
    expect(options).not.toContain('Traité');
  });

  test('« Signalé » et « Marquer urgent » posent chacun leur pastille', async ({ page }) => {
    await monter(page);
    await page.getByTestId('ranger-dans').selectOption('signaler');
    await expect(page.getByTestId('thread-signalee')).toBeVisible();
    await page.getByTestId('ranger-dans').selectOption('urgent');
    await expect(page.getByTestId('thread-urgente')).toBeVisible();
    await expect(page.getByTestId('thread-signalee')).toBeVisible();
  });

  test('« Archivé » depuis « Tout » : pastille, et « Désarchiver » proposé', async ({ page }) => {
    await monter(page);
    await page.getByTestId('ranger-dans').selectOption('archiver');
    await expect(page.getByTestId('thread-archivee')).toBeVisible();
    const options = (await page.getByTestId('ranger-dans').locator('option').allTextContents()).slice(1);
    expect(options).toContain('Désarchiver');
  });
});
