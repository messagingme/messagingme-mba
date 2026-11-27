import { describe, it, expect } from 'vitest';
import { OUTILS, outilsPour, type DepsMcp } from '../src/mcp/outils';
import type { RequeteConnecteur } from '../src/agent/requetes';
import { NomOutilDejaPris } from '../src/agent/catalog';
import { essayerAppel } from '../src/http/agent-requetes';

/**
 * LES APPELS DES SYSTÈMES CONNECTÉS DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 4b) : les outils passent par les
 * fonctions de leurs routes (`src/http/agent-requetes.ts`, `brancherConnecteur`), sur des faux dont les méthodes lisent
 * `this` et notent l'espace. 🔴 Un essai exécute l'appel pour de vrai : depuis Claude, seul un appel qui lit s'essaie ;
 * et un appel ne change pas de système.
 */
const T = 't1';
const SYS = '00000000-0000-4000-8000-0000000000c1';
const APPEL_GET = '00000000-0000-4000-8000-0000000000d1';
const APPEL_POST = '00000000-0000-4000-8000-0000000000d2';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const MOI = { userId: 'u1', autorisationId: 'aut-1' };
const outil = (nom: string) => {
  const o = OUTILS.find((x) => x.nom === nom);
  if (!o) throw new Error(`outil absent : ${nom}`);
  return o;
};

const appel = (over: Partial<RequeteConnecteur> = {}): RequeteConnecteur => ({
  id: APPEL_GET, tenantId: T, sourceId: SYS, label: 'Commande', methode: 'GET', chemin: '/commandes/{numero}', parametres: [],
  entetes: [], corps: { mode: 'aucun' }, outputPaths: ['statut'], valeursTest: { numero: '42' }, outils: 0, updatedAt: '2026-11-27T00:00:00.000Z',
  variables: [{ nom: 'numero', type: 'string', origine: { type: 'modele' } }],
  ...over,
} as RequeteConnecteur);

class FauxRequetes {
  readonly appels: string[] = [];
  readonly creations: Array<Record<string, unknown>> = [];
  readonly patches: Array<Record<string, unknown>> = [];
  lignes: RequeteConnecteur[] = [appel(), appel({ id: APPEL_POST, label: 'Ticket', methode: 'POST', chemin: '/tickets' })];
  scenarios: string[] = [];
  private noter(quoi: string, tenant: string): void { this.appels.push(`${quoi}:${tenant}`); }
  async lister(tenant: string) { this.noter('lister', tenant); return this.lignes.filter((l) => l.tenantId === tenant).map((l) => ({ ...l, scenarios: [] })); }
  async parId(tenant: string, id: string) { this.noter('parId', tenant); return this.lignes.find((l) => l.tenantId === tenant && l.id === id) ?? null; }
  async scenariosQuiUtilisent(tenant: string) { this.noter('scenarios', tenant); return this.scenarios; }
  async creer(tenant: string, input: Record<string, unknown>) {
    this.noter('creer', tenant);
    this.creations.push(input);
    return appel({ id: '00000000-0000-4000-8000-0000000000d9', ...(input as Partial<RequeteConnecteur>) });
  }
  async patch(tenant: string, id: string, p: Record<string, unknown>) {
    this.noter('patch', tenant);
    this.patches.push(p);
    const l = this.lignes.find((x) => x.tenantId === tenant && x.id === id);
    return l ? { ...l, ...(p as Partial<RequeteConnecteur>) } : null;
  }
  async supprimer(tenant: string, id: string) { this.noter('supprimer', tenant); return this.lignes.some((l) => l.tenantId === tenant && l.id === id); }
}

class FauxCatalogue {
  readonly branchements: Array<{ tenant: string; agentId: string; outil: Record<string, unknown> }> = [];
  nomPris = false;
  async ajouterConnecteur(tenant: string, agentId: string, o: Record<string, unknown>) {
    if (this.nomPris) throw new NomOutilDejaPris('consommateur');
    this.branchements.push({ tenant, agentId, outil: o });
    // L'outil créé, avec ses mots : la vue de la route (`vueOutilDAgent`) en dérive ce que le modèle verra.
    return tenant === T && agentId === AGENT ? ({ id: 'outil-1', origin: 'http', params: [], ...o, enabled: false } as never) : null;
  }
}

function monter() {
  const requetes = new FauxRequetes();
  const catalogue = new FauxCatalogue();
  const sources: string[] = [];
  const deps = {
    appelsApi: {
      requetes,
      // Aucune source joignable dans un test unitaire : l'essai le dit, sans réseau.
      sourcePourTest: async (tenant: string, sourceId: string) => {
        sources.push(`${tenant}:${sourceId}`);
        return { baseUrl: 'https://crm.client.fr/api', entetes: {}, status: 'active', erreurAuth: 'aucun secret enregistré sur ce connecteur : collez-le sur la page Connecteurs API' };
      },
      clesDeChamps: async () => ['numero_client'],
      brancheeSurConsentement: async () => false,
    },
    branchementAppels: { outils: catalogue, requetes, sortiesDeLAgent: async () => [] },
  } as unknown as DepsMcp;
  return { deps, requetes, catalogue, sources };
}

