-- migrate: no-transaction
-- 0298_parcours_evenement_unique.sql : un seul parcours d evenement ACTIF par contact, garanti par la base (menu
-- Scenario, lot 4, spec decision 21).
--
-- Deux evenements du meme contact peuvent se jouer en parallele (deux campagnes, un evenement et un demarrage ne d un
-- message entrant, plusieurs processus du worker) : cet index est la SEULE garantie. Le code (start du magasin des
-- parcours) traduit son 23505 en refus type, jamais en echec de campagne. Son predicat est un contrat avec la requete
-- parcoursDEvenementActif du meme magasin, qui le reprend mot pour mot.
--
-- Aucune ligne n a encore evenement non nul (0297 vient de poser la colonne) : la construction est courte et ne peut pas
-- echouer sur un doublon. Elle part dans le meme deploiement que 0297 (migration=avant), apres elle.
--
-- HORS TRANSACTION (CREATE INDEX CONCURRENTLY) : aucun verrou d ecriture sur workflow_runs, chemin chaud des messages
-- entrants. Aucun filet : un echec a mi-parcours laisse un index invalide, et if not exists le SAUTE au rejeu au lieu de
-- le reparer. La verification apres deploiement n est donc pas facultative :
--   select indisvalid from pg_index where indexrelid = 'workflow_runs_evenement_actif_uniq'::regclass;
-- false : drop index concurrently workflow_runs_evenement_actif_uniq; puis rejouer.
create unique index concurrently if not exists workflow_runs_evenement_actif_uniq
  on workflow_runs (tenant_id, wa_id)
  where evenement is not null and status in ('waiting', 'sleeping');
