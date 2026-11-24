import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { OUTILS } from '../src/mcp/outils';
import { ADRESSES } from './parite/adresses';
import { CHAMPS, ECARTS, type Corps } from './parite/champs';
import { aplatir, ecarts, type Champ } from './parite/schemas';

/**
 * LA PARITÉ DES CHAMPS (lot 1 du CSM virtuel, brique B1, plan `docs/superpowers/plans/2026-11-24-csm-lot1-b1-parite.md`).
 *
 * 🔴 CE QUE CE TEST TIENT : pour chaque route d'écriture servie par un outil MCP, le schéma qui valide son corps est
 * comparé à l'entrée de cet outil, et les écarts (un champ que l'outil ne porte pas, une borne qu'il n'annonce pas) sont
 * EXACTEMENT ceux de `ECARTS`. La parité se dérive des schémas exportés, elle ne se relit pas : un test qui comparait
 * des noms de clés n'avait rien vu pendant des semaines (`tests/agent-setup-bornes.test.ts`, 2026-09-17).
 */

type AvecSchema = Extract<Corps, { schema: z.ZodType }>;
const avecSchema = (c: Corps): c is AvecSchema => 'schema' in c;
const versJson = (s: z.ZodType): unknown => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });

function entreeDesOutils(cle: string): Map<string, Champ> {
  const d = ADRESSES[cle];
  const noms = d !== undefined && 'outils' in d ? d.outils : [];
  const fusion = new Map<string, Champ>();
  for (const nom of noms) {
    const outil = OUTILS.find((o) => o.nom === nom);
    if (outil !== undefined) for (const [k, v] of aplatir(outil.entree)) if (!fusion.has(k)) fusion.set(k, v);
  }
  return fusion;
}

const ecritures = Object.entries(ADRESSES)
  .filter(([cle, d]) => /^(POST|PUT|PATCH|DELETE) /.test(cle) && 'outils' in d)
  .map(([cle]) => cle);

describe('la comparaison d’un schéma et d’une entrée d’outil', () => {
  const outil = aplatir({
    type: 'object',
    properties: {
      agent_id: { type: 'string', maxLength: 100 },
      nom: { type: 'string', minLength: 1, maxLength: 60 },
      mode: { type: 'string', enum: ['a', 'b'] },
    },
  });

  it('un champ de la route que l’outil ne porte pas est un écart ; le même en snake_case ne l’est pas', () => {
    const route = aplatir(versJson(z.object({ agentId: z.string().max(100), couleur: z.string() })));
    expect(ecarts(route, outil)).toEqual(['couleur : absent de l’outil']);
  });

  it('une borne que l’outil n’annonce pas, ou annonce plus lâche, est un écart ; plus stricte, non', () => {
    expect(ecarts(aplatir(versJson(z.object({ nom: z.string().min(1).max(40) }))), outil)).toEqual(['nom : maxLength annoncé 60, la route applique 40']);
    expect(ecarts(aplatir(versJson(z.object({ nom: z.string().min(1).max(80) }))), outil)).toEqual([]);
    expect(ecarts(aplatir(versJson(z.object({ nom: z.string().min(2) }))), outil)).toEqual(['nom : minLength annoncé 1, la route applique 2']);
  });

  it('une valeur permise par la route et absente de l’outil est un écart', () => {
    expect(ecarts(aplatir(versJson(z.object({ mode: z.enum(['a', 'b', 'c']) }))), outil)).toEqual(['mode : valeur "c" absente de l’outil']);
  });

  it('les noms et les absents déclarés s’appliquent, un objet mis à plat compris', () => {
    const route = (max: number) => aplatir(versJson(z.object({ contenu: z.object({ nom: z.string().max(max) }), cache: z.string() })));
    const c = { noms: { contenu: '' }, absents: { cache: 'exprès' } };
    expect(ecarts(route(80), outil, c)).toEqual([]);
    expect(ecarts(route(40), outil, c)).toEqual(['contenu.nom : maxLength annoncé 60, la route applique 40']);
    expect(ecarts(route(80), outil)).toEqual(['cache : absent de l’outil', 'contenu : absent de l’outil']);
  });

  it('🔴 un nullable écrit par deux versions de zod (type en liste, ou anyOf) donne la même mise à plat', () => {
    const enListe = aplatir({ type: 'object', properties: { x: { type: ['string', 'null'], maxLength: 5 } } });
    const enAnyOf = aplatir({ type: 'object', properties: { x: { anyOf: [{ type: 'string', maxLength: 5 }, { type: 'null' }] } } });
    expect(enAnyOf).toEqual(enListe);
  });

  it('les bornes d’un entier sûr ne sont pas des bornes choisies par la route', () => {
    expect(aplatir(versJson(z.object({ n: z.number().int() }))).get('n')).toEqual({ types: new Set(['integer']) });
  });
});

