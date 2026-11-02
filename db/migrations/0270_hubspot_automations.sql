-- 0270_hubspot_automations.sql : la ligne « Automations HubSpot : lancer un scenario quand un deal atteint une etape »
-- de Tools > Integrations > HubSpot (lot 3a du plan mm-hubspot docs/2026-11-02-champs-hubspot-et-accord-plan.md,
-- cadrage du meme jour, decisions 5 et 7 validees par Julien).
--
-- UN INTERRUPTEUR PAR ESPACE, a cote de hubspot_workflows (0259) :
--   hubspot_automations  un deal HubSpot qui atteint une etape declenche les automations « deal »          defaut FAUX
-- Eteint, POST /hubspot/deal-stage repond sans rien faire (ni fiche creee, ni champ ecrit, ni evenement publie), et le
-- declencheur est grise dans Automations. Il ouvre une porte d envoi et la creation de fiches : il est eteint par defaut.
--
-- LES ESPACES QUI ONT DEJA UNE AUTOMATION « DEAL » GARDENT LEUR COMPORTEMENT : la reprise l allume pour tout espace
-- qui en a une, ACTIVE OU NON (une automation desactivee qu on reactive ne doit pas tomber sur une ligne eteinte).
-- UPSERT CIBLE, sur le modele de 0251 : un espace sans ligne de reglages en recoit une, aux defauts de toutes les autres
-- colonnes ; un espace qui en a une ne voit bouger que cette colonne. Aucune lecture ne distingue « pas de ligne » de
-- « ligne aux defauts » (releve du lot 3a, chaque lecteur de tenant_settings retombe sur les defauts des colonnes).
--
-- 🔴 MIGRATION=AVANT, OBLIGATOIRE : le code neuf lit la colonne « === true », et une base en retard la rendrait absente,
-- donc eteinte, ce qui couperait toutes les automations « deal » entre le deploiement et migrate. L ancien code ne
-- nomme pas cette colonne (la lecture des reglages est un select etoile) : il survit a la migration.
set local lock_timeout = '5s';

alter table tenant_settings add column if not exists hubspot_automations boolean not null default false;

insert into tenant_settings (tenant_id, hubspot_automations, updated_at)
select distinct a.tenant_id, true, now()
  from automations a
 where a.trigger_kind = 'hubspot_deal_stage'
on conflict (tenant_id) do update
   set hubspot_automations = true,
       updated_at = now();
