import { test, expect } from './aide/test';

/**
 * 🔴 OÙ S'ENREGISTRE CHAQUE ÉLÉMENT D'UN FORMULAIRE, POUR CE SCÉNARIO (Julien, 2026-11-10 : « reprendre dans le bandeau
 * de droite la liste des éléments capturés par le flow et le champ où ça s'enregistre, vide si le formulaire a été créé
 * dans le BM, et pouvoir changer l'affectation pour ce scénario »).
 *
 * Le panneau lit les éléments sur l'API (`/flows/:id/sorties`) et n'enregistre dans le bloc que les lignes CHANGÉES :
 * revenir au champ du formulaire efface l'exception. Prénom, Nom et Email sont proposés même sur un espace sans champ.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

const SORTIES: Record<string, { status: number; body: unknown }> = {
  fbm: { status: 200, body: { source: 'meta', sorties: [{ cle: 'prenom_bm', libelle: 'Votre prénom', cible: '' }] } },
  fmm: { status: 200, body: { source: 'messagingme', sorties: [{ cle: 'mail', libelle: 'Adresse e-mail', cible: 'email' }] } },
  fabsent: { status: 404, body: { error: 'Not Found' } },
};

async function monter(page: import('@playwright/test').Page, flowId: string) {
  const saved: Graph[] = [];
  const initial: Graph = {
    nodes: [{ id: 'n1', type: 'flow', position: { x: 0, y: 0 }, data: { wfType: 'flow', flowId, flowName: 'RDV', cta: 'Envoyer' } }],
    edges: [],
  };
  const wf = { id: 'wf1', name: 'Scénario E2E', graph: initial, createdAt: '', updatedAt: '' };
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'PATCH' && /\/workflows\/wf1$/.test(url)) {
      const body = (req.postDataJSON() ?? {}) as { graph?: Graph };
      if (body.graph) saved.push(body.graph);
      return json({ ok: true });
    }
    const sorties = /\/flows\/([^/]+)\/sorties$/.exec(url);
    if (sorties) { const r = SORTIES[sorties[1]!]!; return json(r.body, r.status); }
    if (/\/workflows\/wf1$/.test(url)) return json({ workflow: wf });
    if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Scénario E2E', graph: initial }] });
    if (url.includes('/email/accounts')) return json({ accounts: [] });
    if (url.includes('/email/templates')) return json({ templates: [] });
    if (url.includes('/templates')) return json({ templates: [] });
    if (url.includes('/flows')) return json({ flows: [{ id: flowId, name: 'RDV', status: 'PUBLISHED', fields: [] }] });
    if (url.includes('/tags')) return json({ tags: [] });
    if (url.includes('/user-fields/usage')) return json({ total: 0, parChamp: {} });
    if (url.includes('/user-fields')) return json({ fields: [{ key: 'ville', label: 'Ville', type: 'text' }] });
    if (url.includes('/settings')) return json({ mbaEnabled: false, rcsEnabled: false, hubspotListsEnabled: false, campaignsPaused: false });
    if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  await page.goto('/workflows?open=wf1');
  await page.locator('.react-flow__node[data-id="n1"]').click();
  return saved;
}

const rangementDe = (g: Graph | undefined) => (g?.nodes.find((n) => n.id === 'n1')?.data as { rangement?: unknown } | undefined)?.rangement;

test.describe('Bloc Formulaire : le rangement de ses éléments', () => {
  test('🔴 formulaire du Business Manager : ses éléments, sans champ, et Prénom se choisit pour ce scénario', async ({ page }) => {
    const saved = await monter(page, 'fbm');
    const ligne = page.getByTestId('formulaire-rangement-prenom_bm');
    await expect(ligne).toHaveValue('');
    await expect(page.getByTestId('formulaire-rangement')).toContainText('Votre prénom');
    // Les trois champs socle d'abord, puis ceux de l'espace.
    const options = await ligne.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(options).toEqual(['', 'prenom', 'nom_de_famille', 'email', 'ville']);

    await ligne.selectOption('prenom');
    await expect.poll(() => rangementDe(saved.at(-1)), { timeout: 10_000 }).toEqual({ prenom_bm: 'prenom' });
  });

  test('formulaire de Messaging Me : son champ s’affiche, une exception se pose puis s’efface en y revenant', async ({ page }) => {
    const saved = await monter(page, 'fmm');
    const ligne = page.getByTestId('formulaire-rangement-mail');
    await expect(ligne).toHaveValue('email');
    await expect(page.getByTestId('formulaire-rangement-exception-mail')).toHaveCount(0);

    await ligne.selectOption('');
    await expect(page.getByTestId('formulaire-rangement-exception-mail')).toBeVisible();
    await expect.poll(() => rangementDe(saved.at(-1)), { timeout: 10_000 }).toEqual({ mail: '' });

    await ligne.selectOption('email');
    await expect(page.getByTestId('formulaire-rangement-exception-mail')).toHaveCount(0);
    await expect.poll(() => rangementDe(saved.at(-1)), { timeout: 10_000 }).toEqual({});
  });

  test('route absente (console poussée avant l’API) : le panneau le dit, sans casser le bloc', async ({ page }) => {
    await monter(page, 'fabsent');
    await expect(page.getByTestId('formulaire-rangement-erreur')).toContainText('pas encore disponible');
    await expect(page.locator('select:has(option[value="fabsent"])')).toBeVisible();
  });
});
