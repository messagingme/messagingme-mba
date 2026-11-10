-- 0287_inbox_hubspot_affectations.sql : le conseiller posé sur le fil HubSpot (lot 3 de l'Inbox, plan
-- ~/mm-hubspot/docs/2026-11-10-inbox-hubspot-lot3-affectation-plan.md, validé par Julien le 2026-11-10).
--
-- `affectation_poussee` : l'adresse du conseiller que le balayage `hubspot-inbox` a posée sur le fil HubSpot de cette
-- entrée, une chaîne vide pour « personne » (l'affectation retirée), NULL tant que rien n'a été poussé. Le balayage
-- pousse quand l'affecté de la conversation en diffère ; une nouvelle entrée (seconde demande d'humain) repart de NULL.
-- `affectation_tentee_le` : la dernière tentative, réussie ou non. Le balayage prend d'abord les entrées jamais tentées,
-- puis les plus anciennement tentées : une entrée dont le fil n'est pas encore connu du connecteur (rejouée à chaque tour)
-- ne garde jamais la tête de la liste devant les affectations neuves.
-- Une adresse, donc une donnée personnelle d'un MEMBRE de l'espace (pas d'un contact) : la purge d'un contact supprime
-- ses conversations, la cascade emporte leurs entrées.
--
-- Colonnes nullables sans défaut sur une table petite (une ligne par conversation entrée dans l'Inbox) : un changement de
-- catalogue seul. AVANT le code (`migration=avant`) : le balayage neuf la nomme.
set local lock_timeout = '5s';

alter table inbox_hubspot_entrees add column if not exists affectation_poussee text;
alter table inbox_hubspot_entrees add column if not exists affectation_tentee_le timestamptz;
