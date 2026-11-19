import { test, expect, type Page } from './aide/test';
import { repondre } from './aide/confirmation';

/**
 * AUTOMATION > HUBSPOT, VU DE L'ÉCRAN (menu « Scénario », lot 6c) : les trois familles (changement d'étape d'un deal,
 * rendez-vous, scénario lancé par un workflow HubSpot), leurs lignes, leur « Ajouter » qui ouvre le builder sur le scénario
 * créé, l'interrupteur, la suppression ; « Autres » ne crée plus de changement d'étape ; le builder d'un scénario HubSpot.
 * L'API (6b) tient ses règles de son côté ; ici, on regarde ce que l'écran MONTRE et ce qu'il ENVOIE, contre une API
 * simulée sur le contrat du plan (`GET/POST/PUT/DELETE /tenants/:tenantId/hubspot/lignes`).
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

const commun = {
  actif: true, scenario: 'Scénario', modele: 'relance', langue: 'fr', etatChezMeta: 'APPROVED', blocs: 1, versionProgrammee: false,
};
const ETAPE = { ...commun, id: 'e1', workflowId: 'wf-e1', famille: 'etape', config: { pipelineId: 'default', stageId: 'rdv', stageLabel: 'Rendez-vous' } };
const RDV = {
  ...commun, id: 'r1', workflowId: 'wf-r1', famille: 'rdv', actif: false, modele: null, langue: null, etatChezMeta: null,
  config: { fieldKey: 'hs_contact_date_rdv', sens: 'avant', delaiMinutes: 180 },
};
const WORKFLOW = { ...commun, id: 'w1', workflowId: 'wf-w1', famille: 'workflow', scenario: 'Relance devis', etatChezMeta: 'PENDING', config: {} };

const PIPELINES = [
  { id: 'default', label: 'Pipeline de vente', stages: [{ id: 'rdv', label: 'Rendez-vous pris', closed: false }, { id: 'won', label: 'Gagné', closed: true }] },
  { id: 'renew', label: 'Renouvellement', stages: [{ id: 'relance', label: 'À relancer', closed: false }] },
];
const CHAMPS = [
  { key: 'hs_contact_date_rdv', label: 'Date du RDV (HubSpot)', type: 'datetime' },
  { key: 'hs_deal_closedate', label: 'Date de clôture (HubSpot)', type: 'date' },
  { key: 'hs_contact_ville', label: 'Ville (HubSpot)', type: 'text' },
  { key: 'rappel', label: 'Rappel', type: 'datetime' },
];
/** Le refus de l'API quand on allume une ligne sans premier template publié (contrat : 409, `a_completer`). */
const REFUS_A_COMPLETER = 'Écrivez et publiez d’abord le premier message de son scénario.';

interface Trace {
  creations: unknown[];
  reglages: Array<{ id: string; corps: unknown }>;
  suppressions: string[];
  noms: Array<{ id: string; corps: unknown }>;
  appelsEtapes: number;
}

