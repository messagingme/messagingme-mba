/**
 * LA COMPARAISON D'UN SCHÉMA D'ÉCRITURE ET DE L'ENTRÉE D'UN OUTIL MCP (lot 1 du CSM virtuel, brique B1, parité des
 * champs ; plan `docs/superpowers/plans/2026-11-24-csm-lot1-b1-parite.md`).
 *
 * Les deux côtés passent par la même forme : un schéma JSON (`z.toJSONSchema` côté route, l'`entree` telle quelle côté
 * outil) mis à plat en chemins (`contenu.objectif`, `sorties[].code`), chacun avec ses types et ses bornes. Puis chaque
 * champ de la route doit se retrouver dans l'outil, avec ses types, ses valeurs permises et des bornes AU MOINS aussi
 * strictes : un modèle ne respecte que ce qu'on lui annonce, et une borne que le serveur applique sans que l'outil la
 * dise ne se découvre qu'au refus.
 *
 * ⚠️ UN SEUL SENS : de la route vers l'outil. Un outil plus strict, ou qui porte des champs à lui (une empreinte, un
 * code de confirmation, l'offre d'une autre route qu'il sert aussi), n'est pas un écart. Ni une obligation : un outil
 * peut fournir lui-même la valeur par défaut d'un champ que la route exige.
 *
 * ⚠️ LA FORME QUE REND `z.toJSONSchema` CHANGE D'UNE VERSION DE ZOD À L'AUTRE : un champ nullable s'écrit
 * `type: [x, null]` en 4.6.7 (le lockfile, la CI) et `anyOf` en 4.4.3 (un `node_modules` en retard). La mise à plat
 * ramène les deux à la même chose (un ensemble de types), sinon ce test serait vert à un endroit et rouge à l'autre.
 */

type Json = { readonly [k: string]: unknown };

