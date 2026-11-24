-- 0315_workflow_versions.sql : chaque version publiee d un scenario est gardee (lot 1 du CSM virtuel, B3, plan
-- docs/superpowers/plans/2026-11-24-csm-lot1-c-clic-et-versions.md). Restaurer une version = la republier.
--
-- workflow_versions : une ligne par version publiee : l espace, le scenario, un numero croissant par scenario (1, 2...),
--   le graphe publie et sa date. Cle etrangere en cascade sur workflows : supprimer un scenario ou un espace emporte ses
--   versions. Aucune donnee de personne : un graphe de blocs, comme workflows.graph.
-- La reprise : chaque scenario deja publie (graphe non vide) recoit sa version 1, datee de sa publication ; sans elle, la
--   premiere publication apres ce deploiement ne pourrait pas etre defaite. Elle vient APRES le declencheur : create
--   trigger prend sur workflows un verrou qui en bloque les ecritures jusqu a la fin de la migration, donc aucune
--   publication ne passe entre la reprise et le declencheur sans sa version.
-- Le declencheur workflows_version, le PREMIER du depot, et c est voulu : toute ecriture qui change workflows.graph
--   insere une version, quel que soit le chemin (console, API et MCP, ligne Shopify ou HubSpot, publication programmee),
--   et un chemin ajoute demain aussi, ce qu un appel pose dans chaque chemin ne garantirait pas. Une creation qui arrive
--   deja publiee (graphe non vide, l API) aussi ; un graphe vide (un scenario neuf de la console) non. Le declencheur n a
--   pas de session : QUI a publie reste au journal d audit (workflow.published).
-- Ce qui fait une version : un graphe qui differe de la DERNIERE version autrement que par la disposition des blocs.
--   Deplacer un bloc d un scenario publie reecrit workflows.graph (l enregistrement automatique de l editeur y range la
--   disposition) : sans cette regle, chaque deplacement serait une version. La comparaison passe par
--   workflow_graphe_forme, le jumeau SQL de forme() dans src/workflow/store.pg.ts (le graphe sans les positions), que
--   tests/migration-0315.test.ts tient egal. Une version garde la disposition de sa publication. Un graphe dont nodes
--   n est pas un tableau (la console n en ecrit pas, mais la base l accepte) ne fait pas de version et n empeche jamais
--   l ecriture : la garde passe par un case, seul ordre d evaluation garanti, avant tout jsonb_array_length ; une
--   version a donc toujours des nodes en tableau, et workflow_graphe_forme n en recoit jamais d autre. Le test d un graphe
--   inchange n est qu un raccourci : chaque enregistrement automatique de l editeur reecrit graph a l identique (le
--   brouillon change, pas le publie), et il evite d y relire la derniere version.
-- Le numero : max + 1. Deux ecritures d un meme scenario se suivent sur le verrou de sa ligne (l UPDATE le prend), donc
--   le numero ne se double pas ; la cle primaire (workflow_id, numero) le garantit de toute facon.
-- Lue seulement par le code neuf, et l ancien code n est pas gene par une table et un declencheur neufs : migration=avant.
set local lock_timeout = '5s';

create table if not exists workflow_versions (
  tenant_id uuid not null references tenants(id) on delete cascade,
  workflow_id uuid not null references workflows(id) on delete cascade,
  numero integer not null constraint workflow_versions_numero_check check (numero >= 1),
  graph jsonb not null,
  publiee_le timestamptz not null default now(),
  primary key (workflow_id, numero)
);

create index if not exists workflow_versions_tenant_idx on workflow_versions (tenant_id, workflow_id, numero desc);

create or replace function workflow_graphe_forme(g jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'edges', g->'edges',
    'nodes', (select coalesce(jsonb_agg(n - 'position' order by ord), '[]'::jsonb)
                from jsonb_array_elements(coalesce(g->'nodes', '[]'::jsonb)) with ordinality as t(n, ord))
  )
$$;

create or replace function workflow_version_publiee() returns trigger language plpgsql as $$
declare
  derniere_numero integer;
  derniere_graph jsonb;
begin
  if (case when jsonb_typeof(new.graph -> 'nodes') = 'array' then jsonb_array_length(new.graph -> 'nodes') else 0 end) = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.graph is not distinct from old.graph then
    return new;
  end if;
  select v.numero, v.graph into derniere_numero, derniere_graph
    from workflow_versions v
   where v.workflow_id = new.id
   order by v.numero desc
   limit 1;
  if derniere_graph is not null and workflow_graphe_forme(derniere_graph) = workflow_graphe_forme(new.graph) then
    return new;
  end if;
  insert into workflow_versions (tenant_id, workflow_id, numero, graph)
  values (new.tenant_id, new.id, coalesce(derniere_numero, 0) + 1, new.graph);
  return new;
end
$$;

drop trigger if exists workflows_version on workflows;
create trigger workflows_version
  after insert or update of graph on workflows
  for each row execute function workflow_version_publiee();

insert into workflow_versions (tenant_id, workflow_id, numero, graph, publiee_le)
select w.tenant_id, w.id, 1, w.graph, coalesce(w.published_at, w.updated_at, w.created_at)
from workflows w
where (case when jsonb_typeof(w.graph -> 'nodes') = 'array' then jsonb_array_length(w.graph -> 'nodes') else 0 end) > 0
on conflict (workflow_id, numero) do nothing;
