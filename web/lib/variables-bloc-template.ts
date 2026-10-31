import type { ParamSource, UserFieldDef } from './api';
import { appliquerIndices, selToSource, type VarRow } from './variables-template';

/**
 * Module PUR : le champ du contact qui remplit chaque `{{n}}` du template envoyé par un bloc de scénario.
 *
 * Le bloc part des sources posées sur le template à sa création (`template_param_hints`) et peut en choisir
 * d'autres, pour lui seul (`node.data.variables`). À l'envoi, la source du bloc prime position par position
 * (`sourcesDuBloc`, `src/workflow/template-send.ts`) ; une position sans aucune source fait refuser l'envoi.
 */

export interface SourceDuBloc { position: number; source: ParamSource }

/** Option du sélecteur : aucune source, donc un envoi refusé. Jamais envoyée au serveur. */
export const SEL_AUCUN = '';

/** Les choix enregistrés dans le bloc, lus défensivement : `data` est du JSON libre. */
export function lireSourcesDuBloc(raw: unknown): SourceDuBloc[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is SourceDuBloc => typeof v === 'object' && v !== null
    && Number.isInteger((v as { position?: unknown }).position)
    && typeof (v as { source?: unknown }).source === 'object' && (v as { source?: unknown }).source !== null);
}

/** Les lignes du sélecteur : celles du template, puis celles du bloc par-dessus ; une position sans source reste vide. */
export function lignesDuBloc(n: number, duTemplate: readonly SourceDuBloc[], duBloc: readonly SourceDuBloc[], champs: UserFieldDef[]): VarRow[] {
  const vides: VarRow[] = Array.from({ length: Math.max(0, n) }, () => ({ sel: SEL_AUCUN, value: '' }));
  return appliquerIndices(appliquerIndices(vides, duTemplate, champs), duBloc, champs);
}

/**
 * Les lignes -> ce que le bloc enregistre : les seules positions qui diffèrent de celles du template (`base`), pour
 * qu'une position non touchée continue de suivre le template. Une ligne vide, ou un texte fixe sans texte (en cours
 * de saisie), n'enregistre rien.
 */
export function versSourcesDuBloc(lignes: readonly VarRow[], base: readonly VarRow[] = []): SourceDuBloc[] {
  return lignes.flatMap((l, i) => {
    if (l.sel === SEL_AUCUN || (l.sel === 'literal' && l.value.trim() === '')) return [];
    if (base[i]?.sel === l.sel && base[i]?.value === l.value) return [];
    return [{ position: i + 1, source: selToSource(l.sel, l.value) }];
  });
}
