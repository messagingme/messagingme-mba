-- 0309_contacts_nee_de.sql : la fiche nee d un envoi Shopify (segments Shopify enrichis, lot 2a, plan
-- docs/superpowers/plans/2026-11-23-segments-shopify-lot-2-numeros.md).
--
-- contacts.nee_de : posee une seule fois, juste apres que l envoi public d un message Shopify (confirmation de commande,
--   avis d expedition, relance de panier) a INSERE la fiche, et jamais mise a jour. Le premier accuse 131026 ne supprime
--   que ces fiches, et seulement si elles n ont jamais ecrit (decision de Julien du 2026-11-23). null : toute autre
--   origine, dont toutes les fiches deja la, qu aucun lot ne marque apres coup. La source du consentement
--   (opt_in_source = shopify:<domaine>) ne suffit pas : elle est aussi ecrite sur une fiche deja la restee unknown.
--
-- NON BLOQUANTE : le code neuf la pose par une ecriture a part, au mieux (une panne est journalisee, la fiche reste
-- sans marque, donc gardee), et le job qui la lit echoue sans rien supprimer tant qu elle manque. L ancien code ne la
-- nomme pas. A appliquer avant le code (migration=avant), dans le meme deploiement.
--
-- Nullable, sans defaut : metadonnee seule. Le CHECK fait parcourir contacts sous son verrou exclusif (colonne neuve,
-- toute nulle : court, comme les CHECK de 0196 sur la meme table) ; au-dela de 5 s d attente du verrou, la migration
-- echoue et se rejoue (transaction).
set local lock_timeout = '5s';

alter table contacts add column if not exists nee_de text
  constraint contacts_nee_de_check check (nee_de in ('shopify'));
