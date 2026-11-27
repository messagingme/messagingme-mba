-- 0331 : un systeme connecte (connecteur HTTP) peut se declarer SANS sa cle tant qu il n est pas actif (lot 1 du CSM
-- virtuel, B10, livraison 4a). Claude, qui ne voit jamais une cle, le declare en brouillon ; la personne colle la cle sur
-- la page Connecteurs de la console, puis l active. Un systeme ACTIF garde l exigence : la base la tient, en plus du code
-- (src/agent/source-configuration.ts, la cle exigee sur le statut effectif apres ecriture).
--
-- agent_tool_sources_auth_chk (nom pose par 0088, recree par 0325) est recree sous le meme nom, sur-ensemble de l ancien :
-- toutes les lignes y entrent. La structure reste exigee quel que soit le statut (le nom de l en-tete, la configuration
-- OAuth). Retire SANS if exists : un nom faux fait echouer la migration au lieu de laisser l ancienne en place.
--
-- A appliquer AVANT le code (migration=avant) : le code neuf peut inserer un brouillon sans cle. L ancien code y survit :
-- il n ecrit jamais de ligne sans cle, et refuse toujours d activer un systeme sans elle. Table petite (quelques lignes par
-- espace) ; au-dela de 5 s d attente du verrou, la migration echoue et se rejoue (transaction).
--
-- Retour arriere : recreer l ancienne contrainte echoue tant qu un systeme sans cle existe (un brouillon declare depuis
-- Claude) ; completer ou supprimer ces brouillons d abord
-- (select id from agent_tool_sources where auth_kind <> 'none' and auth_secret_enc is null).
set local lock_timeout = '5s';

alter table agent_tool_sources drop constraint agent_tool_sources_auth_chk;
alter table agent_tool_sources add constraint agent_tool_sources_auth_chk
  check ((auth_kind = 'none' and auth_secret_enc is null)
      or (auth_kind = 'bearer' and (auth_secret_enc is not null or status <> 'active'))
      or (auth_kind = 'header' and auth_header_name is not null and (auth_secret_enc is not null or status <> 'active'))
      or (auth_kind = 'oauth_password' and auth_oauth is not null and (auth_secret_enc is not null or status <> 'active')));
