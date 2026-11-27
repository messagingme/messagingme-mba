import { describe, it, expect } from 'vitest';
import { OUTILS, outilsPour, type DepsMcp } from '../src/mcp/outils';
import { LabelSourceDejaPris, SourcePorteDesAppels, type AuthSource, type SourceVue } from '../src/agent/sources';

/**
 * LES SYSTÈMES CONNECTÉS DES AGENTS DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 4a) : les outils passent par les
 * fonctions de leurs routes (`src/http/agent-sources.ts`), sur un faux dépôt dont les méthodes lisent `this` et notent
 * l'espace visé. 🔴 La clé ne passe jamais par Claude : aucun outil ne la prend, et l'adresse d'un système qui en porte
 * une ne change pas depuis Claude.
 */
const T = 't1';
const SYS = '00000000-0000-4000-8000-0000000000c1';
const NEUF = '00000000-0000-4000-8000-0000000000c9';
const SERVEUR_MCP = '00000000-0000-4000-8000-0000000000c2';
const MOI = { userId: 'u1', autorisationId: 'aut-1' };
const outil = (nom: string) => {
  const o = OUTILS.find((x) => x.nom === nom);
  if (!o) throw new Error(`outil absent : ${nom}`);
  return o;
};

const vue = (over: Partial<SourceVue> = {}): SourceVue => ({
  id: SYS, tenantId: T, kind: 'http', label: 'ERP', baseUrl: 'https://api.client.fr/v1', authKind: 'bearer', authHeaderName: null,
  oauth: null, aAuthentification: true, secretPublie: false, status: 'active', lastOkAt: null, lastError: null, outilsActifs: 0,
  agents: 0, ...over,
});

class FauxSources {
  readonly appels: string[] = [];
  readonly creations: Array<Record<string, unknown>> = [];
  readonly patches: Array<Record<string, unknown>> = [];
  lignes: SourceVue[] = [vue(), vue({ id: SERVEUR_MCP, kind: 'mcp', label: 'Serveur MCP' })];
  porteDesAppels = false;
  private noter(quoi: string, tenant: string): void { this.appels.push(`${quoi}:${tenant}`); }
  async lister(tenant: string) { this.noter('lister', tenant); return this.lignes.filter((s) => s.tenantId === tenant); }
  async parId(tenant: string, id: string) {
    this.noter('parId', tenant);
    return this.lignes.find((s) => s.tenantId === tenant && s.id === id) ?? null;
  }
  async creer(tenant: string, input: { label: string; baseUrl: string; authKind: AuthSource; authSecret?: string }) {
    this.noter('creer', tenant);
    if (input.label === 'deja') throw new LabelSourceDejaPris(input.label);
    this.creations.push(input);
    const s = vue({ id: NEUF, label: input.label, baseUrl: input.baseUrl, authKind: input.authKind, aAuthentification: input.authSecret !== undefined, status: 'draft' });
    this.lignes.push(s);
    return s;
  }
  async patch(tenant: string, id: string, p: Record<string, unknown>) {
    this.noter('patch', tenant);
    this.patches.push(p);
    const s = this.lignes.find((x) => x.tenantId === tenant && x.id === id);
    return s ? { ...s, ...p } : null;
  }
  async supprimer(tenant: string, id: string) {
    this.noter('supprimer', tenant);
    if (this.porteDesAppels) throw new SourcePorteDesAppels();
    const avant = this.lignes.length;
    this.lignes = this.lignes.filter((s) => !(s.tenantId === tenant && s.id === id));
    return this.lignes.length < avant;
  }
}

function monter() {
  const sources = new FauxSources();
  const traces: Array<{ action: string; userId: string | null; detail: unknown }> = [];
  const epreuves: Array<{ tenant: string; id: string; chemin: string }> = [];
  const deps = {
    systemesApi: {
      audit: async (_t: string, acteur: { userId: string | null }, action: string, _cible: unknown, detail: unknown) => { traces.push({ action, userId: acteur.userId, detail }); },
      sources,
      eprouver: async (tenant: string, id: string, chemin: string) => { epreuves.push({ tenant, id, chemin }); return { ok: false, httpStatus: 401, erreur: 'HTTP 401' }; },
    },
  } as unknown as DepsMcp;
  return { deps, sources, traces, epreuves };
}

