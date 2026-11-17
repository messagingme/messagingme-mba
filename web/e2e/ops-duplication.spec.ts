import { test, expect } from './aide/test';

/**
 * L'ONGLET « DUPLIQUER » DE `/ops` (duplication d'un scénario entre espaces, lot 1 ; routes `/ops/duplication`, tenues
 * côté serveur par `tests/ops-duplication.test.ts`).
 *
 * Ce que ces tests protègent à l'écran : les trois choix puis le récapitulatif (blocs débranchés, champs créés et en
 * conflit, déclencheurs copiés éteints ou retirés, signaux), le bouton grisé sur un blocage, la copie et son résultat,
 * l'empreinte périmée qui propose de relancer l'aperçu, la session perdue, et une API plus ancienne qui dit « pas encore
 * disponible ».
 */
const SESSION_OPS = { token: 'session-ops-e2e', email: 'exploitant@e2e.test' };
const SRC = '4169c753-311a-43bb-a334-d8a2cb7caf6f';
const DST = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const SANS = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const WF = '0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';

const APERCU = {
  nomCopie: 'Accueil (copie)',
  debranches: [
    { nodeId: 'a3', nom: 'Vers le RDV', type: 'aller_a', raison: 'aller_a' },
    { nodeId: 'i4', nom: 'Passer à Léa', type: 'inbox', raison: 'assignation' },
  ],
  templates: [{ nom: 'bienvenue', langue: 'fr' }],
  champsACreer: [{ key: 'ville', label: 'Ville', type: 'text' }],
  champsEnConflit: [{ cle: 'score', typeSource: 'number', typeDestination: 'text' }],
  champsInconnus: [],
  templatesAbsents: [],
  templatesNonApprouves: [],
  declencheursCopies: [{ nom: 'Accueil', type: 'keyword' }],
  declencheursRetires: [{ nom: 'Lead HubSpot', raison: 'lie_a_la_source' }],
  motsRetires: [{ nom: 'Accueil', mots: ['promo'] }],
  signaux: ['l’offre de la destination n’inclut pas les scénarios'],
  blocages: [],
  empreinte: 'a'.repeat(64),
  dependances: {
    agents: [{
      id: 'ag-1', nom: 'Conseiller', nomCopie: 'Conseiller (copie)', fiches: 3,
      outilsCopies: [{ nom: 'creer_lead', nomCopie: 'creer_lead' }],
      outilsNonCopies: [{ nom: 'agenda', raison: 'mcp' }],
    }],
    requetes: [{ id: 'rq-1', nom: 'Créer le lead', nomCopie: 'Créer le lead', source: { nom: 'CRM', nomCopie: 'CRM', secret: true } }],
    modelesEmail: [{ id: 'me-1', nom: 'Confirmation', nomCopie: 'Confirmation' }],
  },
};

interface Options {
  espaces?: { status: number; body: unknown };
  apercu?: { status: number; body: unknown };
  duplication?: { status: number; body: unknown };
  /** Les réponses successives de la liste des scénarios (une panne, puis la liste). */
  scenarios?: Array<{ status: number; body: unknown }>;
  /** Le temps que met la duplication à répondre, pour voir les listes grisées pendant la copie. */
  attenteDuplicationMs?: number;
}

async function ouvrir(page: import('@playwright/test').Page, o: Options = {}) {
  const envois: unknown[] = [];
  const scenarios = [...(o.scenarios ?? [])];
  await page.addInitScript((s) => window.localStorage.setItem('mba.sessionOps', JSON.stringify(s)), SESSION_OPS);
  await page.route('**/api/backend/**', async (route) => {
    const chemin = route.request().url().split('?')[0]!;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/ops/duplication/espaces')) {
      const e = o.espaces ?? { status: 200, body: { espaces: [
        { id: SRC, nom: 'Source', waba: true }, { id: DST, nom: 'Destination', waba: true }, { id: SANS, nom: 'Sans numéro', waba: false },
      ] } };
      return json(e.body, e.status);
    }
    if (chemin.includes('/ops/duplication/espaces/') && chemin.endsWith('/scenarios')) {
      const r = scenarios.shift() ?? { status: 200, body: { scenarios: [{ id: WF, nom: 'Accueil' }] } };
      return json(r.body, r.status);
    }
    if (chemin.endsWith('/ops/duplication/apercu')) {
      const a = o.apercu ?? { status: 200, body: { apercu: APERCU } };
      return json(a.body, a.status);
    }
    if (chemin.endsWith('/ops/duplication')) {
      envois.push(route.request().postDataJSON());
      if (o.attenteDuplicationMs) await new Promise((r) => setTimeout(r, o.attenteDuplicationMs));
      const d = o.duplication ?? { status: 201, body: {
        scenarioId: 'wf-copie', nom: 'Accueil (copie)', champsCrees: ['ville'], declencheursCopies: 1,
        debranches: APERCU.debranches, declencheursRetires: APERCU.declencheursRetires, motsRetires: APERCU.motsRetires,
        dependancesCopiees: { agents: ['Conseiller (copie)'], requetes: [], modelesEmail: [], sourcesAvecSecret: ['CRM'] },
      } };
      return json(d.body, d.status);
    }
    return json({});
  });
  await page.goto('/ops?tab=dupliquer');
  return { envois };
}

