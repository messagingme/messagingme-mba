import { test, expect } from './aide/test';

/**
 * LE CRÉDIT WHATSAPP DANS `/ops`, TEL QUE JULIEN LE LIT (2026-11-02 : « je vois toujours pas la grille des prix Meta dans
 * ops », « ça sert à quoi identifiant Meta du numéro ? », « je peux pas enregistrer »).
 *
 * Ce que ces tests protègent à l'écran : la grille de Meta prix par prix (le prix client et, dessous, le tarif de Meta),
 * trouvée par le nom d'un pays même rangé dans un marché régional ; les numéros de l'espace proposés tels quels, chacun
 * avec son geste ou la raison qui l'empêche, au lieu d'un identifiant à taper ; l'Entreprise dite illimitée avec son
 * montant du mois, jamais un « Solde : 0 » ; et ce qui grise « Enregistrer », dit en clair.
 */
const SESSION_OPS = { token: 'session-ops-e2e', email: 'exploitant@e2e.test' };
const ESPACE = {
  id: 't-essai', name: 'Essai Dupont', createdAt: '2026-10-01T00:00:00Z', mbaEnabled: false,
  users: 1, contacts: 0, messages: 0, templatesUsed: 0, lastSendAt: null, phone: null, phoneStatus: null, quality: null,
};

const RESUME = {
  id: 'g1', enVigueurLe: '2026-10-01', chargeeLe: '2026-11-02T08:23:11.407Z', chargeePar: 'exploitant@e2e.test',
  note: 'grille T4', tarifs: 6, perimee: false, prochaine: null,
};

const GRILLE = {
  grille: { id: 'g1', enVigueurLe: '2026-10-01' },
  commissionPct: 5,
  marches: [
    { cle: 'FR', nom: 'France', pays: ['FR'] },
    { cle: 'GB', nom: 'United Kingdom', pays: ['GB', 'GG', 'JE', 'IM'] },
    { cle: 'rest_of_western_europe', nom: 'Rest of Western Europe', pays: ['AT', 'BE', 'DK'] },
    { cle: 'other', nom: 'Other', pays: [] },
  ],
  tarifs: [
    { marche: 'FR', categorie: 'marketing', palier: 0, metaMicroEur: 71_200, clientMicroEur: 74_760 },
    { marche: 'FR', categorie: 'service', palier: 0, metaMicroEur: 24_800, clientMicroEur: 26_040 },
    { marche: 'GB', categorie: 'marketing', palier: 0, metaMicroEur: 50_600, clientMicroEur: 53_130 },
    { marche: 'rest_of_western_europe', categorie: 'marketing', palier: 0, metaMicroEur: 59_900, clientMicroEur: 62_895 },
    { marche: 'other', categorie: 'marketing', palier: 0, metaMicroEur: 55_800, clientMicroEur: 58_590 },
  ],
};

/** Un numéro arrivé par la fenêtre du partenaire qui attend sa ligne (relecture du lot E5, jaune 3). */
const EN_ATTENTE = {
  tenantId: 't-essai', espace: 'Essai Dupont', phoneNumberId: '106540352242922', numero: '+44 1224 000000',
  depuis: '2026-11-09T18:30:00.000Z',
};

/** `enAttente` : la liste des numéros qui attendent leur ligne ; `null`, une API d'avant la route (404). */
async function reglages(page: import('@playwright/test').Page, grille: typeof GRILLE | null, enAttente: Array<typeof EN_ATTENTE> | null = []) {
  await page.addInitScript((s) => window.localStorage.setItem('mba.sessionOps', JSON.stringify(s)), SESSION_OPS);
  await page.route('**/api/backend/**', async (route) => {
    const chemin = route.request().url().split('?')[0]!;
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/ops/credit-whatsapp/reglages')) return json({ grille: RESUME, commissionPct: 5 });
    if (chemin.endsWith('/ops/credit-whatsapp/grille')) {
      if (grille === null) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"inconnu"}' });
      return json(grille);
    }
    if (chemin.endsWith('/ops/credit-whatsapp/en-attente')) {
      if (enAttente === null) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"inconnu"}' });
      return json({ numeros: enAttente });
    }
    if (chemin.endsWith('/ops/overview')) return json({ tenants: [], daily: [], queues: [], worker: null });
    // Les cartes voisines se masquent d'elles-mêmes sans leur route.
    if (chemin.includes('/ops/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"indisponible"}' });
    return json({});
  });
  await page.goto('/ops?tab=reglages');
}

