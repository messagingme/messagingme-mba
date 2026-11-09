-- 0284_inbox_hubspot_entrees.sql : les conversations qui sont dans l'Inbox HubSpot (lot 1 bis du plan
-- ~/mm-hubspot/docs/2026-11-09-inbox-hubspot-lot1bis-humain-plan.md, validé par Julien le 2026-11-09).
--
-- Seules les conversations qui attendent un humain (le prédicat de la page « Messaging Me », `ATTEND_UN_HUMAIN_SQL`)
-- entrent dans l'Inbox. Une ligne par entrée : `entree_le` quand la conversation y est entrée (son contexte publié),
-- `sortie_le` quand elle en est sortie (rendue à un robot, « Traité », archivée). Une seule entrée OUVERTE par
-- conversation (index unique partiel) ; une seconde demande d'humain ouvre une nouvelle ligne.
--
-- Aucune donnée personnelle : des identifiants et des dates. La purge d'un contact supprime ses conversations, la
-- cascade emporte leurs entrées (la purge n'a pas à nommer cette table).
--
-- Table neuve et colonne nullable, aucun code existant ne les lit : posée AVANT le code (`migration=avant`) sans verrou sur une table chaude
-- (les clés étrangères visent `tenants` et `conversations`, posées sur une table vide).
set local lock_timeout = '5s';

-- L'instant du branchement : seules les conversations actives DEPUIS entrent (décision 4, aucun rattrapage). Nullable,
-- sans défaut : aucune réécriture de `tenant_settings` ; un espace branché avant ce lot (null) n'a pas de borne.
alter table tenant_settings add column if not exists hubspot_inbox_branche_le timestamptz;
-- Un espace branché avant ce lot n'a pas d'arriéré non plus : son branchement est daté de l'application de la migration.
update tenant_settings set hubspot_inbox_branche_le = now()
 where hubspot_inbox_boite is not null and hubspot_inbox_branche_le is null;

create table if not exists inbox_hubspot_entrees (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  conversation_id  uuid not null references conversations(id) on delete cascade,
  entree_le        timestamptz not null default now(),
  sortie_le        timestamptz
);

-- Une seule entrée ouverte par conversation : l'inscription concurrente de deux copies du balayage ne double rien.
create unique index if not exists inbox_hubspot_entrees_ouverte_uidx
  on inbox_hubspot_entrees (conversation_id) where sortie_le is null;

-- Le balayage lit les entrées ouvertes d'un espace.
create index if not exists inbox_hubspot_entrees_espace_idx
  on inbox_hubspot_entrees (tenant_id) where sortie_le is null;