describe('les systèmes connectés des agents depuis Claude (CSM, B10, livraison 4a)', () => {
  it('🔴 les cinq outils sont réservés à une personne, la liste comprise (une sortie vers un tiers, comme les webhooks)', () => {
    const cle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    for (const nom of ['list_connector_systems', 'create_connector_system', 'update_connector_system', 'delete_connector_system', 'test_connector_system']) {
      expect(cle, nom).not.toContain(nom);
    }
  });

  it('🔴 une clé glissée dans la connexion OAuth est refusée, pas jetée en silence ; rien n’est créé', async () => {
    const { deps, sources } = monter();
    for (const cle of ['password', 'client_secret']) {
      await expect(outil('create_connector_system').executer(deps, T, {
        label: 'Réservation', base_url: 'https://resa.client.fr', auth: 'oauth_password',
        oauth: { token_url: 'https://resa.client.fr/token', client_id: 'api', username: 'demo', [cle]: 'x' },
      }, MOI), cle).rejects.toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/ne passe jamais par Claude/) });
    }
    expect(sources.creations).toEqual([]);
  });

  it('🔴 aucun outil ne prend une clé : aucun champ n’en porte, et une clé proposée est refusée avec le geste de la console', () => {
    for (const nom of ['create_connector_system', 'update_connector_system']) {
      const o = outil(nom);
      expect(Object.keys(o.entree.properties).filter((k) => /secret|key|token|password/i.test(k)), nom).toEqual([]);
      expect(Object.keys(o.entree.properties.oauth?.properties ?? {}), nom).not.toContain('password');
      expect(o.phraseClesInconnues?.(['auth_secret']), nom).toMatch(/ne passe jamais par Claude[\s\S]*Connecteurs API/);
    }
  });

  it('list_connector_systems : les connecteurs HTTP de l’espace, jamais un serveur MCP', async () => {
    const { deps } = monter();
    const r = await outil('list_connector_systems').executer(deps, T, {}, MOI) as { systemes: SourceVue[] };
    expect(r.systemes.map((s) => s.id)).toEqual([SYS]);
    expect((await outil('list_connector_systems').executer(deps, 't2', {}, MOI) as { systemes: unknown[] }).systemes).toEqual([]);
  });

  it('🔴 create_connector_system : déclaré en brouillon, SANS clé, au nom de la personne ; le geste de la console pour la coller', async () => {
    const { deps, sources, traces } = monter();
    const r = await outil('create_connector_system').executer(deps, T, {
      label: 'CRM', base_url: 'https://crm.client.fr/api', auth: 'header', auth_header_name: 'X-Api-Key',
    }, MOI) as { systeme: SourceVue; cle: { a_coller: boolean; page: string; consigne: string } };
    expect(sources.creations).toEqual([{ kind: 'http', label: 'CRM', baseUrl: 'https://crm.client.fr/api', authKind: 'header', authHeaderName: 'X-Api-Key' }]);
    expect(r.systeme).toMatchObject({ status: 'draft', aAuthentification: false });
    expect(r.cle.a_coller).toBe(true);
    expect(r.cle.page).toMatch(/\/connecteurs$/);
    expect(r.cle.consigne).toMatch(/« CRM »[\s\S]*« Remplacer »[\s\S]*« Activer »[\s\S]*ne passe jamais par Claude/);
    expect(traces).toEqual([{ action: 'connecteur.cree', userId: 'u1', detail: { authKind: 'header', hote: 'crm.client.fr' } }]);
  });

  it('create_connector_system : OAuth sans mot de passe, aux noms de la route ; sans authentification, rien à coller', async () => {
    const { deps, sources } = monter();
    const r = await outil('create_connector_system').executer(deps, T, {
      label: 'Réservation', base_url: 'https://resa.client.fr', auth: 'oauth_password',
      oauth: { token_url: 'https://resa.client.fr/token', client_id: 'api', username: 'demo' },
    }, MOI) as { cle: { a_coller: boolean; consigne: string } };
    expect(sources.creations[0]).toMatchObject({ authKind: 'oauth_password', oauth: { tokenUrl: 'https://resa.client.fr/token', clientId: 'api', username: 'demo', scope: '' } });
    expect(r.cle.consigne).toMatch(/« Nouveau mot de passe »/);
    const libre = await outil('create_connector_system').executer(deps, T, { label: 'Public', base_url: 'https://open.client.fr', auth: 'none' }, MOI) as { cle: unknown };
    expect(libre.cle).toEqual({ a_coller: false });
  });

  it('create_connector_system : les refus de la route, avec la page de la console', async () => {
    const { deps, sources } = monter();
    for (const [args, code] of [
      [{ label: 'X', base_url: 'http://10.0.0.4/api', auth: 'none' }, 'invalid_args'],
      [{ label: 'X', base_url: 'https://x.fr', auth: 'header' }, 'invalid_args'],
      [{ label: 'deja', base_url: 'https://x.fr', auth: 'none' }, 'conflict'],
    ] as const) {
      const refus = await outil('create_connector_system').executer(deps, T, args, MOI).catch((e: unknown) => e);
      expect(refus, JSON.stringify(args)).toMatchObject({ code });
      expect((refus as { precisions: { action: string } }).precisions.action).toMatch(/\/connecteurs$/);
    }
    expect(sources.creations).toEqual([]);
  });

  it('update_connector_system : seuls les champs donnés partent, au nom de la personne ; rien à changer est refusé', async () => {
    const { deps, sources, traces } = monter();
    await outil('update_connector_system').executer(deps, T, { system_id: SYS, label: 'ERP prod' }, MOI);
    expect(sources.patches).toEqual([{ label: 'ERP prod' }]);
    expect(traces[0]).toMatchObject({ action: 'connecteur.modifie', userId: 'u1' });
    await expect(outil('update_connector_system').executer(deps, T, { system_id: SYS }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    // Un serveur MCP ou un système d'un autre espace : introuvable, rien n'est écrit.
    for (const [tenant, id] of [[T, SERVEUR_MCP], ['t2', SYS]] as const) {
      await expect(outil('update_connector_system').executer(deps, tenant, { system_id: id, label: 'x' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    }
    expect(sources.patches).toHaveLength(1);
  });

  it('🔴 update_connector_system ne change jamais une adresse : ni base_url ni oauth dans son schéma, et rien n’en part', async () => {
    const { deps, sources } = monter();
    expect(Object.keys(outil('update_connector_system').entree.properties)).not.toEqual(expect.arrayContaining(['base_url']));
    expect(Object.keys(outil('update_connector_system').entree.properties)).not.toEqual(expect.arrayContaining(['oauth']));
    // Un système SANS clé, en brouillon : même là, l'adresse ne part pas de Claude (la console seule la change).
    sources.lignes[0] = vue({ aAuthentification: false, status: 'draft' });
    for (const args of [
      { system_id: SYS, base_url: 'https://ailleurs.example.com' },
      { system_id: SYS, oauth: { token_url: 'https://ailleurs.example.com/token', client_id: 'a', username: 'b' } },
    ]) {
      await expect(outil('update_connector_system').executer(deps, T, args, MOI), JSON.stringify(args)).rejects.toMatchObject({ code: 'invalid_args' });
    }
    await outil('update_connector_system').executer(deps, T, { system_id: SYS, label: 'ERP v2', base_url: 'https://ailleurs.example.com' }, MOI);
    expect(sources.patches).toEqual([{ label: 'ERP v2' }]);
  });

  it('🔴 update_connector_system ne retire pas la clé d’un système (auth none) ; sans clé, le mode change', async () => {
    const { deps, sources } = monter();
    await expect(outil('update_connector_system').executer(deps, T, { system_id: SYS, auth: 'none' }, MOI))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(/porte une clé[\s\S]*console/) });
    expect(sources.patches).toEqual([]);
    sources.lignes[0] = vue({ aAuthentification: false, status: 'draft' });
    await outil('update_connector_system').executer(deps, T, { system_id: SYS, auth: 'none' }, MOI);
    expect(sources.patches).toEqual([{ authKind: 'none' }]);
  });

  it('🔴 update_connector_system : activer un système sans sa clé est refusé, avec la page où la coller ; avec elle, accepté', async () => {
    const { deps, sources } = monter();
    sources.lignes[0] = vue({ aAuthentification: false, status: 'draft' });
    const refus = await outil('update_connector_system').executer(deps, T, { system_id: SYS, status: 'active' }, MOI).catch((e: unknown) => e);
    expect(refus).toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/secret est requis/) });
    expect((refus as { precisions: { action: string } }).precisions.action).toMatch(/\/connecteurs$/);
    expect(sources.patches).toEqual([]);
    sources.lignes[0] = vue({ aAuthentification: true, status: 'draft' });
    const r = await outil('update_connector_system').executer(deps, T, { system_id: SYS, status: 'active' }, MOI) as { systeme: SourceVue; cle: unknown };
    expect(r.systeme.status).toBe('active');
    expect(r.cle).toEqual({ a_coller: false });
  });

  it('delete_connector_system : refusé tant que des outils actifs ou des appels en dépendent ; sinon supprimé, et tracé', async () => {
    const { deps, sources, traces } = monter();
    sources.lignes[0] = vue({ outilsActifs: 2 });
    await expect(outil('delete_connector_system').executer(deps, T, { system_id: SYS }, MOI))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(/2 outil\(s\) actif\(s\)/) });
    sources.lignes[0] = vue();
    sources.porteDesAppels = true;
    await expect(outil('delete_connector_system').executer(deps, T, { system_id: SYS }, MOI)).rejects.toMatchObject({ code: 'conflict' });
    sources.porteDesAppels = false;
    expect(await outil('delete_connector_system').executer(deps, T, { system_id: SYS }, MOI)).toEqual({ id: SYS, deleted: true });
    expect(traces).toEqual([{ action: 'connecteur.supprime', userId: 'u1', detail: {} }]);
    await expect(outil('delete_connector_system').executer(deps, T, { system_id: SERVEUR_MCP }, MOI)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('test_connector_system : l’épreuve de la route, sur / par défaut ; un système qui ne répond pas est un résultat', async () => {
    const { deps, epreuves } = monter();
    expect(await outil('test_connector_system').executer(deps, T, { system_id: SYS }, MOI)).toEqual({ ok: false, httpStatus: 401, erreur: 'HTTP 401' });
    await outil('test_connector_system').executer(deps, T, { system_id: SYS, path: '/sante' }, MOI);
    expect(epreuves).toEqual([{ tenant: T, id: SYS, chemin: '/' }, { tenant: T, id: SYS, chemin: '/sante' }]);
    for (const [tenant, id] of [[T, SERVEUR_MCP], ['t2', SYS], [T, 'systeme-1']] as const) {
      await expect(outil('test_connector_system').executer(deps, tenant, { system_id: id }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    }
    expect(epreuves).toHaveLength(2);
  });
});
