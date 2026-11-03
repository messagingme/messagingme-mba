-- 0276 : l'option du Credit WhatsApp, 30 euros HT par numero et par mois (lot 4a du plan
-- docs/superpowers/plans/2026-11-03-credit-whatsapp-lot-4.md, decisions de Julien du 2026-11-03).
--
-- - options_credit_whatsapp : l'abonnement Stripe de l'option d'un espace, ecrit par le seul webhook signe, sur le
--   modele d'abonnements_offre. places est la quantite que Stripe a RELUE payee (une place ajoutee dont la facture
--   echoue ne compte pas). Vivante tant que Stripe n'en a pas annonce la fin, relances d'un impaye comprises : une
--   option en retard garde ses places (decision de la spec, les envois s'arretent quand Stripe abandonne).
-- - lignes_credit_whatsapp_un_compte_uidx : une seule ligne en cours par compte WhatsApp, tenue par la base et plus
--   seulement par la route de /ops (jaune 3 de la relecture des jaunes du 2026-11-03) : Meta attache la ligne au compte,
--   deux lignes en cours sur un compte compteraient ses numeros deux fois. Mesure avant (2026-11-03) : une seule ligne
--   en cours en production, aucun compte en double.
--
-- A appliquer AVANT le code : le code neuf lit la table (la garde compte les places d'une ligne 'option'). L'ancien
-- code y survit : il ignore la table, et la route de /ops refuse deja une seconde ligne sur un compte couvert avant
-- d'ecrire (une course entre deux copies rendrait un 500 au lieu d'un 409, sans rien ecrire).
set local lock_timeout = '5s';

create table if not exists options_credit_whatsapp (
  stripe_subscription_id text primary key,
  tenant_id              uuid not null references tenants (id) on delete cascade,
  livemode               boolean not null,
  statut                 text not null default 'actif',
  places                 integer not null,
  periode_fin            timestamptz,
  -- La fin programmee dans le portail de Stripe (cancel_at_period_end), dite au client ; null : aucune.
  fin_prevue_le          timestamptz,
  fini_le                timestamptz,
  fin_raison             text,
  cree_le                timestamptz not null default now(),
  maj_le                 timestamptz not null default now(),
  constraint options_credit_whatsapp_id_chk check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  constraint options_credit_whatsapp_statut_chk check (statut in ('actif', 'en_retard', 'resilie')),
  constraint options_credit_whatsapp_places_chk check (places between 1 and 20),
  constraint options_credit_whatsapp_fin_raison_chk
    check (fin_raison is null or (fin_raison in ('resiliation', 'impaye', 'fin_de_droit') and fini_le is not null))
);

create unique index if not exists options_credit_whatsapp_une_vivante_par_espace
  on options_credit_whatsapp (tenant_id) where fini_le is null;

create unique index if not exists lignes_credit_whatsapp_un_compte_uidx
  on lignes_credit_whatsapp (waba_id) where retiree_le is null and waba_id is not null;
