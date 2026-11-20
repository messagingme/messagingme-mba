import { test, expect } from '../aide/test';
import { NAVIGATEUR, capturer, communs, langue, type Locale } from './donnees-demo';

/**
 * « Envoyer les événements à votre outil » : l'adresse de réception d'un outil (ici Make) collée, les événements, le
 * secret montré une seule fois, l'essai et le journal. Les états sont ceux de `web/e2e/webhooks-sortants.spec.ts` ;
 * rien n'est appelé, le secret est inventé.
 */
const CLE = 'envoyer-les-evenements-a-votre-outil';
const URL_OUTIL = 'https://hook.eu1.make.com/abc123exemple';
const TYPES = ['message.received', 'message.delivered', 'message.read', 'message.failed', 'link.clicked', 'contact.opted_out',
  'conversation.analyzed', 'contact.risk_changed', 'template.status_changed', 'agent.action'];
const PAR_DEFAUT = TYPES.filter((t) => !['message.delivered', 'message.read', 'message.failed', 'agent.action'].includes(t));
const SECRET = 'whsec_demoInventePourLaCaptureXXXXXXXXXX';

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale})`, async ({ page }) => {
      const adresses: Array<Record<string, unknown>> = [];
      await langue(page, locale);
      await page.route('**/api/backend/**', async (route) => {
        const req = route.request();
        const chemin = new URL(req.url()).pathname;
        const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
        if (req.method() === 'GET' && chemin.endsWith('/evenements/adresses')) {
          return json({ adresses, limite: 5, types: TYPES, typesParDefaut: PAR_DEFAUT, chiffrementPret: true });
        }
        if (req.method() === 'POST' && chemin.endsWith('/evenements/adresses')) {
          const c = req.postDataJSON() as { url: string; types: string[] };
          const adresse = {
            id: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f', url: c.url, description: 'Make', types: c.types, active: true,
            creeLe: '2026-11-20T10:00:00.000Z', ancienSecretJusqua: null, derniereLivraisonLe: null, enReessai: 0, echecs: 0,
          };
          adresses.push(adresse);
          return json({ adresse, secret: SECRET }, 201);
        }
        if (req.method() === 'POST' && chemin.endsWith('/essai')) return json({ evenementId: 'evt_1', livre: true, code: 200, reponse: 'Accepted' });
        if (req.method() === 'GET' && chemin.endsWith('/envois')) {
          return json({ envois: [
            { id: 'e2', evenementId: 'evt_2', type: 'message.received', statut: 'livre', tentatives: 1, dernierCode: 200, derniereReponse: 'Accepted',
              prochainEssaiLe: null, creeLe: '2026-11-20T10:04:00.000Z', livreLe: '2026-11-20T10:04:00.000Z', corps: '{"id":"evt_2","type":"message.received"}' },
            { id: 'e1', evenementId: 'evt_1', type: 'test', statut: 'livre', tentatives: 1, dernierCode: 200, derniereReponse: 'Accepted',
              prochainEssaiLe: null, creeLe: '2026-11-20T10:01:00.000Z', livreLe: '2026-11-20T10:01:00.000Z', corps: '{"id":"evt_1","type":"test"}' },
          ] });
        }
        return json({});
      });
      await communs(page);

      // 1. L'adresse de Make collée, les événements cochés par défaut, juste avant « Créer l'adresse ».
      await page.goto('/developers/evenements');
      await page.getByTestId('evt-url').fill(URL_OUTIL);
      await capturer(page, CLE, 1, locale, undefined, 'haut', page.getByTestId('evt-creer'));

      // 2. Le secret, montré une seule fois.
      await page.getByTestId('evt-creer').click();
      await expect(page.getByTestId('evt-secret')).toBeVisible();
      await capturer(page, CLE, 2, locale, page.getByTestId('evt-secret'), 'haut', page.getByRole('button', { name: /J’ai copié le secret|I copied the secret/ }));

      // 3. L'essai envoyé, et ce que l'outil a répondu.
      await page.getByRole('button', { name: /J’ai copié le secret|I copied the secret/ }).click();
      await page.getByTestId('evt-essai').click();
      await expect(page.getByTestId('evt-essai-issue')).toBeVisible();
      await capturer(page, CLE, 3, locale, page.getByTestId('evt-adresse'), 'haut', page.getByTestId('evt-essai'));

      // 4. Le journal : chaque envoi, son statut et ses tentatives.
      await page.getByTestId('evt-journal').click();
      await expect(page.getByTestId('evt-envoi').first()).toBeVisible();
      await capturer(page, CLE, 4, locale, page.getByTestId('evt-adresse'), 'haut', page.getByTestId('evt-envoi').first());
    });
  });
}
