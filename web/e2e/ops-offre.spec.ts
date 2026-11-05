import { test, expect } from './aide/test';

/**
 * L'offre Entreprise d'un espace, posée depuis `/ops` (demande de Julien du 2026-10-13 ; route du lot 6,
 * `GET` et `PUT /ops/offre/:tenantId`, tenue côté serveur par `tests/ops-offre.test.ts`).
 *
 * Ce que ces tests protègent à l'écran : l'état actuel lu avant tout geste, la note obligatoire, la limite
 * d'utilisateurs (ou sans limite), le retour en Base, et 🔴 la conservation JAMAIS envoyée sans qu'on coche « la
 * changer », avec l'avertissement rouge d'un raccourcissement, parce qu'il purge des conversations sans retour.
 */
const SESSION_OPS = { token: 'session-ops-e2e', email: 'exploitant@e2e.test' };
const ESPACE = {
  id: 't-essai', name: 'Essai Dupont', createdAt: '2026-10-01T00:00:00Z', mbaEnabled: false,
  users: 1, contacts: 0, messages: 0, templatesUsed: 0, lastSendAt: null, phone: null, phoneStatus: null, quality: null,
};

async function ouvrir(page: import('@playwright/test').Page, offre: Record<string, unknown>) {
  const ecrits: unknown[] = [];
  await page.addInitScript((s) => window.localStorage.setItem('mba.sessionOps', JSON.stringify(s)), SESSION_OPS);
  await page.route('**/api/backend/**', async (route) => {
    const chemin = route.request().url().split('?')[0]!;
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/ops/overview')) return json({ tenants: [ESPACE], daily: [], queues: [], worker: null });
    if (chemin.endsWith('/ops/offre/t-essai')) {
      if (route.request().method() === 'PUT') {
        const corps = route.request().postDataJSON() as Record<string, unknown>;
        ecrits.push(corps);
        // Le Business (spec Business) : absent du corps = inchangé ; les gestes du PUT viennent de l'état donné au test.
        const business = 'business' in corps ? corps.business : offre.business;
        return json({
          tenantId: 't-essai', entreprise: corps.entreprise, utilisateurs: corps.utilisateurs,
          conservationJours: 'conservationJours' in corps ? corps.conservationJours : offre.conservationJours, utilisateursProposes: 10,
          business, utilisateursBusiness: 'utilisateursBusiness' in corps ? corps.utilisateursBusiness : (offre.utilisateursBusiness ?? null),
          businessEssaiFinLe: 'businessEssaiFinLe' in corps ? corps.businessEssaiFinLe : (offre.businessEssaiFinLe ?? null),
          alertes: offre.alertes, ...(offre.gestes ? { gestes: offre.gestes } : {}),
        });
      }
      return json({ tenantId: 't-essai', utilisateursProposes: 10, ...offre });
    }
    return json({});
  });
  await page.goto('/ops?tab=clients');
  await page.getByTestId('offre-t-essai').click();
  const modale = page.getByTestId('offre-modale');
  await expect(modale).toBeVisible();
  return { modale, ecrits };
}