export interface Champ {
  readonly types: ReadonlySet<string>;
  readonly enum?: readonly unknown[];
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const BORNES = ['pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'] as const;

const estObjet = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
/** `z.number().int()` s'écrit avec les bornes d'un entier sûr : ce ne sont pas des bornes que la route choisit. */
const borneReelle = (v: unknown): boolean => typeof v === 'number' && Math.abs(v) < Number.MAX_SAFE_INTEGER;

/** Met un schéma JSON à plat : chemin -> types et bornes. La racine (`''`) n'est pas rendue. */
export function aplatir(schema: unknown): Map<string, Champ> {
  const racine = estObjet(schema) ? schema : {};
  const defs = { ...(estObjet(racine.$defs) ? racine.$defs : {}), ...(estObjet(racine.definitions) ? racine.definitions : {}) };
  const sortie = new Map<string, Mutable<Champ> & { types: Set<string> }>();

  const visiter = (s: unknown, chemin: string, profondeur: number): void => {
    if (!estObjet(s) || profondeur > 20) return;
    if (typeof s.$ref === 'string') {
      visiter(defs[s.$ref.split('/').pop() ?? ''], chemin, profondeur + 1);
      return;
    }
    if (chemin !== '') {
      const champ = sortie.get(chemin) ?? { types: new Set<string>() };
      sortie.set(chemin, champ);
      const t = s.type;
      for (const x of Array.isArray(t) ? t : typeof t === 'string' ? [t] : []) champ.types.add(String(x));
      if (s.const !== undefined) champ.enum = [...(champ.enum ?? []), s.const];
      if (Array.isArray(s.enum)) champ.enum = [...(champ.enum ?? []), ...s.enum];
      if (champ.enum?.includes(null)) champ.types.add('null');
      for (const b of BORNES) if (s[b] !== undefined && (b === 'pattern' || borneReelle(s[b]))) (champ as Record<string, unknown>)[b] = s[b];
      if (borneReelle(s.exclusiveMinimum)) champ.minimum = s.exclusiveMinimum as number;
      if (borneReelle(s.exclusiveMaximum)) champ.maximum = s.exclusiveMaximum as number;
    }
    for (const cle of ['anyOf', 'oneOf', 'allOf'] as const) {
      const alternatives = s[cle];
      if (Array.isArray(alternatives)) for (const a of alternatives) visiter(a, chemin, profondeur + 1);
    }
    if (estObjet(s.properties)) for (const [k, v] of Object.entries(s.properties)) visiter(v, chemin === '' ? k : `${chemin}.${k}`, profondeur + 1);
    if (estObjet(s.additionalProperties)) visiter(s.additionalProperties, `${chemin}{}`, profondeur + 1);
    if (estObjet(s.items)) visiter(s.items, `${chemin}[]`, profondeur + 1);
  };
  visiter(racine, '', 0);
  return sortie;
}

/** `camelCase` -> `snake_case` : la console parle camel, les outils MCP parlent snake. */
const serpent = (chemin: string): string => chemin.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

export interface Correspondance {
  /** Un champ de la route (ou un préfixe) -> son chemin dans l'outil, quand il ne se déduit pas (`''` : remonte d'un cran). */
  readonly noms?: Readonly<Record<string, string>>;
  /** Un champ de la route (et ses enfants) que l'outil ne porte pas EXPRÈS, avec la raison. */
  readonly absents?: Readonly<Record<string, string>>;
  /** Des valeurs permises par le schéma de la route que l'outil n'annonce pas EXPRÈS (le service les refuse), avec la raison. */
  readonly valeursAbsentes?: Readonly<Record<string, { readonly valeurs: readonly unknown[]; readonly raison: string }>>;
}

/** Le chemin de l'outil qu'on attend pour un chemin de la route : le nom écrit (lui ou un préfixe), sinon le même. */
function cheminDansLOutil(chemin: string, noms: Readonly<Record<string, string>>): string {
  if (Object.hasOwn(noms, chemin)) return noms[chemin]!;
  const segments = chemin.split('.');
  for (let i = segments.length - 1; i > 0; i -= 1) {
    const prefixe = segments.slice(0, i).join('.');
    if (Object.hasOwn(noms, prefixe)) {
      const reste = segments.slice(i).join('.');
      return noms[prefixe] === '' ? reste : `${noms[prefixe]}.${reste}`;
    }
  }
  return chemin;
}

const sousLePrefixe = (chemin: string, prefixe: string): boolean =>
  chemin === prefixe || chemin.startsWith(`${prefixe}.`) || chemin.startsWith(`${prefixe}[]`) || chemin.startsWith(`${prefixe}{}`);

/**
 * Les écarts entre la route et l'outil, un par ligne, triés : un champ de la route que l'outil ne porte pas (ses enfants
 * ne sont pas recomptés), un type ou une valeur permise que l'outil n'annonce pas, une borne que la route applique et
 * que l'outil n'annonce pas ou annonce plus lâche. Quand l'outil annonce une liste fermée, ses longueurs et son motif
 * vont de soi.
 */
export function ecarts(route: Map<string, Champ>, outil: Map<string, Champ>, c: Correspondance = {}): string[] {
  const noms = c.noms ?? {};
  const ignores = [...Object.keys(c.absents ?? {})];
  const sortie: string[] = [];
  for (const [chemin, r] of route) {
    if (ignores.some((a) => sousLePrefixe(chemin, a))) continue;
    const vise = cheminDansLOutil(chemin, noms);
    // Un objet que l'outil met à plat (`contenu: ''`) n'a pas de chemin à lui : seuls ses champs se comparent.
    if (vise === '') continue;
    const o = outil.get(vise) ?? outil.get(serpent(vise));
    if (o === undefined) {
      sortie.push(`${chemin} : absent de l’outil`);
      ignores.push(chemin);
      continue;
    }
    for (const t of r.types) {
      if (!o.types.has(t) && !(t === 'integer' && o.types.has('number'))) sortie.push(`${chemin} : type ${t} non annoncé`);
    }
    if (r.enum !== undefined) {
      if (o.enum === undefined) sortie.push(`${chemin} : valeurs permises non annoncées`);
      else {
        const voulues = c.valeursAbsentes?.[chemin]?.valeurs ?? [];
        for (const v of r.enum) if (v !== null && !o.enum.includes(v) && !voulues.includes(v)) sortie.push(`${chemin} : valeur ${JSON.stringify(v)} absente de l’outil`);
      }
    }
    if (o.enum === undefined && r.pattern !== undefined && o.pattern !== r.pattern) {
      sortie.push(`${chemin} : motif ${o.pattern === undefined ? 'non annoncé' : 'différent'}`);
    }
    const auPlus = (b: 'maxLength' | 'maximum' | 'maxItems'): void => {
      if (r[b] === undefined || (b === 'maxLength' && o.enum !== undefined)) return;
      if (o[b] === undefined) sortie.push(`${chemin} : ${b} ${r[b]} non annoncé`);
      else if (o[b]! > r[b]!) sortie.push(`${chemin} : ${b} annoncé ${o[b]}, la route applique ${r[b]}`);
    };
    const auMoins = (b: 'minLength' | 'minimum' | 'minItems'): void => {
      if (r[b] === undefined || (b !== 'minimum' && r[b] === 0) || (b === 'minLength' && o.enum !== undefined)) return;
      if (o[b] === undefined) sortie.push(`${chemin} : ${b} ${r[b]} non annoncé`);
      else if (o[b]! < r[b]!) sortie.push(`${chemin} : ${b} annoncé ${o[b]}, la route applique ${r[b]}`);
    };
    auPlus('maxLength'); auPlus('maximum'); auPlus('maxItems');
    auMoins('minLength'); auMoins('minimum'); auMoins('minItems');
  }
  return sortie.sort();
}
