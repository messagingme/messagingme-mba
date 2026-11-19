import { test, expect } from './aide/test';

/**
 * E2E Automation (Lot E) : créer une automation « mot-clé » depuis l'écran, et vérifier qu'elle part
 * DÉSACTIVÉE (une automation écrit au client sans relecture humaine : elle ne s'allume jamais toute seule).
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const WF = { id: 'wf1', name: 'Prise de RDV', graph: { nodes: [], edges: [] } };

test.describe('Automation : création d’un déclencheur mot-clé', () => {
  test('crée une automation désactivée avec ses mots-clés, puis l’active', async ({ page }) => {
    const posted: Array<Record<string, unknown>> = [];
    const patched: Array<Record<string, unknown>> = [];
    let listed: Array<Record<string, unknown>> = [];

    await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
    await page.route('**/api/backend/**', async (route) => {
      const req = route.request();
      const url = req.url();
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (url.endsWith('/automations') && req.method() === 'POST') {
        const body = req.postDataJSON() as Record<string, unknown>;
        posted.push(body);
        listed = [{ id: 'a1', ...body, conditionGroup: null, startNodeId: null, cooldownSeconds: null }];
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'a1' }) });
      }
      if (/\/automations\/a1$/.test(url) && req.method() === 'PATCH') {
        const body = req.postDataJSON() as Record<string, unknown>;
        patched.push(body);
        return json({ id: 'a1' });
      }
      if (url.endsWith('/automations')) return json({ automations: listed });
      if (url.endsWith('/workflows')) return json({ workflows: [WF] });
      if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
      return json({});
    });

    await page.goto('/automations');

    await page.getByTestId('automation-add').click();
    await page.getByTestId('automation-name').fill('Demande de RDV');
    await page.getByTestId('automation-keywords').fill('rdv, rendez-vous');
    await page.getByTestId('automation-workflow').selectOption('wf1');
    await page.getByTestId('automation-submit').click();

    // Créée DÉSACTIVÉE, avec les mots-clés découpés et nettoyés.
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({
      name: 'Demande de RDV',
      triggerKind: 'keyword',
      triggerConfig: { keywords: ['rdv', 'rendez-vous'], mode: 'contains' },
      workflowId: 'wf1',
      enabled: false,
    });

    // Elle apparaît dans la liste, désactivée, et le clic l'active.
    const toggle = page.getByTestId('automation-toggle-a1');
    await expect(toggle).toHaveText(/désactivée/);
    await toggle.click();
    await expect.poll(() => patched.length).toBe(1);
    expect(patched[0]).toEqual({ enabled: true });
  });
});

/**
 * Déclencheur « étape de deal HubSpot » dans Autres. 🔴 Depuis le lot 6c du menu « Scénario » (décision 8), il NE SE CRÉE
 * PLUS ici : chaque étape se règle dans la section HubSpot, avec son scénario (`e2e/hubspot-automations.spec.ts`). Une
 * automation EXISTANTE de ce type reste lisible et modifiable jusqu'à la bascule de l'API, qui l'éteint. Les cas d'avant
 * sont gardés sur elle : le menu rend les LIBELLÉS du portail, et l'enregistrement poste les deux identifiants (le
 * serveur exige le pipeline en plus de l'étape) plus le libellé, gardé pour l'affichage.
 */
const PIPELINES = [
  { id: 'default', label: 'Pipeline de vente', stages: [{ id: 'rdv', label: 'Rendez-vous', closed: false }, { id: 'won', label: 'Gagné', closed: true }] },
  { id: 'renew', label: 'Renouvellement', stages: [{ id: 'relance', label: 'À relancer', closed: false }] },
];
/** Une automation « étape de deal » d'avant le lot 6c, telle que la liste la rend. */
const EXISTANTE = {
  id: 'a7', name: 'Devis envoyé', enabled: false, triggerKind: 'hubspot_deal_stage',
  triggerConfig: { pipelineId: 'default', stageId: 'rdv', stageLabel: 'Rendez-vous' },
  conditionGroup: null, workflowId: 'wf1', startNodeId: null, cooldownSeconds: null,
};
const MOT_CLE = { ...EXISTANTE, id: 'a8', name: 'Demande de RDV', triggerKind: 'keyword', triggerConfig: { keywords: ['rdv'], mode: 'contains' } };

