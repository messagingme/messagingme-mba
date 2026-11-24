import { test, expect, type Page } from './aide/test';

/**
 * LA CARTE QUI ACCOMPAGNE, SUR LE PARCOURS AGENT IA (plan 2026-11-24-guide-demarrage, lot 3). Ce que seul un test de bout
 * en bout voit : lancée depuis « Bien démarrer », la carte suit la personne de l'Accueil à la fiche de l'agent, cadre
 * l'élément à toucher, passe seule à l'étape suivante quand le geste est fait (agent créé, proposition arrivée, clic sur
 * « Enregistrer et activer »), survit à un rechargement, se replie et se quitte.
 */
const AG = '22222222-2222-4222-8222-222222222222';
// `assistants` ouvre « Construire en parlant » (sinon l'onglet dit « Pas dans votre offre »).
const PRO = ['inbox', 'scenarios', 'statistiques', 'email', 'console', 'assistants'];
const lim = {
  utilisateurs: 3, admins: null, contacts: null, envoisModelesMois: null, automations: null, suppressionsJour: null,
  adressesWebhook: 5, journalWebhooksJours: 30, conservationJours: 90, commissionPct: 20, badge: false, numeroInclus: true,
};
const OFFRE = {
  offre: 'pro', fonctions: PRO, limites: lim, usage: { envoisModelesMois: 0, contacts: 0, automations: 0, membres: 1 },
  grille: { free: { fonctions: [], limites: lim }, pro: { fonctions: PRO, limites: lim }, entreprise: { fonctions: PRO, limites: lim } },
  upgradeUrl: 'https://console.e2e.test/offre',
};
const FICHE = { nom: '', objectif: '', ton: '', personnalite: '', reglesTransfert: '', sorties: [] };
const PROPOSITION = {
  message: 'Je propose un objectif.',
  proposition: { fiche: { objectif: 'Conseiller les clients de la boutique.' }, outils: [] },
  changements: [{ champ: 'fiche.objectif', label: 'Objectif de l’agent', avant: '', apres: 'Conseiller les clients de la boutique.' }],
  usage: { tokensIn: 10, tokensOut: 10 },
};

async function monter(page: Page, o: { aFaire?: boolean } = {}) {
  let agent: Record<string, unknown> | null = null;
  // Le marquage est retenu, comme en base : la fenêtre ne se rouvre pas au rechargement suivant.
  let aFaire = o.aFaire === true;
  await page.addInitScript(() => window.localStorage.setItem('mba.session', JSON.stringify({ token: 't', email: 'lea@e2e.test', role: 'admin', tenantId: 't-e2e' })));
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.endsWith('/moi/accueil')) { aFaire = false; return route.fulfill({ status: 204, body: '' }); }
    if (url.endsWith('/me')) return json({ email: 'lea@e2e.test', name: 'Léa', role: 'admin', ...(aFaire ? { accueilAFaire: true } : {}) });
    if (url.endsWith('/offre')) return json(OFFRE);
    if (url.endsWith('/demarrage')) return json({ numero: true, outil: false, scenarioOuCampagne: false, agent: false, bulle: false });
    if (url.endsWith('/account-status')) return json({ hasNumber: false, number: null });
    if (/\/setup$/.test(url)) {
      if (method === 'GET') return json({ messages: [], couverture: { manquants: [], total: 9, pointOuvert: null } });
      return json(PROPOSITION);
    }
    if (/\/manques$/.test(url)) return json({ manques: [], avertissements: [] });
    if (/\/tools/.test(url)) return json({ outils: [], catalogue: [] });
    if (/\/knowledge/.test(url)) return json({ fiches: [] });
    if (method === 'POST' && /\/agents$/.test(url)) {
      const corps = (req.postDataJSON() ?? {}) as { label?: string };
      agent = {
        id: AG, label: corps.label ?? 'X', status: 'draft', mentionIa: 'IA', modele: 'modele-test', maxTours: 8, maxAppelsOutils: 12,
        budgetMicroEur: 30000, inactiviteMinutes: 30, contactInconnu: 'lecture_seule', contenu: FICHE, ficheVersion: 1,
      };
      return json({ agent }, 201);
    }
    if (new RegExp(`/agents/${AG}$`).test(url)) {
      if (method === 'PATCH') agent = { ...agent, ...((req.postDataJSON() ?? {}) as Record<string, unknown>) };
      return json({ agent });
    }
    if (/\/agents(\?|$)/.test(url)) return json({ agents: agent ? [agent] : [] });
    if (url.endsWith('/conversations/unread-count')) return json({ count: 0 });
    return json({});
  });
}

