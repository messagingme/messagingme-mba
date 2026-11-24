import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';
import { forme } from '../src/workflow/store.pg';

/**
 * 0315 : chaque version publiée d'un scénario est gardée (lot 1 du CSM virtuel, B3). Elle CRÉE une table, deux fonctions
 * et le premier déclencheur du dépôt : l'ancien code ne les nomme pas et y survit, donc AVANT. Le comportement en base
 * (chaque chemin qui publie fait sa version, pas les autres) est prouvé par
 * `tests/integration/workflow-versions.integration.test.ts` ; ce fichier tient le texte.
 */
const SQL = readFileSync(new URL('../db/migrations/0315_workflow_versions.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const espaces = (t: string): string => t.replace(/\s+/g, ' ').trim();
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => espaces(i).replace(/;\s*$/, ''))
  .filter((i) => i !== '');
const commencant = (debut: string): string => instructions.find((i) => i.startsWith(debut)) ?? '';

describe('migration 0315', () => {
  it('🔴 le plafond d’attente du verrou vient en tête (workflows est chaude), dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('la table : un numéro par scénario, effacée avec son espace et avec son scénario', () => {
    const table = commencant('create table if not exists workflow_versions (');
    expect(table).toContain('tenant_id uuid not null references tenants(id) on delete cascade');
    expect(table).toContain('workflow_id uuid not null references workflows(id) on delete cascade');
    expect(table).toContain('numero integer not null constraint workflow_versions_numero_check check (numero >= 1)');
    expect(table).toContain('primary key (workflow_id, numero)');
  });

  it('l’index sert la lecture scopée à l’espace, les plus récentes d’abord (`src/workflow/versions.pg.ts`)', () => {
    expect(instructions).toContain(
      'create index if not exists workflow_versions_tenant_idx on workflow_versions (tenant_id, workflow_id, numero desc)',
    );
  });

  it('🔴 la reprise : chaque scénario déjà publié a sa version 1, rejouable sans doublon', () => {
    const reprise = commencant('insert into workflow_versions (tenant_id, workflow_id, numero, graph, publiee_le)');
    expect(reprise).toContain("where jsonb_array_length(coalesce(w.graph -> 'nodes', '[]'::jsonb)) > 0");
    expect(reprise).toMatch(/on conflict \(workflow_id, numero\) do nothing$/);
  });

  it('🔴 `workflow_graphe_forme` est la même expression que `forme` du store : la même règle dit « déplacer un bloc n’est pas publier »', () => {
    const fonction = commencant('create or replace function workflow_graphe_forme(g jsonb) returns jsonb language sql immutable as $$');
    const corps = /as \$\$ select (.*) \$\$$/.exec(fonction)?.[1];
    expect(corps).toBe(espaces(forme('g')));
  });

  it('🔴 le déclencheur ne fait une version que d’un graphe non vide qui diffère de la dernière version par sa forme', () => {
    const fonction = commencant('create or replace function workflow_version_publiee() returns trigger');
    expect(fonction).toContain("if jsonb_array_length(coalesce(new.graph -> 'nodes', '[]'::jsonb)) = 0 then return new; end if;");
    expect(fonction).toContain('order by v.numero desc limit 1;');
    expect(fonction).toContain(
      'if derniere_graph is not null and workflow_graphe_forme(derniere_graph) = workflow_graphe_forme(new.graph) then return new; end if;',
    );
    expect(fonction).toContain('values (new.tenant_id, new.id, coalesce(derniere_numero, 0) + 1, new.graph)');
  });

  it('🔴 le déclencheur couvre toute écriture de `graph`, création comprise, et vient AVANT la reprise : son verrou ne laisse passer aucune publication entre les deux', () => {
    const pose = 'create trigger workflows_version after insert or update of graph on workflows for each row execute function workflow_version_publiee()';
    expect(instructions.slice(-3, -1)).toEqual(['drop trigger if exists workflows_version on workflows', pose]);
    expect(instructions.at(-1)).toMatch(/^insert into workflow_versions \(tenant_id, workflow_id, numero, graph, publiee_le\)/);
  });

  it('aucune instruction ne détruit ni ne réécrit une donnée existante', () => {
    for (const i of instructions) expect(i).not.toMatch(/drop table|drop column|truncate|delete from|update workflows/i);
  });
});
