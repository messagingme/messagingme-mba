-- 0296_modeles_de_bloc.sql : les templates ecrits depuis un bloc du constructeur, et la publication programmee (menu
-- Scenario, lot 3, spec docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md, decisions 18, 19 et 27 ;
-- plan docs/superpowers/plans/2026-11-18-menu-scenario-lot-3-template-sur-place.md).
--
-- modeles_de_bloc : une ligne par template cree depuis un bloc (src/workflow/modeles-de-bloc.ts). Elle est la marque
-- « cree par le builder » (son nom nait cote serveur, jamais dans le corps recu) et l etat tranche par Meta, que le
-- statut des modeles (worker) et le filet (API) n ecrivent qu une fois (update ... where etat = 'en_validation').
-- Cle (espace, nom, langue) : c est ainsi que Meta designe un template dans son statut. Le filet relit les lignes encore
-- en validation, tous espaces confondus : son index porte le predicat exact de sa requete. L editeur lit les lignes d un
-- scenario, et la suppression d un scenario les efface en cascade : index (espace, scenario).
--
-- workflows.programmed_* : « Publier » pendant la validation d un template de bloc copie le brouillon ici ; seul
-- PgWorkflowStore le met en ligne, par une instruction conditionnee a programmed_at, et toute publication explicite
-- (console ou API) remet les trois colonnes a null. Nulles et sans defaut : metadonnee seule, aucune reecriture.
--
-- A appliquer AVANT le code, et poussee SEULE : le code neuf ecrit la table et les colonnes, l ancien ne les nomme pas
-- et y survit. workflows est chaude (chaque message entrant lit un scenario), et les cles etrangeres de la table neuve
-- prennent un verrou sur tenants et workflows : au-dela de 5 s d attente d un verrou, la migration echoue et se rejoue
-- (idempotente).
set local lock_timeout = '5s';

create table if not exists modeles_de_bloc (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  workflow_id  uuid not null references workflows(id) on delete cascade,
  modele       text not null check (char_length(modele) between 1 and 512),
  langue       text not null check (char_length(langue) between 1 and 20),
  etat         text not null default 'en_validation',
  raison       text,
  par          uuid,
  cree_le      timestamptz not null default now(),
  tranche_le   timestamptz,
  primary key (tenant_id, modele, langue),
  constraint modeles_de_bloc_etat_chk check (etat in ('en_validation', 'approuve', 'refuse')),
  constraint modeles_de_bloc_raison_chk check (raison is null or char_length(raison) <= 300)
);

create index if not exists modeles_de_bloc_en_validation_idx on modeles_de_bloc (cree_le) where etat = 'en_validation';
create index if not exists modeles_de_bloc_scenario_idx on modeles_de_bloc (tenant_id, workflow_id);

alter table workflows add column if not exists programmed_graph jsonb;
alter table workflows add column if not exists programmed_at timestamptz;
alter table workflows add column if not exists programmed_by uuid;