async function monterEtapeDeDeal(page: import('@playwright/test').Page, dealStages: unknown, automations: unknown[] = [EXISTANTE]) {
  const patched: Array<Record<string, unknown>> = [];
  let appelsEtapes = 0;
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.includes('/hubspot/deal-stages')) { appelsEtapes += 1; return json(dealStages); }
    if (/\/automations\/a7$/.test(url) && req.method() === 'PATCH') {
      patched.push(req.postDataJSON() as Record<string, unknown>);
      return json({ id: 'a7' });
    }
    if (url.endsWith('/automations')) return json({ automations });
    if (url.endsWith('/workflows')) return json({ workflows: [WF] });
    if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  await page.goto('/automations');
  return { patched, nbAppelsEtapes: () => appelsEtapes };
}

test.describe('Automation : déclencheur « étape de deal HubSpot » dans Autres (lot 6c : plus créable, une existante reste modifiable)', () => {
  test('🔴 à la création, le déclencheur n’est plus proposé, portail relié ou non', async ({ page }) => {
    // Il était masqué sans portail (arbitrage du 2026-09-23) et proposé avec : il ne l'est plus du tout, il vit dans la
    // section HubSpot. Ce test garde aussi le cas « sans portail, impossible de retenir une étape » : l'option n'existe plus.
    await monterEtapeDeDeal(page, { connected: true, pipelines: PIPELINES }, []);
    await page.getByTestId('automation-add').click();
    const menu = page.getByTestId('automation-trigger');
    await expect(menu.locator('option[value="hubspot_deal_stage"]')).toHaveCount(0);
    // Les autres déclencheurs restent : on masque UNE option, pas la liste.
    await expect(menu.locator('option[value="keyword"]')).toHaveCount(1);
  });

  test('🔴 la preuve inverse : une automation existante le garde, choisi, avec son étape relue', async ({ page }) => {
    // Sans elle, un masquage qui cacherait toujours l'option passerait le cas du dessus.
    const { nbAppelsEtapes } = await monterEtapeDeDeal(page, { connected: true, pipelines: PIPELINES });
    await expect(page.getByText('un deal HubSpot atteint « Rendez-vous »')).toBeVisible();
    // Les étapes ne sont PAS lues tant que le formulaire n'est pas ouvert sur ce déclencheur (elles coûtent un appel HubSpot).
    expect(nbAppelsEtapes()).toBe(0);
    await page.getByTestId('automation-modifier-a7').click();
    const declencheur = page.getByTestId('automation-trigger');
    await expect(declencheur.locator('option[value="hubspot_deal_stage"]')).toHaveCount(1);
    await expect(declencheur).toHaveValue('hubspot_deal_stage');
    await expect(page.getByTestId('automation-deal-stage')).toHaveValue('default::rdv');
    await expect.poll(() => nbAppelsEtapes()).toBe(1);
  });

  test('une autre automation modifiée ne peut pas devenir une étape de deal', async ({ page }) => {
    await monterEtapeDeDeal(page, { connected: true, pipelines: PIPELINES }, [MOT_CLE]);
    await page.getByTestId('automation-modifier-a8').click();
    await expect(page.getByTestId('automation-trigger').locator('option[value="hubspot_deal_stage"]')).toHaveCount(0);
  });

  test('une existante : le menu groupé par pipeline, l’étape de fin signalée ; une autre étape part avec pipeline, étape et libellé', async ({ page }) => {
    const { patched } = await monterEtapeDeDeal(page, { connected: true, pipelines: PIPELINES });
    await page.getByTestId('automation-modifier-a7').click();
    const menu = page.getByTestId('automation-deal-stage');
    await expect(menu).toBeVisible();
    // Groupé par pipeline, et les étapes de fin sont signalées.
    await expect(menu.locator('optgroup')).toHaveCount(2);
    await expect(menu.locator('option', { hasText: 'Gagné' })).toHaveText(/étape de fin/);
    await menu.selectOption('renew::relance');
    await page.getByTestId('automation-submit').click();
    await expect.poll(() => patched.length).toBe(1);
    expect(patched[0]).toMatchObject({
      triggerKind: 'hubspot_deal_stage',
      // Le pipeline accompagne l'étape : le serveur l'exige. Le libellé n'est que décoratif.
      triggerConfig: { pipelineId: 'renew', stageId: 'relance', stageLabel: 'À relancer' },
    });
  });

  test('une existante sans étape choisie : l’enregistrement reste impossible', async ({ page }) => {
    await monterEtapeDeDeal(page, { connected: true, pipelines: PIPELINES });
    await page.getByTestId('automation-modifier-a7').click();
    await page.getByTestId('automation-deal-stage').selectOption('');
    // Une automation sans étape partirait sur TOUS les changements du portail : le bouton doit rester mort.
    await expect(page.getByTestId('automation-submit')).toBeDisabled();
  });

  test('portail non relié : on le dit, sans menu et sans erreur rouge', async ({ page }) => {
    await monterEtapeDeDeal(page, { connected: false, pipelines: [] });
    await page.getByTestId('automation-modifier-a7').click();
    await expect(page.getByText(/Aucun portail HubSpot relié/)).toBeVisible();
    await expect(page.getByTestId('automation-deal-stage')).toHaveCount(0);
  });
});