test.describe('Ops : la grille de Meta, prix par prix', () => {
  test('🔴 chaque prix client et, dessous, le tarif de Meta ; une catégorie sans tarif le dit', async ({ page }) => {
    await reglages(page, GRILLE);
    const france = page.getByTestId('ops-grille-meta-FR');
    await expect(france).toBeVisible();
    await expect(france.locator('[data-categorie="marketing"] [data-prix="client"]')).toHaveText(/0,0748\s€/);
    await expect(france.locator('[data-categorie="marketing"] [data-prix="meta"]')).toHaveText(/Meta 0,0712\s€/);
    await expect(france.locator('[data-categorie="authentication_international"]')).toHaveText('sans objet');
    // La France d'abord ; les marchés régionaux disent leurs pays ; « Autres pays » vient en dernier.
    await expect(page.getByTestId('ops-grille-meta-table').locator('tbody tr').first()).toContainText('France');
    await expect(page.getByTestId('ops-grille-meta-rest_of_western_europe')).toContainText('Belgique');
    await expect(page.getByTestId('ops-grille-meta-table').locator('tbody tr').last()).toContainText('Autres pays');
  });

  test('chercher un pays trouve le marché régional, ou le pays qui partage son indicatif', async ({ page }) => {
    await reglages(page, GRILLE);
    await page.getByTestId('ops-grille-meta-recherche').fill('belgique');
    await expect(page.getByTestId('ops-grille-meta-rest_of_western_europe')).toBeVisible();
    await expect(page.getByTestId('ops-grille-meta-FR')).toHaveCount(0);
    // Guernesey, au +44, est facturé comme le Royaume-Uni.
    await page.getByTestId('ops-grille-meta-recherche').fill('guernesey');
    await expect(page.getByTestId('ops-grille-meta-GB')).toBeVisible();
    await expect(page.getByTestId('ops-grille-meta-rest_of_western_europe')).toHaveCount(0);
  });

  test('API sans la route : la carte le dit, sans tableau', async ({ page }) => {
    await reglages(page, null);
    await expect(page.getByTestId('ops-grille-meta-prix-absente')).toBeVisible();
    await expect(page.getByTestId('ops-grille-meta-table')).toHaveCount(0);
  });
});

