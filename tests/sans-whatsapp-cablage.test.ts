import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * LE PUITS DU 131026 EST CÂBLÉ SUR LES DEUX FILES QUI TRAITENT DES ACCUSÉS (segments Shopify enrichis, lot 2a). Il est
 * optionnel dans `handleWebhookJob` (absent : la fiche reste, le comportement d'avant), donc le compilateur ne dit rien
 * d'un oubli : un accusé passé par l'autre file laisserait une fiche morte dans la limite de contacts, sans erreur.
 * `webhook-status` porte la plupart des accusés, `webhook` ceux qui arrivent mêlés à des messages.
 */
const sansCommentaires = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const WORKER = sansCommentaires(readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8'));

/** Le texte d'un enregistrement `queue.work('<file>', ...)`, jusqu'à l'enregistrement suivant. */
function enregistrement(file: string): string {
  const debut = WORKER.indexOf(`await queue.work('${file}',`);
  expect(debut, `queue.work('${file}') introuvable`).toBeGreaterThan(-1);
  const suivant = WORKER.indexOf('await queue.work(', debut + 1);
  return WORKER.slice(debut, suivant === -1 ? undefined : suivant);
}

describe('le puits du 131026 dans le worker', () => {
  it('🔴 les deux files d’accusés passent `sansWhatsapp` à `handleWebhookJob`', () => {
    for (const file of ['webhook', 'webhook-status']) {
      const texte = enregistrement(file);
      expect(texte, file).toContain('handleWebhookJob(');
      expect(texte, `${file} : le puits n'est pas câblé`).toMatch(/\bsansWhatsapp\b/);
    }
  });

  it('le puits enfile sur la file que le worker travaille', () => {
    expect(WORKER).toMatch(/queue\.enqueue\(FILE_SANS_WHATSAPP, \{ messageId \}\)/);
    expect(WORKER).toMatch(/await queue\.work\(FILE_SANS_WHATSAPP,/);
  });
});
