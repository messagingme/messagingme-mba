import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../aide/test';
import { NAVIGATEUR, type Locale } from './donnees-demo';

/**
 * LES ÉCRANS QUI SUIVENT LA CONNEXION, pour l'étape 2 du tunnel « Démarrer » de la vitrine (Julien, 2026-11-09 : « des
 * copies d'écran des écrans suivants, faut être visuel ») : la VRAIE page `/autoriser`, ses réponses inventées comme
 * dans `e2e/autoriser.spec.ts`, en français et en anglais. 1, les portes (Google, l'adresse e-mail, le mot de passe) ;
 * 2, l'espace à autoriser ; 3, l'autorisation accordée. Chaque capture ne prend que son encadré, en résolution double ;
 * `scripts/aide/captures-webp.mjs` les range dans `site/img/demarrer/`, hors du centre d'aide.
 */
const CLE = 'demarrer-autoriser';
const DEMANDE = { client: 'Claude Code', hoteDeRetour: 'localhost', droits: ['mcp:read', 'mcp:write'], marque: 'epingle', domaine: null };
const ESPACE: Readonly<Record<Locale, string>> = { fr: 'Mon entreprise', en: 'My company' };
const RETOUR = 'http://localhost:5555/callback?code=demo&state=demo';

/**
 * Google Sign-In, simulé sous l'apparence de son bouton tel que la console le demande (contour, grand, 320 px,
 * « Continuer avec Google ») : le vrai ne se dessine pas sans un identifiant de client valable. Ses styles passent par
 * `element.style`, que la politique de sécurité de la console laisse faire, quand un attribut `style` serait refusé.
 */
const GIS = `(function () {
  var G = [
    ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
    ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
    ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
    ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'],
  ];
  window.google = { accounts: { id: {
    initialize: function (cfg) { window.__rappelGoogle = cfg.callback; },
    renderButton: function (el, opts) {
      var fr = (navigator.language || '').toLowerCase().indexOf('fr') === 0;
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-testid', 'google-demo');
      var s = b.style;
      s.display = 'flex'; s.alignItems = 'center'; s.justifyContent = 'center'; s.gap = '10px';
      s.width = ((opts && opts.width) || 320) + 'px'; s.height = '40px'; s.margin = '0 auto'; s.padding = '0 12px';
      s.border = '1px solid #dadce0'; s.borderRadius = '4px'; s.background = '#ffffff'; s.cursor = 'pointer';
      s.color = '#3c4043'; s.font = '500 14px Roboto, Arial, sans-serif'; s.letterSpacing = '0.25px';
      var NS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('viewBox', '0 0 48 48');
      G.forEach(function (p) { var e = document.createElementNS(NS, 'path'); e.setAttribute('fill', p[0]); e.setAttribute('d', p[1]); svg.appendChild(e); });
      b.appendChild(svg);
      b.appendChild(document.createTextNode(fr ? 'Continuer avec Google' : 'Continue with Google'));
      b.onclick = function () { window.__rappelGoogle({ credential: 'jeton-demo' }); };
      el.appendChild(b);
    },
  } } };
})();`;

async function monter(page: Page, locale: Locale): Promise<void> {
  await page.route('**/api/backend/**', (route) => {
    const chemin = new URL(route.request().url()).pathname.replace('/api/backend', '');
    const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin === '/auth/config') return json({ googleClientId: 'client-demo', googleEnabled: true });
    if (chemin === '/oauth/consentement/demande') return json(DEMANDE);
    if (chemin === '/oauth/consentement/google') {
      return json({ choix: 'preuve-demo', nouveau: true, espaces: [{ tenantId: 't-demo', nom: ESPACE[locale], admin: true }] });
    }
    if (chemin === '/oauth/consentement/autoriser') return json({ adresse: RETOUR });
    return json({});
  });
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ contentType: 'application/javascript', body: GIS }));
  // L'adresse de retour de Claude Code répond « 204, sans contenu » : le navigateur reste sur la page, qui garde
  // « Autorisation accordée » à l'écran.
  await page.route('http://localhost:5555/**', (route) => route.fulfill({ status: 204 }));
}

/**
 * Un encadré de la page, pris en deçà de sa bordure et de ses coins arrondis (14 px, dans ses 24 px de marge : la vitrine
 * pose son propre cadre de navigateur), depuis son haut ou, avec `depuis`, depuis 10 px au-dessus de cet élément.
 */
const RETRAIT = 14;
async function capturer(page: Page, zone: Locator, numero: number, locale: Locale, depuis?: Locator): Promise<void> {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.waitForTimeout(300);
  const b = (await zone.boundingBox())!;
  const haut = depuis ? (await depuis.boundingBox())!.y - 10 : b.y + RETRAIT;
  await page.screenshot({
    path: `e2e/captures/sortie/${CLE}/etape-${numero}${locale === 'en' ? '-en' : ''}.png`,
    fullPage: true,
    clip: { x: b.x + RETRAIT, y: haut, width: b.width - 2 * RETRAIT, height: b.y + b.height - RETRAIT - haut },
  });
}

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], viewport: { width: 560, height: 1100 }, deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      await page.addInitScript((l) => window.localStorage.setItem('mba_locale', l), locale);
      await monter(page, locale);
      await page.goto('/autoriser?demande=d-demo');

      // 1. Les portes : Google, l'adresse e-mail, le mot de passe d'un compte existant (depuis le bouton Google, sans la
      // case du partage avec Meta qui les précède).
      await expect(page.getByTestId('google-demo')).toBeVisible();
      const portes = page.getByTestId('autoriser-sans-google').locator('xpath=ancestor::div[contains(@class,"rounded-carte")][1]');
      await capturer(page, portes, 1, locale, page.getByTestId('google-demo'));

      // 2. L'espace à autoriser, ici tout juste créé.
      await page.getByTestId('google-demo').click();
      await expect(page.getByTestId('autoriser-espaces')).toBeVisible();
      await capturer(page, page.getByTestId('autoriser-espaces'), 2, locale);

      // 3. L'autorisation accordée : la page rend la main à l'assistant.
      await page.getByTestId('autoriser-espace-t-demo').click();
      await expect(page.getByTestId('autoriser-partie')).toBeVisible();
      await capturer(page, page.getByTestId('autoriser-partie'), 3, locale);
    });
  });
}
