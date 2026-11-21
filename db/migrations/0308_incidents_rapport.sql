-- 0308_incidents_rapport.sql : le rapport de la tache cloud sur un incident (Julien, 2026-11-21, plan
-- docs/superpowers/plans/2026-11-21-incidents-sante.md, lot 3).
--
-- La tache cloud analyse l incident et renvoie son rapport a notre API (`POST /internes/incidents/:id/rapport`) ;
-- c est notre serveur qui l envoie sur Telegram, avec les boutons de decision. Le jeton du bot ne quitte jamais le
-- serveur.
--   categorie   la typologie (capacite_worker, rafale_metier, voisin_bruyant, base, dependance_externe, plomberie,
--               plateforme, faux_positif)
--   rapport     le resume du rapport, tel que Telegram l affiche
--   action      l action proposee, pour l issue 2
--   fichier     le chemin du rapport complet dans le depot prive messagingme-incidents
--   rapport_le  l heure du rapport
--
-- A appliquer AVANT le code : la route neuve y ecrit. Des colonnes nullables sans defaut sur une table neuve et petite :
-- aucune reecriture, aucun verrou long. L ancien code ne les nomme pas.
set local lock_timeout = '5s';

alter table incidents
  add column if not exists categorie text check (categorie in (
    'capacite_worker', 'rafale_metier', 'voisin_bruyant', 'base', 'dependance_externe', 'plomberie', 'plateforme', 'faux_positif'
  )),
  add column if not exists rapport text check (char_length(rapport) between 1 and 1500),
  add column if not exists action text check (char_length(action) between 1 and 1000),
  add column if not exists fichier text check (char_length(fichier) between 1 and 200),
  add column if not exists rapport_le timestamptz;
