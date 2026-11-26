-- 0329 : les packs de contacts du Business, 1 000 contacts et 20 euros HT par mois chacun (lot B du plan
-- docs/superpowers/plans/2026-11-26-contacts-packs-business-et-alertes-entreprise.md, decisions de Julien du 2026-11-26).
--
-- packs_contacts_business : l'abonnement Stripe a part des packs d'un espace en Business (le Business, pose dans /ops et
-- facture hors Stripe, n'a pas d'abonnement a lui), ecrit par le webhook signe et par la route des packs apres Stripe, sur
-- le modele d'options_credit_whatsapp (0276). packs est la quantite que Stripe a RELUE payee (un ajout dont la facture
-- echoue ne compte pas). Vivant tant que Stripe n'en a pas annonce la fin, relances d'un impaye comprises ; une seule
-- vivante par espace. Lue par droitsDe sous le Business (PgOffresStore.offreDe) et par la porte de l espace plein
-- (PgContactStore.inconnusRefuses), qui ajoutent 1 000 contacts par pack a la limite.
--
-- BLOQUANTE, a appliquer SEULE et AVANT le code (migration=avant) : le code neuf la nomme a chaque lecture de l offre et a
-- la reception des messages (la porte de l espace plein), deux chemins chauds ; absente, ils echoueraient en 42P01.
-- L ancien code y survit : il ne la nomme pas. Sa cle etrangere prend un verrou SHARE ROW EXCLUSIVE sur tenants, lue et
-- ecrite par le chemin chaud : un lock_timeout de 5 s, en set local (au-dela, la migration echoue et se rejoue, tout est
-- idempotent).
set local lock_timeout = '5s';

create table if not exists packs_contacts_business (
  stripe_subscription_id text primary key,
  tenant_id              uuid not null references tenants (id) on delete cascade,
  livemode               boolean not null,
  statut                 text not null default 'actif',
  packs                  integer not null,
  periode_fin            timestamptz,
  fini_le                timestamptz,
  fin_raison             text,
  cree_le                timestamptz not null default now(),
  maj_le                 timestamptz not null default now(),
  constraint packs_contacts_business_id_chk check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  constraint packs_contacts_business_statut_chk check (statut in ('actif', 'en_retard', 'resilie')),
  constraint packs_contacts_business_packs_chk check (packs between 1 and 1000),
  constraint packs_contacts_business_fin_raison_chk
    check (fin_raison is null or (fin_raison in ('resiliation', 'impaye', 'fin_de_droit') and fini_le is not null))
);

create unique index if not exists packs_contacts_business_un_vivant_par_espace
  on packs_contacts_business (tenant_id) where fini_le is null;
