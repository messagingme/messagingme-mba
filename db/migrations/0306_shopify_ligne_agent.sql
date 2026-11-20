-- 0306_shopify_ligne_agent.sql : la relance de panier avec agent IA, quatrieme ligne Shopify (spec
-- docs/superpowers/specs/2026-11-20-shopify-relance-agent-ia-design.md, plan du meme jour, lot 1).
--
-- shopify_lignes.evenement admet checkout_abandoned_agent : une ligne qui part sur le MEME webhook et la MEME reclamation
-- que checkout_abandoned, exclusive avec elle (tenu par le code a l allumage). L agent choisi vit dans le bloc Agent IA du
-- scenario de la ligne : aucune colonne.
--
-- Le CHECK a ete cree EN LIGNE par 0299 : son nom, shopify_lignes_evenement_check, est a LIRE en base de production
-- avant le deploiement (pg_get_constraintdef). Retire SANS if exists : un nom faux fait echouer la migration au lieu de
-- laisser l ancien en place. Recree sous le meme nom, sur-ensemble de l ancien : les lignes existantes y entrent toutes,
-- la table est petite (quelques lignes par espace branche), la verification est immediate.
--
-- A appliquer AVANT le code, et poussee SEULE : le code neuf ecrit la valeur neuve, que l ancien CHECK refuserait (23514
-- a l allumage). L ancien code y survit : il n ecrit et ne lit aucune valeur neuve. Le CHECK verrouille brievement
-- shopify_lignes : au-dela de 5 s d attente, la migration echoue et se rejoue (transaction).
set local lock_timeout = '5s';

alter table shopify_lignes drop constraint shopify_lignes_evenement_check;

alter table shopify_lignes add constraint shopify_lignes_evenement_check
  check (evenement in ('order_paid', 'order_fulfilled', 'checkout_abandoned', 'checkout_abandoned_agent'));