async function monter(page: Page, o: {
  etat?: Record<string, unknown> | 'absente'; champs?: unknown[]; automations?: unknown[]; refusAllumage?: boolean;
  /** Sa page depuis le lot 7 ; `/automations` pour les « Autres ». */
  ecran?: string;
} = {}): Promise<Trace> {
  const trace: Trace = { creations: [], reglages: [], suppressions: [], noms: [], appelsEtapes: 0 };
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  const etat = o.etat ?? { connecte: true, lignes: [ETAPE, RDV, WORKFLOW] };
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = req.url().split('?')[0]!;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    const ligne = /\/hubspot\/lignes\/([^/]+)$/.exec(chemin);
    if (ligne && req.method() === 'PUT') {
      const corps = req.postDataJSON() as { actif: boolean };
      trace.reglages.push({ id: ligne[1]!, corps });
      if (corps.actif && o.refusAllumage) return json({ error: REFUS_A_COMPLETER, code: 'a_completer' }, 409);
      return json({ ligne: { id: ligne[1], actif: corps.actif } });
    }
    if (ligne && req.method() === 'DELETE') {
      trace.suppressions.push(ligne[1]!);
      return route.fulfill({ status: 204 });
    }
    if (chemin.endsWith('/hubspot/lignes') && req.method() === 'POST') {
      const corps = req.postDataJSON() as { famille: string; config: unknown };
      trace.creations.push(corps);
      return json({ ligne: { ...commun, id: 'nouvelle', workflowId: 'wf-nouveau', actif: false, modele: null, ...corps } }, 201);
    }
    if (chemin.endsWith('/hubspot/lignes')) {
      // Le 404 exact du routeur Fastify : c'est lui qui dit « API pas encore déployée ».
      if (etat === 'absente') return json({ message: 'Route GET not found', error: 'Not Found', statusCode: 404 }, 404);
      return json(etat);
    }
    if (chemin.endsWith('/hubspot/deal-stages')) { trace.appelsEtapes += 1; return json({ connected: true, pipelines: PIPELINES }); }
    if (/\/workflows\/[^/]+$/.test(chemin) && req.method() === 'PATCH') {
      trace.noms.push({ id: chemin.split('/').at(-1)!, corps: req.postDataJSON() });
      return json({ ok: true });
    }
    if (chemin.endsWith('/user-fields')) return json({ fields: o.champs ?? CHAMPS });
    if (chemin.endsWith('/automations')) return json({ automations: o.automations ?? [] });
    if (chemin.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: 'Prise de RDV', graph: { nodes: [], edges: [] } }] });
    if (chemin.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  await page.goto(o.ecran ?? '/automations/hubspot');
  return trace;
}