const titre = (page: Page) => page.getByTestId('guide-titre');

test.describe('La carte qui accompagne : l’agent IA', () => {
  test('🔴 de « Bien démarrer » jusqu’à l’agent activé, la carte avance d’elle-même et cadre le bon élément', async ({ page }) => {
    await monter(page, { aFaire: true });
    await page.goto('/accueil');
    await page.getByTestId('accueil-geste-agent').click();
    await expect(page).toHaveURL(/\/agents$/);
    await expect(titre(page)).toHaveText(/Créez votre agent/);
    await expect(page.getByTestId('guide-cadre')).toBeVisible();

    await page.getByTestId('agent-nouveau-label').fill('Conseiller boutique');
    await page.getByTestId('agent-creer').click();
    await expect(page).toHaveURL(/id=/);
    await expect(titre(page)).toHaveText(/Construire en parlant/);
    await expect(page.getByTestId('guide-compteur')).toHaveText(/Étape 2 sur 4/);

    await page.getByTestId('guide-suivant').click();
    await expect(titre(page)).toHaveText(/Décrivez votre activité/);
    await page.getByTestId('setup-saisie').fill('Je vends des bougies parfumées en ligne.');
    await page.getByTestId('setup-envoyer').click();

    await expect(titre(page)).toHaveText(/Relisez, puis activez/);
    await page.getByTestId('setup-garder-activer').click();
    await expect(titre(page)).toHaveText(/C’est fait/);
    await page.getByTestId('guide-terminer').click();
    await expect(page.getByTestId('guide-carte')).toHaveCount(0);
  });

  test('le parcours survit à un rechargement ; replié, il tient dans une pastille ; « Quitter » l’arrête', async ({ page }) => {
    await monter(page, { aFaire: true });
    await page.goto('/accueil');
    await page.getByTestId('accueil-geste-agent').click();
    // La carte s'affiche sur toute page : on attend l'écran de l'étape avant de recharger.
    await expect(page).toHaveURL(/\/agents$/);
    await expect(titre(page)).toHaveText(/Créez votre agent/);
    await page.reload();
    await expect(titre(page)).toHaveText(/Créez votre agent/);

    await page.getByTestId('guide-replier').click();
    await expect(page.getByTestId('guide-carte')).toHaveCount(0);
    await expect(page.getByTestId('guide-cadre')).toHaveCount(0);
    await page.getByTestId('guide-pastille').click();
    await expect(titre(page)).toHaveText(/Créez votre agent/);

    await page.getByTestId('guide-quitter').click();
    await expect(page.getByTestId('guide-carte')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('agent-nouveau-label')).toBeVisible();
    await expect(page.getByTestId('guide-carte')).toHaveCount(0);
  });

  test('loin de l’écran de l’étape, la carte propose « Y aller » au lieu de « Suivant »', async ({ page }) => {
    await monter(page, { aFaire: true });
    await page.goto('/accueil');
    await page.getByTestId('accueil-geste-agent').click();
    await expect(titre(page)).toHaveText(/Créez votre agent/);
    await page.goto('/accueil');
    await expect(page.getByTestId('guide-y-aller')).toBeVisible();
    await expect(page.getByTestId('guide-suivant')).toHaveCount(0);
    await page.getByTestId('guide-y-aller').click();
    await expect(page).toHaveURL(/\/agents$/);
  });
});
