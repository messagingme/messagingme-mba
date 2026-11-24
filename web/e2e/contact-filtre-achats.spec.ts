import { test, expect } from './aide/test';
import { TREIZE_POUCES, pasDeDebordement } from './aide/largeur';

/**
 * Les filtres « Achats et activité » des contacts (segments, spec du 2026-10-31) : l'activité toujours ; les commandes, la
 * dépense et la dernière commande dans le volet « Shopify », replié, seulement si l'espace a une boutique (spec du
 * 2026-11-21, lot 1).
 *
 * 🔴 Le cas qui compte le plus : une API qui ne répond pas à `/contacts/segments` (plus ancienne que la console, qui part
 * en production à chaque push) ne se voit proposer AUCUN de ces critères. Elle les jetterait sans rien dire, et « au
 * moins deux commandes » rendrait tout l'espace.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const CONTACT = {
  id: 'ct1', profileName: 'Anna Vip', phoneE164: '+33600000001', bsuid: null, optInStatus: 'opted_in',
  tags: ['vip'], fields: {}, createdAt: '2026-01-01T00:00:00Z',
};
const AVEC_BOUTIQUE = { boutique: { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-11-03' };
const SANS_BOUTIQUE = { boutique: null, activiteCompleteDepuis: '2026-11-03' };

/** Les produits déjà vus dans les commandes (lot 3), tels que `GET .../contacts/segments/produits` les rend. */
const PRODUITS = [
  { produitId: '8801', sku: 'SER-30', titre: 'Sérum vitamine C', varianteTitre: '30 ml', commandes: 4 },
  { produitId: '8802', sku: 'CRE-50', titre: 'Crème de nuit', varianteTitre: '50 ml', commandes: 2 },
];

/** Les collections lues (lot 6a), telles que `GET .../contacts/segments/collections` les rend, et l'état de leur lecture. */
const LUES = {
  collections: [{ collectionId: '4401', titre: 'Été', produits: 3 }, { collectionId: '4402', titre: 'Soins du visage', produits: 2 }],
  lecture: { lueLe: '2026-11-24T08:00:00.000Z', enCours: false, refus: null, incompletes: false },
};

/**
 * `segments` : la réponse de la route, ou `null` pour une API qui ne la connaît pas (404). `collections` : la réponse de la
 * route des collections lues, ou une fonction du numéro de l'appel (une lecture en cours, puis finie).
 */