/**
 * Déclencheur « X avant une date du contact » (2026-08-23).
 *
 * Ce qu'il faut protéger ici : le menu ne doit proposer QUE des champs date et heure. Un champ texte
 * accepterait la configuration et ne partirait jamais, sans que rien ne le dise.
 */
test.describe('Automation : un délai avant une date', () => {
  const SESSION_B = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

  async function monter(page: import('@playwright/test').Page, champs: Array<{ key: string; label: string; type: string }>) {
    const posted: Array<Record<string, unknown>> = [];
    await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION_B);
    await page.route('**/api/backend/**', async (route) => {
      const req = route.request();
      const url = req.url();
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (url.endsWith('/automations') && req.method() === 'POST') {
        posted.push(req.postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'a1' }) });
      }
      if (url.endsWith('/automations')) return json({ automations: [] });
      if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Rappel', graph: { nodes: [], edges: [] } }] });
      if (url.includes('/user-fields')) return json({ fields: champs });
      if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
      return json({});
    });
    await page.goto('/automations');
    await page.getByTestId('automation-add').click();
    await page.getByTestId('automation-trigger').selectOption('avant_date');
    return posted;
  }

  test('🔴 seuls les champs DATE ET HEURE sont proposés', async ({ page }) => {
    // Un champ texte accepterait la config et ne partirait jamais : l'automation aurait l'air réglée.
    await monter(page, [
      { key: 'rdv', label: 'Rendez-vous', type: 'datetime' },
      { key: 'ville', label: 'Ville', type: 'text' },
      { key: 'naissance', label: 'Naissance', type: 'date' },
    ]);
    const menu = page.getByTestId('avant-date-champ');
    await expect(menu).toContainText('Rendez-vous');
    await expect(menu).not.toContainText('Ville');
    await expect(menu).not.toContainText('Naissance');
  });

  test('🔴 sans aucun champ date et heure, l’écran DIT quoi faire', async ({ page }) => {
    // Un menu vide laisserait chercher ce qui manque.
    await monter(page, [{ key: 'ville', label: 'Ville', type: 'text' }]);
    await expect(page.getByTestId('avant-date-aucun-champ')).toContainText(/Champs|Fields/);
  });

  test('🔴 la configuration envoyée porte le champ, le délai et l’unité', async ({ page }) => {
    const posted = await monter(page, [{ key: 'rdv', label: 'Rendez-vous', type: 'datetime' }]);
    await page.getByTestId('automation-name').fill('Rappel 48 h avant');
    await page.getByTestId('avant-date-delai').fill('48');
    await page.getByTestId('avant-date-unite').selectOption('heures');
    await page.getByTestId('avant-date-champ').selectOption('rdv');
    await page.getByTestId('automation-workflow').selectOption('wf1');
    await page.getByTestId('automation-submit').click();
    await expect.poll(() => posted.length).toBeGreaterThan(0);
    expect(posted[0]).toMatchObject({
      triggerKind: 'avant_date',
      triggerConfig: { fieldKey: 'rdv', delai: 48, unite: 'heures' },
      enabled: false,
    });
  });

  test('🔴 le SENS part dans la configuration, et « avant » reste le défaut', async ({ page }) => {
    // Demande de Julien du 2026-09-08. Le défaut compte autant que le choix : les automations déjà en
    // production n'ont pas ce champ, elles valent « avant », et l'écran ne doit pas proposer autre chose
    // au départ, sinon on crée des rappels du mauvais côté sans que personne ne l'ait demandé.
    const posted = await monter(page, [{ key: 'rdv', label: 'Rendez-vous', type: 'datetime' }]);
    await expect(page.getByTestId('avant-date-sens')).toHaveValue('avant');

    await page.getByTestId('automation-name').fill('Relance 3 jours après');
    await page.getByTestId('avant-date-sens').selectOption('apres');
    await page.getByTestId('avant-date-delai').fill('3');
    await page.getByTestId('avant-date-unite').selectOption('jours');
    await page.getByTestId('avant-date-champ').selectOption('rdv');
    await page.getByTestId('automation-workflow').selectOption('wf1');
    await page.getByTestId('automation-submit').click();
    await expect.poll(() => posted.length).toBeGreaterThan(0);
    expect(posted[0]).toMatchObject({
      triggerKind: 'avant_date',
      triggerConfig: { fieldKey: 'rdv', delai: 3, unite: 'jours', sens: 'apres' },
    });
  });

  test('le déclencheur s’annonce « avant ou après », pas seulement « avant »', async ({ page }) => {
    await monter(page, [{ key: 'rdv', label: 'Rendez-vous', type: 'datetime' }]);
    await expect(page.getByTestId('automation-trigger')).toContainText(/avant ou après|before or after/);
  });

  test('sans champ choisi, l’enregistrement reste impossible', async ({ page }) => {
    await monter(page, [{ key: 'rdv', label: 'Rendez-vous', type: 'datetime' }]);
    await page.getByTestId('automation-name').fill('Incomplet');
    await page.getByTestId('automation-workflow').selectOption('wf1');
    await expect(page.getByTestId('automation-submit')).toBeDisabled();
  });
});

