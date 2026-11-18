import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * 🔴 AUCUN CHOIX DE SCÉNARIO NE TRAVERSE UN RAYON (menu « Scénario », lot 1, spec
 * `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md` § 5.3).
 *
 * Le magasin filtre ses listes, et `lancer` refuse un autre rayon (`tests/workflow-store-rayon.test.ts`,
 * `tests/workflow-lancements.test.ts`). Restent deux portes que le compilateur ne voit pas :
 *   1. le SQL qui lit `workflows` HORS du magasin ;
 *   2. les lectures par identifiant (`getById`, qui ignore le rayon) qui VALIDENT un choix.
 * Chacune est ici : soit elle compare le rayon, soit elle est rangée dans une liste qui dit pourquoi elle voit tous les
 * rayons. Une entrée qui ne correspond plus à rien fait échouer le test (une liste morte ne protège plus).
 */

const RACINE = resolve(__dirname, '..');
const SRC = join(RACINE, 'src');

function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? fichiers(p) : p.endsWith('.ts') ? [p] : [];
  });
}
const SOURCES = fichiers(SRC).map((p) => ({ chemin: relative(RACINE, p).split('\\').join('/'), texte: readFileSync(p, 'utf8') }));

/** Le SQL qui lit `workflows` hors du magasin et voit tous les rayons, et pourquoi. */
const SQL_TOUS_RAYONS: Record<string, string> = {
  'src/campaign/store.pg.ts': 'le NOM du scénario d’une campagne, affiché',
  'src/crm/contact-history.pg.ts': 'le NOM du scénario dans l’historique d’un contact, affiché',
  'src/ops/erreurs-livraison.pg.ts': 'le NOM du scénario dans le journal des échecs, affiché',
  'src/ops/suppression-espace.pg.ts': 'le COMPTE des scénarios d’un espace à supprimer, tous rayons',
  'src/agent/requetes.pg.ts': 'les scénarios qui UTILISENT une requête : tout usage bloque sa suppression',
  'src/rcs/media-store.pg.ts': 'les scénarios qui UTILISENT un média : tout usage bloque sa suppression',
  'src/dossiers/store.pg.ts': 'le rangement des scénarios en dossiers, par identifiant, tous rayons',
};

/** Les lectures par identifiant qui voient tous les rayons, et pourquoi (fichier → raison). */
const GETBYID_TOUS_RAYONS: Record<string, string> = {
  'src/http/workflows.ts': 'l’éditeur, par identifiant dans l’espace ; la duplication et la publication relisent `rayon`',
  'src/worker.ts': 'la relecture du graphe d’un parcours en cours, et la cible fixée d’un outil d’agent (gardée à l’écriture par le catalogue)',
  'src/socle.ts': 'l’estimation du coût d’une campagne déjà créée, affichée',
  'src/stats/chiffrage.ts': 'le chiffrage d’une campagne déjà créée, affiché',
  'src/workflow/branche-humain.ts': 'la relecture du graphe d’un parcours en cours',
  'src/workflow/lancements.ts': 'compare le rayon par `rayonAdmis`',
  'src/workflow/wiring.ts': 'la relecture du graphe d’un parcours, et l’origine d’un saut dont on lit le rayon',
};

/** Dans `src/index.ts`, les lectures par identifiant qui voient tous les rayons, reconnues par leur ligne. */
const INDEX_TOUS_RAYONS: Record<string, string> = {
  'graphePublie: async (t, id) => (await workflowStore.getById(id, t))?.graph ?? null,':
    'la cible fixée d’un outil de l’agent de Meta, gardée à l’écriture par le catalogue des outils',
  'const w = await workflowStore.getById(id, tenant);':
    'le contexte d’un outil de l’agent de Meta : sa cible, gardée à l’écriture par le catalogue des outils',
};

const RE_SQL = /\b(from|join) workflows\b/;
const RE_GETBYID = /\b(workflowStore|scenarios|workflows|wfStore)\.getById\(/;

describe('🔴 aucun choix de scénario ne traverse un rayon', () => {
  it('le SQL qui lit `workflows` hors du magasin filtre le rayon, ou dit pourquoi il les voit tous', () => {
    const fautifs: string[] = [];
    for (const { chemin, texte } of SOURCES) {
      if (chemin === 'src/workflow/store.pg.ts' || chemin in SQL_TOUS_RAYONS) continue;
      const lignes = texte.split('\n');
      lignes.forEach((ligne, i) => {
        if (!RE_SQL.test(ligne)) return;
        // Le filtre est DANS la requête (la ligne et les trois suivantes), sous forme de comparaison : un commentaire qui
        // parle du rayon ne suffit pas.
        if (!/\brayon\s*=/.test(lignes.slice(i, i + 4).join('\n'))) fautifs.push(`${chemin}:${i + 1}`);
      });
    }
    expect(fautifs).toEqual([]);
  });

  it('chaque entrée SQL de la liste lit encore `workflows` (une liste morte ne protège rien)', () => {
    for (const chemin of Object.keys(SQL_TOUS_RAYONS)) {
      const f = SOURCES.find((s) => s.chemin === chemin);
      expect(f && RE_SQL.test(f.texte), chemin).toBe(true);
    }
  });

  it('chaque lecture par identifiant compare le rayon, ou dit pourquoi elle les voit tous', () => {
    const fautifs: string[] = [];
    for (const { chemin, texte } of SOURCES) {
      if (chemin === 'src/workflow/store.pg.ts' || chemin in GETBYID_TOUS_RAYONS) continue;
      const lignes = texte.split('\n');
      lignes.forEach((ligne, i) => {
        if (!RE_GETBYID.test(ligne)) return;
        if (chemin === 'src/index.ts' && Object.keys(INDEX_TOUS_RAYONS).some((l) => ligne.trim() === l)) return;
        // La comparaison suit la lecture : même ligne ou les trois suivantes (`etatDuScenario` la fait elle-même). Une
        // COMPARAISON (`.rayon`), pas un commentaire qui parle du rayon.
        const voisinage = lignes.slice(i, i + 4).join('\n');
        if (!/\.rayon\b|etatDuScenario\(/.test(voisinage)) fautifs.push(`${chemin}:${i + 1}`);
      });
    }
    expect(fautifs).toEqual([]);
  });

  it('chaque entrée par identifiant de la liste en lit encore une', () => {
    for (const chemin of Object.keys(GETBYID_TOUS_RAYONS)) {
      const f = SOURCES.find((s) => s.chemin === chemin);
      expect(f && RE_GETBYID.test(f.texte), chemin).toBe(true);
    }
    const index = SOURCES.find((s) => s.chemin === 'src/index.ts')!.texte.split('\n').map((l) => l.trim());
    for (const ligne of Object.keys(INDEX_TOUS_RAYONS)) expect(index.filter((l) => l === ligne).length, ligne).toBeGreaterThan(0);
  });
});