test.describe('Ops : les numéros qui attendent leur ligne (relecture du lot E5, jaune 3 ; décision de Julien du 2026-11-09)', () => {
  test('🔴 un numéro arrivé par la fenêtre du partenaire est listé avec son espace, son numéro, le jour de sa connexion, et le geste à faire dans l’ordre', async ({ page }) => {
    // L'alerte Telegram de l'essai 236 s'est perdue : la liste reste, le geste ne dépend plus d'elle.
    await reglages(page, GRILLE, [EN_ATTENTE]);
    const liste = page.getByTestId('ops-credit-whatsapp-en-attente');
    await expect(liste).toContainText('En attente de leur ligne');
    await expect(liste).toContainText('quand il confirme l’attache, pas avant');
    // Sur un compte déjà couvert, « Ne pas poser » ne vaut que l'attache vérifiée : sans elle, notre ligne resterait, et le
    // client paierait deux fois ou Meta refuserait ses envois (relecture du lot V7, jaune 3).
    await expect(liste).toContainText('un compte déjà couvert, l’attache vérifiée, garde sa ligne');
    await expect(liste).toContainText('sans attache, « Ne pas poser » ne retire pas la nôtre : la retirer plutôt');
    await expect(liste.getByTestId('ops-credit-whatsapp-en-attente-numero')).toHaveText('Essai Dupont : +44 1224 000000, connecté le 09/11/2026');
  });

  test('aucun numéro n’attend : la liste le dit', async ({ page }) => {
    await reglages(page, GRILLE);
    await expect(page.getByTestId('ops-credit-whatsapp-en-attente')).toContainText('Aucun numéro n’attend sa ligne.');
    await expect(page.getByTestId('ops-credit-whatsapp-en-attente-numero')).toHaveCount(0);
  });

  test('une API d’avant la route : la liste se dit illisible, le reste de la carte demeure (la console part au push, l’API au déploiement)', async ({ page }) => {
    await reglages(page, GRILLE, null);
    await expect(page.getByTestId('ops-credit-whatsapp-en-attente-illisible')).toBeVisible();
    await expect(page.getByTestId('ops-grille-meta-etat')).toBeVisible();
  });

  test('🔴 « Ne pas poser » : une note requise, l’attente levée par le serveur, la liste relue de sa réponse (relecture du lot E6, jaune 5)', async ({ page }) => {
    await reglages(page, GRILLE, [EN_ATTENTE]);
    const corps: unknown[] = [];
    await page.route('**/api/backend/ops/credit-whatsapp/en-attente/t-essai', async (route) => {
      corps.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ numeros: [] }) });
    });
    const bouton = page.getByTestId('ops-credit-whatsapp-en-attente-ne-pas-poser');
    // Sans note, rien ne part : la raison se dit avant le geste.
    await expect(bouton).toBeDisabled();
    await page.getByTestId('ops-credit-whatsapp-en-attente-note').fill('le partenaire n’attache pas');
    await bouton.click();
    await expect(page.getByTestId('ops-credit-whatsapp-en-attente')).toContainText('Aucun numéro n’attend sa ligne.');
    expect(corps).toEqual([{ phoneNumberId: '106540352242922', note: 'le partenaire n’attache pas' }]);
  });

  test('« Ne pas poser » refusé (le numéro n’attend plus, ou une API d’avant la route) : le message du serveur, et le numéro reste listé', async ({ page }) => {
    await reglages(page, GRILLE, [EN_ATTENTE]);
    await page.route('**/api/backend/ops/credit-whatsapp/en-attente/t-essai', (route) => route.fulfill({
      status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'ce numéro n’attend aucune ligne dans cet espace' }),
    }));
    await page.getByTestId('ops-credit-whatsapp-en-attente-note').fill('le partenaire n’attache pas');
    await page.getByTestId('ops-credit-whatsapp-en-attente-ne-pas-poser').click();
    await expect(page.getByTestId('ops-credit-whatsapp-en-attente-erreur')).toContainText('n’attend aucune ligne');
    await expect(page.getByTestId('ops-credit-whatsapp-en-attente-numero')).toHaveCount(1);
  });
});

/**
 * La vue de la ligne d'un espace Entreprise : un numéro sur la ligne, un couvert par le compte, un empêché, un libre, et
 * ce que « couvert » cachait (relecture du lot D) : une ligne couvrante arrêtée, un numéro en coexistence couvert par son
 * compte, un compte sur la ligne d'un autre espace.
 */
const VUE = {
  tenantId: 't-essai',
  lignes: [{ id: 'l1', phoneNumberId: '111', origine: 'ops', depuis: '2026-11-02T10:00:00Z', arreteeLe: null }],
  numeros: [
    { phoneNumberId: '111', numero: '+33 5 25 68 02 50', nom: 'Messaging Me Tech', couverture: 'ligne', refus: null },
    { phoneNumberId: '222', numero: '+33 5 25 68 02 51', nom: null, couverture: 'compte', refus: null },
    { phoneNumberId: '333', numero: '+44 1555 479304', nom: null, couverture: null, refus: 'coexistence' },
    { phoneNumberId: '444', numero: '+33 6 00 00 00 00', nom: 'Autre', couverture: null, refus: null },
    { phoneNumberId: '555', numero: '+33 6 00 00 00 05', nom: null, couverture: 'compte', arretee: true, refus: null },
    { phoneNumberId: '666', numero: '+33 6 00 00 00 06', nom: null, couverture: 'compte', arretee: false, refus: 'coexistence' },
    { phoneNumberId: '777', numero: '+33 6 00 00 00 07', nom: null, couverture: 'autre_espace', arretee: false, refus: null },
  ],
  soldeMicroEur: 0,
  consommationDuMoisMicroEur: 5_208_000,
  provisions: [],
};

