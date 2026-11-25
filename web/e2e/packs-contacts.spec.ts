import { test, expect, type Page } from './aide/test';
import { repondre } from './aide/confirmation';

/**
 * LES PACKS DE CONTACTS DU PRO DANS LA CONSOLE (décision de Julien du 2026-11-24, lot 1). La page Offre dit les 1 000
 * contacts inclus et les packs achetés, ajoute 1 000 contacts au prix de la formule après confirmation, et en retire,
 * sans remboursement. Un prorata impayé laisse la facture à régler ; un retrait refusé dit la phrase du serveur.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };
const PRO = ['inbox', 'scenarios', 'statistiques', 'agent_meta', 'aide', 'assistants', 'email', 'console'];
const limites = (o: 'free' | 'pro', contacts: number) => ({
  utilisateurs: o === 'free' ? 1 : 3, admins: o === 'free' ? 1 : null, contacts, envoisModelesMois: o === 'free' ? 1000 : null,
  automations: o === 'free' ? 10 : null, suppressionsJour: o === 'free' ? 10 : null, adressesWebhook: o === 'free' ? 1 : 5,
  journalWebhooksJours: o === 'free' ? 3 : 30, conservationJours: o === 'free' ? 30 : 90, commissionPct: o === 'free' ? 50 : 20,
  badge: o === 'free', numeroInclus: o !== 'free',
});
// La grille entière : une vue sans la ligne de l'Entreprise est illisible pour la console (`lireVueOffre`), qui la lit
// alors « offre inconnue » et ne montre pas le bloc.
const GRILLE = {
  free: { fonctions: [], limites: limites('free', 100) },
  pro: { fonctions: PRO, limites: limites('pro', 1000) },
  entreprise: { fonctions: [...PRO, 'analyse', 'publicites', 'chaines', 'crm', 'rcs', 'performance_lab'], limites: { ...limites('pro', 1000), utilisateurs: null, contacts: null } },
};
const PRIX_PACK = { moisCentimes: 2000, anCentimes: 24000 };
const vuePro = (achetes: number, o: { periodicite?: 'mois' | 'an'; enVente?: boolean; contacts?: number } = {}) => ({
  offre: 'pro', fonctions: PRO, limites: limites('pro', 1000 + 1000 * achetes),
  usage: { envoisModelesMois: null, contacts: o.contacts ?? 950, automations: 1, membres: 1 }, grille: GRILLE,
  prixPro: { moisCentimes: 4900, anCentimes: 49000 }, suiteDuNumero: null, essai: { jours: 14, possible: false, finLe: null },
  sieges: { inclus: 3, achetes: 0, periodicite: o.periodicite ?? 'mois' }, prixSiege: null,
  packsContacts: { inclus: 1000, achetes, contactsParPack: 1000, periodicite: o.periodicite ?? 'mois' },
  prixPackContacts: o.enVente === false ? null : PRIX_PACK, upgradeUrl: 'https://console.e2e.test/offre',
});

type Reponse = { status: number; corps: unknown };
async function monter(page: Page, offre: unknown, o: { packs?: Reponse } = {}) {
  const packs: unknown[] = [];
  let vue = offre;
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname.replace('/api/backend', '');
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (req.method() === 'POST' && chemin === '/tenants/t-e2e/offre/packs-contacts') {
      const corps = req.postDataJSON() as { cible: number };
      packs.push(corps);
      if (o.packs) return json(o.packs.corps, o.packs.status);
      // La vue relue après le geste porte la limite neuve.
      vue = vuePro(corps.cible);
      return json({ packs: corps.cible });
    }
    if (chemin === '/tenants/t-e2e/offre') return json(vue);
    if (chemin === '/tenants/t-e2e/contacts') return json({ contacts: [], total: 0 });
    if (chemin === '/tenants/t-e2e/nom') return json({ nom: 'Espace E2E' });
    if (chemin.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Moi', role: 'admin' });
    return json({});
  });
  return { packs };
}

test.describe('🔴 les contacts de la formule Pro', () => {
  test('ajouter 1 000 contacts : le prix est dit, rien ne part avant la confirmation ; confirmé, la limite suit', async ({ page }) => {
    const { packs } = await monter(page, vuePro(0));
    await page.goto('/offre');
    const bloc = page.getByTestId('offre-packs-contacts');
    await expect(bloc).toContainText(/comprend 1\s000 contacts\./);
    await expect(bloc).toContainText('20 € HT par mois');
    await page.getByTestId('offre-ajouter-pack').click();
    await repondre(page, true, 'facturé maintenant');
    await expect(bloc).toContainText(/1 pack de 1\s000 contacts en plus : 2\s000 contacts en tout/);
    expect(packs).toEqual([{ depuis: 0, cible: 1 }]);
  });

  test('un ajout annulé dans la fenêtre : rien ne part', async ({ page }) => {
    const { packs } = await monter(page, vuePro(0));
    await page.goto('/offre');
    await page.getByTestId('offre-ajouter-pack').click();
    await repondre(page, false);
    expect(packs).toEqual([]);
  });

  test('🔴 un prorata impayé : la phrase du serveur et la facture à régler, la limite ne bouge pas', async ({ page }) => {
    await monter(page, vuePro(0), { packs: { status: 402, corps: {
      error: 'Le paiement des contacts en plus n’a pas abouti : réglez la facture sur sa page, la limite suivra.',
      code: 'paiement_pack_contacts_incomplet', url: 'https://invoice.stripe.com/i/prorata',
    } } });
    await page.goto('/offre');
    await page.getByTestId('offre-ajouter-pack').click();
    await repondre(page, true);
    await expect(page.getByTestId('offre-packs-erreur')).toContainText('n’a pas abouti');
    await expect(page.getByTestId('offre-packs-facture')).toHaveAttribute('href', 'https://invoice.stripe.com/i/prorata');
    await expect(page.getByTestId('offre-packs-contacts')).toContainText(/comprend 1\s000 contacts\./);
  });

  test('retirer un pack : sans remboursement ; refusé, la phrase du serveur dit combien supprimer', async ({ page }) => {
    await monter(page, vuePro(1), { packs: { status: 409, corps: {
      error: 'Votre espace compte 1 500 contacts : supprimez-en d’abord 500, pour tenir dans 1 000 contacts.', code: 'contacts_en_trop',
    } } });
    await page.goto('/offre');
    await page.getByTestId('offre-retirer-pack').click();
    await repondre(page, true, 'n’est pas remboursée');
    await expect(page.getByTestId('offre-packs-erreur')).toContainText('supprimez-en d’abord 500');
  });

  test('un Pro annuel lit le prix annuel ; pas en vente : ni prix ni bouton d’ajout, sans pack rien à retirer', async ({ page }) => {
    await monter(page, vuePro(0, { periodicite: 'an' }));
    await page.goto('/offre');
    await expect(page.getByTestId('offre-packs-contacts')).toContainText('240 € HT par an');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await monter(page, vuePro(0, { enVente: false }));
    await page.goto('/offre');
    await expect(page.getByTestId('offre-packs-contacts')).toContainText('pas encore en vente');
    await expect(page.getByTestId('offre-ajouter-pack')).toHaveCount(0);
    await expect(page.getByTestId('offre-retirer-pack')).toHaveCount(0);
  });
});

test.describe('🔴 le pack proposé hors de la page Offre (2026-11-25)', () => {
  test('la page Contacts d’un Pro à 80 % : le compte, le prix, et « Ajouter 1 000 contacts » ouvre l’achat sur la page Offre', async ({ page }) => {
    const { packs } = await monter(page, vuePro(0));
    await page.goto('/contacts');
    const bandeau = page.getByTestId('contacts-bandeau-pack');
    await expect(bandeau).toContainText(/950 contacts sur 1\s000/);
    await expect(bandeau).toContainText('20 € HT par mois');
    await page.getByTestId('contacts-ajouter-pack').click();
    // La page Offre ouvre la confirmation d'elle-même, et perd le paramètre (un rechargement ne la rouvre pas).
    await repondre(page, true, 'facturé maintenant');
    await expect.poll(() => packs.length).toBe(1);
    expect(packs[0]).toEqual({ depuis: 0, cible: 1 });
    await expect(page).toHaveURL(/\/offre$/);
  });

  test('sous 80 %, hors Pro, ou packs pas en vente : aucun bandeau', async ({ page }) => {
    await monter(page, vuePro(0, { contacts: 500 }));
    await page.goto('/contacts');
    await expect(page.getByTestId('contacts-ajouter-menu')).toBeVisible();
    await expect(page.getByTestId('contacts-bandeau-pack')).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await monter(page, vuePro(0, { enVente: false }));
    await page.goto('/contacts');
    await expect(page.getByTestId('contacts-ajouter-menu')).toBeVisible();
    await expect(page.getByTestId('contacts-bandeau-pack')).toHaveCount(0);
  });

  test('l’adresse de l’e-mail (/offre?pack=ajouter) : la confirmation s’ouvre ; annulée, rien ne part', async ({ page }) => {
    const { packs } = await monter(page, vuePro(1, { periodicite: 'an' }));
    await page.goto('/offre?pack=ajouter');
    await repondre(page, false, '240 € HT par an');
    expect(packs).toEqual([]);
    await expect(page.getByTestId('offre-packs-contacts')).toContainText('1 pack');
  });
});
