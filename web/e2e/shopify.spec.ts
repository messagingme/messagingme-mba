import { test, expect, type Page } from './aide/test';
import { repondre, repondreSurPlace } from './aide/confirmation';

/**
 * SHOPIFY DANS LA CONSOLE, vu de l'écran (conception 2026-10-22 ; menu « Scénario », lots 5 et 7) : la carte de Tools >
 * Intégrations branche la boutique, la met en pause et la coupe ; la page Scénario > Automation > Shopify
 * (`/automations/shopify`) allume chaque automation, en dit l'état, règle le délai du panier et ouvre son scénario. Le
 * serveur tient ses règles de son côté (`tests/http-shopify.test.ts`, `tests/shopify-lignes-gestion.test.ts`) ; ici, on
 * regarde ce que l'écran MONTRE et ce qu'il ENVOIE, contre une API simulée.
 */
const PAGE = '/automations/shopify';
const BOUTIQUE = {
  domaine: 'ma-boutique.myshopify.com', nom: 'Ma Boutique', etat: 'connectee', dernierEvenementLe: null,
  delaiPanierMinutes: 60, origine: 'claude_code', pauseLe: null,
};
const VIDE = { boutique: null, compteurs: {}, paniers: { relances: {}, fermesATemps: 0, enAttente: 0 }, pageApps: null, lignes: [] };
/** Le message en vigueur d'une ligne, tel que le serveur le rend (spec 2026-11-20) : corps numéroté, exemples par position. */
const APERCU = { corps: 'Bonjour {{1}}, merci pour votre commande {{2}}.', pied: null, exemples: ['Camille', '#1002'], enValidation: false };
const ligne = (evenement: string, o: Record<string, unknown> = {}) => ({
  evenement, actif: true, workflowId: `wf-${evenement}`, scenario: evenement, modele: `m_${evenement}`, langue: 'fr',
  etatChezMeta: 'APPROVED', blocs: 1, versionProgrammee: false, apercu: APERCU, ...o,
});
const BRANCHEE = {
  ...VIDE, boutique: BOUTIQUE, pageApps: 'https://admin.shopify.com/store/ma-boutique/settings/apps', lignes: [ligne('order_paid')],
};
/** L'attestation du consentement des clients (2026-11-20), telle que le serveur la rend ; sans le champ, une API ancienne. */
const ATTESTEE = { coche: true, le: '2026-11-20T09:00:00.000Z', email: 'moi@e2e.test', texte: 'J’atteste…' };
/** La relance aussi en service : la carte dit alors la ligne des paniers. */
const RELANCE_ACTIVE = { ...BRANCHEE, lignes: [ligne('order_paid'), ligne('checkout_abandoned')] };

interface Trace {
  branchements: unknown[];
  pauses: unknown[];
  lignes: Array<{ evenement: string; corps: unknown }>;
  /** Les POST de l'attestation, et l'ordre de tous les POST (le branchement, puis l'attestation). */
  attestations: unknown[];
  posts: string[];
}

