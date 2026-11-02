-- 0269 : la piece jointe recue par un bloc Question (spec docs/superpowers/specs/2026-11-02-question-fichier-champ-design.md,
-- plan docs/superpowers/plans/2026-11-02-question-fichier-champ.md).
--
-- Decision de Julien du 2026-11-02 : quand un bloc Question recoit une piece (une piece d'identite, par exemple), le
-- champ du contact ne recoit qu'une mention lisible, sans aucun moyen d'acceder au fichier. Cette table relie la mention
-- au message de Meta : un bloc Appel API de scenario n'y fabrique un lien vers le fichier que si le champ porte ENCORE la
-- mention ecrite ici (un champ reecrit depuis par un autre chemin n'est plus une piece). Une ligne par contact et par
-- champ : une nouvelle piece sur le meme champ remplace l'ancienne.
--  - meta_message_id : l'identifiant du message chez Meta (wamid), par lequel la route publique relit le fichier.
--  - mention : le texte exact ecrit dans le champ, compare a la valeur du champ au moment de l'appel.
--
-- A appliquer AVANT le code : l'avance d'un parcours (chemin chaud) ecrit cette table, et la purge d'un contact la
-- nomme. L'ancien code y survit : il ne la nomme pas. Une table neuve ne prend aucun verrou sur les tables existantes,
-- sauf les cles etrangeres (verrou bref sur tenants et contacts) : au-dela de 5 s d'attente, la migration echoue et se
-- rejoue (tout est idempotent).
set local lock_timeout = '5s';

create table if not exists pieces_question (
  tenant_id       uuid not null references tenants(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  cle_champ       text not null check (char_length(cle_champ) between 1 and 200),
  meta_message_id text not null check (char_length(meta_message_id) between 1 and 200),
  mention         text not null check (char_length(mention) between 1 and 200),
  cree_le         timestamptz not null default now(),
  primary key (tenant_id, contact_id, cle_champ)
);
