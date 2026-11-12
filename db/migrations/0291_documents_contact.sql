-- 0291_documents_contact.sql : les PDF propres à un contact, recopiés de HubSpot (plan
-- docs/superpowers/plans/2026-11-12-pdf-par-contact-hubspot.md, lot A ; cadrage du même jour, décisions de Julien).
--
-- Un devis joint à un e-mail dans HubSpot est recopié dans le stockage d'objets de mba (bucket privé, Amsterdam), pour
-- partir en document WhatsApp depuis un scénario. Une ligne par fichier recopié, rangée par NUMÉRO (wa_id) et non par
-- fiche : le lead d'un workflow HubSpot n'a souvent pas encore de fiche quand le fichier arrive. Le champ de la fiche
-- porte le code, jamais une adresse.
--
-- Donnée personnelle (un devis nominatif) : gardée 30 jours au plus (décision de Julien), puis le balayage de rétention
-- efface l'objet et la ligne. La purge RGPD d'un contact MARQUE ses lignes (a_effacer_le, numéro et nom vidés) dans sa
-- transaction, et le même balayage efface leurs objets : la purge n'appelle pas le bucket. La suppression d'un espace
-- emporte les lignes par la cascade et les objets par le préfixe tenants/<espace>/.
--
-- 🔴 La purge RGPD NOMME cette table : migration poussée SEULE et appliquée AVANT le code (migration=avant), sinon la
-- purge entière échoue en 42P01. Table neuve, aucun code existant ne la lit. ⚠️ La clé étrangère prend un verrou SHARE
-- ROW EXCLUSIVE sur tenants le temps de l'instruction : le lock_timeout borne l'attente, une migration refusée se rejoue.
set local lock_timeout = '5s';

create table if not exists documents_contact (
  tenant_id     uuid not null references tenants(id) on delete cascade,
  code          text not null,
  wa_id         text,
  nom           text,
  cle_objet     text not null,
  taille        integer not null check (taille > 0),
  empreinte     text not null,
  cree_le       timestamptz not null default now(),
  a_effacer_le  timestamptz,
  primary key (tenant_id, code),
  -- Une ligne marquée par la purge ne porte plus ni numéro ni nom ; une ligne vivante porte son numéro.
  constraint documents_contact_purge_coherente check (
    (a_effacer_le is null and wa_id is not null) or (a_effacer_le is not null and wa_id is null and nom is null)
  )
);

-- Le même fichier reçu deux fois pour le même numéro n'est pas redéposé : la recopie retrouve le code par l'empreinte.
create index if not exists documents_contact_numero_idx
  on documents_contact (tenant_id, wa_id, empreinte) where wa_id is not null;

-- Le balayage : ce qui a passé ses 30 jours, et ce que la purge a marqué.
create index if not exists documents_contact_cree_le_idx on documents_contact (cree_le);
create index if not exists documents_contact_a_effacer_idx
  on documents_contact (a_effacer_le) where a_effacer_le is not null;