async function monter(page: Page, o: {
  etat?: Record<string, unknown> | 'absente'; apresBranchement?: Record<string, unknown>; ecran?: string; role?: string;
  /** La route de l'attestation : `absente`, le 404 du routeur (API pas encore déployée) ; `panne`, un 500. */
  attestation?: 'absente' | 'panne';
  /** Un allumage refusé (409) avec ce message, celui du serveur sans attestation. */
  refusAllumage?: string;
  /** Les agents IA de l'espace (`GET /agents`), pour la relance avec agent IA ; absents, aucun. */
  agents?: Array<Record<string, unknown>>;
}): Promise<Trace> {
  const trace: Trace = { branchements: [], pauses: [], lignes: [], attestations: [], posts: [] };
  const session = { token: 'e2e-token', email: 'moi@e2e.test', role: o.role ?? 'admin', tenantId: 't-e2e' };
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), session);
  let etat = o.etat ?? BRANCHEE;
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = req.url().split('?')[0]!;
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    const reglageLigne = /\/integrations\/shopify\/lignes\/([a-z_]+)$/.exec(chemin);
    if (reglageLigne && req.method() === 'PUT') {
      const corps = req.postDataJSON() as { actif: boolean };
      trace.lignes.push({ evenement: reglageLigne[1]!, corps });
      if (corps.actif && o.refusAllumage) return json({ error: o.refusAllumage }, 409);
      return json({ ligne: { evenement: reglageLigne[1], workflowId: `wf-${reglageLigne[1]}`, actif: corps.actif, modifieLe: '2026-11-19T10:00:00.000Z' } });
    }
    if (chemin.endsWith('/integrations/shopify') && req.method() === 'PATCH') {
      trace.pauses.push(req.postDataJSON());
      return json({ changee: true });
    }
    if (chemin.endsWith('/integrations/shopify/attestation') && req.method() === 'POST') {
      trace.posts.push('attestation');
      if (o.attestation === 'absente') return json({ message: 'Route POST not found', error: 'Not Found', statusCode: 404 }, 404);
      if (o.attestation === 'panne') return json({ error: 'Internal Server Error' }, 500);
      const corps = req.postDataJSON() as { coche: boolean };
      trace.attestations.push(corps);
      const attestation = { ...ATTESTEE, coche: corps.coche, le: '2026-11-21T09:00:00.000Z' };
      // Le serveur : retirer l'attestation éteint les lignes allumées.
      if (etat !== 'absente') {
        const lignes = (etat.lignes as Array<Record<string, unknown>> | undefined) ?? [];
        etat = { ...etat, attestation, lignes: corps.coche ? lignes : lignes.map((l) => ({ ...l, actif: false })) };
      }
      return json({ attestation });
    }
    if (chemin.endsWith('/integrations/shopify') && req.method() === 'POST') {
      trace.posts.push('branchement');
      trace.branchements.push(req.postDataJSON());
      if (o.apresBranchement) etat = o.apresBranchement;
      return json(BOUTIQUE);
    }
    if (chemin.endsWith('/integrations/shopify')) {
      // Le 404 exact du routeur Fastify : c'est lui qui dit « API pas encore déployée ».
      if (etat === 'absente') return json({ message: 'Route GET not found', error: 'Not Found', statusCode: 404 }, 404);
      return json(etat);
    }
    if (chemin.endsWith('/agents')) return json({ agents: o.agents ?? [], repondeurAgentId: null });
    if (chemin.endsWith('/automations')) return json({ automations: [] });
    if (chemin.endsWith('/workflows')) return json({ workflows: [] });
    if (chemin.endsWith('/settings')) return json({ mbaEnabled: false, timezone: 'Europe/Paris', businessHours: {} });
    if (chemin.endsWith('/account-status')) return json({ hasNumber: false, hubspotPortal: { connected: false } });
    if (chemin.endsWith('/integrations/batch')) return json({ branche: false });
    if (chemin.endsWith('/settings/agents-peuvent-prendre')) return json({ actif: false });
    if (chemin.endsWith('/contacts/blocked')) return json({ contacts: [] });
    if (chemin.endsWith('/unread-count')) return json({ count: 0 });
    if (chemin.endsWith('/me')) return json({ email: 'moi@e2e.test', name: 'Moi', role: o.role ?? 'admin' });
    return json({});
  });
  await page.goto(o.ecran ?? '/integrations#integration-shopify');
  return trace;
}

