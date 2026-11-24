-- 0318_shopify_reprises_fiches.sql : les comptes des fiches d acheteurs du rattrapage (segments Shopify enrichis, lot 5b,
-- plan docs/superpowers/plans/2026-11-24-segments-shopify-lot-5b-fiches-acheteurs.md). Depuis la decision de Julien du
-- 2026-11-24, « Rattraper » cree la fiche d un acheteur au mobile utilisable qui n en a pas, sous l attestation de la
-- boutique, puis y rattache sa commande.
--
-- shopify_reprises.fiches_creees : les fiches que la reprise a creees (une par numero, jamais deux).
-- shopify_reprises.hors_plafond : les commandes non gardees parce que la limite de contacts de l offre ne laissait plus de
--   place a la fiche de leur acheteur.
-- Des comptes seulement, comme les autres colonnes de la table : ni telephone, ni nom, ni commande.
--
-- NON BLOQUANTE : la purge d une fiche et les chemins chauds ne nomment pas shopify_reprises ; seuls le rattrapage (son
-- apercu, son lancement, son etat et son job) lit et ecrit ces colonnes. A appliquer AVANT le code (migration=avant) :
-- l ancien code ne les nomme pas et son insertion prend le defaut, alors que le code neuf sans elles ferait echouer
-- l etat du rattrapage (column does not exist). Defaut constant : metadonnees seules, sous un verrou bref (5 s d attente
-- au plus) ; les CHECK ne parcourent qu une table de quelques lignes.
set local lock_timeout = '5s';

alter table shopify_reprises add column if not exists fiches_creees integer not null default 0
  constraint shopify_reprises_fiches_creees_check check (fiches_creees >= 0);
alter table shopify_reprises add column if not exists hors_plafond integer not null default 0
  constraint shopify_reprises_hors_plafond_check check (hors_plafond >= 0);
