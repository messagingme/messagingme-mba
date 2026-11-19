-- 0304_bascule_hubspot.sql : la bascule HubSpot (menu Scenario, lot 6b, plan
-- docs/superpowers/plans/2026-11-19-menu-scenario-lot-6-hubspot.md, tache 5 ; spec decisions 8, 40 et 41).
--
-- Depuis le lot 6b, le changement d etape d un deal sert les LIGNES d Automation > HubSpot (rayon hubspot), plus le runner
-- du Builder ; et l action d un workflow HubSpot ne lance plus que les scenarios du rayon hubspot qu une ligne
-- « lances par un workflow » (hubspot_workflow) allumee vise. Donc :
--
--  1. Decision 8 : les automations « changement d etape » du Builder (rayon general) ALLUMEES s eteignent ; le code ne
--     permet plus de les rallumer. La sonde du 2026-11-19 n en trouve qu une, deja eteinte, sur la SANDBOX. La « Date d un
--     champ » (avant_date) reste dans Autres, meme sur une propriete hs_ (decision 40 : le rappel de MUTAC).
--  2. Decision 41 : les scenarios qu une action de workflow HubSpot a lances dans les 90 derniers jours (campagnes
--     « HubSpot · workflow ... », le prefixe PREFIXE_LIGNE_HUBSPOT de src/hubspot-workflow/ligne.ts) passent au rayon
--     hubspot avec leur ligne « lances par un workflow », ALLUMEE : ils marchent le lendemain sans etre recrees. Leurs
--     parcours vivants continuent (l executeur, le reveil, la reponse et le balayage lisent le graphe d un parcours sans
--     filtre de rayon, prouve par tests/parcours-vivant-rayon.test.ts), et leur graphe ne porte aucun bloc marque : le
--     verrou du premier bloc ne s y applique pas (refusSelonLeVerrou).
--     SAUF un scenario que le Builder vise encore, qui reste et se signale (raise notice) : une automation des Autres
--     (eteinte comprise), une campagne active qui n est pas celle d un workflow, une etape de campagne, un lien de chaine,
--     une publicite ou son brouillon, un widget, le scenario repondeur, ou un « Aller a » dans un sens ou dans l autre.
--     Deplace, chacun casserait en silence (un lancement du Builder refuse un scenario d un autre rayon comme un inconnu).
--
-- Rejouable : l extinction ne touche que ce qui est allume, un scenario deplace n est plus au Builder, et la ligne ne se
-- pose que si elle n existe pas. Rien n est supprime.
--
-- A appliquer AVANT le code (migration=avant) : l ancien code y survit. Entre elle et le up de l API, l action d un
-- workflow ne trouve plus les scenarios deplaces dans le Builder et rend scenario_refuse : fenetre a reduire (deployer dans
-- la foulee). Quelques lignes au plus, lues par chaque evenement : un lock_timeout de 5 s, en set local.
set local lock_timeout = '5s';

update automations set enabled = false, updated_at = now()
 where rayon = 'general' and trigger_kind = 'hubspot_deal_stage' and enabled;

do $$
declare
  n_eteintes integer;
  n_deplaces integer := 0;
  r record;
  cause text;
begin
  select count(*) into n_eteintes
    from automations where rayon = 'general' and trigger_kind = 'hubspot_deal_stage' and not enabled;
  raise notice '0304 : % automation(s) « changement d etape » du Builder, toutes eteintes', n_eteintes;

  for r in
    select distinct w.id, w.tenant_id, w.name, w.code, w.graph, w.draft_graph
      from campaigns c
      join workflows w on w.id = c.workflow_id and w.tenant_id = c.tenant_id
     where starts_with(c.name, 'HubSpot · workflow ')
       and c.created_at > now() - interval '90 days'
       and w.rayon = 'general'
       and w.systeme is null
  loop
    cause := case
      when exists (select 1 from automations a where a.tenant_id = r.tenant_id and a.workflow_id = r.id and a.rayon = 'general')
        then 'une automation des Autres le vise'
      when exists (select 1 from campaigns c where c.tenant_id = r.tenant_id and c.workflow_id = r.id
                      and c.status in ('scheduled', 'running', 'paused') and not starts_with(c.name, 'HubSpot · workflow '))
        then 'une campagne active du Builder le lance'
      when exists (select 1 from campaign_etages e join campaigns c on c.id = e.campaign_id
                    where c.tenant_id = r.tenant_id and e.workflow_id = r.id
                      and c.status in ('scheduled', 'running', 'paused') and not starts_with(c.name, 'HubSpot · workflow '))
        then 'une etape de campagne active le lance'
      when exists (select 1 from channelsme_links l where l.tenant_id = r.tenant_id and l.workflow_id = r.id)
        then 'un lien de chaine le lance'
      when exists (select 1 from publicites p where p.tenant_id = r.tenant_id and p.workflow_id = r.id)
        then 'une publicite le lance'
      when exists (select 1 from pubs_brouillons b where b.tenant_id = r.tenant_id and b.workflow_id = r.id)
        then 'un brouillon de publicite le vise'
      when exists (select 1 from widgets x where x.tenant_id = r.tenant_id and x.workflow_id = r.id)
        then 'un widget le lance'
      when exists (select 1 from tenant_settings s where s.tenant_id = r.tenant_id and s.repondeur_workflow_id = r.id)
        then 'il est le scenario repondeur'
      when exists (select 1 from jsonb_array_elements(coalesce(r.graph->'nodes', '[]'::jsonb) || coalesce(r.draft_graph->'nodes', '[]'::jsonb)) n
                    where n->>'type' = 'aller_a')
        then 'un de ses « Aller a » vise le Builder'
      when exists (select 1 from workflows w2
                    cross join lateral jsonb_array_elements(coalesce(w2.graph->'nodes', '[]'::jsonb) || coalesce(w2.draft_graph->'nodes', '[]'::jsonb)) n2
                    where w2.tenant_id = r.tenant_id and w2.id <> r.id and n2->>'type' = 'aller_a'
                      and n2->'data'->>'cible' in (select m->'data'->>'code' from jsonb_array_elements(coalesce(r.graph->'nodes', '[]'::jsonb)) m
                                                   where m->'data'->>'code' is not null))
        then 'un « Aller a » d un autre scenario le vise'
      else null
    end;
    if cause is not null then
      raise notice '0304 : scenario % (%) de l espace % garde au Builder : %', r.code, r.name, r.tenant_id, cause;
      continue;
    end if;

    update workflows set rayon = 'hubspot', updated_at = now() where id = r.id and tenant_id = r.tenant_id;
    if not exists (select 1 from automations a
                    where a.tenant_id = r.tenant_id and a.workflow_id = r.id and a.rayon = 'hubspot' and a.trigger_kind = 'hubspot_workflow') then
      insert into automations (tenant_id, name, enabled, trigger_kind, trigger_config, workflow_id, rayon)
      values (r.tenant_id, r.name, true, 'hubspot_workflow', '{}'::jsonb, r.id, 'hubspot');
    end if;
    raise notice '0304 : scenario % (%) de l espace % passe au rayon hubspot, sa ligne « lances par un workflow » allumee',
      r.code, r.name, r.tenant_id;
    n_deplaces := n_deplaces + 1;
  end loop;
  raise notice '0304 : % scenario(s) passe(s) au rayon hubspot', n_deplaces;
end $$;
