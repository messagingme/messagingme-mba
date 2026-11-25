-- 0325 : un connecteur se connecte par identifiant et mot de passe (OAuth, grant_type=password), et une requete envoie un
-- corps « formulaire » (multipart/form-data) qui peut porter une piece recue (plan
-- docs/superpowers/plans/2026-11-25-connecteur-oauth-et-piece-en-fichier.md, essai Everial).
--
-- agent_tool_sources.auth_oauth : ce qui n est PAS secret dans une connexion OAuth (adresse du jeton, client_id,
-- identifiant, scope), lisible a l ecran. Le mot de passe reste dans auth_secret_enc, chiffre comme les autres secrets.
-- Nullable sans defaut : ne reecrit pas la table.
--
-- Les deux CHECK crees EN LIGNE par 0088 et 0105 portent le nom par defaut de Postgres (<table>_<colonne>_check), a LIRE
-- en base de production avant le deploiement (pg_get_constraintdef). Retires SANS if exists : un nom faux fait echouer la
-- migration au lieu de laisser l ancien en place. Recrees sous le meme nom, sur-ensembles des anciens : toutes les lignes
-- y entrent. agent_tool_sources_auth_chk est recree aussi, elargi au mode neuf (secret ET auth_oauth exiges).
--
-- A appliquer AVANT le code (migration=avant), poussee SEULE : le code neuf lit auth_oauth dans chaque lecture d une
-- source, y compris a chaque appel de connecteur. L ancien code y survit : il ne nomme pas la colonne et n ecrit aucune
-- valeur neuve. Tables petites (quelques lignes par espace) ; au-dela de 5 s d attente du verrou, la migration echoue et
-- se rejoue (transaction).
set local lock_timeout = '5s';

alter table agent_tool_sources add column if not exists auth_oauth jsonb;

alter table agent_tool_sources drop constraint agent_tool_sources_auth_kind_check;
alter table agent_tool_sources add constraint agent_tool_sources_auth_kind_check
  check (auth_kind in ('none', 'bearer', 'header', 'oauth_password'));

alter table agent_tool_sources drop constraint agent_tool_sources_auth_chk;
alter table agent_tool_sources add constraint agent_tool_sources_auth_chk
  check ((auth_kind = 'none' and auth_secret_enc is null)
      or (auth_kind = 'bearer' and auth_secret_enc is not null)
      or (auth_kind = 'header' and auth_secret_enc is not null and auth_header_name is not null)
      or (auth_kind = 'oauth_password' and auth_secret_enc is not null and auth_oauth is not null));

alter table connector_requests drop constraint connector_requests_body_mode_check;
alter table connector_requests add constraint connector_requests_body_mode_check
  check (body_mode in ('aucun', 'json', 'champs', 'formulaire'));
