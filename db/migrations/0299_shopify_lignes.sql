-- 0299_shopify_lignes.sql : les lignes Shopify (menu Scenario, lot 5, plan
-- docs/superpowers/plans/2026-11-18-menu-scenario-lot-5-shopify.md ; spec decisions 8, 13, 15, 32 et 33).
--
-- shopify_lignes : une ligne par evenement et par espace (commande payee, commande expediee, panier abandonne), avec son
-- scenario du rayon shopify et son interrupteur. Elle remplace shopify_messages comme source de ce que le circuit envoie
-- (lot 5b) ; shopify_messages et shopify_messages_attente restent en lecture jusqu a un lot ulterieur (decision 8 : pas
-- de conversion). Configuration sans donnee personnelle : hors de la purge RGPD, emportee avec l espace ; le scenario
-- supprime emporte sa ligne (la route de suppression d un scenario refusera celui qu une ligne tient, lot 5b).
--
-- shopify_boutiques.pause_le : la boutique en pause (decision 15), null = active. paniers_depuis : un panier modifie
-- avant cet instant n est jamais relance (pose a la reprise et au rallumage de la ligne du panier), null = aucune borne.
--
-- ventes_attribuees.source : une ligne de retour sur investissement par automation (decision 32), commande_payee et
-- commande_expediee en plus. Le CHECK a ete cree EN LIGNE par 0261 : son nom, ventes_attribuees_source_check, a ete LU
-- en base de production le 2026-11-19 (sonde du lot 5). Retire SANS if exists : un nom faux fait echouer la migration au
-- lieu de laisser l ancien en place. Recree sous le meme nom, sur-ensemble de l ancien : les lignes existantes y entrent
-- toutes. La table compte 5 lignes (meme sonde) : la verification est immediate, sans le detour NOT VALID puis VALIDATE.
--
-- A appliquer AVANT le code, et poussee SEULE : chaque webhook Shopify lira les colonnes de shopify_boutiques ; deploye
-- avant elles, il tomberait en 42703 (500, Shopify reessaie puis desabonne). L ancien code y survit : il ne nomme rien de
-- neuf, et l ancien CHECK etait plus etroit. Les cles etrangeres verrouillent brievement tenants et workflows : au-dela de
-- 5 s d attente d un verrou, la migration echoue et se rejoue (transaction).
set local lock_timeout = '5s';

create table if not exists shopify_lignes (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  evenement   text not null check (evenement in ('order_paid', 'order_fulfilled', 'checkout_abandoned')),
  workflow_id uuid not null references workflows(id) on delete cascade,
  actif       boolean not null default false,
  modifie_par uuid,
  modifie_le  timestamptz not null default now(),
  primary key (tenant_id, evenement)
);

create index if not exists shopify_lignes_workflow_idx on shopify_lignes (workflow_id);

alter table shopify_boutiques add column if not exists pause_le timestamptz;

alter table shopify_boutiques add column if not exists paniers_depuis timestamptz;

alter table ventes_attribuees drop constraint ventes_attribuees_source_check;

alter table ventes_attribuees add constraint ventes_attribuees_source_check
  check (source in ('campagne', 'relance_panier', 'scenario', 'agent', 'agent_meta', 'commande_payee', 'commande_expediee'));