async function choisirTout(page: import('@playwright/test').Page) {
  await page.getByTestId('ops-duplication-source').selectOption(SRC);
  await page.getByTestId('ops-duplication-scenario').selectOption(WF);
  await page.getByTestId('ops-duplication-destination').selectOption(DST);
}

test.describe('Ops : l’onglet Dupliquer', () => {
  test('🔴 les trois choix, le récapitulatif, puis la copie et son résultat', async ({ page }) => {
    const { envois } = await ouvrir(page);
    await expect(page.getByTestId('mba-tab-dupliquer')).toHaveAttribute('aria-selected', 'true');
    // La destination ne propose pas la source, et dit qui n'a pas de WABA.
    await page.getByTestId('ops-duplication-source').selectOption(SRC);
    await expect(page.getByTestId('ops-duplication-destination').locator('option')).toHaveText(['Choisir…', 'Destination', 'Sans numéro (sans WABA)']);
    await choisirTout(page);
    const recap = page.getByTestId('ops-duplication-recapitulatif');
    await expect(recap).toContainText('« Accueil (copie) » dans Destination');
    await expect(page.getByTestId('ops-duplication-debranches')).toContainText('Vers le RDV : « aller vers » débranché');
    await expect(page.getByTestId('ops-duplication-debranches')).toContainText('Passer à Léa : assignation retirée');
    await expect(page.getByTestId('ops-duplication-champs')).toContainText('Ville (ville, text) : créé');
    await expect(page.getByTestId('ops-duplication-champs')).toContainText('score : number dans la source, text dans la destination');
    await expect(page.getByTestId('ops-duplication-templates')).toContainText('bienvenue (fr)');
    await expect(page.getByTestId('ops-duplication-declencheurs')).toContainText('Accueil (keyword) : copié, éteint');
    await expect(page.getByTestId('ops-duplication-declencheurs')).toContainText('déjà pris dans la destination : promo');
    await expect(page.getByTestId('ops-duplication-declencheurs')).toContainText('Lead HubSpot : ne suit pas');
    await expect(page.getByTestId('ops-duplication-signaux')).toContainText('n’inclut pas les scénarios');

    await page.getByTestId('ops-duplication-bouton').click();
    await expect(page.getByTestId('ops-duplication-resultat')).toContainText('« Accueil (copie) », inactive, en brouillon');
    expect(envois).toEqual([{
      source: SRC, scenarioId: WF, destination: DST, empreinte: 'a'.repeat(64), dupliquer: { agents: [], requetes: [], modelesEmail: [] },
    }]);
  });

  test('🔴 un blocage : le récapitulatif le dit et le bouton reste grisé', async ({ page }) => {
    await ouvrir(page, { apercu: { status: 200, body: { apercu: { ...APERCU, blocages: ['l’espace de destination n’a pas de WABA'] } } } });
    await choisirTout(page);
    await expect(page.getByTestId('ops-duplication-blocages')).toContainText('pas de WABA');
    await expect(page.getByTestId('ops-duplication-bouton')).toBeDisabled();
  });

  test('🔴 l’état a changé depuis l’aperçu (409) : le message, et le bouton pour relancer l’aperçu', async ({ page }) => {
    await ouvrir(page, { duplication: { status: 409, body: { error: 'le scénario ou l’espace de destination a changé : relancez l’aperçu' } } });
    await choisirTout(page);
    await page.getByTestId('ops-duplication-bouton').click();
    await expect(page.getByTestId('ops-duplication-erreur-copie')).toContainText('relancez l’aperçu');
    await page.getByTestId('ops-duplication-relancer').click();
    await expect(page.getByTestId('ops-duplication-recapitulatif')).toBeVisible();
    await expect(page.getByTestId('ops-duplication-erreur-copie')).toHaveCount(0);
  });

  test('changer un choix efface l’aperçu', async ({ page }) => {
    await ouvrir(page);
    await choisirTout(page);
    await expect(page.getByTestId('ops-duplication-recapitulatif')).toBeVisible();
    await page.getByTestId('ops-duplication-destination').selectOption('');
    await expect(page.getByTestId('ops-duplication-recapitulatif')).toHaveCount(0);
  });

  test('la session perdue (401) ramène à la connexion', async ({ page }) => {
    await ouvrir(page, { apercu: { status: 401, body: { error: 'session expirée' } } });
    await choisirTout(page);
    await expect(page.getByTestId('ops-connexion')).toBeVisible();
  });

  test('une API plus ancienne (404) : « pas encore disponible », pas une erreur brute', async ({ page }) => {
    await ouvrir(page, { espaces: { status: 404, body: { message: 'Route GET:/ops/duplication/espaces not found' } } });
    await expect(page.getByTestId('ops-duplication-erreur')).toContainText(/pas encore disponible/);
  });
});