async function mock(page: import('@playwright/test').Page, segments: unknown, collections: unknown | ((appel: number, q: string) => unknown) = LUES): Promise<URLSearchParams[]> {
  const requetes: URLSearchParams[] = [];
  let appels = 0;
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (url.pathname.endsWith('/contacts/segments/collections')) {
      appels += 1;
      return json(typeof collections === 'function' ? collections(appels, url.searchParams.get('q') ?? '') : collections);
    }
    if (url.pathname.endsWith('/contacts/segments/produits')) {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      return json({ produits: PRODUITS.filter((p) => q === '' || p.titre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) });
    }
    if (url.pathname.endsWith('/contacts/segments')) return segments === null ? json({ error: 'Not Found' }, 404) : json(segments);
    if (url.pathname.endsWith('/conversations/todo-count')) return json({ count: 0 });
    if (url.pathname.endsWith('/contacts')) { requetes.push(url.searchParams); return json({ contacts: [CONTACT], total: 1 }); }
    if (url.pathname.endsWith('/user-fields')) return json({ fields: [] });
    if (url.pathname.endsWith('/tags')) return json({ tags: [] });
    if (url.pathname.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  return requetes;
}

/** Les critères de segment d'une requête de la liste : ils voyagent dans `fields`, opérateur `segment` (clé -> valeur). */
function segments(q: URLSearchParams): Record<string, string> {
  let champs: unknown;
  try { champs = JSON.parse(q.get('fields') ?? '[]'); } catch { return {}; }
  if (!Array.isArray(champs)) return {};
  return Object.fromEntries(champs.filter((c) => c?.op === 'segment').map((c) => [String(c.key), String(c.value)]));
}

async function ouvrir(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/contacts');
  await page.getByTestId('contacts-toggle-filters').click();
}

/** Déplie le volet Shopify, replié par défaut dans le mini-CRM. */
async function deplierShopify(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('filtres-shopify-titre').click();
  await expect(page.getByTestId('filtres-shopify')).toHaveAttribute('open', '');
}

test.describe('Contacts : les filtres d’achats et d’activité', () => {
  test.use({ viewport: TREIZE_POUCES });

  test('🔴 avec une boutique : commandes sur une période et activité partent à l’API', async ({ page }) => {
    const requetes = await mock(page, AVEC_BOUTIQUE);
    await ouvrir(page);
    // Replié par défaut : les critères de commande ne se voient qu'une fois le volet ouvert.
    await expect(page.getByTestId('filtres-shopify')).toBeVisible();
    await expect(page.getByTestId('filtre-commandes-min')).toBeHidden();
    await deplierShopify(page);
    await expect(page.getByTestId('filtres-achats-suivi')).toContainText('Commandes payées suivies depuis le');
    await page.getByTestId('filtre-commandes-jours').fill('90');
    await page.getByTestId('filtre-commandes-min').fill('2');
    await page.getByTestId('filtre-actif-jours').fill('30');
    await expect.poll(() => requetes.some((q) => {
      const s = segments(q);
      return s.segment_commandes === '{"min":2,"jours":90}' && s.segment_actif === '30';
    })).toBe(true);
    // La devise de la boutique est dite là où l'on saisit un montant.
    await expect(page.getByTestId('filtres-shopify')).toContainText('Dépense (EUR)');
  });

  test('🔴 une saisie invalide est dite, n’est jamais envoyée, et ne retire pas le critère valide', async ({ page }) => {
    const requetes = await mock(page, AVEC_BOUTIQUE);
    await ouvrir(page);
    await deplierShopify(page);
    await page.getByTestId('filtre-commandes-min').fill('0');
    await expect(page.getByTestId('filtre-commandes-erreur')).toContainText('ne restreint rien');
    await page.getByTestId('filtre-commandes-min').fill('3');
    await expect.poll(() => requetes.some((q) => segments(q).segment_commandes === '{"min":3}')).toBe(true);
    await page.getByTestId('filtre-commandes-max').fill('2');
    await expect(page.getByTestId('filtre-commandes-erreur')).toContainText('Le minimum dépasse le maximum');
    await page.getByTestId('filtre-inactif-jours').fill('90');
    await expect.poll(() => requetes.some((q) => segments(q).segment_inactif === '90')).toBe(true);
    // Le maximum faux n'a rien envoyé, et le critère valide « au moins 3 » est resté : l'audience ne s'est pas élargie.
    const derniere = segments(requetes[requetes.length - 1]!);
    expect(derniere.segment_commandes).toBe('{"min":3}');
    expect(requetes.some((q) => 'segment_commandes' in segments(q) && segments(q).segment_commandes !== '{"min":3}')).toBe(false);
  });

  // Pas de boutique, pas de volet : masqué plutôt que grisé, comme le bouton HubSpot (décision de Julien du 2026-11-22).
  test('sans boutique : l’activité seulement, et aucun volet Shopify', async ({ page }) => {
    await mock(page, SANS_BOUTIQUE);
    await ouvrir(page);
    await expect(page.getByTestId('filtre-actif-jours')).toBeVisible();
    await expect(page.getByTestId('filtres-shopify')).toHaveCount(0);
    await expect(page.getByTestId('filtre-commandes-min')).toHaveCount(0);
    await expect(page.getByTestId('filtre-depense-min')).toHaveCount(0);
  });

  // 🔴 Replier le volet range l'écran, il ne retire rien : un critère qui partirait avec le volet élargirait l'audience.
  test('replier le volet ne retire pas le critère posé', async ({ page }) => {
    const requetes = await mock(page, AVEC_BOUTIQUE);
    await ouvrir(page);
    await deplierShopify(page);
    await page.getByTestId('filtre-commandes-min').fill('2');
    await expect.poll(() => requetes.some((q) => segments(q).segment_commandes === '{"min":2}')).toBe(true);
    await page.getByTestId('filtres-shopify-titre').click();
    await expect(page.getByTestId('filtres-shopify')).not.toHaveAttribute('open', '');
    await page.getByTestId('filtre-actif-jours').fill('30');
    await expect.poll(() => requetes.some((q) => segments(q).segment_actif === '30')).toBe(true);
    expect(segments(requetes[requetes.length - 1]!).segment_commandes).toBe('{"min":2}');
    await page.getByTestId('filtres-shopify-titre').click();
    await expect(page.getByTestId('filtre-commandes-min')).toHaveValue('2');
  });

  test('🔴 une API qui ne connaît pas les segments : aucun de ces critères n’est proposé', async ({ page }) => {
    await mock(page, null);
    await ouvrir(page);
    // Le reste du panneau est là : seul ce qui dépend de l'API manque.
    await expect(page.getByTestId('filtre-joignabilite')).toBeVisible();
    await expect(page.getByTestId('filtres-achats')).toHaveCount(0);
    await expect(page.getByTestId('filtres-shopify')).toHaveCount(0);
  });

  test('sur un 13 pouces, la partie ne fait pas déborder le panneau', async ({ page }) => {
    await mock(page, AVEC_BOUTIQUE);
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtre-derniere-commande-max')).toBeVisible();
    await pasDeDebordement(page);
  });
});

/**
 * LES CRITÈRES PRODUIT DU VOLET (segments Shopify enrichis, lot 3) : choisis parmi les produits déjà commandés, ils
 * partent à l'API dans `fields`. 🔴 L'exclusion n'est jamais seule, et une API qui ne les annonce pas n'en voit aucun.
 */
test.describe('Contacts : les critères produit du volet Shopify', () => {
  test.use({ viewport: TREIZE_POUCES });
  const AVEC_PRODUITS = { ...AVEC_BOUTIQUE, produits: true };
  const dernier = (requetes: URLSearchParams[]) => segments(requetes.at(-1) ?? new URLSearchParams());

  test('🔴 « a acheté », la fenêtre, l’exclusion jamais seule, le réassort et la variante partent à l’API', async ({ page }) => {
    const requetes = await mock(page, AVEC_PRODUITS);
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtre-produits-resultat')).toHaveCount(2);
    // L'exclusion seule viserait presque tout l'espace : son bouton attend « a acheté ».
    await expect(page.getByTestId('produit-pas-achete').first()).toBeDisabled();
    await expect(page.getByTestId('filtre-pas-achete-aide')).toBeVisible();
    await page.getByTestId('produit-achete').first().click();
    await expect(page.getByTestId('filtre-achete-puce')).toHaveText(/Sérum vitamine C/);
    await expect.poll(() => dernier(requetes).segment_achete).toBe('{"produits":[{"produit":"8801"}]}');
    await page.getByTestId('filtre-achete-jours').fill('90');
    await expect.poll(() => dernier(requetes).segment_achete).toBe('{"produits":[{"produit":"8801"}],"jours":90}');
    await page.getByTestId('produit-pas-achete').nth(1).click();
    await expect.poll(() => dernier(requetes).segment_pas_achete).toBe('{"produits":[{"produit":"8802"}]}');
    // Retirer le dernier produit acheté emporte l'exclusion, qui ne s'emploie jamais seule.
    await page.getByTestId('filtre-achete-retirer').click();
    await expect.poll(() => [dernier(requetes).segment_achete, dernier(requetes).segment_pas_achete]).toEqual([undefined, undefined]);
    // Le réassort part avec une borne visible, « il y a au moins 60 jours », modifiable.
    await page.getByTestId('produit-reassort').first().click();
    await expect.poll(() => dernier(requetes).segment_reassort).toBe('{"produit":"8801","min":60}');
    await expect(page.getByTestId('filtre-reassort-min')).toHaveValue('60');
    await page.getByTestId('filtre-reassort-max').fill('120');
    await expect.poll(() => dernier(requetes).segment_reassort).toBe('{"produit":"8801","min":60,"max":120}');
    // Vider les deux bornes le temps d'une frappe ne retire rien : la dernière plage valide reste.
    await page.getByTestId('filtre-reassort-min').fill('');
    await page.getByTestId('filtre-reassort-max').fill('');
    await expect(page.getByTestId('filtre-reassort-erreur')).toBeVisible();
    expect(dernier(requetes).segment_reassort).toBe('{"produit":"8801","min":60,"max":120}');
    // La variante, par son SKU.
    await page.getByTestId('filtre-produits-cible-sku').check();
    await page.getByTestId('produit-achete').first().click();
    await expect.poll(() => dernier(requetes).segment_achete).toBe('{"produits":[{"sku":"SER-30"}]}');
  });

  test('la recherche passe à l’API ; une liste illisible le dit', async ({ page }) => {
    await mock(page, AVEC_PRODUITS);
    await ouvrir(page);
    await deplierShopify(page);
    await page.getByTestId('filtre-produits-recherche').fill('crème');
    await expect(page.getByTestId('filtre-produits-resultat')).toHaveCount(1);
    await expect(page.getByTestId('filtre-produits-resultat')).toContainText('Crème de nuit');
    await page.getByTestId('filtre-produits-recherche').fill('introuvable');
    await expect(page.getByTestId('filtre-produits-aucun')).toBeVisible();
  });

  test('🔴 une API qui n’annonce pas les critères produit : aucune ligne produit dans le volet', async ({ page }) => {
    await mock(page, AVEC_BOUTIQUE);
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtre-commandes-min')).toBeVisible();
    await expect(page.getByTestId('filtres-produits')).toHaveCount(0);
  });
});

/**
 * LES DEUX BOUTONS PRÊTS DU VOLET (segments Shopify enrichis, lot 4) : un clic pose le critère, un second le retire ; la
 * pastille compte le bouton seul. 🔴 Masqués à zéro, et tous absents sans compte (une API plus ancienne).
 */
test.describe('Contacts : les boutons « sans commander » du volet Shopify', () => {
  test.use({ viewport: TREIZE_POUCES });
  const dernier = (requetes: URLSearchParams[]) => segments(requetes.at(-1) ?? new URLSearchParams());

  test('🔴 un clic pose le bouton, un second le retire ; les deux se cumulent ; la pastille compte le bouton seul', async ({ page }) => {
    const requetes = await mock(page, { ...AVEC_BOUTIQUE, boutons: { ecritSansCommande: 12, clicSansCommande: 4 } });
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtre-bouton-ecrit')).toHaveText('A écrit sans commander · 12');
    await expect(page.getByTestId('filtre-bouton-clic')).toHaveText('A cliqué sans commander · 4');
    await expect(page.getByTestId('filtres-boutons-legende')).toContainText('message reçu encore connu');
    await page.getByTestId('filtre-bouton-ecrit').click();
    await expect(page.getByTestId('filtre-bouton-ecrit')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => dernier(requetes).segment_ecrit_sans_commande).toBe('true');
    await page.getByTestId('filtre-bouton-clic').click();
    await expect.poll(() => [dernier(requetes).segment_ecrit_sans_commande, dernier(requetes).segment_clic_sans_commande]).toEqual(['true', 'true']);
    await page.getByTestId('filtre-bouton-ecrit').click();
    await expect(page.getByTestId('filtre-bouton-ecrit')).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => [dernier(requetes).segment_ecrit_sans_commande, dernier(requetes).segment_clic_sans_commande]).toEqual([undefined, 'true']);
  });

  test('🔴 un bouton à zéro n’est pas montré, l’autre l’est', async ({ page }) => {
    await mock(page, { ...AVEC_BOUTIQUE, boutons: { ecritSansCommande: 0, clicSansCommande: 7 } });
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtre-bouton-clic')).toHaveText('A cliqué sans commander · 7');
    await expect(page.getByTestId('filtre-bouton-ecrit')).toHaveCount(0);
  });

  test('🔴 une API qui ne rend pas les comptes : aucun bouton, le reste du volet est là', async ({ page }) => {
    await mock(page, AVEC_BOUTIQUE);
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtre-commandes-min')).toBeVisible();
    await expect(page.getByTestId('filtres-boutons-sans-commande')).toHaveCount(0);
  });
});

