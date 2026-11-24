-- 0321 : les packs de contacts du Pro (decision de Julien du 2026-11-24, plan
-- docs/superpowers/plans/2026-11-24-contacts-packs-et-remplacement.md, lot 1).
--
-- abonnements_offre.packs_contacts : les packs payes en plus des 1 000 contacts du Pro (1 000 contacts chacun, 20 euros HT
-- par mois, 240 par an), relus chez Stripe par la route d achat et par le webhook. La limite de contacts du Pro devient
-- 1 000 plus 1 000 par pack, dans droitsDe seulement (src/offres/offres.ts).
--
-- A appliquer AVANT le up (migration=avant) : le code neuf lit la colonne a chaque lecture de l offre (PgOffresStore.offreDe)
-- et a la porte de l espace plein, donc sur les chemins chauds de la console et de la reception, et le webhook l ecrit.
-- L ancien code y survit : il ne la nomme pas, et son insertion la laisse a son defaut. Une colonne NOT NULL a defaut
-- constant ne reecrit pas la table (Postgres 11 et plus). abonnements_offre est lue par offre_de_l_espace sur les chemins
-- chauds : un lock_timeout de 5 s, en set local.
set local lock_timeout = '5s';

alter table abonnements_offre add column if not exists packs_contacts integer not null default 0;
alter table abonnements_offre drop constraint if exists abonnements_offre_packs_contacts_chk;
alter table abonnements_offre add constraint abonnements_offre_packs_contacts_chk check (packs_contacts between 0 and 1000);