test.describe('Tools > Intégrations > Shopify : la carte de la console', () => {
  test('🔴 survoler la carte n’ouvre aucune capture « Voir l’écran » ; survoler un lien n’ouvre que la sienne', async ({ page }) => {
    await monter(page, { etat: VIDE });
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('shopify-mode-operatoire')).toBeVisible();
    const captures = carte.getByRole('tooltip', { includeHidden: true });
    expect(await captures.count()).toBeGreaterThan(1);
    await carte.getByTestId('shopify-mode-operatoire').hover();
    await expect(carte.getByRole('tooltip')).toHaveCount(0);
    await carte.getByRole('button', { name: 'Voir l’écran' }).first().hover();
    await expect(carte.getByRole('tooltip')).toHaveCount(1);
  });

  test('🔴 sans boutique : le mode opératoire, puis les clés branchent la boutique, nettoyées', async ({ page }) => {
    const trace = await monter(page, { etat: VIDE, apresBranchement: BRANCHEE });
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('shopify-mode-operatoire')).toContainText('Applis > Créer une appli > Créer l’appli manuellement');
    await expect(carte.getByTestId('shopify-mode-operatoire')).toContainText('https://app.messagingme.fr/shopify/console/');
    await expect(carte.getByTestId('shopify-mode-operatoire')).toContainText('read_customers,read_orders,read_checkouts,read_fulfillments');
    const valider = carte.getByTestId('shopify-brancher-valider');
    await expect(valider).toBeDisabled();
    await carte.getByTestId('shopify-boutique').fill(' https://admin.shopify.com/store/ma-boutique ');
    await carte.getByTestId('shopify-client-id').fill(' cid ');
    await carte.getByTestId('shopify-secret').fill('shpss_secret\n');
    // L'attestation du consentement est requise (2026-11-20) : sans elle, le bouton reste éteint et dit pourquoi.
    await expect(valider).toBeDisabled();
    await expect(carte.getByTestId('shopify-attestation-raison')).toContainText('Cochez l’attestation');
    await expect(carte.getByTestId('shopify-attestation')).toContainText('J’atteste que les clients de ma boutique ont accepté');
    await carte.getByTestId('shopify-attestation-case').check();
    await expect(carte.getByTestId('shopify-attestation-raison')).toHaveCount(0);
    await valider.click();
    await expect.poll(() => trace.branchements.length).toBe(1);
    // Le corps du branchement est inchangé (validé strictement par le serveur) ; l'attestation part APRÈS, à côté.
    expect(trace.branchements[0]).toEqual({ boutique: 'https://admin.shopify.com/store/ma-boutique', clientId: 'cid', secret: 'shpss_secret' });
    await expect.poll(() => trace.attestations).toEqual([{ coche: true, langue: 'fr' }]);
    expect(trace.posts).toEqual(['branchement', 'attestation']);
    // Plus d'assistant : les messages sont des automations, que la carte renvoie à LEUR page (menu « Scénario », lot 7).
    const versLesAutomations = carte.getByTestId('integration-shopify-automations').getByRole('link');
    await expect(versLesAutomations).toHaveText('Scénario > Automation > Shopify');
    await expect(versLesAutomations).toHaveAttribute('href', PAGE);
    await expect(carte.getByTestId('integration-shopify-message')).toContainText('Boutique branchée');
    await expect(carte.getByTestId('integration-shopify-message')).toContainText('Scénario > Automation > Shopify');
  });

  test('🔴 l’API sans la route de l’attestation (404 du routeur) : le branchement réussit, sans un mot de plus', async ({ page }) => {
    const trace = await monter(page, { etat: VIDE, apresBranchement: BRANCHEE, attestation: 'absente' });
    const carte = page.getByTestId('integration-shopify');
    await carte.getByTestId('shopify-boutique').fill('ma-boutique.myshopify.com');
    await carte.getByTestId('shopify-client-id').fill('cid');
    await carte.getByTestId('shopify-secret').fill('shpss_secret');
    await carte.getByTestId('shopify-attestation-case').check();
    await carte.getByTestId('shopify-brancher-valider').click();
    await expect(carte.getByTestId('integration-shopify-message')).toHaveText('Boutique branchée : allumez maintenant ses automations dans Scénario > Automation > Shopify.');
    expect(trace.posts).toEqual(['branchement', 'attestation']);
  });

  test('🔴 l’attestation en panne après le branchement : la boutique reste branchée, la carte dit où la cocher', async ({ page }) => {
    const trace = await monter(page, { etat: VIDE, apresBranchement: BRANCHEE, attestation: 'panne' });
    const carte = page.getByTestId('integration-shopify');
    await carte.getByTestId('shopify-boutique').fill('ma-boutique.myshopify.com');
    await carte.getByTestId('shopify-client-id').fill('cid');
    await carte.getByTestId('shopify-secret').fill('shpss_secret');
    await carte.getByTestId('shopify-attestation-case').check();
    await carte.getByTestId('shopify-brancher-valider').click();
    const message = carte.getByTestId('integration-shopify-message');
    await expect(message).toContainText('Boutique branchée, mais votre attestation n’a pas pu être enregistrée');
    await expect(message).toContainText('Scénario > Automation > Shopify');
    await expect(carte.getByTestId('integration-shopify-etat')).toContainText('branchée');
    expect(trace.branchements).toHaveLength(1);
  });

  test('🔴 la pause se confirme, puis part ; la reprise part sans question', async ({ page }) => {
    const trace = await monter(page, {});
    const carte = page.getByTestId('integration-shopify');
    await carte.getByTestId('integration-shopify-pause-interrupteur').click();
    await repondre(page, true, 'Aucun message Shopify ne partira plus');
    await expect.poll(() => trace.pauses).toEqual([{ pause: true }]);
    await expect(carte.getByTestId('integration-shopify-message')).toContainText('Boutique en pause');
  });

  test('🔴 en pause, la carte le dit ; la reprise part sans question', async ({ page }) => {
    const trace = await monter(page, { etat: { ...BRANCHEE, boutique: { ...BOUTIQUE, pauseLe: '2026-11-19T10:00:00.000Z' } } });
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('integration-shopify-pause')).toContainText('En pause depuis');
    await carte.getByTestId('integration-shopify-pause-interrupteur').click();
    await expect.poll(() => trace.pauses).toEqual([{ pause: false }]);
    await expect(page.getByTestId('confirmation')).toHaveCount(0);
  });

  test('🔴 la ligne des paniers dit les relances parties et les récupérés de la même date, leur montant, les tests à part (plan 2026-10-30)', async ({ page }) => {
    await monter(page, {
      etat: {
        ...RELANCE_ACTIVE,
        paniers: {
          relances: { envoye: 3 }, fermesATemps: 1, enAttente: 2,
          relancesParties: 4, recuperes: 2, montantsRecuperes: [{ devise: 'EUR', montant: '59.9' }], recuperesTest: 1,
        },
      },
    });
    const ligneDesPaniers = page.getByTestId('integration-shopify-paniers');
    await expect(ligneDesPaniers).toContainText('4 relances parties, 2 récupérés');
    await expect(ligneDesPaniers).toContainText(/59,90\s€/);
    await expect(ligneDesPaniers).toContainText('et 1 de test, non comptés');
  });

  test('la ligne des paniers ne se montre que si l’automation du panier est en service', async ({ page }) => {
    await monter(page, { etat: { ...BRANCHEE, lignes: [ligne('order_paid'), ligne('checkout_abandoned', { actif: false })] } });
    await expect(page.getByTestId('integration-shopify-etat')).toBeVisible();
    await expect(page.getByTestId('integration-shopify-paniers')).toHaveCount(0);
  });

  test('🔴 API pas encore déployée (404 du routeur) : AUCUNE carte', async ({ page }) => {
    await monter(page, { etat: 'absente' });
    await expect(page.getByTestId('volet-hubspot')).toBeVisible();
    await expect(page.getByTestId('volet-shopify').getByTestId('integration-en-travaux')).toBeVisible();
    await expect(page.getByTestId('integration-shopify')).toHaveCount(0);
  });
});

