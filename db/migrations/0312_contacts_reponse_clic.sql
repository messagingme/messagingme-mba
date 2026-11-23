-- 0312_contacts_reponse_clic.sql : la derniere reponse et le dernier clic d une fiche (segments Shopify enrichis, lot 4,
-- plan docs/superpowers/plans/2026-11-23-segments-shopify-lot-4-sans-commander.md). Les boutons « A ecrit sans
-- commander » et « A clique sans commander » les lisent chacun.
--
-- contacts.derniere_reponse_le : le dernier message recu du contact, reaction et appui de bouton compris.
-- contacts.dernier_clic_le : son dernier clic attribue sur un lien suivi.
--   Deux faits que derniere_activite_le (0273) melange. Remplies ici depuis les messages encore conserves et les clics,
--   comme 0273, puis ecrites par les deux chemins concernes (le message entrant, le clic), sans jamais reculer. Elles
--   survivent a la purge des conversations (la conservation de l espace), pas a celle de la fiche.
--
-- 🔴 BLOQUANTE : la purge d une fiche (purgeMany) les nommera. Poussee SEULE et appliquee (migration=avant) avant que son
-- code n arrive sur main : une image qui les nomme sans elle ferait echouer toute purge en 42703. L ancien code y
-- survit : il ne les nomme pas.
--
-- Les agregats se calculent AVANT l alter, dans des tables temporaires : le verrou exclusif de contacts ne couvre que
-- l ecriture. Colonnes nullables sans defaut : metadonnee seule. Au-dela de 5 s d attente d un verrou, la migration
-- echoue et se rejoue (idempotente). Une fiche purgee (anonymized_at) ne recoit rien : ses clics gardent son
-- identifiant (la cle etrangere ne joue qu a la suppression d une ligne, et la purge n en supprime pas).
set local lock_timeout = '5s';

-- Par espace : une fiche ne recoit jamais la date d un autre espace, meme sur une donnee incoherente.
create temp table reponses_0312 on commit drop as
  select v.tenant_id, v.contact_id, max(m.created_at) as le
    from conversations v join conversation_messages m on m.conversation_id = v.id
   where v.contact_id is not null and m.direction = 'in'
   group by v.tenant_id, v.contact_id;

create temp table clics_0312 on commit drop as
  select k.tenant_id, k.contact_id, max(k.at) as le
    from tracked_link_clicks k
   where k.contact_id is not null
   group by k.tenant_id, k.contact_id;

alter table contacts
  add column if not exists derniere_reponse_le timestamptz,
  add column if not exists dernier_clic_le timestamptz;

update contacts c
   set derniere_reponse_le = r.le
  from reponses_0312 r
 where c.id = r.contact_id and c.tenant_id = r.tenant_id and c.anonymized_at is null
   and (c.derniere_reponse_le is null or c.derniere_reponse_le < r.le);

update contacts c
   set dernier_clic_le = k.le
  from clics_0312 k
 where c.id = k.contact_id and c.tenant_id = k.tenant_id and c.anonymized_at is null
   and (c.dernier_clic_le is null or c.dernier_clic_le < k.le);
