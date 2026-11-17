import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireFicheDuDepot } from './fiches';

/**
 * Une fiche du mode d'emploi, lue telle qu'elle est dans le dépôt, pour qu'une source citée par le bot d'aide s'ouvre
 * dans la console. Le fichier, et non la table : la table en garde des MORCEAUX réécrits pour le rappel
 * (`decouperFiche`), le fichier est la fiche. Il est dans l'image (`COPY docs/aide`, `Dockerfile`).
 */
const DOSSIER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'aide', 'fiches');

/** Le nom d'un fichier de fiche. Tout le reste (`..`, `/`, `\`) est refusé avant de toucher au disque. */
const CLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * La fiche, dans la langue demandée quand sa traduction existe (seules les fiches publiques en ont une), sinon en
 * français. `null` : clé mal formée ou fiche inconnue.
 */
export async function lireFicheAide(cle: string, langue: 'fr' | 'en'): Promise<{ titre: string; corps: string } | null> {
  if (cle.length > 120 || !CLE.test(cle)) return null;
  const chemins = langue === 'en' ? [join(DOSSIER, 'en', `${cle}.md`), join(DOSSIER, `${cle}.md`)] : [join(DOSSIER, `${cle}.md`)];
  for (const chemin of chemins) {
    try {
      const f = lireFicheDuDepot(`${cle}.md`, await readFile(chemin, 'utf8'));
      return { titre: f.titre, corps: f.corps };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return null;
}