test.describe('Scénario > Automation > Shopify : les automations de la boutique, sur leur page (menu « Scénario », lots 5 et 7)', () => {
  test('🔴 une ligne par événement : son état dit, sans ligne « pas encore créée », et son scénario s’ouvre', async ({ page }) => {
    await monter(page, {
      ecran: PAGE,
      etat: { ...BRANCHEE, lignes: [ligne('order_paid'), ligne('checkout_abandoned', { modele: null, langue: null, etatChezMeta: null })] },
    });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Automations Shopify');
    const section = page.getByTestId('automations-shopify');
    await expect(section.getByTestId('automations-shopify-etat-order_paid')).toHaveText('active');
    await expect(section.getByTestId('automations-shopify-etat-order_fulfilled')).toHaveText('pas encore créée');
    await expect(section.getByTestId('automations-shopify-etat-checkout_abandoned')).toContainText('à compléter');
    await expect(section.getByTestId('automations-shopify-ouvrir-order_paid')).toHaveAttribute('href', '/workflows?open=wf-order_paid');
    await expect(section.getByTestId('automations-shopify-ouvrir-order_fulfilled')).toHaveCount(0);
    await expect(section.getByTestId('automations-shopify-interrupteur-order_paid')).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByTestId('automations-shopify-interrupteur-order_fulfilled')).toHaveAttribute('aria-pressed', 'false');
  });

  test('🔴 l’interrupteur éteint ou rallume sa ligne sur place ; le délai du panier part avec elle', async ({ page }) => {
    const trace = await monter(page, {
      ecran: PAGE, etat: { ...RELANCE_ACTIVE, lignes: [...RELANCE_ACTIVE.lignes, ligne('order_fulfilled', { actif: false })] },
    });
    const section = page.getByTestId('automations-shopify');
    await section.getByTestId('automations-shopify-interrupteur-order_paid').click();
    await expect.poll(() => trace.lignes).toEqual([{ evenement: 'order_paid', corps: { actif: false } }]);
    // Une ligne qui existe déjà se rallume sur place : seul le PREMIER allumage ouvre le builder.
    await section.getByTestId('automations-shopify-interrupteur-order_fulfilled').click();
    await expect.poll(() => trace.lignes.length).toBe(2);
    expect(trace.lignes[1]).toEqual({ evenement: 'order_fulfilled', corps: { actif: true } });
    await section.getByTestId('automations-shopify-delai').selectOption('180');
    await expect.poll(() => trace.lignes.length).toBe(3);
    expect(trace.lignes[2]).toEqual({ evenement: 'checkout_abandoned', corps: { actif: true, delaiMinutes: 180 } });
    await expect(page).toHaveURL(/\/automations\/shopify$/);
  });

  test('🔴 le premier allumage crée le scénario et l’ouvre dans le builder (spec § 2.1)', async ({ page }) => {
    const trace = await monter(page, { ecran: PAGE, etat: BRANCHEE });
    await page.getByTestId('automations-shopify-interrupteur-order_fulfilled').click();
    await expect.poll(() => trace.lignes).toEqual([{ evenement: 'order_fulfilled', corps: { actif: true } }]);
    await expect(page).toHaveURL(/\/workflows\?open=wf-order_fulfilled$/);
  });

  test('🔴 le message au focus et au survol d’une ligne, ses données remplacées par leurs exemples ; un clic ouvre son scénario (spec 2026-11-20)', async ({ page }) => {
    // Le message standard posé au branchement : la ligne éteinte, son template dans une version programmée.
    const enValidation = ligne('order_paid', {
      actif: false, modele: null, langue: null, etatChezMeta: null, versionProgrammee: true, apercu: { ...APERCU, enValidation: true },
    });
    await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, lignes: [enValidation, ligne('order_fulfilled', { actif: false, apercu: null })] } });
    const section = page.getByTestId('automations-shopify');
    await expect(section.getByTestId('automations-shopify-etat-order_paid')).toHaveText('éteinte, message en validation chez Meta');
    await expect(section.getByTestId('automations-shopify-etat-order_fulfilled')).toHaveText('prête : allumez-la pour l’envoyer');
    const bulle = section.getByTestId('automations-shopify-apercu-order_paid');
    await expect(bulle).toBeHidden();
    // Au clavier d'abord : le focus du lien ouvre la bulle, sans souris.
    await section.getByTestId('automations-shopify-ligne-order_paid').focus();
    await expect(bulle).toBeVisible();
    await expect(bulle).toContainText('Bonjour Camille, merci pour votre commande #1002.');
    await expect(bulle).toContainText('En validation chez Meta');
    await section.getByTestId('automations-shopify-ligne-order_paid').blur();
    await expect(bulle).toBeHidden();
    await section.getByTestId('automations-shopify-ligne-order_paid').hover();
    await expect(bulle).toBeVisible();
    // Une ligne sans message n'a pas de bulle ; une automation pas encore créée, pas de lien.
    await expect(section.getByTestId('automations-shopify-apercu-order_fulfilled')).toHaveCount(0);
    await expect(section.getByTestId('automations-shopify-ligne-checkout_abandoned')).toHaveCount(0);
    await section.getByTestId('automations-shopify-ligne-order_paid').click();
    await expect(page).toHaveURL(/\/workflows\?open=wf-order_paid$/);
  });

  test('🔴 jamais attestée : la case en tête, décochée ; la cocher envoie l’attestation et dit qui et quand (2026-11-20)', async ({ page }) => {
    const trace = await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, attestation: null } });
    const bandeau = page.getByTestId('automations-shopify-attestation');
    await expect(bandeau).toContainText('J’atteste que les clients de ma boutique ont accepté');
    await expect(bandeau).toContainText('Cochez-la pour allumer vos automations.');
    const caseAttestation = page.getByTestId('automations-shopify-attestation-case');
    await expect(caseAttestation).not.toBeChecked();
    await expect(page.getByTestId('automations-shopify-attestation-par')).toHaveCount(0);
    await caseAttestation.check();
    await expect.poll(() => trace.attestations).toEqual([{ coche: true, langue: 'fr' }]);
    await expect(caseAttestation).toBeChecked();
    await expect(page.getByTestId('automations-shopify-attestation-par')).toHaveText('Attestée le 21 novembre 2026 par moi@e2e.test');
  });

  test('🔴 attestée : qui et quand ; la décocher se confirme, puis la retire et les automations s’éteignent', async ({ page }) => {
    const trace = await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, attestation: ATTESTEE } });
    const caseAttestation = page.getByTestId('automations-shopify-attestation-case');
    await expect(caseAttestation).toBeChecked();
    await expect(page.getByTestId('automations-shopify-attestation-par')).toHaveText('Attestée le 20 novembre 2026 par moi@e2e.test');
    await expect(page.getByTestId('automations-shopify-interrupteur-order_paid')).toHaveAttribute('aria-pressed', 'true');
    // Annuler : rien ne part, la case reste cochée.
    await caseAttestation.click();
    await repondreSurPlace(page, false, 'Retirer l’attestation éteint vos trois automations.');
    await expect(caseAttestation).toBeChecked();
    expect(trace.attestations).toEqual([]);
    // Confirmer : l'attestation est retirée, l'état relu (le serveur a éteint la ligne).
    await caseAttestation.click();
    await repondreSurPlace(page, true);
    await expect.poll(() => trace.attestations).toEqual([{ coche: false, langue: 'fr' }]);
    await expect(caseAttestation).not.toBeChecked();
    await expect(page.getByTestId('automations-shopify-interrupteur-order_paid')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('automations-shopify-attestation')).toContainText('Cochez-la pour allumer vos automations.');
  });

  test('attestée sans e-mail connu : la date seule', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, attestation: { ...ATTESTEE, email: null } } });
    await expect(page.getByTestId('automations-shopify-attestation-par')).toHaveText('Attestée le 20 novembre 2026');
  });

  test('🔴 une API qui ne rend pas encore l’attestation : aucune case, les automations comme avant', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: BRANCHEE });
    await expect(page.getByTestId('automations-shopify-order_paid')).toBeVisible();
    await expect(page.getByTestId('automations-shopify-attestation')).toHaveCount(0);
  });

  test('🔴 un allumage refusé sans attestation (409) : le refus du serveur, sur la ligne de son interrupteur', async ({ page }) => {
    const refus = 'Cochez d’abord l’attestation du consentement de vos clients.';
    await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, attestation: null, lignes: [ligne('order_paid', { actif: false })] }, refusAllumage: refus });
    await page.getByTestId('automations-shopify-interrupteur-order_paid').click();
    await expect(page.getByTestId('automations-shopify-order_paid').getByTestId('automations-shopify-erreur')).toHaveText(refus);
    await expect(page).toHaveURL(/\/automations\/shopify$/);
  });

  test('la pause se dit, avec le chemin pour la reprendre, et les lignes restent', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, boutique: { ...BOUTIQUE, pauseLe: '2026-11-19T10:00:00.000Z' } } });
    await expect(page.getByTestId('automations-shopify-pause')).toContainText('Boutique en pause');
    await expect(page.getByTestId('automations-shopify-order_paid')).toBeVisible();
  });

  test('la coupure se dit, sans aucune ligne', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, boutique: { ...BOUTIQUE, etat: 'coupee' } } });
    await expect(page.getByTestId('automations-shopify-coupee')).toContainText('Boutique coupée');
    await expect(page.getByTestId('automations-shopify-order_paid')).toHaveCount(0);
  });

  test('🔴 sans boutique, la page le dit et mène à la carte qui la branche, sans aucune ligne', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: VIDE });
    const sans = page.getByTestId('automations-shopify-sans-boutique');
    await expect(sans).toContainText('Aucune boutique Shopify n’est branchée');
    await expect(sans.getByRole('link')).toHaveAttribute('href', '/integrations#integration-shopify');
    await expect(page.getByTestId('automations-shopify')).toHaveCount(0);
  });

  test('🔴 l’API sans la route (404 du routeur) : la page dit que la lecture a échoué, sans aucune ligne', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: 'absente' });
    await expect(page.getByTestId('automations-shopify-panne')).toContainText('n’ont pas pu être lues');
    await expect(page.getByTestId('automations-shopify')).toHaveCount(0);
  });

  test('🔴 l’écran des autres automations n’a plus de section Shopify, même avec une boutique', async ({ page }) => {
    // La lecture de la boutique doit avoir RÉPONDU avant l'assertion d'absence : la barre la lit sur toute la Console, et
    // c'est elle qui fait apparaître l'entrée Shopify, pas la page.
    const lue = page.waitForResponse((r) => r.url().includes('/integrations/shopify'));
    await monter(page, { ecran: '/automations', etat: BRANCHEE });
    await lue;
    await expect(page.getByTestId('automation-add')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Autres automations');
    await expect(page.getByTestId('automations-shopify')).toHaveCount(0);
    await expect(page.locator('aside a[href="/automations/shopify"]')).toHaveCount(1);
  });
});

