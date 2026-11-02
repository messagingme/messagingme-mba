-- 0267 : la marque d'origine d'un scenario (spec docs/superpowers/specs/2026-11-02-scenarios-api-design.md, plan
-- docs/superpowers/plans/2026-11-02-scenarios-api.md, tache 1).
--
-- L'API publique et le MCP creent des scenarios (/v1/scenarios, create_scenario). Ils ne remplacent et ne suppriment
-- que ceux qu'ils ont crees : un scenario dessine dans la console porte souvent des blocs que l'API ne sait pas decrire,
-- et le reecrire les effacerait. La colonne le dit ; elle est posee a la creation et ne change jamais.
--
-- A appliquer AVANT le code : le code neuf l'ecrit. L'ancien code y survit : il ne la nomme pas, et elle a un defaut
-- constant (ajoutee sans reecrire la table). Chaque scenario existant devient 'console'.
set local lock_timeout = '5s';

alter table workflows add column if not exists origine text not null default 'console'
  constraint workflows_origine_chk check (origine in ('console', 'api'));
