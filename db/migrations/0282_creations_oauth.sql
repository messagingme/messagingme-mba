-- 0282 : ce qu'une application connectée crée meurt avec sa révocation par un admin (lot D de l'audit, 2026-11-06).
--
-- oauth_autorisation_id : l'autorisation OAuth sous laquelle Claude, ou une autre application connectée, a créé la clé
-- d'API (outil create_api_key) ou l'adresse de webhook sortant (outil create_webhook_endpoint). Révoquer cette
-- autorisation dans la console révoque la clé et met l'adresse en pause, dans la même transaction (PgOauthStore.revoquer).
-- Les autres fins de l'autorisation (révocation par le client, jeton rejoué, fin de vie, purge) laissent vivre ce qu'elle
-- a créé : la purge remet le lien à vide (on delete set null) et la création reste une clé ou une adresse ordinaire.
-- Vide pour ce que la console, l'API publique et le relais créent, et pour les créations d'avant ce lot : rien ne dit
-- sous quelle autorisation elles sont nées, aucune reprise.
--
-- Partie AVANT le code qui l'écrit (migration=avant) : l'ancien code ignore les deux colonnes. Nullables et sans défaut,
-- leur ajout ne touche que les métadonnées, et la clé étrangère se vérifie sur une colonne vide. api_keys est lue à
-- chaque appel de /v1 et de /mcp : au-delà de 5 s d'attente d'un verrou, la migration échoue et se rejoue (idempotente).
-- Les index partiels servent la révocation et l'action de la clé étrangère quand la purge efface une autorisation. Les
-- deux tables sont petites (quelques clés et adresses par espace, bornées par l'offre) : une construction simple suffit.
set local lock_timeout = '5s';

alter table api_keys add column if not exists oauth_autorisation_id uuid references oauth_autorisations (id) on delete set null;
alter table adresses_evenements add column if not exists oauth_autorisation_id uuid references oauth_autorisations (id) on delete set null;

create index if not exists api_keys_oauth_autorisation_idx
  on api_keys (oauth_autorisation_id) where oauth_autorisation_id is not null;
create index if not exists adresses_evenements_oauth_autorisation_idx
  on adresses_evenements (oauth_autorisation_id) where oauth_autorisation_id is not null;