test.describe('Ops : l’offre Entreprise d’un espace', () => {
  test('🔴 passer un espace en Entreprise : 10 proposés, note obligatoire, conservation NON envoyée', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, { entreprise: false, utilisateurs: null, conservationJours: 90 });
    await expect(modale.getByTestId('offre-actuelle')).toContainText(/hors Entreprise|not on Enterprise/);
    await modale.getByTestId('offre-entreprise').check();
    await expect(modale.getByTestId('offre-utilisateurs')).toHaveValue('10');
    // Sans note, rien ne part.
    await expect(modale.getByTestId('offre-enregistrer')).toBeDisabled();
    await modale.getByTestId('offre-note').fill('Devis signé le 13/10');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toContainText(/Entreprise|Enterprise/);
    expect(ecrits).toEqual([{ entreprise: true, utilisateurs: 10, note: 'Devis signé le 13/10' }]);
    await expect(modale.getByTestId('offre-actuelle')).toContainText(/10 utilisateurs au plus|10 users at most/);
  });

  test('🔴 les contacts et la commission du devis (spec offres v2) ne partent que si on coche « Régler »', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, { entreprise: true, utilisateurs: 10, conservationJours: null, contacts: null, commissionPct: null });
    await modale.getByTestId('offre-changer-devis').check();
    await modale.getByTestId('offre-commission').fill('7.5');
    // Une commission décimale rendrait la vue illisible : rien ne part.
    await modale.getByTestId('offre-note').fill('Devis signé');
    await expect(modale.getByTestId('offre-enregistrer')).toBeDisabled();
    await modale.getByTestId('offre-contacts').fill('20000');
    await modale.getByTestId('offre-commission').fill('7');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toBeVisible();
    expect(ecrits).toEqual([{ entreprise: true, utilisateurs: 10, contacts: 20000, commissionPct: 7, note: 'Devis signé' }]);
  });

  test('🔴 la commission des messages de l’Entreprise ne part que si elle change, et aucune case d’open bar (illimité d’office)', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, {
      entreprise: true, utilisateurs: 10, conservationJours: null, contacts: null, commissionPct: null, commissionMessagesPct: null,
    });
    await modale.getByTestId('offre-changer-devis').check();
    // Toute Entreprise est illimitée (décision du 2026-11-02) : plus rien à cocher.
    await expect(modale.getByTestId('offre-open-bar')).toHaveCount(0);
    await modale.getByTestId('offre-commission-messages').fill('2.5');
    await modale.getByTestId('offre-note').fill('Devis signé, messages facturés après');
    await expect(modale.getByTestId('offre-enregistrer')).toBeDisabled();
    await modale.getByTestId('offre-commission-messages').fill('3');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toBeVisible();
    expect(ecrits).toEqual([{
      entreprise: true, utilisateurs: 10, contacts: null, commissionPct: null, commissionMessagesPct: 3,
      note: 'Devis signé, messages facturés après',
    }]);
  });

  test('🔴 le plafond de sécurité de l’IA (Entreprise illimitée) : lu, ne part que s’il change, et une saisie invalide ne part pas', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, {
      entreprise: true, utilisateurs: 10, conservationJours: null, contacts: null, commissionPct: null, plafondIaMoisEuros: 150,
    });
    await modale.getByTestId('offre-changer-devis').check();
    await expect(modale.getByTestId('offre-plafond-ia')).toHaveValue('150');
    await modale.getByTestId('offre-note').fill('Client prévenu, plafond relevé');
    await modale.getByTestId('offre-plafond-ia').fill('0');
    await expect(modale.getByTestId('offre-enregistrer')).toBeDisabled();
    await modale.getByTestId('offre-plafond-ia').fill('400');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toBeVisible();
    expect(ecrits).toEqual([{
      entreprise: true, utilisateurs: 10, contacts: null, commissionPct: null, plafondIaMoisEuros: 400,
      note: 'Client prévenu, plafond relevé',
    }]);
  });

  // Inchangé, il ne part pas : le cas de la commission des messages, plus haut, coche « Régler » sans y toucher.
  test('vidé, le plafond de l’IA revient au défaut de l’instance (`null` part)', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, {
      entreprise: true, utilisateurs: 10, conservationJours: null, contacts: null, commissionPct: null, plafondIaMoisEuros: 150,
    });
    await modale.getByTestId('offre-changer-devis').check();
    await modale.getByTestId('offre-plafond-ia').fill('');
    await modale.getByTestId('offre-note').fill('Retour au plafond par défaut');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toBeVisible();
    expect(ecrits).toEqual([{
      entreprise: true, utilisateurs: 10, contacts: null, commissionPct: null, plafondIaMoisEuros: null,
      note: 'Retour au plafond par défaut',
    }]);
  });

  test('🔴 retirer l’Entreprise d’un espace dont un numéro est sur la ligne sans crédit : l’écran prévient avant l’enregistrement', async ({ page }) => {
    const { modale } = await ouvrir(page, {
      entreprise: true, utilisateurs: 10, conservationJours: null,
      alertes: { proPayeVivant: false, numeroSeulVivant: false, numeroFourniSansCouverture: false, ligneCreditWhatsappSansCredit: true },
    });
    await expect(modale.getByTestId('offre-alerte-credit-wa')).toHaveCount(0);
    await modale.getByTestId('offre-entreprise').uncheck();
    // Retombé en Free (aucun Pro payé), l'achat lui est fermé : l'écran ne le promet pas, il dit de retirer le numéro.
    await expect(modale.getByTestId('offre-alerte-credit-wa')).toContainText(/En Free, le Crédit WhatsApp ne s’achète pas : retirez d’abord le numéro de la ligne/);
    // Vers le Business : il prépaie, comme le Pro, et l'achat lui est ouvert.
    await modale.getByTestId('offre-business').check();
    await expect(modale.getByTestId('offre-alerte-credit-wa')).toContainText(/avant un achat de Crédit WhatsApp/);
  });

  test('🔴 retirer le Business d’un espace qui a l’option du Crédit WhatsApp sans Pro : l’écran annonce sa résiliation', async ({ page }) => {
    const { modale } = await ouvrir(page, {
      entreprise: false, utilisateurs: null, conservationJours: 90, business: true, utilisateursBusiness: null,
      alertes: { proPayeVivant: false, numeroSeulVivant: false, numeroFourniSansCouverture: false, optionCreditWhatsappSansDroit: true },
    });
    await expect(modale.getByTestId('offre-alerte-option-wa')).toHaveCount(0);
    await modale.getByTestId('offre-business').uncheck();
    await expect(modale.getByTestId('offre-alerte-option-wa')).toContainText(/résiliée chez Stripe/);
    // Passer en Entreprise garde le droit à l'option : plus d'annonce.
    await modale.getByTestId('offre-entreprise').check();
    await expect(modale.getByTestId('offre-alerte-option-wa')).toHaveCount(0);
  });

  test('🔴 passer en Entreprise un espace qui a l’option du Crédit WhatsApp : l’écran dit qu’elle reste facturée', async ({ page }) => {
    const { modale } = await ouvrir(page, {
      entreprise: false, utilisateurs: null, conservationJours: 90, business: true, utilisateursBusiness: null,
      alertes: { proPayeVivant: false, numeroSeulVivant: false, numeroFourniSansCouverture: false, optionCreditWhatsappSansDroit: true, optionCreditWhatsappVivante: true },
    });
    await expect(modale.getByTestId('offre-alerte-option-wa-entreprise')).toHaveCount(0);
    await modale.getByTestId('offre-entreprise').check();
    await expect(modale.getByTestId('offre-alerte-option-wa-entreprise')).toContainText(/reste facturée chaque mois/);
    // L'Entreprise garde le droit à l'option : rien n'annonce sa résiliation automatique.
    await expect(modale.getByTestId('offre-alerte-option-wa')).toHaveCount(0);
  });

  test('sans limite d’utilisateurs : `null` part', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, { entreprise: false, utilisateurs: null, conservationJours: null });
    await modale.getByTestId('offre-entreprise').check();
    await modale.getByTestId('offre-sans-limite').check();
    await modale.getByTestId('offre-note').fill('Grand compte');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toBeVisible();
    expect(ecrits).toEqual([{ entreprise: true, utilisateurs: null, note: 'Grand compte' }]);
  });

  test('ramener en Base : Entreprise décochée, la limite repart à « sans limite »', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, { entreprise: true, utilisateurs: 25, conservationJours: 0 });
    await expect(modale.getByTestId('offre-actuelle')).toContainText(/25 utilisateurs au plus|25 users at most/);
    await expect(modale.getByTestId('offre-retour-base')).toHaveCount(0);
    await modale.getByTestId('offre-entreprise').uncheck();
    // Le retour en Base gèle des membres et, après la grâce, purge : il se dit avant l'enregistrement, avec le compte.
    await expect(modale.getByTestId('offre-retour-base')).toContainText(/il en compte 1|it has 1/);
    await modale.getByTestId('offre-note').fill('Fin du contrat');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toContainText(/hors Entreprise|out of Enterprise/);
    expect(ecrits).toEqual([{ entreprise: false, utilisateurs: null, note: 'Fin du contrat' }]);
  });

  test('🔴 une conservation raccourcie s’annonce en rouge, et ne part que si on l’a cochée', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, { entreprise: true, utilisateurs: 10, conservationJours: 365 });
    await modale.getByTestId('offre-changer-conservation').check();
    await modale.getByTestId('offre-conservation').fill('30');
    await expect(modale.getByTestId('offre-purge')).toBeVisible();
    // Un allongement ne prévient pas.
    await modale.getByTestId('offre-conservation').fill('730');
    await expect(modale.getByTestId('offre-purge')).toHaveCount(0);
    await modale.getByTestId('offre-conservation').fill('30');
    await modale.getByTestId('offre-note').fill('Demande du client');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toBeVisible();
    expect(ecrits).toEqual([{ entreprise: true, utilisateurs: 10, conservationJours: 30, note: 'Demande du client' }]);
  });
});

