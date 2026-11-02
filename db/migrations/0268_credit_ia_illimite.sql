-- 0268 : l'Entreprise illimitee, lot B : le Credit IA (spec docs/superpowers/specs/2026-11-02-entreprise-illimitee-design.md,
-- plan docs/superpowers/plans/2026-11-02-entreprise-illimitee.md).
--
-- Decision de Julien du 2026-11-02 : en Entreprise, l'IA est illimitee, facturee au contrat, et son solde prepaye ne
-- bouge jamais. Chaque debit reste ecrit dans agent_credit_mouvements, marque illimite, pour la facture du mois. Un
-- plafond de securite par mois et par espace (100 euros par defaut, choisi par Julien le meme jour) arrete l'IA de
-- l'espace quand il est atteint : un agent qui boucle ne doit pas nous couter sans limite.
--  - agent_credit_mouvements.illimite : un debit d'une Entreprise, qui ne touche pas agent_credits.
--  - tenants.entreprise_plafond_ia_micro_eur : le plafond du mois d'un espace ; nul = le defaut de l'instance.
--  - alertes_plafond_ia : une alerte a Julien par espace, par mois et par seuil (80 et 100 pour cent).
--  - consommation_ia_du_mois(espace) et acces_credit_ia(espace, plafond par defaut) : la regle, en SQL, une seule
--    definition, lue par le code et par la requete de la vectorisation.
--
-- A appliquer AVANT le code : le code neuf ecrit la colonne et appelle les fonctions. L'ancien code y survit : il ne
-- nomme rien de tout cela, et les colonnes ont un defaut constant (ajoutees sans reecrire les tables). La table des
-- mouvements est ecrite a chaque tour d'agent et tenants lue a chaque requete : au-dela de 5 s d'attente d'un verrou, la
-- migration echoue et se rejoue (tout est idempotent).
set local lock_timeout = '5s';

alter table agent_credit_mouvements add column if not exists illimite boolean not null default false;

alter table tenants add column if not exists entreprise_plafond_ia_micro_eur bigint;
alter table tenants drop constraint if exists tenants_entreprise_plafond_ia_chk;
alter table tenants add constraint tenants_entreprise_plafond_ia_chk
  check (entreprise_plafond_ia_micro_eur is null or entreprise_plafond_ia_micro_eur > 0);

create table if not exists alertes_plafond_ia (
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- Le premier jour du mois de Paris.
  mois      date not null,
  seuil     smallint not null check (seuil in (80, 100)),
  le        timestamptz not null default now(),
  primary key (tenant_id, mois, seuil)
);

-- Les debits illimites du mois de Paris, en micro-euros, au prix client : ce que l'Entreprise a consomme.
create or replace function consommation_ia_du_mois(espace uuid) returns bigint
language sql stable as $$
  select coalesce(-sum(m.delta_micro_eur), 0)::bigint
    from agent_credit_mouvements m
   where m.tenant_id = espace and m.illimite
     and m.at >= (date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')
$$;

-- L'espace peut-il consommer de l'IA ? 'ok', 'epuise' (prepaye, solde nul ou negatif) ou 'plafond' (Entreprise, plafond
-- du mois atteint). L'Entreprise ne lit jamais son solde : il ne bouge pas.
create or replace function acces_credit_ia(espace uuid, plafond_defaut_micro_eur bigint) returns text
language sql stable as $$
  select case
    when offre_de_l_espace(espace) = 'entreprise' then
      case when consommation_ia_du_mois(espace)
                < coalesce((select t.entreprise_plafond_ia_micro_eur from tenants t where t.id = espace), plafond_defaut_micro_eur)
           then 'ok' else 'plafond' end
    when coalesce((select c.solde_micro_eur from agent_credits c where c.tenant_id = espace), 0) > 0 then 'ok'
    else 'epuise'
  end
$$;
