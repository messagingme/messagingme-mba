/**
 * CE QUE PAIE UN DÉBIT DU CRÉDIT IA, lu dans le journal (`agent_credit_mouvements`), pour la ligne « Coût de l'IA ».
 *
 * 🔴 LA NATURE SE LIT DANS LA NOTE, PAS DANS LA SESSION. Un tour d'agent débite avec sa session et SANS note ; tout
 * autre débit porte une note (essai, connaissance, transcription). La session ne suffit pas : `session_id` passe à
 * `null` quand la conversation est purgée (`on delete set null`, migration 0087), alors que le débit reste au
 * journal. Une note absente veut donc dire « tour d'agent », session encore là ou non.
 *
 * 🔴 LES NOTES S'ÉCRIVENT ICI ET NULLE PART AILLEURS : une note tapée à la main chez un appelant tomberait en « autre »
 * sans que rien ne le signale. `tests/natures-credit.test.ts` refuse un appel de `debiter` qui passe une chaîne écrite
 * en dur.
 */

export const NATURES_IA = ['agent', 'essai', 'connaissance', 'transcription', 'traduction', 'autre'] as const;
export type NatureIa = (typeof NATURES_IA)[number];

/** La note d'un essai, par porte. */
export const NOTE_ESSAI = {
  formulaire: 'essai depuis la console',
  mcp: 'essai depuis le serveur MCP',
} as const;

export const NOTE_TRANSCRIPTION = 'transcription d’un vocal';

const PREFIXE_VECTORISATION = 'vectorisation de ';

/** La note d'une vectorisation de la connaissance : le nombre de fiches varie, le préfixe non. */
export function noteVectorisation(fiches: number): string {
  return `${PREFIXE_VECTORISATION}${fiches} fiche${fiches > 1 ? 's' : ''} de connaissance`;
}

const NOTES_ESSAI: ReadonlySet<string> = new Set(Object.values(NOTE_ESSAI));

/**
 * La nature d'un mouvement, ou `null` quand ce n'est pas une consommation (achat, recharge, crédit offert). Une note
 * inconnue d'un débit `conso` est rangée en « autre », jamais perdue : le total reste juste même si une porte nouvelle
 * oublie de se déclarer.
 */
export function natureDuMouvement(raison: string, note: string | null): NatureIa | null {
  if (raison === 'traduction') return 'traduction';
  if (raison !== 'conso') return null;
  if (note === null || note === '') return 'agent';
  if (NOTES_ESSAI.has(note)) return 'essai';
  if (note.startsWith(PREFIXE_VECTORISATION)) return 'connaissance';
  if (note === NOTE_TRANSCRIPTION) return 'transcription';
  return 'autre';
}

/** Une ventilation vide, chaque nature à zéro : l'écran affiche toutes les parts, même nulles. */
export function ventilationVide(): Record<NatureIa, number> {
  return { agent: 0, essai: 0, connaissance: 0, transcription: 0, traduction: 0, autre: 0 };
}
