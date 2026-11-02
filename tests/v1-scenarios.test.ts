import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { sha256Hex } from '../src/lib/signature';
import { GardeUsageMemoire } from './aide/usage';
import type { ApiKeyLookup } from '../src/auth/api-key-store.pg';
import { cleApiDeTest, aucunJetonOauth } from './aide/cle-api';
import { contactsV1Muets } from './aide/contacts-v1';
import { depsScenarios, recette } from './aide/scenarios-api';
import type { DepsScenariosApi } from '../src/workflow/scenarios-api';

/**
 * LES SCÉNARIOS PAR L'API (spec 2026-11-02-scenarios-api) : `POST|GET|PUT|DELETE /v1/scenarios`, sous le droit NEUF
 * `scenarios:write`. La route traduit, le service décide (`tests/workflow-scenarios-api.test.ts`).
 */
class FakeApiKeys implements ApiKeyLookup {
  private readonly byHash = new Map<string, { id: string; tenantId: string; scopes: string[] }>();
  add(raw: string, rec: { id: string; tenantId: string; scopes: string[] }) { this.byHash.set(sha256Hex(raw), rec); return this; }
  async findActiveByHash(hash: string) { return this.byHash.get(hash) ?? null; }
  async touchLastUsed(): Promise<void> {}
}

const AUTEUR = cleApiDeTest('auteur-scenarios');
const VOISIN = cleApiDeTest('voisin-scenarios');
const ENVOYEUR = cleApiDeTest('envoyeur-scenarios');

function monter(over: Partial<DepsScenariosApi> = {}) {
  const { d, store } = depsScenarios(over);
  const keys = new FakeApiKeys()
    .add(AUTEUR, { id: 'k1', tenantId: 't-1', scopes: ['scenarios:write'] })
    .add(VOISIN, { id: 'k2', tenantId: 't-2', scopes: ['scenarios:write'] })
    .add(ENVOYEUR, { id: 'k3', tenantId: 't-1', scopes: ['sends:create', 'templates:write'] });
  const server = buildServer({
    queue: new FakeQueue(),
    usage: new GardeUsageMemoire(),
    v1: { apiKeys: keys, oauth: aucunJetonOauth, contacts: contactsV1Muets(), scenarios: d },
  });
  const appel = (method: 'POST' | 'GET' | 'PUT' | 'DELETE', url: string, corps?: unknown, cle = AUTEUR, entetes: Record<string, string> = {}) =>
    server.inject({
      method, url,
      headers: { authorization: `Bearer ${cle}`, ...(corps === undefined ? {} : { 'content-type': 'application/json' }), ...entetes },
      ...(corps === undefined ? {} : { payload: corps as object }),
    });
  return { server, appel, store };
}

const autre = () => recette({
  template: { nom: 'relance', langue: 'fr' },
  boutons: [{ texte: 'Oui', suite: { humain: {} } }, { texte: 'Non', suite: { message: { texte: 'Dommage !' } } }],
});

describe('/v1/scenarios', () => {
  it('🔴 sans le droit scenarios:write : 403, même avec sends:create et templates:write', async () => {
    const { appel, server } = monter();
    const res = await appel('POST', '/v1/scenarios', recette(), ENVOYEUR);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'missing_scope' });
    await server.close();
  });

  it('POST : 201, la vue du scénario publié', async () => {
    const { appel, server } = monter();
    const res = await appel('POST', '/v1/scenarios', recette());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ nom: 'Relance', origine: 'api', ouverture: 'whatsapp_template', empreinte: expect.any(String) });
    await server.close();
  });

  it('POST : une recette mal formée rend 400 avec son chemin ; un nom pris, 409 avec l’id existant', async () => {
    const { appel, server } = monter();
    expect((await appel('POST', '/v1/scenarios', { nom: 'x', entree: {} })).json()).toMatchObject({ code: 'invalid_body', chemin: 'entree' });
    const premier = (await appel('POST', '/v1/scenarios', recette())).json<{ id: string }>();
    const doublon = await appel('POST', '/v1/scenarios', recette());
    expect(doublon.statusCode).toBe(409);
    expect(doublon.json()).toMatchObject({ code: 'scenario_name_taken', id: premier.id });
    await server.close();
  });

  it('hors offre : 402 avec le lien de l’offre', async () => {
    const { appel, server } = monter({ offres: { offreDe: async () => ({ droits: { fonctions: new Set() } }) as never } });
    const res = await appel('POST', '/v1/scenarios', recette());
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ code: 'plan_feature_unavailable', upgradeUrl: expect.any(String) });
    await server.close();
  });

  it('🔴 GET, PUT et DELETE d’un scénario d’un autre espace : 404', async () => {
    const { appel, server } = monter();
    const { id, empreinte } = (await appel('POST', '/v1/scenarios', recette())).json<{ id: string; empreinte: string }>();
    expect((await appel('GET', `/v1/scenarios/${id}`, undefined, VOISIN)).statusCode).toBe(404);
    expect((await appel('PUT', `/v1/scenarios/${id}`, autre(), VOISIN, { 'if-match': empreinte })).statusCode).toBe(404);
    expect((await appel('DELETE', `/v1/scenarios/${id}`, undefined, VOISIN)).statusCode).toBe(404);
    expect((await appel('GET', `/v1/scenarios/${id}`)).statusCode).toBe(200);
    await server.close();
  });

  it('PUT : 428 sans empreinte ; 200 avec If-Match, entre guillemets ou non, ou avec « empreinte » dans le corps', async () => {
    const { appel, server } = monter();
    const cree = (await appel('POST', '/v1/scenarios', recette())).json<{ id: string; code: string; empreinte: string }>();
    const sans = await appel('PUT', `/v1/scenarios/${cree.id}`, autre());
    expect(sans.statusCode).toBe(428);
    expect(sans.json()).toMatchObject({ code: 'precondition_required' });
    const r1 = await appel('PUT', `/v1/scenarios/${cree.code}`, autre(), AUTEUR, { 'if-match': `"${cree.empreinte}"` });
    expect(r1.statusCode).toBe(200);
    const e1 = r1.json<{ empreinte: string }>().empreinte;
    const r2 = await appel('PUT', `/v1/scenarios/${cree.id}`, { ...recette(), empreinte: e1 });
    expect(r2.statusCode).toBe(200);
    expect((await appel('PUT', `/v1/scenarios/${cree.id}`, autre(), AUTEUR, { 'if-match': e1 })).json()).toMatchObject({ code: 'scenario_changed' });
    await server.close();
  });

  it('DELETE : 200 et le scénario n’est plus lisible', async () => {
    const { appel, server, store } = monter();
    store.supprimerParApi.mockImplementation((async (id: string) => { store.lignes.delete(id); return 'ok'; }) as never);
    const { id } = (await appel('POST', '/v1/scenarios', recette())).json<{ id: string }>();
    const res = await appel('DELETE', `/v1/scenarios/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id, supprime: true });
    expect((await appel('GET', `/v1/scenarios/${id}`)).statusCode).toBe(404);
    await server.close();
  });
});
