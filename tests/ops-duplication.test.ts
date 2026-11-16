import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { signSession } from '../src/auth/token';
import { accesOps, ADRESSE_OPS, SECRET_OPS } from './acces-ops';
import { FakeQueue } from './fake-queue';
import { capturerJournal } from './journal';
import { verrousEnMemoire } from './verrous';
import type { OpsDuplicationDeps } from '../src/http/ops-duplication';
import type { EtatEnBase } from '../src/ops/duplication/store.pg';
import type { TemplateDeLaWaba } from '../src/ops/duplication/plan';

/**
 * LA DUPLICATION D'UN SCÉNARIO DEPUIS /ops, PAR LE VRAI CÂBLAGE (`buildServer`) : la garde d'exploitation, l'aperçu qui
 * n'écrit rien, l'empreinte qui refuse un état changé, les blocages, une duplication à la fois par destination, jamais de
 * 5xx, et la trace signée de l'exploitant. Le plan : `tests/ops-duplication-plan.test.ts` ; le SQL :
 * `tests/integration/ops-duplication.integration.test.ts`.
 */
const SRC = '4169c753-311a-43bb-a334-d8a2cb7caf6f';
const DST = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const WF = '0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
const INCONNU = '11111111-2222-4333-8444-555555555555';

const ETAT: EtatEnBase = {
  source: { id: SRC, nom: 'Source' },
  destination: { id: DST, nom: 'Destination', codeClient: 'dst02' },
  scenario: {
    id: WF, nom: 'Accueil',
    graphe: {
      nodes: [
        { id: 'q1', type: 'question', position: { x: 0, y: 0 }, data: { body: 'Ville ?', champReponse: 'ville' } },
        { id: 't2', type: 'template', position: { x: 0, y: 0 }, data: { templateName: 'bienvenue', language: 'fr' } },
        { id: 'a3', type: 'aller_a', position: { x: 0, y: 0 }, data: { cible: 'nod_src01_01J00000000000000000000001', name: 'Vers le RDV' } },
        { id: 'g4', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'vip' } },
      ],
      edges: [],
    },
  },
  automationsDuScenario: [],
  automationsDeLaDestination: [],
  champsSource: [{ key: 'ville', label: 'Ville', type: 'text' }],
  champsDestination: [],
  nomsPrisDestination: [],
};

interface Options {
  templatesDe?: OpsDuplicationDeps['templatesDe'];
  ecrire?: OpsDuplicationDeps['store']['ecrire'];
  declareTags?: OpsDuplicationDeps['declareTags'];
  verrous?: ReturnType<typeof verrousEnMemoire>;
}

function monter(o: Options = {}) {
  const ecrits: Array<{ destination: string; nom: string }> = [];
  const tagsDeclares: string[][] = [];
  let lectures = 0;
  const verrous = o.verrous ?? verrousEnMemoire();
  const deps: OpsDuplicationDeps = {
    store: {
      espaces: async () => { lectures += 1; return [{ id: SRC, nom: 'Source', waba: true }, { id: DST, nom: 'Destination', waba: true }]; },
      scenarios: async (t) => { lectures += 1; return t === SRC ? [{ id: WF, nom: 'Accueil' }] : []; },
      lireEtat: async (s, w, d) => { lectures += 1; return s === SRC && w === WF && d === DST ? ETAT : null; },
      ecrire: o.ecrire ?? (async (destination, nom) => {
        ecrits.push({ destination, nom });
        return { scenarioId: 'wf-copie', nom: `${nom} (copie)`, champsCrees: ['ville'], declencheursCopies: 0 };
      }),
    },
    templatesDe: o.templatesDe ?? (async (): Promise<TemplateDeLaWaba[]> => [{ nom: 'bienvenue', langue: 'fr', statut: 'APPROVED' }]),
    offreOuvreScenarios: async () => true,
    declareTags: o.declareTags ?? (async (_t, tags) => { tagsDeclares.push(tags); }),
    verrous,
  };
  const server = buildServer({ queue: new FakeQueue(), auth: acces.auth, opsDuplication: deps });
  return { server, ecrits, tagsDeclares, verrous, lus: () => lectures };
}

const acces = accesOps();
const ops: Record<string, string> = { 'content-type': 'application/json' };
beforeAll(async () => {
  const s = buildServer({ queue: new FakeQueue(), auth: acces.auth });
  ops.authorization = `Bearer ${await acces.jeton(s)}`;
  await s.close();
});

const corps = { source: SRC, scenarioId: WF, destination: DST };

async function empreinteDe(server: ReturnType<typeof monter>['server']): Promise<string> {
  const res = await server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: corps });
  return res.json<{ apercu: { empreinte: string } }>().apercu.empreinte;
}

