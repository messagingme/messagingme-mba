-- 0310_shopify_joignabilite.sql : la joignabilite WhatsApp des commandes Shopify (segments Shopify enrichis, lot 2b, plan
-- docs/superpowers/plans/2026-11-23-segments-shopify-lot-2-numeros.md). La carte du Performance Lab lit ces deux tables.
--
-- shopify_joignabilite : une ligne par commande, SANS telephone, nom ni adresse. classement, pose a orders/paid (aucun des
--   quatre candidats n a de texte : sans_numero ; du texte sans E.164 mobile : invalide ; sinon utilisable) ; test, le
--   drapeau de Shopify ; expediee_le, le premier fulfillments/create (une commande en deux colis compte une fois).
--   classement est null tant que le paiement n a pas ete vu : une commande payee avant ce lot (ou avant le branchement)
--   nait a son expedition sans classement, et la carte ne la compte pas (sa confirmation, partie sans lien vers elle,
--   l aurait rangee en attente) ; une commande payee a la livraison entre a son orders/paid.
-- shopify_envois : la campagne d un message Shopify (confirmation, avis d expedition) vers sa commande, pour lire ses
--   accuses (campaign_recipients) au moment de la carte, sans rien ecrire dans le traitement des accuses.
--
-- Effacees avec le branchement de la boutique (shop/redact, la desinstallation d une boutique de la console, la reprise
-- par un autre espace), derriere un point de reprise dans sa transaction, et par customers/redact qui cite la commande,
-- au mieux. Le simple Couper les garde, comme les commandes. Une ligne jamais expediee ou jamais vue payee part au bout
-- de 60 jours, toute ligne 400 jours apres son expedition, une campagne reliee avec sa commande.
--
-- NON BLOQUANTE : le code neuf ecrit et efface ces tables au mieux (une panne, une table absente, est journalisee, rien ne
-- s arrete) ; la carte lit une route neuve que la console tolere absente. L ancien code ne les nomme pas. A appliquer
-- avant le code (migration=avant), dans le meme deploiement. Tables neuves : aucun verrou sur une table existante, sauf
-- les cles etrangeres vers tenants et campaigns (verrou bref, 5 s au plus d attente).
set local lock_timeout = '5s';

create table if not exists shopify_joignabilite (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  commande_id text not null,
  classement  text constraint shopify_joignabilite_classement_check
                check (classement in ('sans_numero', 'invalide', 'utilisable')),
  test        boolean not null default false,
  expediee_le timestamptz,
  cree_le     timestamptz not null default now(),
  primary key (tenant_id, commande_id)
);
create index if not exists shopify_joignabilite_expediee on shopify_joignabilite (tenant_id, expediee_le);

create table if not exists shopify_envois (
  campaign_id uuid primary key references campaigns(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  commande_id text not null,
  cree_le     timestamptz not null default now()
);
create index if not exists shopify_envois_commande on shopify_envois (tenant_id, commande_id);