/**
 * Garde HubSpot : quand aucun portail n'est relié, le déclencheur « étape de deal » ne doit pas pouvoir
 * être retenu. Il l'était déjà (impossible de choisir une étape, donc impossible d'enregistrer), mais
 * l'option restait sélectionnable et le message renvoyait vers le mauvais écran. Depuis le lot 6c, il ne se crée
 * plus du tout ici : ces cas se jouent sur une automation EXISTANTE de ce type, la seule qui le montre encore.
 */
test.describe('Automation : HubSpot non connecté', () => {
  async function monter(page: import('@playwright/test').Page, automations: unknown[] = [EXISTANTE]) {
    await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
    await page.route('**/api/backend/**', async (route) => {
      const url = route.request().url();
      const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
      // La route répond 200 avec `connected: false` : ce n'est PAS une erreur HTTP. Une première version du
      // mock rendait 409, ce qui poussait l'écran dans l'état « erreur » et non « non connecté ».
      if (url.includes('/hubspot/deal-stages')) return json({ connected: false, pipelines: [] });
      if (url.endsWith('/automations')) return json({ automations });
      if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Relance', graph: { nodes: [], edges: [] } }] });
      if (url.includes('/user-fields')) return json({ fields: [] });
      if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
      return json({});
    });
    await page.goto('/automations');
  }

  test('🔴 le message renvoie vers l’ACCUEIL, là où la connexion se fait vraiment', async ({ page }) => {
    // Il disait « Paramètres », où il n'y a rien pour connecter HubSpot : on envoyait chercher au mauvais
    // endroit exactement au moment où l'utilisateur est bloqué.
    //
    // ⚠️ L'assertion est SCOPÉE au formulaire. Cherchée sur la page entière, elle matchait le lien
    // « Accueil » de la barre latérale et passait quel que soit le message.
    await monter(page);
    await page.getByTestId('automation-modifier-a7').click();
    const bloc = page.getByTestId('automation-form');
    await expect(bloc).toContainText(/Accueil|Home page/);
    await expect(bloc).not.toContainText(/dans Paramètres|in Settings/);
  });

  test('🔴 une fois qu’on SAIT, l’option n’est plus sélectionnable', async ({ page }) => {
    await monter(page);
    await page.getByTestId('automation-modifier-a7').click();
    await expect(page.getByTestId('automation-form')).toContainText(/Accueil|Home page/);
    const option = page.getByTestId('automation-trigger').locator('option[value="hubspot_deal_stage"]');
    await expect(option).toBeDisabled();
    await expect(option).toContainText(/non connecté|not connected/);
  });

  test('🔴 et la création ne peut pas la retenir : l’option n’existe plus à la création', async ({ page }) => {
    await monter(page, []);
    await page.getByTestId('automation-add').click();
    await page.getByTestId('automation-name').fill('Deal gagné');
    await expect(page.getByTestId('automation-trigger').locator('option[value="hubspot_deal_stage"]')).toHaveCount(0);
  });
});