test.describe('Ops : l’onglet Dupliquer, les dépendances (lot 2)', () => {
  test('🔴 une case par dépendance, décochée ; le secret et les outils qui ne suivent pas sont dits ; le corps porte les cases cochées', async ({ page }) => {
    const { envois } = await ouvrir(page);
    await choisirTout(page);
    const deps = page.getByTestId('ops-duplication-dependances');
    await expect(deps).toContainText('Conseiller (copié sous « Conseiller (copie) »)');
    await expect(page.getByTestId('ops-duplication-case-agent-ag-1')).not.toBeChecked();
    await expect(page.getByTestId('ops-duplication-case-requete-rq-1')).not.toBeChecked();
    await expect(page.getByTestId('ops-duplication-case-modele-me-1')).not.toBeChecked();
    await expect(page.getByTestId('ops-duplication-secret')).toContainText('secret copié');
    await expect(page.getByTestId('ops-duplication-outil-non-copie')).toContainText('agenda ne suit pas : outil MCP');

    await page.getByTestId('ops-duplication-case-agent-ag-1').check();
    await page.getByTestId('ops-duplication-case-requete-rq-1').check();
    // Une case ne touche pas à l'aperçu.
    await expect(page.getByTestId('ops-duplication-recapitulatif')).toBeVisible();
    await page.getByTestId('ops-duplication-bouton').click();
    await expect(page.getByTestId('ops-duplication-resultat')).toContainText('Copiés avec lui : Conseiller (copie) (secret copié : CRM)');
    expect(envois).toEqual([{
      source: SRC, scenarioId: WF, destination: DST, empreinte: 'a'.repeat(64), dupliquer: { agents: ['ag-1'], requetes: ['rq-1'], modelesEmail: [] },
    }]);
  });

  test('les listes et les cases sont grisées pendant la copie', async ({ page }) => {
    await ouvrir(page, { attenteDuplicationMs: 2_000 });
    await choisirTout(page);
    await page.getByTestId('ops-duplication-bouton').click();
    await expect(page.getByTestId('ops-duplication-source')).toBeDisabled();
    await expect(page.getByTestId('ops-duplication-destination')).toBeDisabled();
    await expect(page.getByTestId('ops-duplication-case-agent-ag-1')).toBeDisabled();
    await expect(page.getByTestId('ops-duplication-resultat')).toBeVisible();
  });

  test('choisir comme source l’espace déjà choisi en destination vide la destination', async ({ page }) => {
    await ouvrir(page);
    await page.getByTestId('ops-duplication-source').selectOption(SRC);
    await page.getByTestId('ops-duplication-destination').selectOption(DST);
    await page.getByTestId('ops-duplication-source').selectOption(DST);
    await expect(page.getByTestId('ops-duplication-destination')).toHaveValue('');
  });

  test('une panne du chargement des scénarios garde son message et propose « Réessayer »', async ({ page }) => {
    await ouvrir(page, { scenarios: [{ status: 500, body: { error: 'base en panne' } }] });
    await page.getByTestId('ops-duplication-source').selectOption(SRC);
    await expect(page.getByTestId('ops-duplication-erreur-scenarios')).toContainText('Scénarios illisibles');
    // Un autre choix ne fait pas disparaître l'erreur.
    await page.getByTestId('ops-duplication-destination').selectOption(DST);
    await expect(page.getByTestId('ops-duplication-erreur-scenarios')).toBeVisible();
    await page.getByTestId('ops-duplication-reessayer').click();
    await expect(page.getByTestId('ops-duplication-scenario').locator('option')).toHaveText(['Choisir…', 'Accueil']);
  });
});
