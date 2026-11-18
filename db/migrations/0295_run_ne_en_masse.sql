-- 0295_run_ne_en_masse.sql : un parcours ne d un chemin de masse (menu Scenario, lot 2, spec
-- docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md, decision 24).
--
-- Un bloc template peut desormais sortir par « Pas de reponse apres X ». Un parcours ne d une campagne, d un workflow
-- HubSpot ou d un envoi par l API a un bloc (les types dont la politique ne publie pas les etiquettes,
-- src/workflow/lancements.ts) serait sinon reveille en meme temps pour tous ses destinataires, et chaque etiquette posee
-- sur la branche « Pas de reponse » publierait un « tag ajoute » par destinataire : autant de scenarios lances et
-- factures (invariant 8 de documentation.md). La regle se fige a la NAISSANCE du parcours, comme accord_marketing_exige
-- (0272) : le reveil (resume) n emet rien et saute en aller_a_masse tant que le contact n a pas repondu.
--
-- Defaut FAUX, constant : les parcours deja en cours au deploiement gardent exactement le comportement d avant. Aucun
-- index : la colonne se lit par la cle du parcours qu on vient de trouver, jamais dans un where.
--
-- A appliquer AVANT le code, et poussee SEULE : le code neuf l ecrira dans l insert de start et la lira dans les
-- reclamations du balayage (chemin chaud). L ancien code y survit : il ne la nomme pas, et le defaut remplit ses
-- inserts. Ajout avec defaut constant : metadonnee seule (PG 11+), sans reecrire la table. workflow_runs est chaude
-- (chaque message entrant, chaque balayage) : au-dela de 5 s d attente d un verrou, la migration echoue et se rejoue
-- (idempotente).
set local lock_timeout = '5s';

alter table workflow_runs add column if not exists ne_en_masse boolean not null default false;
