import { test, expect, type Page } from './aide/test';
import { reponseDuBuilder } from './aide/routes-builder';
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
/**
 * Le rattrapage des commandes : l'aperçu d'une API du lot 5 (sans les fiches d'acheteurs), celui du lot 5b (les fiches à
 * créer, les places, le plafond), et la reprise lancée, tels que le serveur les rend.
 */
const APERCU_RATTRAPAGE_LOT5 = { fenetreDebut: '2026-09-24T00:00:00.000Z', lues: 42, deja: 10, rattachables: 25, sansFiche: 5, sansNumero: 2, ecartees: 3, complet: true };
const APERCU_RATTRAPAGE = { ...APERCU_RATTRAPAGE_LOT5, fichesACreer: 20, horsPlafond: 0, placesLibres: 950, remplitLesPlaces: false };
const REPRISE = {
  id: 'r1', statut: 'en_attente', interrompue: false, fenetreDebut: '2026-09-24T00:00:00.000Z', commenceLe: '2026-11-23T12:00:00.000Z', finiLe: null,
  comptes: { lues: 0, rattachees: 0, deja: 0, sansFiche: 0, sansNumero: 0, fichesCreees: 0, horsPlafond: 0 }, erreur: null,
};
/** La relance aussi en service : la carte dit alors la ligne des paniers. */
const RELANCE_ACTIVE = { ...BRANCHEE, lignes: [ligne('order_paid'), ligne('checkout_abandoned')] };
/** La synchronisation des étiquettes (lot 6b), telle que le serveur la rend : jamais allumée, puis lue. */
const ETIQUETTES_ETEINTES = {
  allumee: false, synchroLe: null, enCours: false, refus: null, comptes: { clientsLus: 0, trouvesParTelephone: 0, sansFiche: 0, fichesEtiquetees: 0 },
};
const ETIQUETTES_LUES = {
  allumee: true, synchroLe: '2026-11-24T08:00:00.000Z', enCours: false, refus: null as null | { code: string; message: string },
  comptes: { clientsLus: 12, trouvesParTelephone: 3, sansFiche: 4, fichesEtiquetees: 6 },
};

interface Trace {
  branchements: unknown[];
  pauses: unknown[];
  coupures: number;
  lignes: Array<{ evenement: string; corps: unknown }>;
  /** Les POST de l'attestation, et l'ordre de tous les POST (le branchement, puis l'attestation). */
  attestations: unknown[];
  posts: string[];
  /** Les lancements du rattrapage des commandes (lot 5). */
  rattrapages: number;
  /** Les réglages de la synchronisation des étiquettes (corps du PUT) et ses lancements « maintenant » (lot 6b). */
  reglagesEtiquettes: unknown[];
  synchrosEtiquettes: number;
  segmentsSuivis: unknown[];
}