/** Un Business, avec les places de son option (lot 4a) : une pose y consomme des places, sauf forcée. */
const BUSINESS = { entreprise: false, business: true, vue: { ...VUE, soldeMicroEur: 12_000_000, places: { payees: 1, couverts: 1 } } };

async function offre(page: import('@playwright/test').Page, espace: { entreprise: boolean; business: boolean; vue: object } = { entreprise: true, business: false, vue: VUE }) {
  const poses: unknown[] = [];
  await page.addInitScript((s) => window.localStorage.setItem('mba.sessionOps', JSON.stringify(s)), SESSION_OPS);
  await page.route('**/api/backend/**', async (route) => {
    const chemin = route.request().url().split('?')[0]!;
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/ops/overview')) return json({ tenants: [ESPACE], daily: [], queues: [], worker: null });
    if (chemin.endsWith('/ops/offre/t-essai')) {
      return json({
        tenantId: 't-essai', entreprise: espace.entreprise, utilisateurs: null, conservationJours: null, utilisateursProposes: 10,
        business: espace.business, utilisateursBusiness: null,
      });
    }
    if (chemin.endsWith('/ops/credit-whatsapp/ligne/t-essai')) {
      if (route.request().method() === 'POST') {
        poses.push(route.request().postDataJSON());
        return json({ ...espace.vue, numeros: VUE.numeros.map((n) => (n.phoneNumberId === '444' ? { ...n, couverture: 'ligne' } : n)) });
      }
      return json(espace.vue);
    }
    return json({});
  });
  await page.goto('/ops?tab=clients');
  await page.getByTestId('offre-t-essai').click();
  const modale = page.getByTestId('offre-modale');
  await expect(modale).toBeVisible();
  return { modale, poses };
}

