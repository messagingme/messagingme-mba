-- 0305_shopify_attestations.sql : l attestation du consentement des clients d une boutique Shopify (Julien, 2026-11-20,
-- plan docs/superpowers/plans/2026-11-20-shopify-attestation-consentement.md).
--
-- Le marchand coche « J atteste que les clients de ma boutique ont accepte de recevoir de ma part des messages WhatsApp
-- (confirmation et suivi de commande, relance de panier), et j en assume la responsabilite. » : sans elle, aucune
-- automation Shopify ne s allume. HISTORISEE : chaque geste (cocher, decocher) ajoute une ligne, aucune ne se modifie ni
-- ne s efface tant que l espace existe. L etat en vigueur est la DERNIERE ligne de l espace.
--   coche     vrai = attestee, faux = retiree
--   texte     la phrase attestee, mot pour mot (une autre version du texte se distingue a la lecture)
--   domaine   la boutique au moment du geste
--   par       l utilisateur (users.id), sans cle etrangere : la trace survit au compte
--   email     son adresse au moment du geste ; null pour Claude Code sans session nominative
--   origine   console ou claude_code
-- Toutes posees par le SERVEUR depuis la session, jamais lues du corps (sauf `coche`).
--
-- A appliquer AVANT le code : le code neuf la lit a chaque allumage. Une table neuve, vide : aucun verrou sur une table
-- chaude. L ancien code ne la nomme pas.
set local lock_timeout = '5s';

create table if not exists shopify_attestations (
  id        bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  domaine   text not null,
  coche     boolean not null,
  texte     text not null check (char_length(texte) between 1 and 1000),
  par       uuid,
  email     text,
  origine   text not null check (origine in ('console', 'claude_code')),
  le        timestamptz not null default now()
);

create index if not exists shopify_attestations_espace_idx on shopify_attestations (tenant_id, le desc, id desc);
