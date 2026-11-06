-- 0280 : ou va le numero fourni d'un espace (plan docs/superpowers/plans/2026-11-06-numero-fourni-reprise.md).
--
--  - tenants.numero_fourni_destination : api (le numero passe par la fenetre de Meta, sans application) ou application
--    (il est mis DANS l'application WhatsApp Business, puis garde en la reliant par la fenetre de Meta). Nulle =
--    inconnue : les espaces existants le restent, AUCUNE REPRISE, deliberement, une destination devinee serait
--    inventee. Ecrite par start_whatsapp_connection, lue par l'etat de la connexion (la page /brancher et Claude) : sans
--    elle, un numero mis dans l'application ne savait plus ou il allait des que le lien d'une heure, ou le code de 15
--    minutes, etait passe (vecu le 2026-11-06).
--  - tenants.numero_fourni_destination_le : quand elle a ete retenue (posee avec elle, seulement quand elle CHANGE). Un
--    code ne dit « le compte de l'application existe » que s'il est arrive APRES : un code recu par la fenetre de Meta,
--    avant que la personne ne choisisse l'application, ne cree aucun compte (rouge de la relecture du lot).
--
-- 🔴 ELLE AJOUTE UNE COLONNE QUE LE CODE NEUF ECRIT ET LIT, DONC AVANT LE UP de l'API : l'ancien code l'ignore.
--
-- ⚠️ LE VERROU : une colonne nullable sans defaut ne reecrit pas la table, mais add constraint relit tenants sous un
-- ACCESS EXCLUSIVE bref (quelques centaines de lignes, comme 0212). Lire pg_stat_activity avant ; lock_timeout pour
-- echouer au bout de 5 s au lieu de faire attendre chaque requete qui lit un espace.
set local lock_timeout = '5s';

alter table tenants add column if not exists numero_fourni_destination text;
alter table tenants add column if not exists numero_fourni_destination_le timestamptz;
alter table tenants drop constraint if exists tenants_numero_fourni_destination_chk;
alter table tenants add constraint tenants_numero_fourni_destination_chk
  check (numero_fourni_destination is null or numero_fourni_destination in ('api', 'application'));