describe('la duplication d’un scénario depuis /ops', () => {
  it('🔴 sans session d’exploitation, avec une fausse, ou avec une session d’ADMIN d’espace : 401, rien n’est lu ni écrit', async () => {
    const { server, ecrits, lus } = monter();
    const admin = await signSession({ userId: 'u1', tenantId: SRC, role: 'admin' }, SECRET_OPS);
    for (const entetes of [{}, { authorization: 'Bearer pas-une-session' }, { authorization: `Bearer ${admin}` }]) {
      const h = { ...entetes, 'content-type': 'application/json' };
      expect((await server.inject({ method: 'GET', url: '/ops/duplication/espaces', headers: h })).statusCode).toBe(401);
      expect((await server.inject({ method: 'GET', url: `/ops/duplication/espaces/${SRC}/scenarios`, headers: h })).statusCode).toBe(401);
      expect((await server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: h, payload: corps })).statusCode).toBe(401);
      expect((await server.inject({ method: 'POST', url: '/ops/duplication', headers: h, payload: { ...corps, empreinte: 'a'.repeat(64) } })).statusCode).toBe(401);
    }
    expect(lus()).toBe(0);
    expect(ecrits).toEqual([]);
    await server.close();
  });

  it('les listes : espaces et scénarios ; 404 sur un identifiant mal formé', async () => {
    const { server } = monter();
    expect((await server.inject({ method: 'GET', url: '/ops/duplication/espaces', headers: ops })).json()).toEqual({
      espaces: [{ id: SRC, nom: 'Source', waba: true }, { id: DST, nom: 'Destination', waba: true }],
    });
    expect((await server.inject({ method: 'GET', url: `/ops/duplication/espaces/${SRC}/scenarios`, headers: ops })).json()).toEqual({
      scenarios: [{ id: WF, nom: 'Accueil' }],
    });
    expect((await server.inject({ method: 'GET', url: '/ops/duplication/espaces/pas-un-uuid/scenarios', headers: ops })).statusCode).toBe(404);
    await server.close();
  });

  it('l’aperçu dit ce qui sera débranché et créé, sans le graphe, et n’écrit rien', async () => {
    const { server, ecrits } = monter();
    const res = await server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: corps });
    expect(res.statusCode).toBe(200);
    const a = res.json<{ apercu: Record<string, unknown> }>().apercu;
    expect(a).toMatchObject({
      nomCopie: 'Accueil (copie)',
      debranches: [{ nodeId: 'a3', nom: 'Vers le RDV', type: 'aller_a', raison: 'aller_a' }],
      champsACreer: [{ key: 'ville', label: 'Ville', type: 'text' }],
      templatesAbsents: [],
      blocages: [],
    });
    expect(a).not.toHaveProperty('graphe');
    expect(ecrits).toEqual([]);
    await server.close();
  });

  it('corps mal formé : 400 ; identifiant qui n’est pas un UUID ou scénario hors de la source : 404', async () => {
    const { server } = monter();
    const post = (payload: unknown) => server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: payload as Record<string, unknown> });
    expect((await post({ source: SRC })).statusCode).toBe(400);
    expect((await post({ ...corps, scenarioId: 'pas-un-uuid' })).statusCode).toBe(404);
    expect((await post({ ...corps, scenarioId: INCONNU })).statusCode).toBe(404);
    await server.close();
  });

  it('🔴 les templates de la destination illisibles chez Meta : 422 lisible, jamais 5xx ni « aucun template »', async () => {
    const { server, ecrits } = monter({ templatesDe: async () => { throw new Error('jeton invalide'); } });
    const res = await server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: corps });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string }>().error).toContain('Meta');
    const exe = await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte: 'a'.repeat(64) } });
    expect(exe.statusCode).toBe(422);
    expect(ecrits).toEqual([]);
    await server.close();
  });

  it('🔴 une duplication bloquée (destination sans WABA) : 422 avec les blocages, rien n’est écrit', async () => {
    const { server, ecrits } = monter({ templatesDe: async () => null });
    const empreinte = await empreinteDe(server);
    const res = await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte } });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ blocages: string[] }>().blocages.join(' ')).toContain('WABA');
    expect(ecrits).toEqual([]);
    await server.close();
  });

  it('🔴 une empreinte qui n’est plus celle de l’état : 409 « relancez l’aperçu », rien n’est écrit', async () => {
    const { server, ecrits } = monter();
    const res = await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte: 'b'.repeat(64) } });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toContain('relancez l’aperçu');
    expect(ecrits).toEqual([]);
    await server.close();
  });

  it('🔴 une duplication vers la même destination déjà en cours : 409, rien n’est écrit', async () => {
    const verrous = verrousEnMemoire();
    await verrous.prendre([[`duplication-scenario:${DST}`, 60_000]]);
    const { server, ecrits } = monter({ verrous });
    const res = await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte: 'a'.repeat(64) } });
    expect(res.statusCode).toBe(409);
    expect(ecrits).toEqual([]);
    await server.close();
  });

  it('🔴 l’écriture qui échoue : 422 lisible, jamais 5xx, et le verrou est rendu', async () => {
    const { server, verrous } = monter({ ecrire: async () => { throw new Error('base en panne'); } });
    const empreinte = await empreinteDe(server);
    const res = await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte } });
    expect(res.statusCode).toBe(422);
    expect(verrous.tenues()).toEqual([]);
    await server.close();
  });

  it('🔴 la duplication : 201, le nom choisi, les blocs débranchés, les tags déclarés, et la trace porte l’exploitant', async () => {
    const { server, ecrits, tagsDeclares, verrous } = monter();
    const empreinte = await empreinteDe(server);
    const { resultat: res, lignes } = await capturerJournal(() => server.inject({
      method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte },
    }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ scenarioId: 'wf-copie', nom: 'Accueil (copie)', champsCrees: ['ville'], debranches: [{ nodeId: 'a3' }] });
    expect(ecrits).toEqual([{ destination: DST, nom: 'Accueil' }]);
    expect(tagsDeclares).toEqual([['vip']]);
    expect(lignes).toContainEqual(expect.objectContaining({ msg: 'ops_duplication_scenario', par: ADRESSE_OPS, source: SRC, destination: DST, copie: 'wf-copie' }));
    expect(verrous.tenues()).toEqual([]);
    await server.close();
  });

  it('les tags qui ne se déclarent pas ne changent rien au 201', async () => {
    const { server } = monter({ declareTags: async () => { throw new Error('tags en panne'); } });
    const empreinte = await empreinteDe(server);
    expect((await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte } })).statusCode).toBe(201);
    await server.close();
  });
});