/**
 * 🔴 Déclencheur « le contact arrive d'une publicité WhatsApp » (CTWA).
 *
 * Meta joint l'origine de la pub (`referral.source_id`) au PREMIER message envoyé après le clic, et à lui
 * seul. C'est ce qui permet de router un lead publicitaire vers un scénario d'accueil.
 *
 * La config VIDE veut dire « n'importe quelle pub », à l'INVERSE du déclencheur « tag ajouté » : c'est le
 * montage le plus courant, et il reste borné aux messages venus d'une pub.
 */
test.describe('Automation : déclencheur publicité (CTWA)', () => {
  async function monter(page: import('@playwright/test').Page, posted: Array<Record<string, unknown>>) {
    await page.addInitScript((sess) => window.localStorage.setItem('mba.session', JSON.stringify(sess)), SESSION);
    await page.route('**/api/backend/**', async (route) => {
      const req = route.request();
      const url = req.url();
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (url.endsWith('/automations') && req.method() === 'POST') {
        posted.push(req.postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'a1' }) });
      }
      if (url.endsWith('/automations')) return json({ automations: [] });
      if (url.endsWith('/workflows')) return json({ workflows: [WF] });
      if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
      return json({});
    });
    await page.goto('/automations');
    await page.getByTestId('automation-add').click();
    await page.getByTestId('automation-name').fill('Lead pub');
    await page.getByTestId('automation-trigger').selectOption('ctwa_ad');
  }

  test('🔴 sans identifiant, la config part VIDE : le scénario vaut pour toutes les pubs', async ({ page }) => {
    const posted: Array<Record<string, unknown>> = [];
    await monter(page, posted);
    await expect(page.getByTestId('config-ctwa-ad')).toBeVisible();
    await page.getByTestId('automation-workflow').selectOption('wf1');
    await page.getByTestId('automation-submit').click();

    await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(1);
    expect(posted[0]).toMatchObject({ triggerKind: 'ctwa_ad', triggerConfig: {} });
  });

  test('avec un identifiant, il part dans la config', async ({ page }) => {
    const posted: Array<Record<string, unknown>> = [];
    await monter(page, posted);
    await page.getByTestId('automation-ad-id').fill('120212345678901234');
    await page.getByTestId('automation-workflow').selectOption('wf1');
    await page.getByTestId('automation-submit').click();

    await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(1);
    expect(posted[0]).toMatchObject({ triggerKind: 'ctwa_ad', triggerConfig: { adId: '120212345678901234' } });
  });
});

