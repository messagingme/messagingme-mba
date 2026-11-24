import { describe, it, expect } from 'vitest';
import { EXEMPLES_SDK } from '../web/lib/exemples-code';
import { lire, parAttribut, texte } from './vitrine-lecture';

/**
 * La page « API WhatsApp Business » (2026-11-24, plan docs/superpowers/plans/2026-11-24-guides-vitrine.md, lot 3) montre un
 * EXTRAIT de l'exemple du SDK que la CI compile (`EXEMPLES_SDK.premierAppel`, celui de la page Développeurs). Recopié à la
 * main, il dériverait sans bruit le jour où le SDK change : chaque ligne de l'extrait doit être une ligne de l'exemple.
 */
describe('la page API WhatsApp Business', () => {
  const lignesDuSdk = new Set(EXEMPLES_SDK.premierAppel.code.split('\n').map((l) => l.trimEnd()));
  for (const page of ['api-whatsapp-business/index.html', 'en/whatsapp-business-api/index.html']) {
    it(`${page} : l’extrait de code est tiré, ligne à ligne, de l’exemple du SDK compilé par la CI`, () => {
      const [extrait, ...autres] = parAttribut(lire(page), 'data-extrait');
      expect(extrait?.valeur).toBe('sdk.premierAppel');
      expect(autres).toEqual([]);
      const lignes = texte(extrait!.contenu).trim().split('\n');
      expect(lignes.length).toBeGreaterThan(3);
      for (const l of lignes) expect(lignesDuSdk.has(l.trimEnd()), l).toBe(true);
    });
  }
});
