-- 0277 : l'epoque des sessions d'une identite (audit du 2026-11-04).
--
-- Toute session emise AVANT cet instant est refusee par la garde, celle de la console comme celle de l'exploitation :
-- une reinitialisation ou un changement du mot de passe, et l'effacement du second facteur, la posent, a l'horloge de
-- l'API (celle qui signe le iat des sessions). null = aucune coupure, l'etat de toutes les identites existantes.
--
-- Partie AVANT le code qui l'ecrit et la lit (migration=avant) : une colonne ajoutee, nullable, sans defaut, que
-- l'ancien code ignore. Metadonnee seule, mais un ACCESS EXCLUSIVE bref sur identities, lue a chaque connexion : au-dela
-- de 5 s d'attente du verrou, la migration echoue et se rejoue (idempotente).
set local lock_timeout = '5s';

alter table identities add column if not exists sessions_depuis timestamptz;
