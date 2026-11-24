-- 0322 : l'option « le plus ancien laisse sa place » du Business et de l'Entreprise (decision de Julien du 2026-11-24,
-- plan docs/superpowers/plans/2026-11-24-contacts-packs-et-remplacement.md, lot 2).
--
-- tenant_settings.contacts_remplacer_anciens : cochee par un administrateur dans Reglages, ou par l'exploitation dans la
-- fiche d'offre de /ops. Espace plein et option cochee, chaque nouveau contact compte fait purger le contact compte le plus
-- ancien en creation (PgContactStore.faireDeLaPlace). Fausse par defaut : rien ne change pour personne.
--
-- 🔴 BLOQUANTE, a appliquer AVANT le code (migration=avant) : les trois gardes de creation (verifierPlaceContacts) et la
-- porte de l'espace plein (inconnusRefuses, worker) la lisent a CHAQUE creation et a chaque entrant d'un espace limite ;
-- sans elle, toute creation echouerait en 42703. L'ancien code y survit : il ne la nomme pas, et l'insertion d'une ligne
-- de reglages la laisse a son defaut. Defaut constant : metadonnees seules, sous un verrou bref (5 s d'attente au plus).
set local lock_timeout = '5s';

alter table tenant_settings add column if not exists contacts_remplacer_anciens boolean not null default false;