test.describe('Automation > HubSpot : les automations que HubSpot lance (menu « Scénario », lot 6c)', () => {
  test('🔴 sans portail relié : la page dit de le relier, et aucune ligne', async ({ page }) => {
    await monter(page, { etat: { connecte: false, lignes: [ETAPE] } });
    await expect(page.getByTestId('automations-hubspot-sans-portail')).toContainText('Tools > Intégrations');
    await expect(page.getByTestId('automations-hubspot')).toHaveCount(0);
  });

  test('🔴 l’API sans la route (pas encore déployée, 404 du routeur) : la page dit l’échec de la lecture, sans ligne', async ({ page }) => {
    await monter(page, { etat: 'absente' });
    await expect(page.getByTestId('automations-hubspot-panne')).toBeVisible();
    await expect(page.getByTestId('automations-hubspot')).toHaveCount(0);
  });

  test('🔴 les trois familles, chacune ses lignes : libellé, état, interrupteur et scénario', async ({ page }) => {
    const trace = await monter(page);
    const section = page.getByTestId('automations-hubspot');
    await expect(section.getByTestId('automations-hubspot-famille-etape')).toContainText('Changement d’étape d’un deal');
    await expect(section.getByTestId('automations-hubspot-famille-rdv')).toContainText('Rendez-vous');
    await expect(section.getByTestId('automations-hubspot-famille-workflow')).toContainText('Lancés par un workflow HubSpot');
    // Une étape : « Pipeline › Étape », les libellés lus chez HubSpot (« Rendez-vous pris », pas celui gardé à la création).
    await expect(section.getByTestId('automations-hubspot-libelle-e1')).toHaveText('Pipeline de vente › Rendez-vous pris');
    await expect(section.getByTestId('automations-hubspot-etat-e1')).toHaveText('active');
    await expect(section.getByTestId('automations-hubspot-interrupteur-e1')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('automations-hubspot-ouvrir-e1')).toHaveAttribute('href', '/workflows?open=wf-e1');
    // Un rendez-vous : « 3 h avant « Date du RDV » », éteint et sans premier message : à compléter.
    await expect(section.getByTestId('automations-hubspot-libelle-r1')).toHaveText('3 h avant « Date du RDV (HubSpot) »');
    await expect(section.getByTestId('automations-hubspot-etat-r1')).toContainText('à compléter');
    await expect(section.getByTestId('automations-hubspot-interrupteur-r1')).toHaveAttribute('aria-pressed', 'false');
    // Un scénario lancé par un workflow : son nom, celui que l'action de HubSpot propose.
    await expect(section.getByTestId('automations-hubspot-libelle-w1')).toHaveText('Relance devis');
    await expect(section.getByTestId('automations-hubspot-etat-w1')).toHaveText('en validation chez Meta');
    await expect(section.getByTestId('automations-hubspot-ouvrir-w1')).toHaveAttribute('href', '/workflows?open=wf-w1');
    // Les étapes du portail ne sont lues qu'une fois, pour le nom du pipeline.
    expect(trace.appelsEtapes).toBe(1);
  });

  test('une famille sans ligne le dit, et les étapes du portail ne sont pas lues sans ligne d’étape', async ({ page }) => {
    const trace = await monter(page, { etat: { connecte: true, lignes: [WORKFLOW] } });
    await expect(page.getByTestId('automations-hubspot-vide-etape')).toHaveText('Aucune étape réglée.');
    await expect(page.getByTestId('automations-hubspot-vide-rdv')).toHaveText('Aucun rendez-vous réglé.');
    await expect(page.getByTestId('automations-hubspot-libelle-w1')).toBeVisible();
    expect(trace.appelsEtapes).toBe(0);
  });

  test('🔴 « Ajouter » une étape : groupée par pipeline, l’étape déjà réglée grisée ; le POST porte pipeline, étape et libellé, puis le builder s’ouvre', async ({ page }) => {
    const trace = await monter(page, { etat: { connecte: true, lignes: [ETAPE] } });
    await page.getByTestId('automations-hubspot-ajouter-etape').click();
    const menu = page.getByTestId('automations-hubspot-etape-choix');
    await expect(menu.locator('optgroup')).toHaveCount(2);
    await expect(menu.locator('option[value="default::rdv"]')).toBeDisabled();
    await expect(menu.locator('option[value="default::rdv"]')).toContainText('déjà réglée');
    await expect(menu.locator('option[value="default::won"]')).toContainText('étape de fin');
    // Sans étape choisie, rien ne part : une ligne sans étape partirait sur tous les changements du portail.
    const creer = page.getByTestId('automations-hubspot-creer-etape');
    await expect(creer).toBeDisabled();
    await menu.selectOption('renew::relance');
    await creer.click();
    await expect.poll(() => trace.creations).toEqual([{ famille: 'etape', config: { pipelineId: 'renew', stageId: 'relance', stageLabel: 'À relancer' } }]);
    await expect(page).toHaveURL(/\/workflows\?open=wf-nouveau$/);
    expect(trace.appelsEtapes).toBe(1);
  });

  test('🔴 « Ajouter » un rendez-vous : seuls les champs « date et heure » importés de HubSpot ; le POST porte le champ, le sens et le délai en minutes', async ({ page }) => {
    const trace = await monter(page, { etat: { connecte: true, lignes: [] } });
    await page.getByTestId('automations-hubspot-ajouter-rdv').click();
    const champ = page.getByTestId('automations-hubspot-rdv-champ');
    await expect(champ.locator('option')).toHaveText(['Choisir un champ…', 'Date du RDV (HubSpot)']);
    await expect(page.getByTestId('automations-hubspot-rdv-sens')).toHaveValue('avant');
    const creer = page.getByTestId('automations-hubspot-creer-rdv');
    await expect(creer).toBeDisabled();
    await page.getByTestId('automations-hubspot-rdv-delai').fill('2');
    await page.getByTestId('automations-hubspot-rdv-unite').selectOption('jours');
    await page.getByTestId('automations-hubspot-rdv-sens').selectOption('apres');
    await champ.selectOption('hs_contact_date_rdv');
    await creer.click();
    await expect.poll(() => trace.creations).toEqual([{ famille: 'rdv', config: { fieldKey: 'hs_contact_date_rdv', sens: 'apres', delaiMinutes: 2880 } }]);
    await expect(page).toHaveURL(/\/workflows\?open=wf-nouveau$/);
  });

  test('sans champ « date et heure » importé de HubSpot, le formulaire dit où le choisir, et rien ne part', async ({ page }) => {
    await monter(page, { etat: { connecte: true, lignes: [] }, champs: [{ key: 'rappel', label: 'Rappel', type: 'datetime' }] });
    await page.getByTestId('automations-hubspot-ajouter-rdv').click();
    await expect(page.getByTestId('automations-hubspot-rdv-aucun-champ')).toContainText('Tools > Intégrations > HubSpot');
    await expect(page.getByTestId('automations-hubspot-creer-rdv')).toBeDisabled();
  });

  test('🔴 « Ajouter » un scénario lancé par un workflow : son nom part sur le scénario créé, puis le builder s’ouvre', async ({ page }) => {
    const trace = await monter(page, { etat: { connecte: true, lignes: [] } });
    await page.getByTestId('automations-hubspot-ajouter-workflow').click();
    const creer = page.getByTestId('automations-hubspot-creer-workflow');
    await expect(creer).toBeDisabled();
    await page.getByTestId('automations-hubspot-workflow-nom').fill('  Relance après devis ');
    await creer.click();
    await expect.poll(() => trace.creations).toEqual([{ famille: 'workflow', config: {} }]);
    await expect.poll(() => trace.noms).toEqual([{ id: 'wf-nouveau', corps: { name: 'Relance après devis' } }]);
    await expect(page).toHaveURL(/\/workflows\?open=wf-nouveau$/);
  });

  test('🔴 l’interrupteur envoie { actif } et l’écran reste ; allumer sans premier message : la raison de l’API s’affiche', async ({ page }) => {
    const trace = await monter(page, { refusAllumage: true });
    await page.getByTestId('automations-hubspot-interrupteur-e1').click();
    await expect.poll(() => trace.reglages).toEqual([{ id: 'e1', corps: { actif: false } }]);
    await page.getByTestId('automations-hubspot-interrupteur-r1').click();
    await expect.poll(() => trace.reglages.length).toBe(2);
    expect(trace.reglages[1]).toEqual({ id: 'r1', corps: { actif: true } });
    await expect(page.getByTestId('automations-hubspot-erreur')).toHaveText(REFUS_A_COMPLETER);
    await expect(page).toHaveURL(/\/automations\/hubspot$/);
  });

  test('🔴 la suppression se confirme, puis part ; annulée, rien ne part', async ({ page }) => {
    const trace = await monter(page);
    await page.getByTestId('automations-hubspot-supprimer-w1').click();
    // Un scénario lancé par un workflow : la question dit que HubSpot ne pourra plus le lancer.
    await repondre(page, false, 'Les workflows HubSpot qui le lancent ne le pourront plus');
    expect(trace.suppressions).toEqual([]);
    await page.getByTestId('automations-hubspot-supprimer-w1').click();
    await repondre(page, true, 'ses parcours en cours s’arrêtent');
    await expect.poll(() => trace.suppressions).toEqual(['w1']);
  });

  test('🔴 « Autres » ne propose plus le changement d’étape HubSpot à la création', async ({ page }) => {
    await monter(page, { ecran: '/automations' });
    // Les automations HubSpot ont leur page depuis le lot 7 : plus aucune section sur « Autres ».
    await expect(page.getByTestId('automations-hubspot')).toHaveCount(0);
    await page.getByTestId('automation-add').click();
    const declencheur = page.getByTestId('automation-trigger');
    await expect(declencheur.locator('option[value="hubspot_deal_stage"]')).toHaveCount(0);
    // On masque UNE option, pas la liste.
    await expect(declencheur.locator('option[value="avant_date"]')).toHaveCount(1);
  });
});

