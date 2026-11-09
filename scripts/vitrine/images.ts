// scripts/vitrine/images.ts
// Les images et les films de la vitrine vus par ses générateurs : leur adresse versionnée et les dimensions d'un WebP,
// pour qu'une page les cite sans rien écrire à la main (le centre d'aide, `aide.ts` ; le tunnel « Démarrer », `tunnel.ts`).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = (p: string) => fileURLToPath(new URL(`../../site/${p}`, import.meta.url));

/**
 * Une adresse de la vitrine suivie de l'empreinte de son fichier (`?v=`) : les images et les films restent un jour en
 * cache chez le visiteur (`site/vercel.json`), et une capture refaite garde son nom. L'empreinte change avec le fichier,
 * sans `?v=` à incrémenter à la main ; un fichier pas encore livré garde `?v=1`.
 */
export const versionnee = (adresse: string): string => {
  const fichier = SITE(adresse.slice(1));
  return `${adresse}?v=${existsSync(fichier) ? createHash('sha256').update(readFileSync(fichier)).digest('hex').slice(0, 8) : '1'}`;
};

/**
 * La largeur et la hauteur d'un WebP de la vitrine, lues dans son en-tête (blocs `VP8 `, `VP8L` ou `VP8X`) : une image
 * qui les porte ne fait pas sauter la page à son chargement, et une capture refaite les donne d'elle-même.
 */
export function dimensionsWebp(adresse: string): { largeur: number; hauteur: number } {
  const o = readFileSync(SITE(adresse.slice(1)));
  if (o.toString('ascii', 0, 4) !== 'RIFF' || o.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`${adresse} : pas un WebP`);
  const bloc = o.toString('ascii', 12, 16);
  if (bloc === 'VP8 ') return { largeur: o.readUInt16LE(26) & 0x3fff, hauteur: o.readUInt16LE(28) & 0x3fff };
  if (bloc === 'VP8L') {
    const b = o.readUInt32LE(21);
    return { largeur: 1 + (b & 0x3fff), hauteur: 1 + ((b >>> 14) & 0x3fff) };
  }
  if (bloc === 'VP8X') return { largeur: 1 + o.readUIntLE(24, 3), hauteur: 1 + o.readUIntLE(27, 3) };
  throw new Error(`${adresse} : en-tête WebP inconnu (${bloc})`);
}
