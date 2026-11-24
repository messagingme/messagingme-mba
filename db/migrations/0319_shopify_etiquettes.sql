-- 0319_shopify_etiquettes.sql : les etiquettes des clients Shopify (segments Shopify enrichis, lot 6b, plan
-- docs/superpowers/plans/2026-11-24-segments-shopify-lot-6b-etiquettes.md). Les etiquettes que le marchand pose sur ses
-- clients dans Shopify, lues chez Shopify par une synchronisation qu il allume, filtrables, et JAMAIS melangees aux
-- etiquettes Messaging Me (contacts.tags) : une table a part, en lecture.
--
-- shopify_clients : le lien d un client Shopify (son identifiant numerique, legacyResourceId) a UNE fiche de l espace,
--   et d une fiche a UN client (les deux uniques). Rempli par les commandes deja notees (shopify_commandes.client_id) et
--   par la synchronisation (le telephone du client, defaultPhoneNumber, jamais une adresse). vu_le : la derniere lecture
--   du client chez Shopify (nulle : pas encore lu). Jamais un client sans fiche.
-- shopify_etiquettes : les etiquettes d une fiche a la derniere lecture de son client, remplacees en bloc a chaque lecture
--   reussie. Le texte est borne a 255 caracteres, la borne de Shopify (REST Admin 2026-10, ressource Customer, mise a
--   jour d un client : each tag can have up to 255 characters). L index (tenant_id, lower(etiquette)) sert le critere,
--   qui compare sans la casse : son expression est celle de la requete, mot pour mot.
-- shopify_fiches_cherchees : les fiches deja cherchees chez Shopify par leur telephone, pour ne les chercher qu une fois.
--   La date seule : ni le telephone, ni ce que Shopify a rendu. Un lien perdu (client supprime chez Shopify) efface la
--   marque de sa fiche, qui peut etre recherchee une fois de plus.
-- shopify_etiquettes_synchro : l etat de la synchronisation d un espace, une ligne. allumee (eteinte par defaut : seul le
--   marchand l allume), la derniere synchronisation aboutie (synchro_le ; nulle, le critere est refuse), la derniere
--   demande, la synchronisation en cours (son debut, son dernier progres, le dernier client lu), la derniere issue et son
--   message, ses comptes, et le bail du job qui la tient (bail_jusqua, jeton : pg-boss ne deduplique rien). Jamais une
--   colonne de shopify_boutiques, que chaque webhook lit.
--
-- Les trois tables de la fiche cascadent avec elle (cle etrangere vers contacts). La purge d une fiche (purgeMany, qui
-- l anonymise sans la supprimer, la cascade ne joue donc pas) et l effacement du branchement (effacerBranchement :
-- coupure d une boutique de la console, shop/redact, boutique reprise par un autre espace) les nomment.
--
-- BLOQUANTE : purgeMany et effacerBranchement nomment ces tables ; absentes, toute purge et tout effacement echouent en
-- 42P01. A appliquer SEULE, avant le code (migration=avant). Quatre tables neuves, aucune table existante modifiee ; leurs
-- cles etrangeres prennent un verrou SHARE ROW EXCLUSIVE sur tenants et contacts, lues et ecrites par le chemin chaud :
-- un lock_timeout de 5 s, en set local.
set local lock_timeout = '5s';

create table if not exists shopify_clients (
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_id text not null constraint shopify_clients_client_id_check check (client_id ~ '^[0-9]{1,19}$'),
  contact_id uuid not null constraint shopify_clients_contact_id_fkey references contacts(id) on delete cascade,
  vu_le timestamptz,
  primary key (tenant_id, client_id),
  constraint shopify_clients_contact_key unique (tenant_id, contact_id)
);

create table if not exists shopify_etiquettes (
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null constraint shopify_etiquettes_contact_id_fkey references contacts(id) on delete cascade,
  etiquette text not null constraint shopify_etiquettes_etiquette_check check (char_length(etiquette) between 1 and 255),
  vue_le timestamptz not null default now(),
  primary key (tenant_id, contact_id, etiquette)
);

create index if not exists shopify_etiquettes_etiquette on shopify_etiquettes (tenant_id, lower(etiquette));

create table if not exists shopify_fiches_cherchees (
  tenant_id uuid not null references tenants(id) on delete cascade,
  contact_id uuid not null constraint shopify_fiches_cherchees_contact_id_fkey references contacts(id) on delete cascade,
  cherchee_le timestamptz not null default now(),
  primary key (tenant_id, contact_id)
);

create table if not exists shopify_etiquettes_synchro (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  allumee boolean not null default false,
  synchro_le timestamptz,
  demandee_le timestamptz,
  en_cours_depuis timestamptz,
  maj_le timestamptz,
  curseur text constraint shopify_etiquettes_synchro_curseur_check check (curseur ~ '^[0-9]{1,19}$'),
  issue text constraint shopify_etiquettes_synchro_issue_check check (issue in ('lue', 'sans_droit', 'refusee', 'erreur')),
  issue_le timestamptz,
  message text constraint shopify_etiquettes_synchro_message_check check (char_length(message) between 1 and 500),
  clients_lus integer not null default 0 constraint shopify_etiquettes_synchro_clients_lus_check check (clients_lus >= 0),
  trouves_par_telephone integer not null default 0
    constraint shopify_etiquettes_synchro_trouves_par_telephone_check check (trouves_par_telephone >= 0),
  sans_fiche integer not null default 0 constraint shopify_etiquettes_synchro_sans_fiche_check check (sans_fiche >= 0),
  fiches_etiquetees integer not null default 0
    constraint shopify_etiquettes_synchro_fiches_etiquetees_check check (fiches_etiquetees >= 0),
  bail_jusqua timestamptz,
  jeton uuid
);