/**
 * LE BUILDER D'UN SCÉNARIO HUBSPOT (lot 6c) : son premier bloc est verrouillé comme celui d'un scénario Shopify (la
 * marque posée par le serveur), il dit que HubSpot l'envoie, et ses variables lisent la fiche du contact (décision 38) :
 * les champs HubSpot importés, jamais les données d'un événement Shopify.
 */
test.describe('Éditeur : un scénario HubSpot (lot 6c)', () => {
  const GRAPHE = {
    nodes: [
      { id: 'n1', type: 'template', position: { x: 0, y: 0 }, data: { wfType: 'template', templateName: 'rappel_rdv', language: 'fr', templateButtons: [], verrouille: true } },
      { id: 'n2', type: 'quick_message', position: { x: 0, y: 200 }, data: { wfType: 'quick_message', body: 'À très vite !' } },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  };
  const TEMPLATE = {
    id: 'id-rappel', name: 'rappel_rdv', status: 'APPROVED', category: 'UTILITY', language: 'fr',
    body: 'Bonjour {{1}}, votre rendez-vous est le {{2}}.', headerFormat: null, isCarousel: false, editable: true, buttons: [],
  };

  test('🔴 le premier bloc : verrouillé, il dit que HubSpot l’envoie ; ses variables proposent les champs de la fiche, aucune donnée Shopify', async ({ page }) => {
    await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
    const wf = { id: 'wf-h', name: 'Rappel de rendez-vous', rayon: 'hubspot', graph: GRAPHE, draftGraph: GRAPHE, createdAt: '', updatedAt: '' };
    await page.route('**/api/backend/**', async (route) => {
      const req = route.request();
      const url = req.url();
      const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
      if (req.method() === 'PATCH' && /\/workflows\/wf-h$/.test(url)) return json({ ok: true, brouillon: true });
      if (/\/workflows\/wf-h\/modeles$/.test(url)) return json({ modeles: [], programmee: null });
      if (/\/workflows\/wf-h$/.test(url)) return json({ workflow: wf });
      if (url.endsWith('/workflows')) return json({ workflows: [] });
      if (/\/nodes(\?|$)/.test(url)) return json({ nodes: [] });
      if (url.includes('/param-hints')) return json({ hints: [] });
      if (url.includes('/email/accounts')) return json({ accounts: [] });
      if (url.includes('/email/templates')) return json({ templates: [] });
      if (url.includes('/templates')) return json({ templates: [TEMPLATE] });
      if (url.includes('/flows')) return json({ flows: [] });
      if (url.includes('/tags')) return json({ tags: [] });
      if (url.includes('/user-fields/usage')) return json({ total: 0, parChamp: {} });
      if (url.includes('/user-fields')) return json({ fields: CHAMPS });
      if (url.includes('/settings')) return json({ mbaEnabled: false, rcsEnabled: false, hubspotListsEnabled: false, campaignsPaused: false });
      if (url.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
      return json({});
    });
    await page.goto('/workflows?open=wf-h');
    const premier = page.locator('.react-flow__node[data-id="n1"]');
    await expect(page.getByTestId('wf-premier-bloc-n1')).toBeVisible();
    await expect(premier.getByTitle('Supprimer le bloc')).toHaveCount(0);
    await premier.click();
    const panneau = page.getByTestId('panneau-premier-bloc');
    await expect(panneau).toContainText('il part à chaque événement HubSpot');
    await expect(panneau).not.toContainText('Shopify');
    const v2 = page.getByTestId('template-node-variable-2');
    await expect(v2.locator('option[value="field:hs_contact_date_rdv"]')).toHaveCount(1);
    await expect(v2.locator('option[value^="var:"]')).toHaveCount(0);
  });
});
