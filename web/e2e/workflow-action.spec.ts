import { test, expect } from './aide/test';

/**
 * E2E builder : le bloc « Action » s'ajoute (par défaut « ajouter un tag »), on change l'action, on en ajoute d'autres
 * au même bloc (« + »), et l'auto-save persiste un node `type:'action'` avec le bon `actionKind` et sa `suite`.
 * Backend intercepté, aucune base (pattern des E2E accueil / condition).
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

/** Ouvre le builder sur un scénario d'un seul template, et rend les graphes que l'auto-save envoie. */
async function ouvrirBuilder(page: import('@playwright/test').Page) {
  const saved: Graph[] = [];
  const initial: Graph = { nodes: [{ id: 't', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'promo' } }], edges: [] };
  const wf = { id: 'wf1', name: 'Scénario E2E', graph: initial, createdAt: '', updatedAt: '' };

  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'PATCH' && /\/workflows\/wf1$/.test(url)) {
      const body = (req.postDataJSON() ?? {}) as { graph?: Graph };
      if (body.graph) saved.push(body.graph);
      return json({ ok: true });
    }
    if (/\/workflows\/wf1$/.test(url)) return json({ workflow: wf });
    if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Scénario E2E', graph: initial }] });
    if (url.includes('/templates')) return json({ templates: [] });
    if (url.includes('/flows')) return json({ flows: [] });
    if (url.includes('/tags')) return json({ tags: [] });
    if (url.includes('/user-fields')) return json({ fields: [] });
    if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });

  await page.goto('/workflows?open=wf1');
  // Ajoute un bloc Action (sélectionné à la création).
  await page.getByTestId('add-node-action').click();
  return { saved };
}

/** Un graphe enregistré porte-t-il un bloc action avec ce `actionKind` (et éventuellement ce tag) ? */
const persiste = (saved: Graph[], kind: string, tag?: string): boolean =>
  saved.some((g) => g.nodes.some((nd) => nd.type === 'action'
    && (nd.data as { actionKind?: unknown }).actionKind === kind
    && (tag === undefined || (nd.data as { tag?: unknown }).tag === tag)));

