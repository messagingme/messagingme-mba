/**
 * LE RENDU D'UNE FICHE DU MODE D'EMPLOI dans le panneau d'aide, quand on clique une source « D'après ».
 *
 * La grammaire est celle des fiches (`src/aide/structure.ts`), petite et tenue par les tests du dépôt : des blocs
 * séparés par une ligne vide (paragraphe, liste de lignes `- `, intertitre `## `), et en ligne le gras et le code.
 * Pas de bibliothèque Markdown pour ça. Le texte reste du TEXTE : rien n'est injecté en HTML.
 */

export type BlocFiche =
  | { type: 'intertitre'; texte: string }
  | { type: 'paragraphe'; texte: string }
  | { type: 'liste'; items: string[] };

export type SegmentFiche = { texte: string; gras?: true; code?: true };

/** La voie d'une étape (`**3. [claude] Titre.**`), dite en clair : le lecteur n'a pas la page de la vitrine. */
const VOIES: Record<'fr' | 'en', Record<'claude' | 'console', string>> = {
  fr: { claude: 'Depuis Claude Code : ', console: 'Dans la console : ' },
  en: { claude: 'From Claude Code: ', console: 'In the console: ' },
};

export function blocsFiche(corps: string, langue: 'fr' | 'en' = 'fr'): BlocFiche[] {
  return corps
    .replace(/\r\n/g, '\n')
    .replace(/\[(claude|console)\]\s+/g, (_, v: 'claude' | 'console') => VOIES[langue][v])
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b !== '')
    .map((b): BlocFiche => {
      if (b.startsWith('## ')) return { type: 'intertitre', texte: b.slice(3).trim() };
      const lignes = b.split('\n');
      if (lignes[0]!.startsWith('- ')) {
        // Une ligne qui ne commence pas par `- ` continue le point précédent (retour à la ligne dans le fichier).
        const items: string[] = [];
        for (const l of lignes) {
          if (l.startsWith('- ')) items.push(l.slice(2).trim());
          else items[items.length - 1] += ` ${l.trim()}`;
        }
        return { type: 'liste', items };
      }
      return { type: 'paragraphe', texte: lignes.map((l) => l.trim()).join(' ') };
    });
}

export function segmentsFiche(texte: string): SegmentFiche[] {
  return texte
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter((s) => s !== '')
    .map((s): SegmentFiche => {
      if (s.length > 4 && s.startsWith('**') && s.endsWith('**')) return { texte: s.slice(2, -2), gras: true };
      if (s.length > 2 && s.startsWith('`') && s.endsWith('`')) return { texte: s.slice(1, -1), code: true };
      return { texte: s };
    });
}