/**
 * 🔴 Déclencheur « le risque de désengagement d'un contact devient élevé » (lot 7 de l'API publique).
 *
 * Il ne se règle pas, il se constate : la config part VIDE. Ce que l'écran doit dire AVANT la création, parce
 * que ce déclencheur vient d'un chemin de MASSE (le balayage de nuit) et peut lancer des scénarios facturés :
 * un passage et pas un état, jamais la nuit (départ à l'ouverture de l'espace), 200 contacts au plus par jour et
 * par espace, 30 jours entre deux relances d'un même contact, rien pour un désabonné ou un bloqué, et un scénario
 * qui commence par un template.
 */
test.describe('Automation : déclencheur « risque élevé »', () => {
  async function monter(page: import('@playwright/test').Page, posted: Array<Record<string, unknown>>, listees: unknown[] = []) {
    await page.addInitScript((sess) => window.localStorage.setItem('mba.session', JSON.stringify(sess)), SESSION);
    await page.route('**/api/backend/**', async (route) => {
      const req = route.request();
      const url = req.url();
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (url.endsWith('/automations') && req.method() === 'POST') {
        posted.push(req.postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'a1' }) });
      }
      if (url.endsWith('/automations')) return json({ automations: listees });
      if (url.endsWith('/workflows')) return json({ workflows: [WF] });
      if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
      return json({});
    });
    await page.goto('/automations');
  }

  test('🔴 l’écran dit les bornes avant la création, et la config part VIDE', async ({ page }) => {
    const posted: Array<Record<string, unknown>> = [];
    await monter(page, posted);
    await page.getByTestId('automation-add').click();
    await page.getByTestId('automation-name').fill('Relance des partants');
    await page.getByTestId('automation-trigger').selectOption('risque_eleve');
    const explication = page.getByTestId('config-risque-eleve');
    await expect(explication).toContainText('passe en risque élevé');
    await expect(page.getByTestId('config-risque-eleve-depart')).toContainText('ne part jamais la nuit');
    await expect(page.getByTestId('config-risque-eleve-depart')).toContainText('l’ouverture de votre espace');
    await expect(explication).toContainText('Au plus 200 contacts par jour et par espace');
    await expect(explication).toContainText('pas le scénario avant 30 jours');
    await expect(explication).toContainText('désabonné ou bloqué ne déclenche rien');
    await expect(explication).toContainText('commencer par un envoi de template');
    await page.getByTestId('automation-workflow').selectOption('wf1');
    await page.getByTestId('automation-submit').click();

    await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(1);
    expect(posted[0]).toMatchObject({ triggerKind: 'risque_eleve', triggerConfig: {}, enabled: false });
  });

  test('une automation existante se lit en clair dans la liste', async ({ page }) => {
    const listee = { id: 'a9', name: 'Relance', enabled: false, triggerKind: 'risque_eleve', triggerConfig: {}, conditionGroup: null, workflowId: 'wf1', startNodeId: null, cooldownSeconds: null };
    await monter(page, [], [listee]);
    await expect(page.getByText('le risque de désengagement d’un contact devient élevé')).toBeVisible();
  });
});