test.describe('Scénario > Automation > Shopify : la relance de panier avec agent IA (2026-11-20)', () => {
  const AGENT = { id: 'ag1', label: 'Conseiller', status: 'active', sorties: [], modele: 'm' };
  const AUTRE = { id: 'ag2', label: 'Vendeur', status: 'active', sorties: [], modele: 'm' };

  test('🔴 sans agent IA actif : l’interrupteur est grisé, et l’écran dit d’en créer un', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, attestation: ATTESTEE }, agents: [{ ...AGENT, status: 'disabled' }] });
    const section = page.getByTestId('automations-shopify');
    await expect(section.getByTestId('automations-shopify-interrupteur-checkout_abandoned_agent')).toBeDisabled();
    await expect(section.getByTestId('automations-shopify-sans-agent').getByRole('link', { name: 'Créer un agent IA' })).toHaveAttribute('href', '/agents');
  });

  test('🔴 allumer demande l’agent, puis éteint la relance normale et le dit, sans quitter la page', async ({ page }) => {
    const trace = await monter(page, { ecran: PAGE, etat: { ...RELANCE_ACTIVE, attestation: ATTESTEE }, agents: [AGENT, AUTRE] });
    const section = page.getByTestId('automations-shopify');
    await section.getByTestId('automations-shopify-interrupteur-checkout_abandoned_agent').click();
    expect(trace.lignes, 'rien ne part avant le choix').toEqual([]);
    await section.getByTestId('automations-shopify-choix-agent-liste').selectOption('ag2');
    await section.getByTestId('automations-shopify-choix-agent-valider').click();
    await expect.poll(() => trace.lignes).toEqual([{ evenement: 'checkout_abandoned_agent', corps: { actif: true, agentId: 'ag2' } }]);
    await expect(section.getByTestId('automations-shopify-remplacee')).toHaveText('« Panier abandonné » a été éteinte : un panier ne reçoit qu’une relance.');
    await expect(page).toHaveURL(/\/automations\/shopify$/);
  });

  test('annuler le choix n’allume rien', async ({ page }) => {
    const trace = await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, attestation: ATTESTEE }, agents: [AGENT] });
    const section = page.getByTestId('automations-shopify');
    await section.getByTestId('automations-shopify-interrupteur-checkout_abandoned_agent').click();
    await section.getByTestId('automations-shopify-choix-agent-annuler').click();
    await expect(section.getByTestId('automations-shopify-choix-agent')).toHaveCount(0);
    expect(trace.lignes).toEqual([]);
  });

  test('🔴 allumée : son agent se change sur place, et ses avertissements se lisent', async ({ page }) => {
    const ligneAgent = ligne('checkout_abandoned_agent', {
      agent: { id: 'ag1', label: 'Conseiller', actif: true }, avertissements: ['bouton_absent', 'modele_en_attente'],
    });
    const trace = await monter(page, { ecran: PAGE, etat: { ...BRANCHEE, attestation: ATTESTEE, lignes: [ligne('order_paid'), ligneAgent] }, agents: [AGENT, AUTRE] });
    const section = page.getByTestId('automations-shopify');
    await expect(section.getByTestId('automations-shopify-avertissement-bouton_absent')).toContainText('ne mène plus à l’agent IA');
    await expect(section.getByTestId('automations-shopify-avertissement-modele_en_attente')).toContainText('aucun panier n’est relancé');
    await expect(section.getByTestId('automations-shopify-agent-liste')).toHaveValue('ag1');
    await section.getByTestId('automations-shopify-agent-liste').selectOption('ag2');
    await section.getByTestId('automations-shopify-agent-valider').click();
    await expect.poll(() => trace.lignes).toEqual([{ evenement: 'checkout_abandoned_agent', corps: { actif: true, agentId: 'ag2' } }]);
  });
});
