-- 0327_shopify_segments.sql : les segments natifs Shopify (segments Shopify enrichis, lot 6c, plan
-- docs/superpowers/plans/2026-11-25-segments-shopify-lot-6c-segments.md). Les segments que le marchand a construits DANS
-- Shopify, lus par la synchronisation des etiquettes (le meme interrupteur, le meme job), dont il suit 20 au plus ; leurs
-- membres, rattaches aux fiches par les liens client-fiche (shopify_clients), filtrables. Jamais melanges aux etiquettes.
--
-- shopify_segments : les segments lus a la derniere lecture de la liste. La requete ShopifyQL est gardee pour
--   l'affichage, jamais reevaluee. suivi : choisi par le marchand (20 au plus, regle du code). absent_le : disparu chez
--   Shopify a la derniere lecture de la liste (ses membres partent, son nom reste pour le refus du critere). lu_le : la
--   derniere lecture COMPLETE de ses membres (nulle : le critere est refuse). partiel : la derniere lecture n'a pas abouti
--   (les membres d'avant restent). membres, fiches : les comptes de la derniere lecture complete. La lecture en cours :
--   lecture_debut (les appartenances plus anciennes partent a sa fin), curseur (la page suivante), requete (l'identifiant
--   d'une requete asynchrone de Shopify), lecture_membres (les membres comptes jusque-la).
-- shopify_segment_membres : les fiches de chaque segment, ecrites page par page (vu_le), remplacees a la fin d'une lecture
--   complete. Aucune liste brute des membres : un membre sans fiche n'est pas garde.
--
-- Les appartenances cascadent avec la fiche et avec le segment. BLOQUANTE : purgeMany (qui anonymise sans supprimer, la
-- cascade ne joue donc pas) et effacerBranchement nomment ces tables ; absentes, toute purge et tout effacement echouent en
-- 42P01. A appliquer SEULE, avant le code (migration=avant). Deux tables neuves ; leurs cles etrangeres prennent un verrou
-- SHARE ROW EXCLUSIVE sur tenants et contacts, lues et ecrites par le chemin chaud : un lock_timeout de 5 s, en set local.
set local lock_timeout = '5s';

create table if not exists shopify_segments (
  tenant_id uuid not null references tenants(id) on delete cascade,
  segment_id text not null constraint shopify_segments_segment_id_check check (segment_id ~ '^[0-9]{1,19}$'),
  nom text not null constraint shopify_segments_nom_check check (char_length(nom) between 1 and 255),
  requete text constraint shopify_segments_requete_check check (char_length(requete) <= 5000),
  suivi boolean not null default false,
  vu_le timestamptz not null default now(),
  absent_le timestamptz,
  lu_le timestamptz,
  partiel boolean not null default false,
  membres integer not null default 0 constraint shopify_segments_membres_check check (membres >= 0),
  fiches integer not null default 0 constraint shopify_segments_fiches_check check (fiches >= 0),
  lecture_debut timestamptz,
  curseur text constraint shopify_segments_curseur_check check (char_length(curseur) between 1 and 2000),
  requete_asynchrone text constraint shopify_segments_requete_asynchrone_check check (char_length(requete_asynchrone) between 1 and 500),
  lecture_membres integer not null default 0 constraint shopify_segments_lecture_membres_check check (lecture_membres >= 0),
  primary key (tenant_id, segment_id)
);

create table if not exists shopify_segment_membres (
  tenant_id uuid not null,
  segment_id text not null,
  contact_id uuid not null constraint shopify_segment_membres_contact_id_fkey references contacts(id) on delete cascade,
  vu_le timestamptz not null default now(),
  primary key (tenant_id, segment_id, contact_id),
  constraint shopify_segment_membres_segment_fkey foreign key (tenant_id, segment_id)
    references shopify_segments (tenant_id, segment_id) on delete cascade
);

create index if not exists shopify_segment_membres_contact on shopify_segment_membres (contact_id);