/**
 * LE CRITÈRE DE COLLECTION DU VOLET (segments Shopify enrichis, lot 6a) : choisi parmi les collections LUES chez Shopify,
 * telles qu'elles sont dans la boutique à la dernière lecture (la phrase le dit, avec sa date). 🔴 Une API qui ne l'annonce
 * pas n'en montre aucun ; une lecture en cours, ou refusée faute du droit read_products, se dit.
 */
test.describe('Contacts : le critère de collection du volet Shopify', () => {
  test.use({ viewport: TREIZE_POUCES });
  const AVEC_COLLECTIONS = { ...AVEC_BOUTIQUE, produits: true, collections: true };
  const dernier = (requetes: URLSearchParams[]) => segments(requetes.at(-1) ?? new URLSearchParams());

  test('🔴 « a acheté dans la collection » : chacune des collections, la fenêtre, la puce nommée ; la phrase dit la date de la lecture', async ({ page }) => {
    const requetes = await mock(page, AVEC_COLLECTIONS);
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtre-collections-resultat')).toHaveCount(2);
    await expect(page.getByTestId('filtre-collections-resultat').first()).toContainText('Été');
    await expect(page.getByTestId('filtre-collections-resultat').first()).toContainText('3 produits commandés');
    await expect(page.getByTestId('filtre-collections-lues-le')).toContainText('telles qu’elles sont dans votre boutique, lues le');
    await expect(page.getByTestId('filtre-collections-lues-le')).toContainText('pas au jour de sa commande');
    await page.getByTestId('collection-achete').first().click();
    await expect(page.getByTestId('filtre-collection-puce')).toHaveText(/Été/);
    await expect.poll(() => dernier(requetes).segment_collection).toBe('{"collections":["4401"]}');
    await page.getByTestId('filtre-collection-jours').fill('90');
    await expect.poll(() => dernier(requetes).segment_collection).toBe('{"collections":["4401"],"jours":90}');
    await page.getByTestId('collection-achete').nth(1).click();
    await expect.poll(() => dernier(requetes).segment_collection).toBe('{"collections":["4401","4402"],"jours":90}');
    await expect(page.getByTestId('filtre-collection-puce')).toHaveCount(2);
    // Retirer les deux puces retire le critère.
    await page.getByTestId('filtre-collection-retirer').first().click();
    await page.getByTestId('filtre-collection-retirer').first().click();
    await expect.poll(() => dernier(requetes).segment_collection).toBeUndefined();
    await expect(page.getByTestId('filtre-collection')).toHaveCount(0);
  });

  test('🔴 une lecture en cours se dit, et la liste se relit seule jusqu’à son issue', async ({ page }) => {
    const enCours = { collections: [], lecture: { lueLe: null, enCours: true, refus: null, incompletes: false } };
    await mock(page, AVEC_COLLECTIONS, (appel: number) => (appel === 1 ? enCours : LUES));
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtre-collections-en-cours')).toContainText('Lecture des collections de votre boutique en cours');
    await expect(page.getByTestId('filtre-collections-resultat')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByTestId('filtre-collections-en-cours')).toHaveCount(0);
  });

  test('🔴 sans le droit read_products : la phrase dit comment l’ajouter, aucune collection n’est proposée', async ({ page }) => {
    await mock(page, AVEC_COLLECTIONS, {
      collections: [], lecture: { lueLe: null, enCours: false, refus: { code: 'sans_droit', message: 'm' }, incompletes: false },
    });
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtre-collections-sans-droit')).toContainText('read_products');
    await expect(page.getByTestId('filtre-collections-sans-droit')).toContainText('réinstallez-la sur la boutique');
    await expect(page.getByTestId('filtre-collections-resultat')).toHaveCount(0);
  });

  test('🔴 une collection posée qui n’est plus dans la liste complète est signalée : le critère serait refusé', async ({ page }) => {
    const etat = { liste: LUES };
    await mock(page, AVEC_COLLECTIONS, () => etat.liste);
    await ouvrir(page);
    await deplierShopify(page);
    await page.getByTestId('collection-achete').first().click();
    await expect(page.getByTestId('filtre-collection-puce')).toHaveText(/Été/);
    // Relue, la boutique n'a plus « Été » : la recherche relance la lecture, la liste complète ne la porte plus.
    etat.liste = { ...LUES, collections: [LUES.collections[1]!] };
    await page.getByTestId('filtre-collections-recherche').fill('soins');
    await page.getByTestId('filtre-collections-recherche').fill('');
    await expect(page.getByTestId('filtre-collection-inconnue')).toContainText('Été n’est plus parmi les collections lues');
  });

  test('🔴 une API qui n’annonce pas les collections : aucune ligne de collection, les critères produit restent', async ({ page }) => {
    await mock(page, { ...AVEC_BOUTIQUE, produits: true });
    await ouvrir(page);
    await deplierShopify(page);
    await expect(page.getByTestId('filtres-produits')).toBeVisible();
    await expect(page.getByTestId('filtres-collections')).toHaveCount(0);
  });

  test('sur un 13 pouces, le critère de collection ne fait pas déborder le panneau', async ({ page }) => {
    await mock(page, AVEC_COLLECTIONS);
    await ouvrir(page);
    await deplierShopify(page);
    await page.getByTestId('collection-achete').first().click();
    await expect(page.getByTestId('filtre-collection-jours')).toBeVisible();
    await pasDeDebordement(page);
  });
});
