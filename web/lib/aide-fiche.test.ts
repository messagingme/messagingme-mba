import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blocsFiche, segmentsFiche } from './aide-fiche';

describe('rendu d’une fiche dans le panneau d’aide', () => {
  it('lit paragraphes, listes à lignes continuées et intertitres', () => {
    const corps = 'Un chapeau\nsur deux lignes.\n\n**1. Écrire.** Cliquez.\n\n- un point\n  qui continue\n- un autre\n\n## La suite';
    expect(blocsFiche(corps)).toEqual([
      { type: 'paragraphe', texte: 'Un chapeau sur deux lignes.' },
      { type: 'paragraphe', texte: '**1. Écrire.** Cliquez.' },
      { type: 'liste', items: ['un point qui continue', 'un autre'] },
      { type: 'intertitre', texte: 'La suite' },
    ]);
  });

  it('dit la voie d’une étape en clair, dans la langue de la console', () => {
    expect(blocsFiche('**2. [claude] Brancher.** Tapez.')).toEqual([{ type: 'paragraphe', texte: '**2. Depuis Claude Code : Brancher.** Tapez.' }]);
    expect(blocsFiche('**2. [console] Plug.** Click.', 'en')).toEqual([{ type: 'paragraphe', texte: '**2. In the console: Plug.** Click.' }]);
  });

  it('découpe le gras et le code, et laisse le reste en texte', () => {
    expect(segmentsFiche('Ouvrez **Campagnes**, puis `npm run` ici.')).toEqual([
      { texte: 'Ouvrez ' }, { texte: 'Campagnes', gras: true }, { texte: ', puis ' }, { texte: 'npm run', code: true }, { texte: ' ici.' },
    ]);
  });

  it('🔴 aucune vraie fiche ne laisse de marque de syntaxe à l’écran', () => {
    // Les fiches du dépôt, corps seul (en-tête et titre retirés comme le fait le serveur) : un `**`, un `##` ou un `- `
    // resté visible voudrait dire que la grammaire a bougé sans que ce rendu suive.
    const dossier = join(__dirname, '..', '..', 'docs', 'aide', 'fiches');
    const fichiers = readdirSync(dossier).filter((n) => n.endsWith('.md'));
    expect(fichiers.length).toBeGreaterThan(10);
    for (const n of fichiers) {
      const texte = readFileSync(join(dossier, n), 'utf8').replace(/\r\n/g, '\n');
      const corps = texte.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^#[ \t]+.+$/m, '');
      const visibles = blocsFiche(corps).flatMap((b) => (b.type === 'liste' ? b.items : [b.texte]))
        .flatMap((t) => segmentsFiche(t)).filter((s) => !s.code).map((s) => s.texte).join('\n');
      expect(visibles, n).not.toMatch(/\*\*|^#|^- |\[(claude|console)\]/m);
    }
  });
});
