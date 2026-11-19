import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { PgAutomationStore } from '../src/automation/store.pg';
import { LimiteOffreError } from '../src/offres/refus';

/**
 * 🔴 LE RAYON DES AUTOMATIONS (menu « Scénario », lot 1, migration 0293). L'écran Automation (« Autres ») ne liste que
 * le rayon qu'on lui demande ; le rayon s'écrit à la création et jamais après.
 *
 * Lot 6 : le MOTEUR (`listEnabled`, chaque message entrant, et le balayage des dates du worker) ne sert plus que le rayon
 * général, les lignes HubSpot ayant leur propre circuit ; les écritures de l'écran par identifiant ne touchent que le rayon
 * demandé ; la limite d'automations de l'offre et le gel ne comptent que le rayon général (les lignes HubSpot ont leur
 * plafond par ligne, décision 36).
 */

interface Requete { sql: string; params: unknown[] }

function banc(rayon: string = 'general', limite?: () => Promise<number | null>) {
  const requetes: Requete[] = [];
  const ligne = {
    id: 'a1', tenant_id: 't1', name: 'A', enabled: true, trigger_kind: 'keyword', trigger_config: { keywords: ['x'] },
    condition_group: null, workflow_id: 'w1', start_node_id: null, cooldown_seconds: null, max_fires_per_hour: null,
    possede_par: null, accord_marketing_par: null, accord_marketing_email: null, accord_marketing_le: null, rayon,
  };
  const query = async (sql: string, params: unknown[] = []) => {
    requetes.push({ sql: sql.replace(/\s+/g, ' '), params });
    return { rows: [ligne], rowCount: 1 };
  };
  return { requetes, store: new PgAutomationStore({ query } as unknown as Pool, limite) };
}

const ENTREE = {
  name: 'A', triggerKind: 'keyword' as const, triggerConfig: { keywords: ['x'] }, conditionGroup: null, workflowId: 'w1',
  startNodeId: null, cooldownSeconds: null, enabled: false,
};

/** Le prédicat de la population que compte la limite de l'offre : allumées, du client, du rayon général. */
const COMPTEE = /\benabled and possede_par is null and rayon = 'general'/;

describe('🔴 le rayon des automations', () => {
  it('list : filtre le rayon demandé, passé en paramètre', async () => {
    const { requetes, store } = banc();
    await store.list('t1', 'hubspot');
    expect(requetes[0]?.sql).toMatch(/\brayon = \$2\b/);
    expect(requetes[0]?.params).toEqual(['t1', 'hubspot']);
  });

  /**
   * ⚠️ CE CAS DISAIT LE CONTRAIRE JUSQU'AU LOT 6 (« ne filtre AUCUN rayon : une automation Shopify allumée doit partir »).
   * Shopify a pris sa propre table au lot 5 (`shopify_lignes`), et les lignes HubSpot (rayon `hubspot`, lot 6b) ont leur
   * circuit : relue ici, une ligne de rendez-vous partirait par le runner en `automatisme_ordinaire`, que `lancer` refuse
   * (il ne lance que le Builder), et son tir serait effacé (`clearFired`), son marqueur de rendez-vous avec.
   */
  it('🔴 lot 6 : listEnabled (le moteur, chaque message entrant) ne sert que le rayon général', async () => {
    const { requetes, store } = banc();
    await store.listEnabled('t1', ['keyword']);
    expect(requetes[0]?.sql).toMatch(/\brayon = 'general'/);
  });

  it('🔴 lot 6 : le balayage des dates du worker ne parcourt que les espaces qui ont une date du rayon général', async () => {
    const { requetes, store } = banc();
    expect(await store.tenantsAvecDeclencheurDate()).toEqual(['t1']);
    expect(requetes[0]?.sql).toMatch(/\btrigger_kind = 'avant_date' and rayon = 'general'/);
  });

  it('create écrit le rayon de l’entrée', async () => {
    const { requetes, store } = banc();
    await store.create('t1', { ...ENTREE, rayon: 'shopify' });
    const insertion = requetes.find((q) => q.sql.startsWith('insert into automations'));
    expect(insertion?.sql).toMatch(/\brayon\b/);
    expect(insertion?.params).toContain('shopify');
  });

  it('update n’écrit jamais le rayon, même glissé dans le patch : il ne sert qu’à choisir la ligne', async () => {
    const { requetes, store } = banc();
    await store.update('a1', 't1', 'general', { name: 'B', ...({ rayon: 'shopify' } as object) });
    const maj = requetes.find((q) => q.sql.startsWith('update automations'));
    expect(maj?.sql.slice(0, maj.sql.indexOf(' where '))).not.toMatch(/\brayon\b/);
    expect(maj?.params).not.toContain('shopify');
  });

  it('🔴 lot 6 : getById, update et remove (l’écran, par identifiant) ne touchent que le rayon demandé', async () => {
    const { requetes, store } = banc();
    await store.getById('a1', 't1', 'general');
    await store.update('a1', 't1', 'general', { name: 'B' });
    await store.remove('a1', 't1', 'general');
    expect(requetes).toHaveLength(3);
    for (const q of requetes) {
      expect(q.sql, q.sql).toMatch(/\bid = \$1 and tenant_id = \$2 and rayon = \$3\b/);
      expect(q.params.slice(0, 3), q.sql).toEqual(['a1', 't1', 'general']);
    }
  });

  it('une ligne au rayon illisible est inerte (ignorée), jamais rangée dans un rayon deviné', async () => {
    const { store } = banc('brevo');
    expect(await store.listEnabled('t1', ['keyword'])).toEqual([]);
  });
});

describe('🔴 lot 6 : la limite de l’offre et le gel ne comptent que le rayon général', () => {
  it('la place se compte sur les automations allumées du client, du rayon général', async () => {
    const { requetes, store } = banc('general', async () => 5);
    await store.create('t1', { ...ENTREE, enabled: true, rayon: 'general' });
    expect(requetes[0]?.sql).toMatch(COMPTEE);
  });

  it('les plus anciennes (le gel au retour en Base) : la même population', async () => {
    const { requetes, store } = banc();
    await store.plusAnciennes('t1', 3);
    expect(requetes[0]?.sql).toMatch(COMPTEE);
  });

  it('une ligne HubSpot allumée se crée et se rallume sans lire la limite ; une automation du Builder la lit', async () => {
    let lectures = 0;
    const limiteZero = async () => { lectures += 1; return 0; };
    const { store } = banc('hubspot', limiteZero);
    await store.create('t1', { ...ENTREE, enabled: true, rayon: 'hubspot' });
    await store.update('a1', 't1', 'hubspot', { enabled: true });
    expect(lectures).toBe(0);
    await expect(store.create('t1', { ...ENTREE, enabled: true, rayon: 'general' })).rejects.toBeInstanceOf(LimiteOffreError);
    await expect(store.update('a1', 't1', 'general', { enabled: true })).rejects.toBeInstanceOf(LimiteOffreError);
    expect(lectures).toBe(2);
  });
});
