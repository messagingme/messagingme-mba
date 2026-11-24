-- 0320_shopify_etiquettes_index.sql : les index de la cascade d une fiche sur les tables des etiquettes Shopify
-- (segments Shopify enrichis, lot 6b, migration 0319).
--
-- Les trois tables de la fiche (shopify_clients, shopify_etiquettes, shopify_fiches_cherchees) referencent contacts(id)
-- en cascade, mais leurs cles commencent par tenant_id : la suppression d une fiche, dont la cascade ne nomme que
-- contact_id, balaierait chacune en entier. Un index par table, sur contact_id seul.
--
-- NON BLOQUANTE : aucune requete du code ne la suppose, l ancien et le nouveau code y survivent. Les tables restent vides
-- tant qu aucun espace n a allume la synchronisation des etiquettes : un index ordinaire, dans la transaction, y est
-- immediat. Au-dela de 5 s d attente d un verrou, la migration echoue et se rejoue (tout est idempotent).
set local lock_timeout = '5s';

create index if not exists shopify_clients_contact on shopify_clients (contact_id);
create index if not exists shopify_etiquettes_contact on shopify_etiquettes (contact_id);
create index if not exists shopify_fiches_cherchees_contact on shopify_fiches_cherchees (contact_id);
