-- 0297_parcours_evenement.sql : le parcours d evenement (menu Scenario, lot 4, plan
-- docs/superpowers/plans/2026-11-18-menu-scenario-lot-4-moteur.md ; spec decisions 21, 28 et 29).
--
-- workflow_runs.evenement : l origine et les variables d un parcours ne d un evenement (Shopify d abord), en jsonb
-- { origine, variables } ; null = parcours ordinaire, soit toutes les lignes existantes. Les variables (des liens a cle
-- d acces) s effacent a la fin du parcours, l origine reste. Lue par safeParse, jamais journalisee.
-- campaigns.parcours_evenement : le scenario et le bloc qu une campagne d envoi public porte pour faire naitre ce parcours
-- quand Meta a accepte le premier template (decision 28) ; null = aucune, soit toutes les campagnes existantes.
-- Deux colonnes plutot qu une table : la purge d un contact et la retention des parcours les emportent sans retouche.
--
-- A appliquer AVANT le code, et poussee SEULE : le code neuf nommera workflow_runs.evenement dans les lectures du chemin
-- chaud (chaque message entrant, chaque balayage) ; deploye avant cette colonne, il tomberait en 42703 a chaque entrant.
-- L ancien code y survit : il ne nomme aucune des deux colonnes.
--
-- Nullables, sans defaut : metadonnee seule, sans reecrire les tables. Deux tables chaudes : au-dela de 5 s d attente
-- d un verrou, la migration echoue et se rejoue (idempotente).
set local lock_timeout = '5s';

alter table workflow_runs add column if not exists evenement jsonb;
alter table campaigns add column if not exists parcours_evenement jsonb;
