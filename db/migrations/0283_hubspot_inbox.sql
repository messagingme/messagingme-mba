-- 0283_hubspot_inbox.sql : les conversations WhatsApp dans l'Inbox HubSpot (lot 1 de l'Inbox, tâche 6 du plan
-- ~/mm-hubspot/docs/2026-11-06-inbox-hubspot-lot1-plan.md).
--
-- `hubspot_inbox_boite` : la boîte de réception HubSpot où l'espace a branché sa ligne WhatsApp (null = non branché).
-- Le compte de canal lui-même vit chez le connecteur (`inbox_comptes`), qui est seul à parler à HubSpot.
-- `hubspot_inbox_curseur_le` et `hubspot_inbox_curseur_id` : le dernier message poussé au connecteur, dans l'ordre
-- (created_at, id) du balayage `hubspot-inbox`. Posé à l'instant du branchement : aucun historique n'est publié.
--
-- Colonnes nullables sans défaut : aucune réécriture de `tenant_settings`, aucun verrou long. Posée AVANT le code
-- (`migration=avant`) : l'ancien code lit `tenant_settings` en `select *` et ignore ces colonnes.
alter table tenant_settings add column if not exists hubspot_inbox_boite text;
alter table tenant_settings add column if not exists hubspot_inbox_curseur_le timestamptz;
alter table tenant_settings add column if not exists hubspot_inbox_curseur_id uuid;

-- Le balayage ne lit que les espaces branchés.
create index if not exists tenant_settings_hubspot_inbox_idx on tenant_settings (tenant_id) where hubspot_inbox_boite is not null;