async function monter(page: Page, o: {
  etat?: Record<string, unknown> | 'absente'; apresBranchement?: Record<string, unknown>; ecran?: string; role?: string;
  /** La route de l'attestation : `absente`, le 404 du routeur (API pas encore déployée) ; `panne`, un 500. */
  attestation?: 'absente' | 'panne';
  /** Un allumage refusé (409) avec ce message, celui du serveur sans attestation. */
  refusAllumage?: string;
  /** Les agents IA de l'espace (`GET /agents`), pour la relance avec agent IA ; absents, aucun. */
  agents?: Array<Record<string, unknown>>;
  /**
   * Le rattrapage des commandes (segments Shopify, lot 5) : la dernière reprise (`absente` : le 404 du routeur, une API
   * plus ancienne), l'aperçu, la reprise rendue au lancement.
   */
  rattrapage?: {
    etat?: Record<string, unknown> | null | 'absente'; apercu?: Record<string, unknown>; lancee?: Record<string, unknown>;
    /** L'aperçu refusé (409) avec ce message : celui du serveur sans l'attestation du consentement des clients. */
    refusApercu?: string;
  };
  /**
   * La synchronisation des étiquettes (segments Shopify, lot 6b) : son état (`absente` : le 404 du routeur, une API plus
   * ancienne), un refus du serveur aux gestes (le 429 de l'offre Free), et `dejaEnCours` : le serveur rend `lancee: false`,
   * une synchronisation tournait déjà.
   */
  etiquettes?: { synchro?: Record<string, unknown> | 'absente'; refus?: { statut: number; error: string }; dejaEnCours?: boolean };
  /**
   * Les segments Shopify lus (lot 6c) : la liste (`absente` : le 404 du routeur) et un refus du serveur au choix. Leur
   * synchronisation est celle des étiquettes (`etiquettes.synchro`).
   */
  segments?: {
    lus?: Array<Record<string, unknown>> | 'absente'; refus?: { statut: number; error: string };
    /** La liste que rend le serveur une fois « Synchroniser maintenant » parti (la synchronisation lit la liste). */
    apresSynchro?: Array<Record<string, unknown>>;
  };
}): Promise<Trace> {
  const trace: Trace = {
    branchements: [], pauses: [], coupures: 0, lignes: [], attestations: [], posts: [], rattrapages: 0, reglagesEtiquettes: [], synchrosEtiquettes: 0, segmentsSuivis: [],
  };
  let segmentsLus = o.segments?.lus;
  let rattrapage = o.rattrapage?.etat ?? null;
  let synchroEtiquettes = o.etiquettes?.synchro;
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
    if (chemin.endsWith('/integrations/shopify/commandes/rattrapage')) {
      if (rattrapage === 'absente') return json({ message: `Route ${req.method()} not found`, error: 'Not Found', statusCode: 404 }, 404);
      if (req.method() === 'POST') {
        trace.rattrapages += 1;
        rattrapage = o.rattrapage?.lancee ?? REPRISE;
        return json({ reprise: rattrapage }, 202);
      }
      return json({ reprise: rattrapage });
    }
    if (chemin.endsWith('/integrations/shopify/commandes/apercu')) {
      if (o.rattrapage?.refusApercu) return json({ error: o.rattrapage.refusApercu }, 409);
      return json(o.rattrapage?.apercu ?? APERCU_RATTRAPAGE);
    }
    if (chemin.endsWith('/contacts/segments/etiquettes-shopify')) {
      if (synchroEtiquettes === 'absente') return json({ message: 'Route GET not found', error: 'Not Found', statusCode: 404 }, 404);
      return synchroEtiquettes === undefined ? json({}) : json({ etiquettes: [], synchro: synchroEtiquettes });
    }
    if (chemin.endsWith('/contacts/segments/segments-shopify')) {
      if (segmentsLus === 'absente') return json({ message: 'Route GET not found', error: 'Not Found', statusCode: 404 }, 404);
      return segmentsLus === undefined || synchroEtiquettes === undefined || synchroEtiquettes === 'absente'
        ? json({}) : json({ segments: segmentsLus, synchro: synchroEtiquettes });
    }
    if (chemin.endsWith('/integrations/shopify/segments') && req.method() === 'PUT') {
      const corps = req.postDataJSON() as { segments: string[] };
      trace.segmentsSuivis.push(corps);
      if (o.segments?.refus) return json({ error: o.segments.refus.error }, o.segments.refus.statut);
      if (Array.isArray(segmentsLus)) segmentsLus = segmentsLus.map((s) => ({ ...s, suivi: corps.segments.includes(String(s.segmentId)) }));
      if (corps.segments.length > 0 && synchroEtiquettes !== undefined && synchroEtiquettes !== 'absente') synchroEtiquettes = { ...synchroEtiquettes, enCours: true };
      return json({ synchro: { ...(synchroEtiquettes as Record<string, unknown>), enCours: true, lancee: corps.segments.length > 0 } }, 202);
    }
    if (chemin.endsWith('/integrations/shopify/etiquettes') && req.method() === 'PUT') {
      const corps = req.postDataJSON() as { allumee: boolean };
      trace.reglagesEtiquettes.push(corps);
      if (o.etiquettes?.refus) return json({ error: o.etiquettes.refus.error }, o.etiquettes.refus.statut);
      if (synchroEtiquettes !== undefined && synchroEtiquettes !== 'absente') {
        synchroEtiquettes = { ...synchroEtiquettes, allumee: corps.allumee, enCours: corps.allumee };
      }
      const lancee = corps.allumee && o.etiquettes?.dejaEnCours !== true;
      return json({ synchro: { ...(synchroEtiquettes as Record<string, unknown>), lancee } }, lancee ? 202 : 200);
    }
    if (chemin.endsWith('/integrations/shopify/etiquettes/synchro') && req.method() === 'POST') {
      trace.synchrosEtiquettes += 1;
      if (o.etiquettes?.refus) return json({ error: o.etiquettes.refus.error }, o.etiquettes.refus.statut);
      if (synchroEtiquettes !== undefined && synchroEtiquettes !== 'absente') synchroEtiquettes = { ...synchroEtiquettes, enCours: true };
      if (o.segments?.apresSynchro) segmentsLus = o.segments.apresSynchro;
      const lancee = o.etiquettes?.dejaEnCours !== true;
      return json({ synchro: { ...(synchroEtiquettes as Record<string, unknown>), lancee } }, lancee ? 202 : 200);
    }
    if (chemin.endsWith('/integrations/shopify') && req.method() === 'DELETE') {
      trace.coupures += 1;
      if (etat !== 'absente') etat = { ...etat, boutique: { ...(etat.boutique as Record<string, unknown>), etat: 'coupee' } };
      return json({ dejaCoupee: false, pageApps: null });
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
    const lectureScenario = /\/workflows\/([^/]+)$/.exec(chemin);
    if (lectureScenario && req.method() === 'GET') {
      const id = decodeURIComponent(lectureScenario[1]!);
      return json({ workflow: {
        id, name: `Scénario ${id}`, rayon: 'shopify', createdAt: '', updatedAt: '',
        graph: { nodes: [{ id: 'depart', type: 'template', position: { x: 0, y: 0 }, data: {} }], edges: [] },
      } });
    }
    const duBuilder = req.method() === 'GET' ? reponseDuBuilder(chemin) : undefined;
    if (duBuilder !== undefined) return json(duBuilder);
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
    await expect(carte.getByTestId('shopify-mode-operatoire')).toContainText('read_customers,read_orders,read_checkouts,read_fulfillments,read_products,read_all_orders');
    // read_all_orders (segments, lot 6a) : à retirer si Shopify refuse la version, la consigne le dit.
    await expect(carte.getByTestId('shopify-mode-operatoire')).toContainText('Si Shopify refuse la version à cause de read_all_orders, retirez-le');
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
    // Les messages sont des automations : le message du branchement dit où les allumer (la carte n'en parle plus, 2026-11-26).
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
    await expect(carte.getByTestId('integration-shopify-etat')).toContainText('Branchée');
    expect(trace.branchements).toHaveLength(1);
  });

  test('🔴 branchée : le nom de la boutique en grand, « Débrancher » en face, qui se confirme puis part', async ({ page }) => {
    const trace = await monter(page, {});
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('integration-shopify-nom')).toHaveText('Ma Boutique');
    await expect(carte.getByTestId('integration-shopify-etat')).toContainText('Branchée · ma-boutique.myshopify.com');
    await expect(carte.getByTestId('integration-shopify-rebrancher')).toHaveCount(0);
    await carte.getByTestId('integration-shopify-debrancher').click();
    await repondre(page, true, 'Plus aucun message de commande ne partira');
    await expect.poll(() => trace.coupures).toBe(1);
    await expect(carte.getByTestId('integration-shopify-message')).toContainText('Boutique débranchée');
    await expect(carte.getByTestId('integration-shopify-etat')).toContainText('Débranchée : plus aucun message ne part');
    await expect(carte.getByTestId('integration-shopify-rebrancher')).toBeVisible();
  });

  test('🔴 débranchée : « Rebrancher » en face ouvre les clés ; aucune ligne de geste', async ({ page }) => {
    await monter(page, { etat: { ...BRANCHEE, boutique: { ...BOUTIQUE, etat: 'coupee' } } });
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('integration-shopify-debrancher')).toHaveCount(0);
    await expect(carte.getByTestId('shopify-brancher')).toHaveCount(0);
    for (const id of ['integration-shopify-importer', 'integration-shopify-rattraper', 'integration-shopify-etiquettes-maintenant']) {
      await expect(carte.getByTestId(id), id).toHaveCount(0);
    }
    await carte.getByTestId('integration-shopify-rebrancher').click();
    await expect(carte.getByTestId('shopify-brancher')).toBeVisible();
    await expect(carte.getByTestId('shopify-boutique')).toBeVisible();
  });
  test('🔴 en pause (posée avant la refonte), la carte le dit ; « Reprendre » part sans question', async ({ page }) => {
    const trace = await monter(page, { etat: { ...BRANCHEE, boutique: { ...BOUTIQUE, pauseLe: '2026-11-19T10:00:00.000Z' } } });
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('integration-shopify-pause')).toContainText('En pause depuis');
    await carte.getByTestId('integration-shopify-reprendre').click();
    await expect.poll(() => trace.pauses).toEqual([{ pause: false }]);
    await expect(page.getByTestId('confirmation')).toHaveCount(0);
  });
  test('🔴 la carte branchée ne porte plus ni texte des automations, ni pause, ni paniers, ni chiffres des 30 jours, ni lien des apps (2026-11-26)', async ({ page }) => {
    await monter(page, {
      etat: {
        ...RELANCE_ACTIVE, compteurs: { envoye: 6, sans_telephone: 4 },
        paniers: { relances: { envoye: 3 }, fermesATemps: 1, enAttente: 2, relancesParties: 4, recuperes: 2, montantsRecuperes: [], recuperesTest: 0 },
      },
    });
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('integration-shopify-nom')).toBeVisible();
    for (const id of ['integration-shopify-automations', 'integration-shopify-pause', 'integration-shopify-paniers', 'integration-shopify-compteurs', 'integration-shopify-rgpd']) {
      await expect(carte.getByTestId(id), id).toHaveCount(0);
    }
    await expect(carte.getByRole('link', { name: 'La page des apps de la boutique' })).toHaveCount(0);
    await expect(carte).not.toContainText('Les 30 derniers jours');
  });
  test('🔴 les boutons de la carte s’alignent : même colonne, même largeur', async ({ page }) => {
    await monter(page, { etiquettes: { synchro: ETIQUETTES_LUES } });
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('integration-shopify-etiquettes-maintenant')).toBeVisible();
    const boites = await Promise.all(['integration-shopify-debrancher', 'integration-shopify-importer', 'integration-shopify-rattraper', 'integration-shopify-etiquettes-maintenant']
      .map(async (id) => (await carte.getByTestId(id).boundingBox())!));
    for (const b of boites) {
      expect(Math.abs(b.x - boites[0]!.x)).toBeLessThan(1);
      expect(Math.abs(b.width - boites[0]!.width)).toBeLessThan(1);
    }
  });
  test('🔴 le rattrapage des commandes : l’aperçu compte, fiches d’acheteurs à créer comprises, le lancement part une fois, la carte dit qu’il tourne (lots 5 et 5b)', async ({ page }) => {
    const trace = await monter(page, {});
    const carte = page.getByTestId('integration-shopify');
    await expect(carte.getByTestId('integration-shopify-rattrapage-etat')).toHaveCount(0);
    await carte.getByTestId('integration-shopify-rattraper').click();
    // 🔴 Le titre de la fenêtre se voit : le volet des intégrations masque le titre de la CARTE, jamais celui d'une fenêtre.
    await expect(page.getByTestId('shopify-rattrapage').getByRole('heading', { name: 'Rattraper les commandes des 60 derniers jours' })).toBeVisible();
    await expect(carte.getByRole('heading', { name: 'Shopify', exact: true })).toBeHidden();
    const apercu = page.getByTestId('shopify-rattrapage-apercu');
    await expect(apercu).toContainText('42 commandes payées créées depuis le');
    await expect(apercu).toContainText('25 à rattacher à une fiche');
    await expect(page.getByTestId('shopify-rattrapage-fiches')).toHaveText(
      '20 fiches d’acheteurs à créer : consentantes sur la foi de votre attestation, étiquetées « Shopify » (votre offre laisse 950 places)',
    );
    await expect(page.getByTestId('shopify-rattrapage-plafond')).toHaveCount(0);
    // Il reste des places après ces fiches : rien à dire de la porte des nouveaux clients.
    await expect(page.getByTestId('shopify-rattrapage-places')).toHaveCount(0);
    await expect(apercu).toContainText('5 sans fiche créée (un contact supprimé après la commande, un STOP, un numéro absent de WhatsApp, ou un numéro sur la seule livraison, comme un cadeau) : comptées, jamais gardées');
    await expect(apercu).toContainText('2 sans numéro WhatsApp utilisable');
    await expect(apercu).toContainText('3 écartées : jamais payées ou illisibles');
    await expect(page.getByTestId('shopify-rattrapage-regle')).toContainText('Aucun message ne part. Une fiche créée par le rattrapage est supprimée si WhatsApp ne trouve pas son numéro au premier envoi');
    await expect(page.getByTestId('shopify-rattrapage')).not.toContainText('Aucune fiche n’est créée');
    expect(trace.rattrapages).toBe(0);
    await page.getByTestId('shopify-rattrapage-lancer').click();
    await expect(page.getByTestId('shopify-rattrapage')).toHaveCount(0);
    expect(trace.rattrapages).toBe(1);
    await expect(carte.getByTestId('integration-shopify-message')).toContainText('Rattrapage lancé');
    await expect(carte.getByTestId('integration-shopify-rattrapage-etat')).toContainText('En cours, lancé le');
    // Pendant qu'il tourne, aucun second lancement n'est possible : le bouton reste à sa place, grisé.
    await expect(carte.getByTestId('integration-shopify-rattraper')).toBeDisabled();
  });

  test('un aperçu partiel le dit ; un rattrapage terminé dit sa date, et seulement elle', async ({ page }) => {
    const termine = {
      ...REPRISE, statut: 'termine', finiLe: '2026-11-23T12:05:00.000Z',
      comptes: { lues: 42, rattachees: 25, deja: 10, sansFiche: 5, sansNumero: 2, fichesCreees: 20, horsPlafond: 3 },
    };
    await monter(page, { rattrapage: { etat: termine, apercu: { ...APERCU_RATTRAPAGE, complet: false } } });
    const etat = page.getByTestId('integration-shopify-rattrapage-etat');
    await expect(etat).toHaveText('Dernier rattrapage le 23/11/2026');
    await page.getByTestId('integration-shopify-rattraper').click();
    await expect(page.getByTestId('shopify-rattrapage-partiel')).toContainText('l’aperçu n’a pas tout lu');
  });

  test('🔴 la limite de l’offre atteinte : l’aperçu dit les commandes qu’elle écarterait, et que les nouveaux clients n’entreraient plus', async ({ page }) => {
    await monter(page, { rattrapage: { apercu: { ...APERCU_RATTRAPAGE, fichesACreer: 2, horsPlafond: 4, placesLibres: 2, remplitLesPlaces: true } } });
    await page.getByTestId('integration-shopify-rattraper').click();
    await expect(page.getByTestId('shopify-rattrapage-fiches')).toContainText('2 fiches d’acheteurs à créer : consentantes');
    await expect(page.getByTestId('shopify-rattrapage-fiches')).toContainText('(votre offre laisse 2 places)');
    await expect(page.getByTestId('shopify-rattrapage-plafond')).toHaveText('4 au-delà de la limite de contacts de votre offre : non gardées');
    await expect(page.getByTestId('shopify-rattrapage-places')).toHaveText(
      'Ces fiches prendraient les dernières places de votre offre : ensuite, un nouveau client qui vous écrirait le premier n’entrerait plus.',
    );
  });

  test('🔴 sans l’attestation du consentement des clients, l’aperçu le dit, et rien ne se lance', async ({ page }) => {
    const refus = 'Le rattrapage crée, consentantes, les fiches des acheteurs qui n’en ont pas : avant lui, attestez…';
    const trace = await monter(page, { rattrapage: { refusApercu: refus } });
    await page.getByTestId('integration-shopify-rattraper').click();
    await expect(page.getByTestId('shopify-rattrapage-erreur')).toHaveText(refus);
    await expect(page.getByTestId('shopify-rattrapage-lancer')).toHaveCount(0);
    expect(trace.rattrapages).toBe(0);
  });

  test('🔴 une API d’avant le lot 5b ne crée aucune fiche : l’aperçu garde le texte du lot 5, aucune création promise', async ({ page }) => {
    await monter(page, { rattrapage: { apercu: APERCU_RATTRAPAGE_LOT5, etat: { ...REPRISE, statut: 'termine', finiLe: '2026-11-23T12:05:00.000Z', comptes: { lues: 3, rattachees: 1, deja: 1, sansFiche: 1, sansNumero: 0 } } } });
    await expect(page.getByTestId('integration-shopify-rattrapage-etat')).toHaveText('Dernier rattrapage le 23/11/2026');
    await page.getByTestId('integration-shopify-rattraper').click();
    await expect(page.getByTestId('shopify-rattrapage-apercu')).toContainText('5 sans fiche à leur numéro : comptées, jamais gardées');
    await expect(page.getByTestId('shopify-rattrapage-fiches')).toHaveCount(0);
    await expect(page.getByTestId('shopify-rattrapage-regle')).toContainText('Aucune fiche n’est créée et aucun message ne part');
  });

  test('un rattrapage arrêté par Shopify dit sa raison, et se relance', async ({ page }) => {
    await monter(page, { rattrapage: { etat: { ...REPRISE, statut: 'refuse', finiLe: '2026-11-23T12:01:00.000Z', erreur: 'Shopify refuse la lecture des commandes' } } });
    await expect(page.getByTestId('integration-shopify-rattrapage-etat')).toContainText('Arrêté : Shopify refuse la lecture des commandes');
    await expect(page.getByTestId('integration-shopify-rattraper')).toHaveText('Relancer');
  });

  test('🔴 l’API sans les routes du rattrapage (404 du routeur) : la carte n’en dit rien', async ({ page }) => {
    await monter(page, { rattrapage: { etat: 'absente' } });
    await expect(page.getByTestId('integration-shopify-etat')).toBeVisible();
    await expect(page.getByTestId('integration-shopify-rattrapage')).toHaveCount(0);
  });

  test('🔴 les étiquettes Shopify (lot 6b) : jamais synchronisées, « Synchroniser maintenant » les allume et lance la lecture, une fois', async ({ page }) => {
    const trace = await monter(page, { etiquettes: { synchro: ETIQUETTES_ETEINTES } });
    const bloc = page.getByTestId('integration-shopify-etiquettes');
    await expect(bloc).toContainText('Synchroniser les étiquettes Shopify de vos clients');
    await expect(page.getByRole('switch')).toHaveCount(0);
    expect(trace.reglagesEtiquettes).toHaveLength(0);
    await bloc.getByTestId('integration-shopify-etiquettes-maintenant').click();
    await expect(page.getByTestId('integration-shopify-message')).toContainText('Synchronisation lancée');
    expect(trace.reglagesEtiquettes).toEqual([{ allumee: true }]);
    expect(trace.synchrosEtiquettes).toBe(0);
    await expect(bloc.getByTestId('integration-shopify-etiquettes-en-cours')).toContainText('En cours : 0 client lu.');
    await expect(bloc.getByTestId('integration-shopify-etiquettes-maintenant')).toBeDisabled();
  });
  test('🔴 allumée : la date de la dernière synchronisation, et seulement elle ; « maintenant » part une fois', async ({ page }) => {
    const trace = await monter(page, { etiquettes: { synchro: ETIQUETTES_LUES } });
    const etat = page.getByTestId('integration-shopify-etiquettes-etat');
    await expect(etat).toHaveText(/^Dernière synchronisation le \d{2}\/\d{2}\/\d{4}$/);
    await page.getByTestId('integration-shopify-etiquettes-maintenant').click();
    await expect(page.getByTestId('integration-shopify-message')).toContainText('Synchronisation lancée');
    expect(trace.synchrosEtiquettes).toBe(1);
    expect(trace.reglagesEtiquettes).toEqual([]);
    await expect(page.getByTestId('integration-shopify-etiquettes-en-cours')).toContainText('En cours : 12 clients lus.');
    await expect(page.getByTestId('integration-shopify-etiquettes-maintenant')).toBeDisabled();
  });
  test('🔴 « maintenant » quand une synchronisation tourne déjà (lancee: false) : la carte ne dit pas « lancée »', async ({ page }) => {
    const trace = await monter(page, { etiquettes: { synchro: ETIQUETTES_LUES, dejaEnCours: true } });
    await page.getByTestId('integration-shopify-etiquettes-maintenant').click();
    await expect(page.getByTestId('integration-shopify-message')).toHaveText('Une synchronisation tourne déjà : elle continue.');
    expect(trace.synchrosEtiquettes).toBe(1);
  });

  test('🔴 un refus du serveur (l’offre Free, une fois par 24 heures) se dit sur la carte, et l’état reste', async ({ page }) => {
    const refus = 'Sur l’offre Free, les étiquettes Shopify se synchronisent au plus une fois toutes les 24 heures : réessayez dans 5 heures.';
    const trace = await monter(page, { etiquettes: { synchro: ETIQUETTES_LUES, refus: { statut: 429, error: refus } } });
    await page.getByTestId('integration-shopify-etiquettes-maintenant').click();
    await expect(page.getByTestId('integration-shopify-message')).toContainText('au plus une fois toutes les 24 heures');
    expect(trace.synchrosEtiquettes).toBe(1);
    await expect(page.getByTestId('integration-shopify-etiquettes-etat')).toContainText('Dernière synchronisation le');
  });

  test('une synchronisation refusée par Shopify se dit, avec la phrase du serveur', async ({ page }) => {
    await monter(page, { etiquettes: { synchro: { ...ETIQUETTES_LUES, synchroLe: null, refus: { code: 'sans_droit', message: 'ajoutez le droit read_customers.' } } } });
    await expect(page.getByTestId('integration-shopify-etiquettes-refus')).toContainText('La dernière synchronisation a échoué : ajoutez le droit read_customers.');
  });

  test('🔴 l’API sans les routes des étiquettes (404 du routeur) : la carte n’en dit rien', async ({ page }) => {
    await monter(page, { etiquettes: { synchro: 'absente' } });
    await expect(page.getByTestId('integration-shopify-etat')).toBeVisible();
    await expect(page.getByTestId('integration-shopify-etiquettes')).toHaveCount(0);
  });

  const SEGMENTS_LUS = [
    { segmentId: '11', nom: 'Clients fidèles', requete: null, suivi: true, absent: false, luLe: '2026-11-24T08:00:00.000Z', partiel: false, membres: 9, fiches: 4 },
    { segmentId: '12', nom: 'Gros paniers', requete: null, suivi: false, absent: false, luLe: null, partiel: false, membres: 0, fiches: 0 },
    { segmentId: '15', nom: 'Disparu', requete: null, suivi: false, absent: true, luLe: null, partiel: false, membres: 0, fiches: 0 },
  ];

  test('🔴 les segments Shopify (lot 6c) : la carte les liste, le choix part une fois, exactement les segments cochés', async ({ page }) => {
    const trace = await monter(page, { etiquettes: { synchro: ETIQUETTES_LUES }, segments: { lus: SEGMENTS_LUS } });
    const bloc = page.getByTestId('integration-shopify-segments');
    await expect(bloc).toContainText('Segments Shopify à suivre, 20 au plus');
    const cases = bloc.getByTestId('integration-shopify-segment');
    await expect(cases).toHaveCount(2);
    await expect(bloc).not.toContainText('Disparu');
    await expect(bloc.getByTestId('integration-shopify-segments-liste')).toContainText('Clients fidèles · 4 fiches · lu le');
    await expect(cases.nth(0)).toBeChecked();
    await expect(cases.nth(1)).not.toBeChecked();
    await expect(bloc.getByTestId('integration-shopify-segments-enregistrer')).toHaveCount(0);
    await cases.nth(1).check();
    await cases.nth(0).uncheck();
    await bloc.getByTestId('integration-shopify-segments-enregistrer').click();
    await expect(page.getByTestId('integration-shopify-message')).toContainText('Segments suivis enregistrés : la lecture de leurs membres tourne en arrière-plan.');
    expect(trace.segmentsSuivis).toEqual([{ segments: ['12'] }]);
    await expect(cases.nth(1)).toBeChecked();
    await expect(bloc.getByTestId('integration-shopify-segments-enregistrer')).toHaveCount(0);
  });

  test('🔴 « Synchroniser maintenant » relit aussi les segments, sans recharger la page ; le choix des segments relit l’état des étiquettes', async ({ page }) => {
    await monter(page, { etiquettes: { synchro: ETIQUETTES_LUES }, segments: { lus: [], apresSynchro: SEGMENTS_LUS } });
    const bloc = page.getByTestId('integration-shopify-segments');
    await expect(bloc.getByTestId('integration-shopify-segments-aucun')).toBeVisible();
    await page.getByTestId('integration-shopify-etiquettes-maintenant').click();
    await expect(bloc.getByTestId('integration-shopify-segment')).toHaveCount(2);
    await expect(bloc.getByTestId('integration-shopify-segments-aucun')).toHaveCount(0);
  });

  test('🔴 le choix des segments lance la synchronisation commune : la partie des étiquettes dit qu’elle tourne', async ({ page }) => {
    await monter(page, { etiquettes: { synchro: ETIQUETTES_LUES }, segments: { lus: SEGMENTS_LUS } });
    await expect(page.getByTestId('integration-shopify-etiquettes-etat')).toContainText('Dernière synchronisation le');
    await page.getByTestId('integration-shopify-segment').nth(1).check();
    await page.getByTestId('integration-shopify-segments-enregistrer').click();
    await expect(page.getByTestId('integration-shopify-etiquettes-en-cours')).toBeVisible();
    await expect(page.getByTestId('integration-shopify-etiquettes-maintenant')).toBeDisabled();
  });

  test('un refus du serveur au choix des segments se dit sur la carte', async ({ page }) => {
    const refus = 'Segment inconnu de cet espace ou disparu chez Shopify : 12.';
    const trace = await monter(page, { etiquettes: { synchro: ETIQUETTES_LUES }, segments: { lus: SEGMENTS_LUS, refus: { statut: 409, error: refus } } });
    await page.getByTestId('integration-shopify-segment').nth(1).check();
    await page.getByTestId('integration-shopify-segments-enregistrer').click();
    await expect(page.getByTestId('integration-shopify-message')).toContainText(refus);
    expect(trace.segmentsSuivis).toHaveLength(1);
  });

  test('🔴 la synchronisation éteinte : la carte ne montre pas les segments', async ({ page }) => {
    await monter(page, { etiquettes: { synchro: ETIQUETTES_ETEINTES }, segments: { lus: SEGMENTS_LUS } });
    await expect(page.getByTestId('integration-shopify-etiquettes')).toBeVisible();
    await expect(page.getByTestId('integration-shopify-segments')).toHaveCount(0);
  });

  test('🔴 l’API sans la route des segments (404 du routeur) : la carte n’en dit rien', async ({ page }) => {
    await monter(page, { etiquettes: { synchro: ETIQUETTES_LUES }, segments: { lus: 'absente' } });
    await expect(page.getByTestId('integration-shopify-etiquettes')).toBeVisible();
    await expect(page.getByTestId('integration-shopify-segments')).toHaveCount(0);
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

  test('🔴 le premier allumage crée le scénario et le DÉPLIE sous la liste, sans quitter la page (2026-11-20)', async ({ page }) => {
    const trace = await monter(page, { ecran: PAGE, etat: BRANCHEE });
    await page.getByTestId('automations-shopify-interrupteur-order_fulfilled').click();
    await expect.poll(() => trace.lignes).toEqual([{ evenement: 'order_fulfilled', corps: { actif: true } }]);
    await expect(page.getByTestId('scenario-ouvert-nom')).toHaveText('Scénario wf-order_fulfilled');
    await expect(page).toHaveURL(/\/automations\/shopify$/);
  });

  test('🔴 « Ouvrir le scénario » le déplie sous la liste, un seul à la fois ; « Fermer » le replie ; l’adresse reste pour un nouvel onglet', async ({ page }) => {
    await monter(page, { ecran: PAGE, etat: { ...RELANCE_ACTIVE, attestation: ATTESTEE } });
    const section = page.getByTestId('automations-shopify');
    await expect(section.getByTestId('automations-shopify-ouvrir-order_paid')).toHaveAttribute('href', '/workflows?open=wf-order_paid');
    await section.getByTestId('automations-shopify-ouvrir-order_paid').click();
    await expect(page.getByTestId('scenario-ouvert-nom')).toHaveText('Scénario wf-order_paid');
    await expect(page.getByTestId('scenario-ouvert').locator('.react-flow__node')).toHaveCount(1);
    await section.getByTestId('automations-shopify-ouvrir-checkout_abandoned').click();
    await expect(page.getByTestId('scenario-ouvert-nom')).toHaveText('Scénario wf-checkout_abandoned');
    await expect(page.getByTestId('scenario-ouvert')).toHaveCount(1);
    await page.getByTestId('scenario-ouvert-fermer').click();
    await expect(page.getByTestId('scenario-ouvert')).toHaveCount(0);
    await expect(page).toHaveURL(/\/automations\/shopify$/);
  });

  test('sur grand écran, le scénario déplié prend toute la largeur, pas celle des listes (Julien, 2026-11-21)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await monter(page, { ecran: PAGE, etat: { ...RELANCE_ACTIVE, attestation: ATTESTEE } });
    await page.getByTestId('automations-shopify-ouvrir-order_paid').click();
    const cadre = await page.getByTestId('scenario-ouvert').boundingBox();
    // `max-w-liste` vaut 72rem (1152 px) : au-delà, la page n'est plus bornée par elle.
    expect(cadre?.width ?? 0).toBeGreaterThan(1300);
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
    await expect(page.getByTestId('scenario-ouvert-nom')).toHaveText('Scénario wf-order_paid');
    await expect(page).toHaveURL(/\/automations\/shopify$/);
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
    await expect(page.getByTestId('automations-shopify-coupee')).toContainText('Boutique débranchée');
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
