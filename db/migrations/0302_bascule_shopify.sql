-- 0302_bascule_shopify.sql : la bascule des messages Shopify vers les lignes (menu Scenario, lot 5b, plan
-- docs/superpowers/plans/2026-11-18-menu-scenario-lot-5-shopify.md, tache 8 ; spec decision 8, pas de conversion).
--
-- Depuis le lot 5b, le circuit (reception des webhooks, relance des paniers) envoie le premier bloc du scenario de la
-- LIGNE de l evenement (shopify_lignes, 0299), jamais plus un message de shopify_messages. Les anciens messages sont
-- eteints, et les attentes de l ancien assistant (shopify_messages_attente) videes : son activation a l approbation de
-- Meta et son filet sont retires du code. Les deux tables restent, lues par get_shopify_state pour les plugins d avant
-- et par le menage differe des modeles de l assistant (traiterOubli garde un modele qu un ancien message nomme encore).
--
-- IRREVERSIBLE pour l etat actif : quels messages etaient allumes n est pas garde. La sonde du 2026-11-19 (Julien) n en
-- a trouve que dans l espace de demonstration ; aucun e-mail de bascule (decision de Julien). Les attentes videes ne se
-- recreent pas non plus : leurs modeles restent chez Meta, visibles dans l ecran Templates.
--
-- A appliquer AVANT le code (migration=avant) : l ancien code y survit (il ne trouve plus de message allume ni
-- d attente, donc n envoie et n active plus rien) ; le nouveau ne lit pas ces tables pour envoyer. Quelques lignes au
-- plus dans chaque table, lues par chaque webhook : un lock_timeout de 5 s, en set local.
set local lock_timeout = '5s';

update shopify_messages set actif = false, modifie_le = now() where actif;

delete from shopify_messages_attente;
