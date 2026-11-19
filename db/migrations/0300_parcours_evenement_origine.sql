-- migrate: no-transaction
-- 0300_parcours_evenement_origine.sql : retrouver les parcours d evenement d un contact, TOUS STATUTS (menu Scenario,
-- lot 5, plan docs/superpowers/plans/2026-11-18-menu-scenario-lot-5-shopify.md, tache 2).
--
-- La naissance d un parcours d evenement devient idempotente par origine (la relance automatique d un envoi redemandait
-- la naissance, relecture de 4b) : avant de naitre, le magasin cherche un parcours de la meme origine pour ce contact,
-- quel que soit son statut. L index 0298 ne couvre que les parcours actifs ; celui-ci couvre tous les parcours
-- d evenement, et seulement eux (les parcours ordinaires, evenement null, n y entrent pas). Son predicat est un contrat
-- avec cette requete, qui l ecrit mot pour mot : evenement is not null.
--
-- Poussee avec 0299, dans le meme deploiement (migration=avant), AVANT le code qui la lit (lot 5a) : sans elle, la
-- requete parcourrait workflow_runs. Aucune ligne n a encore evenement non nul (sonde du 2026-11-19) : la construction est
-- instantanee.
--
-- HORS TRANSACTION (CREATE INDEX CONCURRENTLY) : aucun verrou d ecriture sur workflow_runs, chemin chaud des messages
-- entrants. Aucun filet : un echec a mi-parcours laisse un index invalide, et if not exists le SAUTE au rejeu au lieu de
-- le reparer. La verification apres deploiement n est donc pas facultative :
--   select indisvalid from pg_index where indexrelid = 'workflow_runs_evenement_idx'::regclass;
-- false : drop index concurrently workflow_runs_evenement_idx; puis rejouer.
create index concurrently if not exists workflow_runs_evenement_idx
  on workflow_runs (tenant_id, wa_id)
  where evenement is not null;
