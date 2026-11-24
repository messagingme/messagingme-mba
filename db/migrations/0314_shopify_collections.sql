-- 0314_shopify_collections.sql : les collections des produits achetes (segments Shopify enrichis, lot 6a, plan
-- docs/superpowers/plans/2026-11-24-segments-shopify-lot-6a-collections.md). Le critere « a achete dans la collection »
-- les lit telles qu elles sont dans la boutique a la derniere lecture : l API de Shopify ne rend pas l appartenance passee.
--
-- shopify_produits : un produit vu dans les lignes des commandes payees de l espace (hors cartes cadeaux), son titre lu
--   chez Shopify, la date de la derniere lecture de ses collections (nulle : jamais lu) et collections_incompletes (plus
--   de 50 collections : les 50 premieres sont gardees, la liste ne pretend pas etre complete). Une ligne meme sans
--   collection, pour ne pas relire sans fin. bail_jusqua et jeton : la reservation d un lot par le job (for update skip
--   locked, pg-boss ne deduplique rien) ; un worker mort laisse expirer son bail, un porteur perime n ecrit plus rien.
-- shopify_produit_collections : les collections d un produit a sa derniere lecture, remplacees en bloc a chaque lecture
--   reussie ; cle etrangere vers le produit, en cascade. L index (tenant_id, collection_id) sert le critere.
-- shopify_collections_lecture : l etat de la lecture d un espace, une ligne : la derniere lecture aboutie (lue_le ; nulle,
--   le critere est refuse), la derniere demande (demandee_le), la derniere issue et son message (droit read_products
--   absent, refus de Shopify, panne). Jamais une colonne de shopify_boutiques, que chaque webhook lit.
-- Identifiants en texte numerique, comme produit_id des lignes : le GID se reconstruit pour l appel. Aucune donnee de
-- personne : des produits et des collections du catalogue.
--
-- BLOQUANTE : effacerBranchement (app desinstallee d une boutique de la console, shop/redact, boutique reprise par un
-- autre espace) nomme ces tables ; absentes, l effacement entier echoue. A appliquer SEULE, avant le code
-- (migration=avant). Trois tables neuves, aucune table existante modifiee.
set local lock_timeout = '5s';

create table if not exists shopify_produits (
  tenant_id uuid not null references tenants(id) on delete cascade,
  produit_id text not null constraint shopify_produits_produit_id_check check (produit_id ~ '^[0-9]{1,19}$'),
  titre text constraint shopify_produits_titre_check check (char_length(titre) between 1 and 200),
  collections_lues_le timestamptz,
  collections_incompletes boolean not null default false,
  bail_jusqua timestamptz,
  jeton uuid,
  primary key (tenant_id, produit_id)
);

create table if not exists shopify_produit_collections (
  tenant_id uuid not null,
  produit_id text not null,
  collection_id text not null constraint shopify_produit_collections_collection_id_check check (collection_id ~ '^[0-9]{1,19}$'),
  titre text constraint shopify_produit_collections_titre_check check (char_length(titre) between 1 and 200),
  primary key (tenant_id, produit_id, collection_id),
  constraint shopify_produit_collections_produit_fkey foreign key (tenant_id, produit_id)
    references shopify_produits (tenant_id, produit_id) on delete cascade
);

create index if not exists shopify_produit_collections_collection on shopify_produit_collections (tenant_id, collection_id);

create table if not exists shopify_collections_lecture (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  lue_le timestamptz,
  demandee_le timestamptz,
  issue text constraint shopify_collections_lecture_issue_check check (issue in ('lue', 'sans_droit', 'refusee', 'erreur')),
  issue_le timestamptz,
  message text constraint shopify_collections_lecture_message_check check (char_length(message) between 1 and 500)
);