/**
 * 🔴 Déclencheur « un agent IA déclenche une action » (plan du 2026-10-13). Offert seulement quand un agent porte une
 * action ; la config désigne l'action par l'outil qui la porte ; l'écran dit que le scénario part PENDANT que l'agent
 * parle (seul un scénario fait d'actions le laisse continuer).
 */
test.describe('Automation : déclencheur « action d’un agent IA »', () => {
  const ACTION = { id: '0b7e2c1a-4d5e-4f60-8a9b-1c2d3e4f5a6b', nom: 'Résiliation', agentId: 'ag1', agent: 'Accueil' };
  async function monter(page: import('@playwright/test').Page, posted: Array<Record<string, unknown>>, actions: unknown[], listees: unknown[] = []) {
    await page.addInitScript((sess) => window.localStorage.setItem('mba.session', JSON.stringify(sess)), SESSION);
    await page.route('**/api/backend/**', async (route) => {
      const req = route.request();
      const url = req.url();
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (url.endsWith('/automations') && req.method() === 'POST') {
        posted.push(req.postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'a1' }) });
      }
      if (url.endsWith('/automations/actions-agent')) return json({ actions });
      if (url.endsWith('/automations')) return json({ automations: listees });
      if (url.endsWith('/workflows')) return json({ workflows: [WF] });
      if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
      return json({});
    });
    await page.goto('/automations');
  }

  test('🔴 l’action choisie part dans la config, et l’écran dit que le scénario part pendant que l’agent parle', async ({ page }) => {
    const posted: Array<Record<string, unknown>> = [];
    await monter(page, posted, [ACTION]);
    await page.getByTestId('automation-add').click();
    await page.getByTestId('automation-name').fill('Résiliation : prévenir l’équipe');
    await page.getByTestId('automation-trigger').selectOption('agent_action');
    await expect(page.getByTestId('config-agent-action')).toContainText('pendant que l’agent parle au client');
    await expect(page.getByTestId('config-agent-action')).toContainText('scénario fait d’actions');
    await page.getByTestId('automation-workflow').selectOption('wf1');
    // Sans action choisie, rien ne part.
    await expect(page.getByTestId('automation-submit')).toBeDisabled();
    await page.getByTestId('automation-action').selectOption(ACTION.id);
    await page.getByTestId('automation-submit').click();

    await expect.poll(() => posted.length, { timeout: 10_000 }).toBe(1);
    expect(posted[0]).toMatchObject({ triggerKind: 'agent_action', triggerConfig: { actionId: ACTION.id }, enabled: false });
  });

  test('une automation existante se lit en clair : l’agent et l’action, par leurs noms', async ({ page }) => {
    const listee = { id: 'a9', name: 'Résiliation', enabled: false, triggerKind: 'agent_action', triggerConfig: { actionId: ACTION.id }, conditionGroup: null, workflowId: 'wf1', startNodeId: null, cooldownSeconds: null };
    await monter(page, [], [ACTION], [listee]);
    await expect(page.getByText('l’agent IA Accueil déclenche l’action « Résiliation »')).toBeVisible();
  });

  test('aucune action posée : l’option n’existe pas', async ({ page }) => {
    await monter(page, [], []);
    // La liste des actions est lue avec celle des automations : son état vide prouve que la lecture a eu lieu.
    await expect(page.getByText('Aucune automation')).toBeVisible();
    await page.getByTestId('automation-add').click();
    await expect(page.getByTestId('automation-trigger').locator('option[value="agent_action"]')).toHaveCount(0);
  });
});

/**
 * La case d'accord marketing (lot 3b du plan mm-hubspot du 2026-11-02, décisions 6 et B) : pour TOUS les déclencheurs, un
 * booléen seulement (le serveur pose qui et quand), remise à faux par Annuler, rechargée à l'édition avec son tampon.
 */
