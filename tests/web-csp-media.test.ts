import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * LA CSP DE LA CONSOLE (`web/next.config.mjs`), BLOQUANTE DEPUIS LE 2026-11-03.
 *
 * 🔴 Bloquante, une directive trop étroite coupe un écran sans erreur visible : l'aperçu d'une vidéo (le fichier choisi,
 * par une adresse locale `blob:` ; l'en-tête d'un modèle, sur le CDN de Meta) ou les appels du SDK Meta pendant la
 * connexion d'un numéro, que les e2e simulent et ne voient donc jamais. Ces cas viennent des rapports des vrais
 * navigateurs (`csp_rapports`). Le test lit la politique RÉELLEMENT servie (la fonction `headers()` de la
 * configuration), pas le texte du fichier.
 */
async function entetes(): Promise<Array<{ key: string; value: string }>> {
  const mod = (await import(pathToFileURL(join(process.cwd(), 'web', 'next.config.mjs')).href)) as {
    default: { headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>> };
  };
  return (await mod.default.headers()).flatMap((r) => r.headers);
}

async function politique(): Promise<Map<string, string[]>> {
  const csp = (await entetes()).find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
  return new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).filter((m) => m[0]).map(([nom, ...v]) => [nom ?? '', v]));
}

describe('la CSP de la console', () => {
  it('🔴 elle BLOQUE, et une seule politique est servie (pas de copie en observation qui divergerait)', async () => {
    const cles = (await entetes()).map((h) => h.key.toLowerCase());
    expect(cles.filter((k) => k === 'content-security-policy')).toHaveLength(1);
    expect(cles).not.toContain('content-security-policy-report-only');
  });

  it('🔴 `connect-src` laisse passer les appels du SDK Meta pendant la connexion d’un numéro', async () => {
    const p = await politique();
    expect(p.get('connect-src')).toEqual(expect.arrayContaining([
      'https://graph.facebook.com', 'https://www.facebook.com', 'https://connect.facebook.net', 'https://accounts.google.com',
    ]));
  });

  it('🔴 `media-src` autorise `blob:` (la vidéo choisie), le CDN de Meta (l’en-tête d’un modèle) et la même origine, rien d’autre', async () => {
    const p = await politique();
    expect(p.get('media-src')).toEqual([
      "'self'", 'blob:', 'https://lookaside.fbsbx.com', 'https://*.whatsapp.net', 'https://*.fbcdn.net',
    ]);
  });

  it('les rapports continuent d’arriver : ce qui est bloqué à tort se lit dans `csp_rapports`', async () => {
    const p = await politique();
    expect(p.get('report-uri')?.[0]).toMatch(/\/csp-rapports$/);
  });

  it('garde de la garde : la politique est bien lue (sans quoi l’absence d’une directive passerait inaperçue)', async () => {
    const p = await politique();
    expect(p.get('default-src')).toEqual(["'self'"]);
    expect(p.get('img-src')).toContain('blob:');
  });
});