test.describe('Ops : le Business d’un espace (spec Business)', () => {
  const ALERTES = { proPayeVivant: true, numeroSeulVivant: true, numeroFourniSansCouverture: false };

  test('🔴 poser le Business : exclusif de l’Entreprise, les alertes avant, le bilan des gestes après', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, {
      entreprise: false, utilisateurs: null, conservationJours: 90, business: false, alertes: ALERTES,
      gestes: { creditOffert: 9_000_000, finDuNumero: null, echecs: [] },
    });
    await modale.getByTestId('offre-entreprise').check();
    await modale.getByTestId('offre-business').check();
    await expect(modale.getByTestId('offre-entreprise')).not.toBeChecked();
    await expect(modale.getByTestId('offre-alerte-pro')).toBeVisible();
    await expect(modale.getByTestId('offre-alerte-numero')).toBeVisible();
    await modale.getByTestId('offre-utilisateurs-business').fill('7');
    await modale.getByTestId('offre-note').fill('Contrat Business signé');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toContainText(/Business/);
    await expect(modale.getByTestId('offre-message')).toContainText(/9[.,]00/);
    expect(ecrits).toEqual([{ entreprise: false, utilisateurs: null, business: true, utilisateursBusiness: 7, note: 'Contrat Business signé' }]);
  });

  test('🔴 poser un Business en essai (révision du 2026-11-04) : la case et sa date partent ensemble ; sans date, rien ne part', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, { entreprise: false, utilisateurs: null, conservationJours: 90, business: false, alertes: ALERTES });
    await modale.getByTestId('offre-business').check();
    await modale.getByTestId('offre-business-essai').check();
    await expect(modale.getByTestId('offre-business-essai-aide')).toContainText('l’option Crédit WhatsApp reste fermée');
    await modale.getByTestId('offre-note').fill('Business en essai de 14 jours');
    await expect(modale.getByTestId('offre-enregistrer')).toBeDisabled();
    await modale.getByTestId('offre-business-essai-fin').fill('2026-11-19');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toContainText(/Business/);
    expect(ecrits).toEqual([{
      entreprise: false, utilisateurs: null, business: true, utilisateursBusiness: null,
      businessEssaiFinLe: '2026-11-19T00:00:00.000Z', note: 'Business en essai de 14 jours',
    }]);
  });

  test('🔴 confirmer un Business en essai : la case décochée envoie la confirmation (null) ; sinon l’essai ne part pas', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, {
      entreprise: false, utilisateurs: null, conservationJours: 90, business: true, utilisateursBusiness: null,
      businessEssaiFinLe: '2026-11-19T00:00:00.000Z', alertes: ALERTES,
    });
    await expect(modale.getByTestId('offre-business-essai')).toBeChecked();
    await expect(modale.getByTestId('offre-business-essai-fin')).toHaveValue('2026-11-19');
    // Un enregistrement qui ne touche pas l'essai ne le renvoie pas (absent = inchangé côté serveur).
    await modale.getByTestId('offre-note').fill('Limite revue');
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toBeVisible();
    await modale.getByTestId('offre-business-essai').uncheck();
    await modale.getByTestId('offre-note').fill('Business confirmé');
    await modale.getByTestId('offre-enregistrer').click();
    await expect.poll(() => ecrits.length).toBe(2);
    expect(ecrits).toEqual([
      { entreprise: false, utilisateurs: null, utilisateursBusiness: null, note: 'Limite revue' },
      { entreprise: false, utilisateurs: null, utilisateursBusiness: null, businessEssaiFinLe: null, note: 'Business confirmé' },
    ]);
  });

  test('🔴 retirer un Business qui laisse le numéro fourni sans couverture : rien ne part sans la confirmation', async ({ page }) => {
    const { modale, ecrits } = await ouvrir(page, {
      entreprise: false, utilisateurs: null, conservationJours: 90, business: true, utilisateursBusiness: null,
      alertes: { proPayeVivant: false, numeroSeulVivant: false, numeroFourniSansCouverture: true },
    });
    await expect(modale.getByTestId('offre-actuelle')).toContainText(/Business/);
    await modale.getByTestId('offre-business').uncheck();
    await modale.getByTestId('offre-note').fill('Fin du contrat');
    await expect(modale.getByTestId('offre-retrait-numero')).toBeVisible();
    await expect(modale.getByTestId('offre-enregistrer')).toBeDisabled();
    await modale.getByTestId('offre-retrait-confirme').check();
    await modale.getByTestId('offre-enregistrer').click();
    await expect(modale.getByTestId('offre-message')).toBeVisible();
    expect(ecrits).toEqual([{ entreprise: false, utilisateurs: null, business: false, note: 'Fin du contrat' }]);
  });
});
