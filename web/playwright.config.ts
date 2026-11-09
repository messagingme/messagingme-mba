import { defineConfig, devices } from '@playwright/test';

/**
 * E2E du front mba. Les appels `/api/backend/*` sont INTERCEPTÉS par page.route dans chaque spec (aucun backend
 * ni base requis) : le webServer ne sert que le Next buildé. BACKEND_URL n'est jamais atteint (fallback build).
 *
 * 🔴 DEUX TOPOLOGIES, celles qui sont livrées. Par défaut, celle du VPS : la console appelle `/api/backend` sur sa
 * propre origine. Avec `E2E_TOPOLOGIE=vercel`, celle de `console.messagingme.app` : la console est construite avec une
 * adresse d'API ABSOLUE sur une AUTRE origine que la page (`127.0.0.1` n'est pas `localhost`), comme Vercel appelle
 * `api.messagingme.app`. Le chemin garde son `/api/backend`, donc les interceptions `**\/api/backend/**` des specs la
 * couvrent telles quelles ; ce qui change est l'origine, que la CSP doit autoriser (`e2e/aide/test.ts`).
 * ⚠️ Playwright ne vérifie pas le CORS d'une réponse interceptée (mesuré) : il reste à la charge de `CORS_ORIGINS`.
 */
const API_VERCEL = 'http://127.0.0.1:3000/api/backend';
const topologie = process.env.E2E_TOPOLOGIE ?? 'proxy';
// Une valeur inconnue (casse, faute de frappe) ferait tourner la topologie proxy sous le nom de l'autre, vert et muet.
if (topologie !== 'proxy' && topologie !== 'vercel') {
  throw new Error(`E2E_TOPOLOGIE vaut « ${topologie} » : seules « proxy » et « vercel » existent.`);
}
const vercel = topologie === 'vercel';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // Plafonné à 4 : le serveur Next est PARTAGÉ par tous les workers, et au-delà certains specs voyaient leur
  // requête de liste arriver après le rendu (échecs intermittents sur des assertions pourtant justes, vérifié
  // en repassant la suite à 1 worker : 54/54). On borne plutôt que de tolérer un gate qui ment.
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  // 🔴 Un navigateur FRANÇAIS par défaut (aide à la connexion, lot 2) : depuis que la console prend la langue du
  // navigateur, celle du système (l'anglais sur le Linux de la CI, le français sur un poste Windows français) ferait
  // basculer toute la suite d'une langue à l'autre selon la machine. Un spec qui veut un autre navigateur le dit
  // (`test.use({ locale })`, `e2e/langue-navigateur.spec.ts`).
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry', locale: 'fr-FR' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `next start` émet un warning avec `output: standalone`, mais sert correctement les pages client-rendues
    // (accueil est 'use client') : l'E2E passe. On teste ainsi le build de PROD, pas le dev.
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_TELEMETRY_DISABLED: '1', BACKEND_URL: 'http://127.0.0.1:9', NODE_ENV: 'production',
      ...(vercel ? { NEXT_PUBLIC_API_URL: API_VERCEL } : {}),
    },
  },
});
