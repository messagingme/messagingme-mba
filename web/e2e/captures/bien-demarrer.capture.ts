import { test, expect, type Page } from '../aide/test';
import { mockAccueil } from '../support/accueil';
import { NAVIGATEUR, REGLAGES_ACCUEIL, REGLAGES_DEMO, capturer, chiffresAccueil, communs, langue, type Locale } from './donnees-demo';
import { AG, agentDemo, simulerAgent } from './agent-ia-demo';

/**
 * « BIEN DÉMARRER » (plan 2026-11-24-guide-demarrage, lot 5) : les captures de la fiche du même nom, et du film de
 * bienvenue de la console (`~/engageme-motion/engageme-aide`, clé `bien-demarrer`). Six étapes : la fenêtre « Bien
 * démarrer », puis chaque grande étape avec la carte qui accompagne, puis la carte de l'Accueil. Rien n'est branché,
 * rien n'est envoyé.
 */
const CLE = 'bien-demarrer';
const COMPTE = { number: '+33 6 39 98 01 00', verifiedName: 'Votre marque', ownerBusinessName: 'Votre marque', phoneNumberId: 'pn-demo' };
const SHOPIFY_VIDE = { boutique: null, compteurs: {}, paniers: { relances: {}, fermesATemps: 0, enAttente: 0 }, pageApps: null, lignes: [] };
const NOM_CAMPAGNE: Record<Locale, string> = { fr: 'Soldes d’hiver', en: 'Winter sale' };

/** La carte qui accompagne, posée dans l'onglet sur l'étape voulue d'un parcours. */
async function guide(page: Page, parcours: string, etape: number): Promise<void> {
  await page.addInitScript(([p, e]) => {
    window.sessionStorage.setItem('mba.guide', JSON.stringify({ parcours: p, etape: e, replie: false, fini: false }));
  }, [parcours, etape] as const);
}

/** La progression « Bien démarrer », posée APRÈS `communs` : elle prend le pas sur lui. */
async function demarrage(page: Page, etat: Record<string, boolean>, accueilAFaire: boolean): Promise<void> {
  await page.route('**/api/backend/**', async (route) => {
    const chemin = new URL(route.request().url()).pathname;
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/demarrage')) return json(etat);
    if (chemin.endsWith('/me')) return json({ email: 'lea@votre-marque.test', name: 'Léa Martin', role: 'admin', ...(accueilAFaire ? { accueilAFaire: true } : {}) });
    return route.fallback();
  });
}

const RIEN = { numero: true, outil: false, scenarioOuCampagne: false, agent: false, bulle: false };

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale}) : la fenêtre et la carte de l'Accueil`, async ({ page }) => {
      await langue(page, locale);
      await mockAccueil(page, { account: COMPTE, settings: REGLAGES_ACCUEIL });
      await chiffresAccueil(page);
      await communs(page);
      await demarrage(page, RIEN, true);
      await page.reload();
      await page.goto('/accueil');
      await expect(page.getByTestId('accueil-checklist')).toBeVisible();
      // 1. La fenêtre « Bien démarrer » : le numéro coché, la prochaine étape en bleu.
      await capturer(page, CLE, 1, locale, undefined, 'haut', page.getByTestId('accueil-geste-shopify'));
    });

    test(`${CLE} (${locale}) : Shopify`, async ({ page }) => {
      await langue(page, locale);
      await guide(page, 'shopify', 2);
      await page.route('**/api/backend/**', async (route) => {
        const chemin = new URL(route.request().url()).pathname;
        const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (chemin.endsWith('/integrations/shopify')) return json(SHOPIFY_VIDE);
        if (chemin.endsWith('/integrations/batch')) return json({ branche: false });
        if (chemin.endsWith('/account-status')) return json({ hasNumber: true, hubspotPortal: { connected: false } });
        if (chemin.endsWith('/settings')) return json(REGLAGES_DEMO);
        return json({});
      });
      await communs(page);
      await page.goto('/integrations#integration-shopify');
      await expect(page.getByTestId('shopify-boutique')).toBeVisible();
      // 2. Shopify : le volet ouvert, la carte sur « Collez ce que Shopify vous a donné ».
      await capturer(page, CLE, 2, locale, page.getByTestId('shopify-boutique'), 'haut', page.getByTestId('shopify-boutique'));
    });

    test(`${CLE} (${locale}) : la campagne`, async ({ page }) => {
      await langue(page, locale);
      await guide(page, 'campagne', 1);
      await page.route('**/api/backend/**', async (route) => {
        const chemin = new URL(route.request().url()).pathname;
        const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (chemin.endsWith('/settings')) return json(REGLAGES_DEMO);
        return json({});
      });
      await communs(page);
      await page.goto('/campaigns/nouvelle');
      await page.getByTestId('assistant-nom').fill(NOM_CAMPAGNE[locale]);
      // 3. Une campagne : l'assistant sur son nom, la carte sur « Nommez votre campagne ».
      await capturer(page, CLE, 3, locale, undefined, 'haut', page.getByTestId('assistant-nom'));
    });

    test(`${CLE} (${locale}) : l'agent IA`, async ({ page }) => {
      await langue(page, locale);
      await guide(page, 'agent', 1);
      await simulerAgent(page, { locale, agent: agentDemo(locale, { vide: true }), manques: [] });
      await communs(page);
      await page.goto(`/agents?id=${AG}&tab=construction`);
      await expect(page.getByTestId('setup-vide')).toBeVisible();
      // 4. L'agent IA : « Construire en parlant » encadré par la carte.
      await capturer(page, CLE, 4, locale, undefined, 'haut', page.getByTestId('mba-tab-construction'));
    });

    test(`${CLE} (${locale}) : la bulle et la carte de l'Accueil`, async ({ page }) => {
      await langue(page, locale);
      await page.route('**/api/backend/**', async (route) => {
        const chemin = new URL(route.request().url()).pathname;
        const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (chemin.endsWith('/widgets')) return json({ widgets: [], limite: null });
        if (chemin.endsWith('/workflows')) return json({ workflows: [] });
        if (chemin.endsWith('/account-status')) return json({ hasNumber: true });
        return json({});
      });
      await communs(page);
      await page.goto('/widgets');
      await expect(page.getByTestId('widget-nouveau')).toBeVisible();
      // 5. La bulle WhatsApp : « Nouveau widget ».
      await capturer(page, CLE, 5, locale, undefined, 'haut', page.getByTestId('widget-nouveau'));
    });

    test(`${CLE} (${locale}) : la carte de l'Accueil`, async ({ page }) => {
      await langue(page, locale);
      await mockAccueil(page, { account: COMPTE, settings: REGLAGES_ACCUEIL });
      await chiffresAccueil(page);
      await communs(page);
      await demarrage(page, { numero: true, outil: true, scenarioOuCampagne: false, agent: true, bulle: false }, false);
      await page.goto('/accueil');
      await expect(page.getByTestId('carte-bien-demarrer')).toBeVisible();
      // 6. Plus tard : la carte de l'Accueil dit où l'on en est, « Continuer » rouvre la fenêtre.
      await capturer(page, CLE, 6, locale, undefined, 'haut', page.getByTestId('carte-bien-demarrer-continuer'));
    });
  });
}
