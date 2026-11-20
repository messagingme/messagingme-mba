import { test, expect } from '../aide/test';
import { CHAMPS_DEMO, NAVIGATEUR, capturer, communs, langue, type Locale } from './donnees-demo';

/**
 * « Recevoir des données par webhook » : le webhook créé, son adresse, le contenu reçu d'un formulaire, les valeurs
 * attachées, le contact et le scénario. Les états sont ceux de `web/e2e/webhooks.spec.ts` ; rien n'est appelé, aucun
 * secret réel.
 */
const CLE = 'recevoir-des-donnees-par-webhook';
const CODE = 'ab12cd34ef56gh78jk90mn12pq';
const L = {
  fr: {
    nom: 'Formulaire du site', scenario: 'Merci pour votre demande',
    payload: { formulaire: 'Demande de devis', client: { telephone: '+33612345678', nom: 'Léa Martin' }, projet: 'Cuisine', envoye_le: '2026-11-20T10:30:00Z' },
  },
  en: {
    nom: 'Website form', scenario: 'Thanks for your request',
    payload: { form: 'Quote request', customer: { phone: '+447700900123', name: 'Lea Martin' }, project: 'Kitchen', sent_at: '2026-11-20T10:30:00Z' },
  },
} as const;

const hook = (l: (typeof L)[Locale], recu: boolean) => ({
  id: 'wh1', name: l.nom, enabled: true, code: CODE, url: `https://api.messagingme.app/w/${CODE}`,
  hasSecret: false, mapping: [], createContact: true, workflowId: null, startNodeId: null, cooldownSeconds: null, optIn: true,
  lastPayload: recu ? l.payload : null, lastReceivedAt: recu ? '2026-11-20T10:30:02.000Z' : null, contactsCreated: recu ? 1 : 0,
  createdAt: '2026-11-20T10:00:00.000Z',
});

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      let hooks: unknown[] = [];
      await langue(page, locale);
      await page.route('**/api/backend/**', async (route) => {
        const req = route.request();
        const url = req.url();
        const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (url.includes('/webhooks')) {
          if (req.method() !== 'GET') return json({ id: 'wh1', code: CODE, url: `https://api.messagingme.app/w/${CODE}` });
          return json({ webhooks: hooks });
        }
        if (url.includes('/user-fields')) return json({ fields: CHAMPS_DEMO });
        if (url.endsWith('/workflows')) return json({ workflows: [{ id: 'wf1', name: l.scenario }] });
        return json({});
      });
      await communs(page);

      // 1. Un nom, juste avant « Créer ». Rien n'est créé.
      await page.goto('/webhooks');
      await page.getByTestId('webhook-nom').fill(l.nom);
      await capturer(page, CLE, 1, locale, undefined, 'haut', page.getByRole('button', { name: /^Créer$|^Create$/ }));

      // 2. Le webhook ouvert, encore sans appel : l'adresse à copier.
      hooks = [hook(l, false)];
      await page.goto('/webhooks');
      await page.getByRole('button', { name: l.nom }).click();
      await expect(page.getByTestId('attente-premier-appel')).toBeVisible();
      await capturer(page, CLE, 2, locale, page.getByTestId('webhook-url'), 'haut', page.getByTestId('webhook-url'));

      // 3. L'essai arrivé : le contenu reçu, en arbre.
      hooks = [hook(l, true)];
      await page.goto('/webhooks');
      await page.getByRole('button', { name: l.nom }).click();
      const arbre = page.getByTestId('arbre-json');
      await expect(arbre).toBeVisible();
      await capturer(page, CLE, 3, locale, arbre, 'haut', arbre);

      // 4. Le téléphone et le nom attachés : où va chaque valeur.
      const cles = locale === 'fr' ? ['telephone', 'nom'] : ['phone', 'name'];
      for (const c of cles) await arbre.locator(`[data-cle="${c}"]`).getByRole('button', { name: /Attacher|Attach/ }).click();
      await expect(page.getByTestId('liste-mapping')).toBeVisible();
      await capturer(page, CLE, 4, locale, arbre, 'haut', page.getByTestId('cible-0'));

      // 5. Le contact : créer les inconnus, et leur consentement.
      await capturer(page, CLE, 5, locale, page.getByTestId('webhook-optin'), 'haut', page.getByTestId('webhook-optin'));

      // 6. Un scénario choisi, juste avant « Enregistrer ». Rien n'est enregistré.
      await page.getByTestId('select-scenario').selectOption('wf1');
      await capturer(page, CLE, 6, locale, page.getByTestId('select-scenario'), 'bas', page.getByTestId('enregistrer-webhook'));
    });
  });
}
