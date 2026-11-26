import { test, expect, type Page } from './aide/test';

/**
 * LA DERNIÈRE COMMANDE FACE À LA DERNIÈRE ANALYSE (segments Shopify enrichis, lot 7b), dans la section « Dernière
 * analyse » des filtres de contacts : un critère de segment (`segment_commande_vs_analyse`), offert quand l'API
 * l'annonce (`analyseCommandes` : la fonction `analyse` ET une boutique).
 *
 * 🔴 CE QUE CES CAS PROTÈGENT. Le choix PART au serveur sous sa clé réservée (un choix affiché qui ne partirait pas
 * viserait tout l'espace), « peu importe » le RETIRE, et il n'est pas offert sans l'annonce (une offre sans l'analyse,
 * ou une API plus ancienne, qui refuserait la clé).
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const CHAMPS_FICHE = {
  champs: [
    { cle: 'analyse_sentiment', libelle: ['sentiment de la dernière analyse', 'latest analysis sentiment'], provenance: 'analyse', type: { nature: 'choix', valeurs: ['positif', 'neutre', 'negatif'] }, operateurs: ['in', 'empty', 'not_empty'] },
  ],
};
const AVEC_BOUTIQUE = { boutique: { devise: 'EUR', commandesDepuis: '2026-11-03T10:00:00.000Z', coupeeLe: null }, activiteCompleteDepuis: '2026-11-03', analyseCommandes: true };
const SANS_BOUTIQUE = { boutique: null, activiteCompleteDepuis: '2026-11-03' };
const CONTACTS = [
  { id: 'c1', phoneE164: '+33600000001', bsuid: null, profileName: 'Anna', optInStatus: 'opted_in', fields: {}, tags: [], createdAt: '2026-01-01T00:00:00Z' },
];

/** La valeur du critère dans une requête de la liste (son paramètre `fields`), ou `undefined`. */
function rapportDe(url: string): string | undefined {
  const brut = new URL(url).searchParams.get('fields');
  const champs = brut ? (JSON.parse(brut) as Array<{ key: string; op: string; value: string }>) : [];
  return champs.find((c) => c.key === 'segment_commande_vs_analyse' && c.op === 'segment')?.value;
}

async function mock(page: Page, o: { segments: unknown; champsFiche?: 'ok' | 404; requetes?: string[] }): Promise<void> {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const url = route.request().url();
    const chemin = new URL(url).pathname.replace('/api/backend', '');
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/champs-fiche')) return o.champsFiche === 404 ? json({ error: 'not found' }, 404) : json(CHAMPS_FICHE);
    if (chemin.endsWith('/contacts/segments')) return json(o.segments);
    if (chemin.endsWith('/contacts/count')) { o.requetes?.push(url); return json({ total: CONTACTS.length }); }
    if (chemin.endsWith('/contacts')) { o.requetes?.push(url); return json({ contacts: CONTACTS, total: CONTACTS.length }); }
    if (chemin.endsWith('/conversations/todo-count')) return json({ count: 0 });
    if (chemin.endsWith('/user-fields')) return json({ fields: [] });
    if (chemin.endsWith('/tags')) return json({ tags: [] });
    if (chemin.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
}

async function ouvrir(page: Page): Promise<void> {
  await page.goto('/contacts');
  await page.getByTestId('contacts-toggle-filters').click();
}

test.describe('Contacts : la dernière commande face à la dernière analyse (lot 7b)', () => {
  test('🔴 le choix part au serveur sous sa clé, et « peu importe » le retire', async ({ page }) => {
    const requetes: string[] = [];
    await mock(page, { segments: AVEC_BOUTIQUE, requetes });
    await ouvrir(page);
    const choix = page.getByTestId('filtres-analyse').getByTestId('filtre-commande-analyse');
    await expect(choix).toBeVisible();
    await choix.selectOption('analyse_apres_commande');
    await expect.poll(() => requetes.some((u) => rapportDe(u) === '"analyse_apres_commande"')).toBe(true);
    await choix.selectOption('aucune_apres');
    await expect.poll(() => rapportDe(requetes[requetes.length - 1]!)).toBe('"aucune_apres"');
    await choix.selectOption('');
    await expect.poll(() => rapportDe(requetes[requetes.length - 1]!)).toBeUndefined();
  });

  test('🔴 sans boutique, il n’est pas offert ; les filtres d’analyse restent', async ({ page }) => {
    await mock(page, { segments: SANS_BOUTIQUE });
    await ouvrir(page);
    await expect(page.getByTestId('ajouter-filtre-analyse')).toBeVisible();
    await expect(page.getByTestId('filtre-commande-analyse')).toHaveCount(0);
  });

  test('🔴 sans l’annonce (une offre sans l’analyse, ou une API plus ancienne), il n’est pas offert ; les filtres d’analyse restent', async ({ page }) => {
    const { analyseCommandes: _absente, ...sansAnnonce } = AVEC_BOUTIQUE;
    await mock(page, { segments: sansAnnonce });
    await ouvrir(page);
    await expect(page.getByTestId('ajouter-filtre-analyse')).toBeVisible();
    await expect(page.getByTestId('filtre-commande-analyse')).toHaveCount(0);
  });
});
