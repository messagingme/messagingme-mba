-- 0290_inbox_hubspot_fermetures.sql : fermer le fil dans l'Inbox HubSpot rend la main au répondeur (lot 4 de l'Inbox,
-- plan ~/mm-hubspot/docs/2026-11-11-inbox-hubspot-lot4-fermeture-plan.md, validé par Julien le 2026-11-11).
--
-- `etat_lu_le` : la dernière fois que le balayage `hubspot-inbox` a demandé au connecteur l'état du fil HubSpot de cette
-- entrée. Le balayage relit d'abord les entrées jamais lues, puis les plus anciennement lues, et chacune au plus une fois
-- par minute : un conseiller qui ferme le fil le voit rendu dans la minute, sans qu'aucune entrée ne garde la tête de la
-- liste. Une nouvelle entrée repart de NULL.
--
-- Colonne nullable sans défaut sur une table petite (une ligne par conversation entrée dans l'Inbox) : un changement de
-- catalogue seul. AVANT le code (`migration=avant`) : le balayage neuf la nomme.
set local lock_timeout = '5s';

alter table inbox_hubspot_entrees add column if not exists etat_lu_le timestamptz;
