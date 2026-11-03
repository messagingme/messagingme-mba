-- 0273_segments.sql : les segments sur les commandes, le pays et l activite (spec et plan du 2026-10-31,
-- docs/superpowers/specs/2026-10-31-segments-commandes-pays-activite-design.md).
--
-- contacts.derniere_activite_le : le dernier message recu du contact ou son dernier clic attribue. Ecrite par les deux
--   seuls chemins concernes ; remplie ici depuis les messages encore conserves et les clics. Elle survit a la purge
--   des conversations (la conservation de l espace), pas a celle de la fiche.
-- shopify_commandes recoit la date de paiement, le montant, la devise et le drapeau test : chaque commande payee d une
--   fiche connue s y ecrira a la reception de orders/paid, message branche ou non (decision de Julien). Remplissage de
--   l existant : par ventes_attribuees quand elle connait la commande, sinon la date de reception, sans montant.
--   payee_le prend ensuite now() pour defaut : l ancien code, qui ne la nomme pas, continue d inserer.
-- shopify_boutiques.commandes_depuis : la date depuis laquelle TOUTES les commandes sont suivies. now() pour les
--   boutiques deja branchees (le jour de cette migration), puis chaque rebranchement apres une coupure.
--
-- 🔴 BLOQUANTE : purgeMany nomme derniere_activite_le, connecter nomme commandes_depuis, lierCommande nomme les colonnes de
-- shopify_commandes. Poussee SEULE et appliquee (migration=avant) avant que son code n arrive sur main : une image sans
-- elle ferait echouer toute purge en 42703. L ancien code y survit : il ne nomme rien de neuf, les defauts remplissent
-- ses inserts.
--
-- Verrous : contacts AVANT shopify_commandes, l ordre de purgeMany (sa fiche for update, puis ses commandes) ; l ordre
-- inverse pourrait interbloquer avec une purge. L agregat d activite se calcule AVANT l alter de contacts, dans une table
-- temporaire : le verrou exclusif de contacts ne couvre que l ecriture. Colonnes nullables ou a defaut constant :
-- metadonnee seule. Au-dela de 5 s d attente d un verrou, la migration echoue et se rejoue (idempotente).
set local lock_timeout = '5s';

-- Par espace : une fiche ne recoit jamais l activite d un autre espace, meme sur une donnee incoherente.
create temp table activite_0273 on commit drop as
  select s.tenant_id, s.contact_id, max(s.le) as le
    from (
      select v.tenant_id, v.contact_id, max(m.created_at) as le
        from conversations v join conversation_messages m on m.conversation_id = v.id
       where v.contact_id is not null and m.direction = 'in'
       group by v.tenant_id, v.contact_id
      union all
      select k.tenant_id, k.contact_id, max(k.at)
        from tracked_link_clicks k
       where k.contact_id is not null
       group by k.tenant_id, k.contact_id
    ) s
   group by s.tenant_id, s.contact_id;

alter table contacts add column if not exists derniere_activite_le timestamptz;

update contacts c
   set derniere_activite_le = a.le
  from activite_0273 a
 where c.id = a.contact_id and c.tenant_id = a.tenant_id
   and (c.derniere_activite_le is null or c.derniere_activite_le < a.le);

alter table shopify_commandes
  add column if not exists payee_le timestamptz,
  add column if not exists montant numeric(18,3) check (montant is null or montant >= 0),
  add column if not exists devise text check (devise is null or devise ~ '^[A-Z]{3}$'),
  add column if not exists test boolean not null default false;

update shopify_commandes o
   set payee_le = v.payee_le, montant = v.montant, devise = v.devise, test = v.test
  from ventes_attribuees v
 where v.tenant_id = o.tenant_id and v.commande_id = o.commande_id and o.payee_le is null;

update shopify_commandes set payee_le = cree_le where payee_le is null;

alter table shopify_commandes alter column payee_le set default now();
alter table shopify_commandes alter column payee_le set not null;

alter table shopify_boutiques add column if not exists commandes_depuis timestamptz not null default now();
