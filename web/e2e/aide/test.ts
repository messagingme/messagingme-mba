import { test as base, expect } from '@playwright/test';

export * from '@playwright/test';

/**
 * LE `test` DE TOUS LES SPECS : celui de Playwright, plus une garde qui fait échouer le test si une page a violé la
 * politique de sécurité de la console (CSP, `next.config.mjs`).
 *
 * 🔴 POURQUOI. La CSP bloque depuis le 2026-11-03 : une violation coupe ce qu'elle interdit (un appel, un script, un
 * aperçu), souvent sans erreur visible à l'écran. Pendant l'observation qui a précédé, la même garde disait ce que la
 * politique interdirait ; bloquante, elle voit un écran cassé par elle.
 *
 * Chromium écrit chaque violation dans la console de la page (« … violates the following Content Security Policy
 * directive … »), en observation comme en blocage, et Playwright la reçoit : mesuré le 2026-10-14. L'écoute se pose sur
 * le CONTEXTE, qui reçoit la console de toutes ses pages, fenêtres surgissantes comprises, dès leur premier chargement.
 *
 * ⚠️ Elle ne voit que ce que les specs dessinent : un écran qu'aucun spec n'ouvre, ou un tiers qu'ils simulent (le SDK
 * Meta, Google Sign-In), ne se juge que dans un vrai navigateur. Un spec qui importerait `test` de `@playwright/test`,
 * ou qui ouvrirait son propre contexte, y échapperait : `tests/e2e-garde-csp.test.ts` refuse les deux.
 */
export const test = base.extend<{ gardeCsp: void }>({
  gardeCsp: [async ({ context }, use) => {
    const violations = new Set<string>();
    context.on('console', (message) => {
      const texte = message.text();
      if (texte.includes('Content Security Policy')) violations.add(`${message.page()?.url() ?? '?'} : ${texte}`);
    });
    await use();
    expect([...violations], 'la page a violé la CSP de la console (next.config.mjs)').toEqual([]);
  }, { auto: true }],
});
