-- 0326_shopify_liens_tous_les_numeros.sql : un client Shopify relie TOUTES les fiches de ses numeros, et une fiche
-- porte les etiquettes de TOUS les clients qui ont son numero (segments Shopify enrichis, lot 6b bis, plan
-- docs/superpowers/plans/2026-11-25-segments-shopify-lot-6b-bis-tous-les-numeros.md ; decision de Julien du 2026-11-25,
-- « le max de numeros »).
--
-- shopify_clients devient une table de LIENS plusieurs a plusieurs : cle primaire (tenant_id, client_id, contact_id),
--   la contrainte shopify_clients_contact_key (une fiche, un seul client) disparait. Les noms des contraintes sont ceux
--   lus en base apres la 0319 (pg_constraint, 2026-11-25).
-- shopify_etiquettes porte le client qui a donne l etiquette (client_id) : les etiquettes d une fiche sont l union de
--   celles de ses clients, et la lecture d un client remplace seulement les siennes. Remplie depuis le lien existant
--   (encore une fiche pour un client a cet instant, donc sans ambiguite) ; une ligne sans lien est retiree. Cle primaire
--   (tenant_id, contact_id, client_id, etiquette) ; cle etrangere (tenant_id, client_id, contact_id) vers le lien, en
--   cascade : un lien defait emporte ses etiquettes. La cascade d un lien cherche par (tenant_id, contact_id, client_id) :
--   la cle primaire la sert (egalite sur ses trois premieres colonnes).
--
-- migration=avant : le code neuf ecrit client_id. L ancien code, le temps de la bascule, echoue sur l ecriture des
-- etiquettes d une synchronisation (son on conflict ne trouve plus sa cle) ; elle reprend au passage suivant. Le critere,
-- la liste des etiquettes, l onglet de la fiche, la purge et l effacement du branchement ne nomment pas client_id : ils
-- survivent aux deux versions. Non bloquante (aucun nom de table nouveau). Tables petites, verrous brefs : un
-- lock_timeout de 5 s, en set local.
set local lock_timeout = '5s';

alter table shopify_etiquettes add column client_id text;

update shopify_etiquettes e set client_id = l.client_id
  from shopify_clients l
 where l.tenant_id = e.tenant_id and l.contact_id = e.contact_id;

delete from shopify_etiquettes where client_id is null;

alter table shopify_etiquettes alter column client_id set not null;
alter table shopify_etiquettes add constraint shopify_etiquettes_client_id_check check (client_id ~ '^[0-9]{1,19}$');

alter table shopify_clients drop constraint shopify_clients_contact_key;
alter table shopify_clients drop constraint shopify_clients_pkey;
alter table shopify_clients add constraint shopify_clients_pkey primary key (tenant_id, client_id, contact_id);

alter table shopify_etiquettes drop constraint shopify_etiquettes_pkey;
alter table shopify_etiquettes add constraint shopify_etiquettes_pkey primary key (tenant_id, contact_id, client_id, etiquette);
alter table shopify_etiquettes add constraint shopify_etiquettes_lien_fkey
  foreign key (tenant_id, client_id, contact_id) references shopify_clients (tenant_id, client_id, contact_id) on delete cascade;