test.describe('Builder : node Action', () => {
  test('ajoute un bloc Action, choisit « retirer des étiquettes », en retire deux, et l’auto-save persiste la liste', async ({ page }) => {
    const { saved } = await ouvrirBuilder(page);

    // Le sélecteur d'action est là (par défaut « ajouter un tag ») : on passe au retrait, qui prend une LISTE.
    await page.locator('select:has(option[value="remove_tag"])').selectOption('remove_tag');
    const saisie = page.getByPlaceholder('vip, prospect…');
    await saisie.fill('vip');
    await saisie.press('Enter');
    await saisie.fill('chaud');
    await saisie.press('Enter');
    await expect(page.getByTestId('etiquettes-a-retirer')).toContainText('vip');

    await expect.poll(() => saved.some((g) => g.nodes.some((nd) => nd.type === 'action'
      && (nd.data as { actionKind?: unknown }).actionKind === 'remove_tag'
      && JSON.stringify((nd.data as { tags?: unknown }).tags) === JSON.stringify(['vip', 'chaud']))), { timeout: 10_000 }).toBe(true);
  });

  test('🔴 le « + » ajoute une action au MÊME bloc : trois champs mis à jour sans trois blocs (Julien, 2026-11-11)', async ({ page }) => {
    const { saved } = await ouvrirBuilder(page);
    await page.getByTestId('action-kind').selectOption('set_field');
    await page.locator('select:has(option[value="prenom"])').first().selectOption('prenom');
    await page.getByPlaceholder('valeur à poser').first().fill('Anne');

    // Deuxième action, vider deux champs d'un coup.
    await page.getByTestId('action-ajouter').click();
    await expect(page.getByTestId('action-du-bloc')).toHaveCount(2);
    await page.getByTestId('action-kind').nth(1).selectOption('clear_field');
    await page.getByTestId('champ-a-vider-ajouter').selectOption('nom_de_famille');
    await page.getByTestId('champ-a-vider-ajouter').selectOption('email');
    await expect(page.getByTestId('champs-a-vider')).toContainText('Email');

    // Un seul bloc action : la première à plat, la seconde dans `suite`.
    await expect.poll(() => saved.some((g) => {
      const actions = g.nodes.filter((nd) => nd.type === 'action');
      const d = (actions[0]?.data ?? {}) as { actionKind?: unknown; fieldKey?: unknown; value?: unknown; suite?: Array<{ actionKind?: unknown; champs?: Array<{ key: string }> }> };
      return actions.length === 1 && d.actionKind === 'set_field' && d.fieldKey === 'prenom' && d.value === 'Anne'
        && d.suite?.[0]?.actionKind === 'clear_field'
        && JSON.stringify(d.suite[0].champs?.map((c) => c.key)) === JSON.stringify(['nom_de_famille', 'email']);
    }), { timeout: 10_000 }).toBe(true);

    // Retirer la PREMIÈRE action : la suivante prend sa place à plat, sans reste de l'ancienne.
    await page.getByTestId('action-retirer').first().click();
    await expect(page.getByTestId('action-du-bloc')).toHaveCount(1);
    await expect.poll(() => {
      const d = (saved[saved.length - 1]?.nodes.find((nd) => nd.type === 'action')?.data ?? {}) as Record<string, unknown>;
      return d.actionKind === 'clear_field' && d.fieldKey === undefined && d.value === undefined
        && Array.isArray(d.suite) && d.suite.length === 0 && Array.isArray(d.champs) && d.champs.length === 2;
    }, { timeout: 10_000 }).toBe(true);
  });

  test('🔴 la sous-action « passer en opt-out » se choisit et se persiste, sans rien à saisir', async ({ page }) => {
    // Le seul chemin capable de poser un opt-out AUTOMATIQUEMENT : l'upsert d'import ne fait jamais régresser
    // un statut, et la bascule à la main suppose un opérateur. C'est ce qu'on branche derrière un « STOP ».
    const { saved } = await ouvrirBuilder(page);
    await page.getByTestId('action-kind').selectOption('set_optout');

    // Aucun champ annexe : le sens est dans le choix de l'action. Le bloc est donc complet immédiatement.
    await expect(page.getByPlaceholder('vip, prospect…')).toHaveCount(0);
    await expect.poll(() => persiste(saved, 'set_optout'), { timeout: 10_000 }).toBe(true);
  });

  test('🔴 « Mettre à jour un champ » propose Prénom, Nom et Email sur un espace qui n’a encore aucun champ', async ({ page }) => {
    // Julien, 2026-11-10 : la liste venait des seuls champs déjà créés en base, où un champ socle n'entre qu'à sa première
    // écriture. Sur un espace neuf, les trois champs qu'on veut le plus souvent remplir étaient absents.
    const { saved } = await ouvrirBuilder(page);
    await page.getByTestId('action-kind').selectOption('set_field');
    const champ = page.locator('select:has(option[value="nom_de_famille"])');
    const valeurs = await champ.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(valeurs).toEqual(['', 'prenom', 'nom_de_famille', 'email']);
    await champ.selectOption('nom_de_famille');
    await page.getByPlaceholder('valeur à poser').fill('Dupont');
    await expect.poll(() => saved.some((g) => g.nodes.some((nd) => nd.type === 'action'
      && (nd.data as { fieldKey?: unknown; value?: unknown }).fieldKey === 'nom_de_famille'
      && (nd.data as { value?: unknown }).value === 'Dupont')), { timeout: 10_000 }).toBe(true);
  });

  test('« passer en opt-in » se persiste aussi, et annonce ce qu’elle fait', async ({ page }) => {
    const { saved } = await ouvrirBuilder(page);
    await page.getByTestId('action-kind').selectOption('set_optin');
    await expect(page.getByText(/destinataire des campagnes marketing/)).toBeVisible();
    await expect.poll(() => persiste(saved, 'set_optin'), { timeout: 10_000 }).toBe(true);
  });
});
