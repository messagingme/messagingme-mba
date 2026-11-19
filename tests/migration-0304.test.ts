import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decouperInstructions, veutHorsTransaction } from '../src/db/migration-directives';
import { PREFIXE_LIGNE_HUBSPOT } from '../src/hubspot-workflow/ligne';
import { DECLENCHEUR_DE_LA_FAMILLE } from '../src/hubspot/lignes';

/**
 * 0304 : LA BASCULE HUBSPOT (menu « Scénario », lot 6b, tâche 5 ; décisions 8, 40 et 41). Elle part AVANT le code
 * (`migration=avant`) : l'ancien code y survit (il ne trouve plus d'automation « changement d'étape » allumée, et l'action
 * d'un workflow ne trouve plus, dans le Builder, les scénarios déplacés : `scenario_refuse` jusqu'au `up`, la fenêtre est
 * dite dans le rapport). Le texte de la migration, lu ici ; son effet sur une vraie base, en intégration (CI seule).
 */
const SQL = readFileSync(new URL('../db/migrations/0304_bascule_hubspot.sql', import.meta.url), 'utf8');
const sansCommentaires = (t: string): string => t.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const instructions = decouperInstructions(SQL)
  .map(sansCommentaires)
  .map((i) => i.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim())
  .filter((i) => i !== '');
const code = sansCommentaires(SQL).replace(/\s+/g, ' ');

describe('migration 0304', () => {
  it('🔴 le plafond d’attente du verrou vient en tête, et tout tient dans une transaction', () => {
    expect(instructions[0]).toBe("set local lock_timeout = '5s'");
    expect(veutHorsTransaction(SQL)).toBe(false);
  });

  it('🔴 décision 8 : seules les automations « changement d’étape » ALLUMÉES du Builder s’éteignent ; « Date d’un champ » reste (décision 40)', () => {
    expect(instructions).toContain(
      "update automations set enabled = false, updated_at = now() where rayon = 'general' and trigger_kind = 'hubspot_deal_stage' and enabled",
    );
    expect(code).not.toMatch(/trigger_kind = 'avant_date'/);
  });

  it('🔴 décision 41 : les scénarios d’une campagne au préfixe des workflows, de moins de 90 jours, encore au Builder', () => {
    expect(PREFIXE_LIGNE_HUBSPOT).toBe('HubSpot · workflow ');
    expect(code).toContain(`starts_with(c.name, '${PREFIXE_LIGNE_HUBSPOT}')`);
    expect(code).toContain("c.created_at > now() - interval '90 days'");
    expect(code).toContain("w.rayon = 'general'");
    expect(code).toContain('w.systeme is null');
  });

  it('🔴 le scénario passe au rayon hubspot avec sa ligne « lancés par un workflow » ALLUMÉE, posée une seule fois (rejouable)', () => {
    expect(DECLENCHEUR_DE_LA_FAMILLE.workflow).toBe('hubspot_workflow');
    expect(code).toContain("update workflows set rayon = 'hubspot', updated_at = now() where id = r.id and tenant_id = r.tenant_id");
    expect(code).toMatch(/if not exists \(select 1 from automations a where a\.tenant_id = r\.tenant_id and a\.workflow_id = r\.id and a\.rayon = 'hubspot' and a\.trigger_kind = 'hubspot_workflow'\) then insert into automations/);
    expect(code).toContain("values (r.tenant_id, r.name, true, 'hubspot_workflow', '{}'::jsonb, r.id, 'hubspot')");
  });

  it('🔴 un scénario que le Builder vise encore reste, et chaque cause se dit par un `raise notice`', () => {
    // Une automation des Autres (toutes, éteintes comprises), une campagne active qui n'est pas d'un workflow, une étape de
    // campagne, un lien de chaîne, une publicité, un widget, le scénario répondeur, un « Aller à » dans un sens ou l'autre.
    for (const garde of [
      "from automations a where a.tenant_id = r.tenant_id and a.workflow_id = r.id and a.rayon = 'general'",
      "c.status in ('scheduled', 'running', 'paused') and not starts_with(c.name,",
      'from campaign_etages e join campaigns c on c.id = e.campaign_id',
      'from channelsme_links l where l.tenant_id = r.tenant_id and l.workflow_id = r.id',
      'from publicites p where p.tenant_id = r.tenant_id and p.workflow_id = r.id',
      'from pubs_brouillons b where b.tenant_id = r.tenant_id and b.workflow_id = r.id',
      'from widgets x where x.tenant_id = r.tenant_id and x.workflow_id = r.id',
      'from tenant_settings s where s.tenant_id = r.tenant_id and s.repondeur_workflow_id = r.id',
      "n->>'type' = 'aller_a'",
    ]) expect(code, garde).toContain(garde);
    expect(code).toMatch(/raise notice '0304 : .*garde au Builder/);
    expect(code).toMatch(/raise notice '0304 : .*passe au rayon hubspot/);
    expect(code).toMatch(/raise notice '0304 : % automation/);
  });

  it('elle ne supprime rien et ne touche à aucun parcours (ils continuent : `tests/parcours-vivant-rayon.test.ts`)', () => {
    expect(code).not.toMatch(/\bdelete from\b/i);
    expect(code).not.toMatch(/workflow_runs/);
    expect(code).not.toMatch(/\bdrop\b/i);
  });
});
