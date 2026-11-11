/**
 * Les actions d'un bloc « Action », lues au même endroit par le moteur, la console et le résumé du MCP (2026-11-11).
 *
 * La PREMIÈRE action reste à plat dans `data` (`actionKind`, `tag`, `fieldKey`...), les suivantes vivent dans
 * `data.suite`, chacune de la même forme. Un bloc d'avant n'a pas de `suite` : il se lit à l'identique, sans migration,
 * et tout lecteur qui ne regarde que la première action reste juste pour lui.
 *
 * `remove_tag` retire une LISTE (`tags`), `clear_field` vide une LISTE (`champs`) ; la forme à une valeur (`tag`,
 * `fieldKey`) reste lue pour les blocs d'avant.
 */

export type SousAction = Record<string, unknown>;

/** Les actions du bloc, dans l'ordre où elles se jouent. */
export function sousActions(data: Record<string, unknown>): SousAction[] {
  const suite = Array.isArray(data.suite)
    ? data.suite.filter((x): x is SousAction => x !== null && typeof x === 'object' && !Array.isArray(x))
    : [];
  return [data, ...suite];
}

const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Les étiquettes qu'une action « retirer » retire : la liste `tags`, sinon l'ancienne valeur unique `tag`. */
export function etiquettesARetirer(sa: SousAction): string[] {
  const brut = Array.isArray(sa.tags) ? sa.tags.map(texte) : [texte(sa.tag)];
  return [...new Set(brut.filter((t) => t !== ''))];
}

/** Les champs qu'une action « vider » vide, avec leur libellé : la liste `champs`, sinon l'ancien `fieldKey`. */
export function champsAVider(sa: SousAction): Array<{ key: string; label: string }> {
  const brut = Array.isArray(sa.champs)
    ? sa.champs.map((c) => {
      const o = c !== null && typeof c === 'object' ? (c as Record<string, unknown>) : {};
      return { key: texte(o.key), label: texte(o.label) };
    })
    : [{ key: texte(sa.fieldKey ?? sa.key), label: texte(sa.fieldLabel) }];
  const parCle = new Map<string, { key: string; label: string }>();
  for (const c of brut) if (c.key !== '' && !parCle.has(c.key)) parCle.set(c.key, c);
  return [...parCle.values()];
}