test.describe('Ops : les numéros d’un espace sur la ligne du Crédit WhatsApp', () => {
  test('🔴 les numéros de l’espace, chacun avec son geste : plus d’identifiant Meta à taper', async ({ page }) => {
    const { modale, poses } = await offre(page);
    await expect(modale.getByTestId('ligne-credit-numero-111')).toContainText('sur la ligne');
    await expect(modale.getByTestId('ligne-credit-numero-111').getByTestId('ligne-credit-retirer')).toBeVisible();
    await expect(modale.getByTestId('ligne-credit-numero-222')).toContainText('même compte WhatsApp');
    await expect(modale.getByTestId('ligne-credit-numero-222').getByRole('button')).toHaveCount(0);
    await expect(modale.getByTestId('ligne-credit-numero-333')).toContainText('coexistence');
    await expect(modale.getByTestId('ligne-credit-numero-333').getByRole('button')).toHaveCount(0);

    // La note d'abord : le bouton le dit au lieu de rester grisé sans raison.
    const poser = modale.getByTestId('ligne-credit-numero-444').getByTestId('ligne-credit-poser');
    await expect(poser).toBeDisabled();
    await expect(modale.getByTestId('ligne-credit-note-requise')).toBeVisible();
    await modale.getByTestId('ligne-credit-note').fill('essai du calcul');
    await poser.click();
    await expect(modale.getByTestId('ligne-credit-message')).toContainText('posé sur la ligne');
    expect(poses).toEqual([{ phoneNumberId: '444', poser: true, note: 'essai du calcul' }]);
  });

  test('🔴 « couvert » ne cache plus rien : ligne arrêtée, coexistence, compte sur la ligne d’un autre espace, sans geste', async ({ page }) => {
    const { modale } = await offre(page);
    await expect(modale.getByTestId('ligne-credit-numero-555')).toContainText('envois arrêtés');
    await expect(modale.getByTestId('ligne-credit-numero-666').getByTestId('ligne-credit-alerte')).toContainText('coexistence');
    await expect(modale.getByTestId('ligne-credit-numero-777')).toContainText('ligne d’un autre espace');
    for (const pn of ['555', '666', '777']) await expect(modale.getByTestId(`ligne-credit-numero-${pn}`).getByRole('button')).toHaveCount(0);
    // Un numéro couvert sans rien qui l'empêche n'a pas d'alerte.
    await expect(modale.getByTestId('ligne-credit-numero-222').getByTestId('ligne-credit-alerte')).toHaveCount(0);
  });

  test('🔴 une Entreprise est dite illimitée, avec son montant du mois, jamais « Solde : 0 »', async ({ page }) => {
    const { modale } = await offre(page);
    await expect(modale.getByTestId('ligne-credit-illimite-mois')).toContainText(/Illimité \(Entreprise\) : 5,21\s€ HT/);
    await expect(modale.getByTestId('ligne-credit-solde')).toHaveCount(0);
  });

  test('🔴 hors Entreprise, les places de l’option se lisent, et seule une pose COCHÉE « forcer » part forcée', async ({ page }) => {
    const { modale, poses } = await offre(page, BUSINESS);
    await expect(modale.getByTestId('ligne-credit-places')).toContainText('1 payée, 1 numéro couvert');
    await modale.getByTestId('ligne-credit-note').fill('essai sans place');
    const poser = modale.getByTestId('ligne-credit-numero-444').getByTestId('ligne-credit-poser');
    // Une pose ordinaire garde le corps d'avant l'option : le serveur juge les places.
    await poser.click();
    await expect(modale.getByTestId('ligne-credit-message')).toContainText('posé sur la ligne');
    expect(poses).toEqual([{ phoneNumberId: '444', poser: true, note: 'essai sans place' }]);
  });

  test('🔴 une pose forcée part avec `forcer`, et la case se décoche après le geste', async ({ page }) => {
    const { modale, poses } = await offre(page, BUSINESS);
    await modale.getByTestId('ligne-credit-note').fill('essai forcé');
    await modale.getByTestId('ligne-credit-forcer').check();
    await modale.getByTestId('ligne-credit-numero-444').getByTestId('ligne-credit-poser').click();
    await expect(modale.getByTestId('ligne-credit-message')).toContainText('posé sur la ligne');
    expect(poses).toEqual([{ phoneNumberId: '444', poser: true, note: 'essai forcé', forcer: true }]);
    await expect(modale.getByTestId('ligne-credit-forcer')).not.toBeChecked();
  });

  test('une Entreprise ne compte pas de places : ni le compte des places, ni la case', async ({ page }) => {
    const { modale } = await offre(page, { entreprise: true, business: false, vue: { ...VUE, places: { payees: 0, couverts: 0 } } });
    await expect(modale.getByTestId('ligne-credit-illimite-mois')).toBeVisible();
    await expect(modale.getByTestId('ligne-credit-places')).toHaveCount(0);
    await expect(modale.getByTestId('ligne-credit-forcer')).toHaveCount(0);
  });

  test('🔴 « Enregistrer » grisé dit pourquoi, et la raison disparaît avec la note', async ({ page }) => {
    const { modale } = await offre(page);
    await expect(modale.getByTestId('offre-enregistrer')).toBeDisabled();
    await expect(modale.getByTestId('offre-bloquants')).toContainText('écrivez la note');
    await modale.getByTestId('offre-note').fill('Devis signé le 2 novembre');
    await expect(modale.getByTestId('offre-bloquants')).toHaveCount(0);
    await expect(modale.getByTestId('offre-enregistrer')).toBeEnabled();
  });
});