describe('les appels des systèmes connectés depuis Claude (CSM, B10, livraison 4b)', () => {
  it('🔴 les six outils sont réservés à une personne, la liste comprise', () => {
    const cle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    for (const nom of ['list_connector_calls', 'create_connector_call', 'update_connector_call', 'delete_connector_call', 'test_connector_call', 'attach_connector_call']) {
      expect(cle, nom).not.toContain(nom);
    }
  });

  it('list_connector_calls : les appels, les champs de l’espace et le catalogue des origines, comme la console', async () => {
    const { deps } = monter();
    const r = await outil('list_connector_calls').executer(deps, T, {}, MOI) as { requetes: unknown[]; champs: string[]; catalogue: { fiche: unknown[]; systeme: unknown[] } };
    expect(r.requetes).toHaveLength(2);
    expect(r.champs).toEqual(['numero_client']);
    expect(r.catalogue.fiche.length).toBeGreaterThan(0);
  });

  it('create_connector_call : vérifié comme la console, aux noms de la route ; un en-tête réservé est refusé', async () => {
    const { deps, requetes } = monter();
    const r = await outil('create_connector_call').executer(deps, T, {
      system_id: SYS, label: 'Client', methode: 'GET', chemin: '/clients/{numero}',
      variables: [{ nom: 'numero', type: 'string', origine: { type: 'champ', cle: 'numero_client' } }], output_paths: ['nom'],
      valeurs_test: { numero: '7' },
    }, MOI) as { appel: RequeteConnecteur };
    expect(r.appel.label).toBe('Client');
    expect(requetes.creations[0]).toMatchObject({ sourceId: SYS, label: 'Client', outputPaths: ['nom'], valeursTest: { numero: '7' } });
    for (const args of [
      { system_id: SYS, label: 'X', methode: 'GET', chemin: '/x', entetes: [{ nom: 'Authorization', valeur: 'Bearer volé' }] },
      { system_id: SYS, label: 'X', methode: 'GET', chemin: '/x/{inconnue}' },
      { system_id: SYS, label: 'X', methode: 'GET', chemin: '/x', variables: [{ nom: 'n', type: 'string', origine: { type: 'champ', cle: 'pas_un_champ' } }] },
    ]) {
      const refus = await outil('create_connector_call').executer(deps, T, args, MOI).catch((e: unknown) => e);
      expect(refus, JSON.stringify(args)).toMatchObject({ code: 'invalid_args' });
      expect((refus as { precisions: { action: string } }).precisions.action).toMatch(/\/connecteurs$/);
    }
    expect(requetes.creations).toHaveLength(1);
  });

  it('🔴 update_connector_call : seuls les champs donnés partent ; jamais le système ; rien à changer est refusé', async () => {
    const { deps, requetes } = monter();
    expect(Object.keys(outil('update_connector_call').entree.properties)).not.toContain('system_id');
    await outil('update_connector_call').executer(deps, T, { call_id: APPEL_GET, label: 'Commande v2' }, MOI);
    expect(requetes.patches).toEqual([{ label: 'Commande v2' }]);
    // Un système proposé ne part pas (le serveur refuse la clé ; l'outil, appelé de côté, l'ignore).
    await expect(outil('update_connector_call').executer(deps, T, { call_id: APPEL_GET, system_id: SYS }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    await expect(outil('update_connector_call').executer(deps, T, { call_id: APPEL_GET }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    // Vérifié sur l'état effectif : retirer la variable que le chemin utilise est refusé.
    await expect(outil('update_connector_call').executer(deps, T, { call_id: APPEL_GET, variables: [] }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    expect(requetes.patches).toHaveLength(1);
    await expect(outil('update_connector_call').executer(deps, 't2', { call_id: APPEL_GET, label: 'x' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('🔴 une clé ne passe jamais par un appel : refusée à l’écriture, rien n’est enregistré', async () => {
    const { deps, requetes } = monter();
    const base = { system_id: SYS, label: 'X', methode: 'GET', chemin: '/x' };
    for (const args of [
      { ...base, entetes: [{ nom: 'X-Api-Key', valeur: 'sk_live_1' }] },
      { ...base, parametres: [{ cle: 'api_key', valeur: 'abc' }] },
      { ...base, variables: [{ nom: 'token', type: 'string', origine: { type: 'fixe', valeur: 'abc' } }] },
      { ...base, valeurs_test: { password: 'x' } },
    ]) {
      await expect(outil('create_connector_call').executer(deps, T, args, MOI), JSON.stringify(args))
        .rejects.toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/ne passe jamais par Claude/) });
    }
    await expect(outil('update_connector_call').executer(deps, T, { call_id: APPEL_GET, entetes: [{ nom: 'Authorization-Token', valeur: 'x' }] }, MOI))
      .rejects.toMatchObject({ code: 'invalid_args' });
    expect(requetes.creations).toEqual([]);
    expect(requetes.patches).toEqual([]);
  });

  it('🔴 une clé tapée dans la console ne remonte pas à Claude : masquée dans la liste et dans l’essai', async () => {
    const { deps, requetes } = monter();
    requetes.lignes[0] = appel({
      chemin: '/commandes',
      entetes: [{ nom: 'X-Api-Key', valeur: 'sk_live_1' }, { nom: 'Accept-Language', valeur: 'fr' }],
      parametres: [{ cle: 'key', valeur: 'abc' }, { cle: 'api_key', valeur: '{cle_client}' }, { cle: 'q', valeur: 'tout' }],
      variables: [{ nom: 'secret', type: 'string', origine: { type: 'fixe', valeur: 'xyz' } }, { nom: 'cle_client', type: 'string', origine: { type: 'modele' } }],
      valeursTest: { cle_client: 'abc', secret: 'xyz' },
    } as Partial<RequeteConnecteur>);
    const liste = await outil('list_connector_calls').executer(deps, T, {}, MOI) as { requetes: Array<Record<string, unknown>> };
    expect(liste.requetes[0]).toMatchObject({
      entetes: [{ nom: 'X-Api-Key', valeur: '••••' }, { nom: 'Accept-Language', valeur: 'fr' }],
      // Une variable ({cle_client}) n'est pas un secret : elle reste lisible.
      parametres: [{ cle: 'key', valeur: '••••' }, { cle: 'api_key', valeur: '{cle_client}' }, { cle: 'q', valeur: 'tout' }],
      variables: [{ nom: 'secret', origine: { type: 'fixe', valeur: '••••' } }, { nom: 'cle_client' }],
      valeursTest: { cle_client: '••••', secret: '••••' },
    });
    // L'essai : ce qui est parti, l'adresse et les en-têtes, sans la clé.
    const essai = { ...deps, appelsApi: {
      ...deps.appelsApi,
      sourcePourTest: async () => ({ baseUrl: 'https://crm.client.fr/api', entetes: {}, status: 'active' }),
      transportHttp: { executer: async () => ({ nature: 'reponse', httpStatus: 200, texte: '{"statut":"ok"}', dureeMs: 3 }) },
    } } as unknown as DepsMcp;
    const r = await outil('test_connector_call').executer(essai, T, { call_id: APPEL_GET }, MOI) as { envoye: { url: string; entetes: Record<string, string> } };
    expect(r.envoye.url).not.toMatch(/abc|sk_live/);
    expect(r.envoye.url).toMatch(/[?&]key=/);
    expect(r.envoye.entetes['x-api-key']).toBe('••••');
    expect(r.envoye.entetes['accept-language']).toBe('fr');
  });

  it('🔴 un appel en service (un outil, un bloc) ne change depuis Claude que son nom, ses champs lus et ses valeurs d’essai', async () => {
    const { deps, requetes } = monter();
    requetes.lignes[0] = appel({ outils: 1 });
    await expect(outil('update_connector_call').executer(deps, T, { call_id: APPEL_GET, methode: 'POST', chemin: '/commandes/{numero}/annuler' }, MOI))
      .rejects.toMatchObject({ code: 'forbidden', message: expect.stringMatching(/en service[\s\S]*methode, chemin[\s\S]*console/) });
    requetes.lignes[0] = appel();
    requetes.scenarios = ['Qualification'];
    await expect(outil('update_connector_call').executer(deps, T, { call_id: APPEL_GET, chemin: '/autre/{numero}' }, MOI)).rejects.toMatchObject({ code: 'forbidden' });
    await outil('update_connector_call').executer(deps, T, { call_id: APPEL_GET, label: 'Suivi', output_paths: ['statut', 'date'] }, MOI);
    expect(requetes.patches).toEqual([{ label: 'Suivi', outputPaths: ['statut', 'date'] }]);
    // Hors service, il change.
    requetes.scenarios = [];
    await outil('update_connector_call').executer(deps, T, { call_id: APPEL_GET, chemin: '/autre/{numero}' }, MOI);
    expect(requetes.patches.at(-1)).toEqual({ chemin: '/autre/{numero}' });
  });

  it('create_connector_call : sans champs lus, un brouillon ; un schéma refusé dit quoi corriger', async () => {
    const { deps, requetes } = monter();
    await outil('create_connector_call').executer(deps, T, { system_id: SYS, label: 'Brouillon', methode: 'GET', chemin: '/x' }, MOI);
    expect(requetes.creations[0]).toMatchObject({ outputPaths: [] });
    await expect(outil('create_connector_call').executer(deps, T, {
      system_id: SYS, label: 'X', methode: 'GET', chemin: '/x', variables: [{ nom: 'n', type: 'string', origine: { type: 'fiche', cle: 'pas_une_cle' } }],
    }, MOI)).rejects.toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/variables\.0\.origine/) });
  });

  it('delete_connector_call : refusé tant qu’un outil ou un bloc Appel API s’en sert ; sinon supprimé', async () => {
    const { deps, requetes } = monter();
    requetes.lignes[0] = appel({ outils: 1 });
    await expect(outil('delete_connector_call').executer(deps, T, { call_id: APPEL_GET }, MOI)).rejects.toMatchObject({ code: 'conflict' });
    requetes.lignes[0] = appel();
    requetes.scenarios = ['Qualification'];
    await expect(outil('delete_connector_call').executer(deps, T, { call_id: APPEL_GET }, MOI))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(/« Qualification »/) });
    requetes.scenarios = [];
    expect(await outil('delete_connector_call').executer(deps, T, { call_id: APPEL_GET }, MOI)).toEqual({ id: APPEL_GET, deleted: true });
  });

  it('🔴 test_connector_call : un appel qui lit s’essaie ; un appel qui écrit est refusé AVANT tout appel, vers la console', async () => {
    const { deps, sources, requetes } = monter();
    expect(await outil('test_connector_call').executer(deps, T, { call_id: APPEL_GET, valeurs: { numero: '9' } }, MOI))
      .toEqual({ ok: false, erreur: expect.stringMatching(/aucun secret enregistré/) });
    expect(sources).toEqual([`${T}:${SYS}`]);
    for (const methode of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const id = `00000000-0000-4000-8000-0000000000e${['POST', 'PUT', 'PATCH', 'DELETE'].indexOf(methode)}`;
      requetes.lignes.push(appel({ id, methode, chemin: '/commandes' }));
      await expect(outil('test_connector_call').executer(deps, T, { call_id: id }, MOI), methode)
        .rejects.toMatchObject({ code: 'forbidden', message: expect.stringMatching(new RegExp(`${methode}[\\s\\S]*console`)) });
    }
    expect(sources).toHaveLength(1);
    // La console, elle, essaie un appel qui écrit : la garde n'est que celle de Claude (la route ne la passe pas).
    expect(await essayerAppel(deps.appelsApi, T, APPEL_POST, {})).toMatchObject({ ok: true });
    expect(sources).toHaveLength(2);
    await expect(outil('test_connector_call').executer(deps, 't2', { call_id: APPEL_GET }, MOI)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('🔴 attach_connector_call : l’outil naît par le catalogue, au risque plancher au moins, et dit ce qu’il enverra', async () => {
    const { deps, catalogue } = monter();
    const base = { agent_id: AGENT, call_id: APPEL_POST, nature: 'pousse', name: 'ouvrir_ticket', title: 'Ouvrir un ticket', description: 'Quand le client signale un problème.', ne_pas_utiliser: 'Pour une question.' };
    const r = await outil('attach_connector_call').executer(deps, T, base, MOI) as { outil: { risk: string }; envoi: Array<{ nom: string }>; a_savoir: string };
    expect(catalogue.branchements[0]).toMatchObject({ tenant: T, agentId: AGENT, outil: { requestId: APPEL_POST, sourceId: SYS, name: 'ouvrir_ticket', risk: 'write', nature: 'pousse' } });
    // Ce qui partira, à dire à la personne avant d'activer : la variable de l'appel, avec son libellé.
    expect(r.envoi).toEqual([{ nom: 'numero', libelle: expect.any(String) }]);
    expect(r.a_savoir).toMatch(/inactif[\s\S]*update_agent_tool/);
    // Le risque ne s'abaisse pas sous celui de la méthode ; la lecture se déclare ; un nom pris le dit.
    await expect(outil('attach_connector_call').executer(deps, T, { ...base, risk: 'read' }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    await expect(outil('attach_connector_call').executer(deps, T, { ...base, call_id: APPEL_GET, nature: 'integre' }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    catalogue.nomPris = true;
    await expect(outil('attach_connector_call').executer(deps, T, base, MOI)).rejects.toMatchObject({ code: 'conflict' });
    catalogue.nomPris = false;
    // Un appel ou un agent d'un autre espace : introuvable.
    await expect(outil('attach_connector_call').executer(deps, 't2', base, MOI)).rejects.toMatchObject({ code: 'not_found' });
    await expect(outil('attach_connector_call').executer(deps, T, { ...base, agent_id: '00000000-0000-4000-8000-0000000000a9' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
  });
});
