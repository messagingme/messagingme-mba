-- 0324 : la limite de contacts du Business se regle dans /ops (decision de Julien du 2026-11-25, plan
-- docs/superpowers/plans/2026-11-24-contacts-packs-et-remplacement.md, lot 3).
--
-- tenants.business_contacts : null = les 5 000 de la grille, sinon un entier positif. Lue par droitsDe sous le Business
-- (PgOffresStore.offreDe) et par la porte de l espace plein (PgContactStore.inconnusRefuses), ecrite par la fiche d offre
-- de /ops.
--
-- A appliquer AVANT le up (migration=avant) : le code neuf la lit a chaque lecture de l offre et a la reception, donc sur
-- les chemins chauds. L ancien code y survit : il ne la nomme pas. Une colonne nullable sans defaut ne reecrit pas la table.
-- La table tenants est lue a chaque requete (l offre, l authentification) : au-dela de 5 s d attente du verrou, la
-- migration echoue et se rejoue (tout est idempotent).
set local lock_timeout = '5s';

alter table tenants add column if not exists business_contacts integer;
alter table tenants drop constraint if exists tenants_business_contacts_chk;
alter table tenants add constraint tenants_business_contacts_chk check (business_contacts is null or business_contacts > 0);
