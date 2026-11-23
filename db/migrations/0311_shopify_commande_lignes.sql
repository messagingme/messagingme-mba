-- 0311_shopify_commande_lignes.sql : les lignes des commandes payees (segments Shopify enrichis, lot 3, plan
-- docs/superpowers/plans/2026-11-23-segments-shopify-lot-3-produits.md). Les criteres « a achete », « n a pas achete »
-- et « reassort » les lisent, l onglet Shopify de la fiche les montre.
--
-- shopify_commande_lignes : une ligne par line_items[] d un orders/paid, pour une commande notee dans shopify_commandes
--   (une fiche connue). Ni prix ni montant : la depense reste celle de la commande. quantite est celle du paiement (les
--   remboursements ne sont pas deduits, decision du 2026-10-31). carte_cadeau : gardee, ecartee des criteres (decision
--   de Julien du 2026-11-23). La cle etrangere vers shopify_commandes est en cascade : la purge d une fiche (qui supprime
--   ses commandes), customers/redact (qui purge les fiches) et l effacement du branchement emportent les lignes.
-- shopify_commandes.lignes_tronquees : le corps portait plus de lignes que le plafond (250), gardees dans leur ordre.
--
-- Index partiels : leur predicat est MOT POUR MOT celui des requetes de segment (src/crm/segments.ts) ; elargir l un sans
-- l autre ne produit qu un balayage, sans aucune erreur.
--
-- NON BLOQUANTE : le code neuf ecrit les lignes et le drapeau au mieux, par des instructions a part (une table absente se
-- journalise, la commande reste notee) ; l ancien code ne nomme ni la table ni la colonne. A appliquer avant le code
-- (migration=avant). La colonne a un defaut constant : metadonnee seule, sous un verrou bref, 5 s d attente au plus.
set local lock_timeout = '5s';

alter table shopify_commandes add column if not exists lignes_tronquees boolean not null default false;

create table if not exists shopify_commande_lignes (
  tenant_id      uuid not null,
  commande_id    text not null,
  ligne_id       text not null,
  produit_id     text,
  variante_id    text,
  sku            text,
  titre          text not null constraint shopify_commande_lignes_titre_check check (char_length(titre) between 1 and 200),
  variante_titre text constraint shopify_commande_lignes_variante_titre_check check (char_length(variante_titre) <= 200),
  quantite       integer not null constraint shopify_commande_lignes_quantite_check check (quantite between 1 and 100000),
  carte_cadeau   boolean not null default false,
  primary key (tenant_id, commande_id, ligne_id),
  constraint shopify_commande_lignes_commande_fkey foreign key (tenant_id, commande_id)
    references shopify_commandes (tenant_id, commande_id) on delete cascade
);
create index if not exists shopify_commande_lignes_produit on shopify_commande_lignes (tenant_id, produit_id)
  where produit_id is not null and not carte_cadeau;
create index if not exists shopify_commande_lignes_sku on shopify_commande_lignes (tenant_id, sku)
  where sku is not null and not carte_cadeau;
