-- 0293 : le rayon d'un scenario et d'une automation (menu Scenario, lot 1, spec
-- docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md, section 5.3).
--
--  - workflows.rayon et automations.rayon : general (le Builder et les automations Autres), shopify ou hubspot (les
--    scenarios que lance un evenement de la boutique ou de HubSpot). Cloisonnes dans les deux sens : le magasin des
--    scenarios ne liste que le rayon demande, et un lancement refuse un scenario d'un autre rayon comme un inconnu.
--  - Defaut constant : Postgres pose la valeur sans reecrire la table, et toute ligne existante est general.
--  - Les CHECK portent la liste du code (RAYONS, src/workflow/rayon.ts), tenue par tests/migration-0293.test.ts.
--
-- 🔴 ELLE AJOUTE, DONC AVANT LE UP de l'API et des deux workers : le code neuf filtre sur workflows.rayon dans chaque
-- liste de scenarios, et deploye avant elle chaque liste tomberait en 42703. L'ancien code ne lit pas ces colonnes et
-- n'ecrit jamais de rayon : la base pose general, il y survit.
--
-- ⚠️ AUCUNE REPRISE : zero ligne n'est autre que general au moment de l'appliquer.

set local lock_timeout = '5s';

alter table workflows add column if not exists rayon text not null default 'general';
alter table workflows drop constraint if exists workflows_rayon_chk;
alter table workflows add constraint workflows_rayon_chk check (rayon in ('general', 'shopify', 'hubspot'));

alter table automations add column if not exists rayon text not null default 'general';
alter table automations drop constraint if exists automations_rayon_chk;
alter table automations add constraint automations_rayon_chk check (rayon in ('general', 'shopify', 'hubspot'));