describe('parité des champs : chaque route d’écriture servie par un outil, comparée à cet outil', () => {
  it('la garde de la garde : des routes à comparer, et des schémas qui se mettent à plat', () => {
    const schemas = Object.values(CHAMPS).filter(avecSchema);
    expect(schemas.length).toBeGreaterThan(0);
    for (const c of schemas) expect(aplatir(versJson(c.schema)).size + 1).toBeGreaterThan(0);
  });

  it('🔴 chaque route d’écriture servie par un outil a sa déclaration, et aucune autre route n’en a', () => {
    expect(Object.keys(CHAMPS).sort(), 'Une route d’écriture servie par un outil doit déclarer son corps dans '
      + 'tests/parite/champs.ts (sansCorps, parLaPage, aLaMain ou son schéma).').toEqual([...ecritures].sort());
  });

  it('🔴 les noms, les absents et les valeurs absentes déclarés désignent ce qui existe dans la route', () => {
    const morts: string[] = [];
    for (const [cle, c] of Object.entries(CHAMPS)) {
      if (!avecSchema(c)) continue;
      const route = aplatir(versJson(c.schema));
      for (const k of [...Object.keys(c.noms ?? {}), ...Object.keys(c.absents ?? {})]) if (!route.has(k)) morts.push(`${cle} : ${k}`);
      for (const [k, { valeurs }] of Object.entries(c.valeursAbsentes ?? {})) {
        for (const v of valeurs) if (!(route.get(k)?.enum ?? []).includes(v)) morts.push(`${cle} : ${k} = ${JSON.stringify(v)}`);
      }
    }
    expect(morts).toEqual([]);
  });

  it('chaque absent, chaque valeur absente et chaque route lue à la main dit pourquoi', () => {
    const muets = Object.entries(CHAMPS).flatMap(([cle, c]) => [
      ...('aLaMain' in c && c.aLaMain.trim() === '' ? [cle] : []),
      ...(avecSchema(c) ? Object.entries(c.absents ?? {}).filter(([, r]) => r.trim() === '').map(([k]) => `${cle} : ${k}`) : []),
      ...(avecSchema(c) ? Object.entries(c.valeursAbsentes ?? {}).filter(([, v]) => v.raison.trim() === '').map(([k]) => `${cle} : ${k}`) : []),
    ]);
    expect(muets).toEqual([]);
  });

  it('🔴 les écarts trouvés sont exactement ceux de la liste de travail (ECARTS)', () => {
    const trouves: Record<string, string[]> = {};
    for (const [cle, c] of Object.entries(CHAMPS)) {
      if (!avecSchema(c)) continue;
      const e = ecarts(aplatir(versJson(c.schema)), entreeDesOutils(cle), c);
      if (e.length > 0) trouves[cle] = e;
    }
    const attendus = Object.fromEntries(Object.entries(ECARTS).filter(([, e]) => e.length > 0).map(([k, e]) => [k, [...e].sort()]));
    expect(trouves, 'Un écart neuf : faites porter le champ ou la borne par l’outil. Un écart comblé : retirez sa ligne '
      + 'de ECARTS dans tests/parite/champs.ts.').toEqual(attendus);
  });
});
