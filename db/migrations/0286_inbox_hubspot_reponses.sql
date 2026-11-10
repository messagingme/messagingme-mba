-- 0286_inbox_hubspot_reponses.sql : une réponse tapée dans l'Inbox HubSpot ne se republie pas dans son fil (lot 2 de
-- l'Inbox, plan ~/mm-hubspot/docs/2026-11-09-inbox-hubspot-lot2-retour-plan.md, validé par Julien le 2026-11-09).
--
-- `hubspot_inbox_message_id` : l'identifiant HubSpot du message quand la réponse vient de l'Inbox HubSpot. HubSpot l'a
-- déjà dans le fil ; le balayage `hubspot-inbox` saute les messages qui le portent, sinon la réponse s'afficherait deux
-- fois. Posée après l'envoi, par la route de réponse (`/hubspot/conversation/repondre`, `source: 'inbox'`).
--
-- Colonne nullable sans défaut sur une table chaude : un changement de catalogue seul, sans réécriture ; le verrou
-- ACCESS EXCLUSIVE est bref, d'où `lock_timeout`. AVANT le code (`migration=avant`) : le balayage neuf la nomme.
set local lock_timeout = '5s';

alter table conversation_messages add column if not exists hubspot_inbox_message_id text;
