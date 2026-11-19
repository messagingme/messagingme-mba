-- 0303_accueil_console.sql : la fenetre de bienvenue d'un nouveau membre dans la console (plan
-- docs/superpowers/plans/2026-11-19-accueil-pro.md, tache 1).
--
-- users.accueil_choisi_le : le moment ou la personne a fait un choix dans la fenetre (le tour, un raccourci, « Ne plus
-- afficher »). NULL = la fenetre est encore a montrer. Par COMPTE d'un espace (users), pas par identite : un membre
-- invite dans un second espace la voit dans celui-ci.
--
-- Decision de Julien (2026-11-19) : seuls les NOUVEAUX la voient. Tout compte qui existe au moment de la migration est
-- donc marque ici, SAUF une invitation encore en attente (0281) : c'est un nouveau membre qui ne s'est jamais connecte,
-- il verra la fenetre a sa premiere connexion. Un compte cree ensuite nait NULL (aucun defaut).
--
-- A appliquer AVANT le code (migration=avant) : le code neuf lit et ecrit la colonne ; l'ancien l'ignore et survit.
-- users est lue a chaque connexion : un lock_timeout de 5 s, en set local. La table compte quelques centaines de lignes.
set local lock_timeout = '5s';

alter table users add column if not exists accueil_choisi_le timestamptz;

update users set accueil_choisi_le = now() where accueil_choisi_le is null and not invitation_en_attente;