test.describe('Automation : la case d’accord marketing', () => {
  const ATTESTEE = {
    id: 'a1', name: 'Demande de RDV', enabled: false, triggerKind: 'keyword', triggerConfig: { keywords: ['rdv'], mode: 'contains' },
    conditionGroup: null, workflowId: 'wf1', startNodeId: null, cooldownSeconds: null,
    accordMarketing: { par: 'u1', email: 'marie@e2e.test', le: '2026-11-02T09:30:00.000Z' },
  };

  async function ouvrir(page: import('@playwright/test').Page, automations: unknown[]) {
    const posted: Array<Record<string, unknown>> = [];
    const patched: Array<Record<string, unknown>> = [];
    await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
    await page.route('**/api/backend/**', async (route) => {
      const req = route.request();
      const url = req.url();
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (url.endsWith('/automations') && req.method() === 'POST') {
        posted.push(req.postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'a2' }) });
      }
      if (/\/automations\/a1$/.test(url) && req.method() === 'PATCH') {
        patched.push(req.postDataJSON() as Record<string, unknown>);
        return json({ id: 'a1' });
      }
      if (url.endsWith('/automations')) return json({ automations });
      if (url.endsWith('/workflows')) return json({ workflows: [WF] });
      if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
      return json({});
    });
    await page.goto('/automations');
    return { posted, patched };
  }

  test('🔴 cochée, la création envoie le booléen seul ; décochée par défaut, elle envoie faux', async ({ page }) => {
    const { posted } = await ouvrir(page, []);
    await page.getByTestId('automation-add').click();
    await expect(page.getByTestId('automation-accord-case')).not.toBeChecked();
    await page.getByTestId('automation-name').fill('Avec accord');
    await page.getByTestId('automation-keywords').fill('rdv');
    await page.getByTestId('automation-workflow').selectOption('wf1');
    await page.getByTestId('automation-accord-case').check();
    await page.getByTestId('automation-submit').click();
    await expect.poll(() => posted.length).toBe(1);
    // Le corps ne porte que la case : qui et quand sont posés par le serveur depuis la session.
    expect(posted[0]!.accordMarketing).toBe(true);
  });

  test('🔴 Annuler remet la case à faux : la création suivante n’atteste rien', async ({ page }) => {
    const { posted } = await ouvrir(page, []);
    await page.getByTestId('automation-add').click();
    await page.getByTestId('automation-accord-case').check();
    await page.getByRole('button', { name: 'Annuler' }).click();
    await page.getByTestId('automation-add').click();
    await expect(page.getByTestId('automation-accord-case')).not.toBeChecked();
    await page.getByTestId('automation-name').fill('Sans accord');
    await page.getByTestId('automation-keywords').fill('rdv');
    await page.getByTestId('automation-workflow').selectOption('wf1');
    await page.getByTestId('automation-submit').click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]!.accordMarketing).toBe(false);
  });

  test('🔴 l’édition recharge la case et dit qui l’a cochée et quand ; décochée, elle part à faux', async ({ page }) => {
    const { patched } = await ouvrir(page, [ATTESTEE]);
    await page.getByTestId('automation-modifier-a1').click();
    await expect(page.getByTestId('automation-accord-case')).toBeChecked();
    await expect(page.getByTestId('automation-accord-tampon')).toContainText('marie@e2e.test');
    await expect(page.getByTestId('automation-accord-tampon')).toContainText('02/11/2026');
    await page.getByTestId('automation-accord-case').uncheck();
    await expect(page.getByTestId('automation-accord-tampon')).toHaveCount(0);
    await page.getByTestId('automation-submit').click();
    await expect.poll(() => patched.length).toBe(1);
    expect(patched[0]!.accordMarketing).toBe(false);
  });

  test('une API d’avant le lot (sans le champ) se lit comme non attestée', async ({ page }) => {
    const { accordMarketing: _retire, ...ancienne } = ATTESTEE;
    await ouvrir(page, [ancienne]);
    await page.getByTestId('automation-modifier-a1').click();
    await expect(page.getByTestId('automation-accord-case')).not.toBeChecked();
  });
});
