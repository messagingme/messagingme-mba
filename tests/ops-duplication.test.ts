import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer } from '../src/server';
import { signSession } from '../src/auth/token';
import { accesOps, ADRESSE_OPS, SECRET_OPS } from './acces-ops';
import { FakeQueue } from './fake-queue';
import { capturerJournal } from './journal';
import { verrousEnMemoire } from './verrous';
import { creerDuplicationScenario, type DependancesDuplicationScenario } from '../src/ops/duplication/service';
import type { EtatEnBase } from '../src/ops/duplication/store.pg';
import type { TemplateDeLaWaba } from '../src/ops/duplication/plan';
import type { EntreeMeta } from '../src/ops/duplication/meta-execution';
import type { TemplateSummary } from '../src/meta/templates';
import { TokenInvalidError } from '../src/meta/credentials';
import { MetaApiError } from '../src/meta/errors';

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
  dependances: { agents: [], requetes: [], sources: [], modelesEmail: [] },
  nomsPris: { agents: [], requetes: [], sources: [], modelesEmail: [], outils: [], flows: [] },
};

/** Le template `bienvenue` tel que la source le rend en entier (lot 3). */
const BIENVENUE: TemplateSummary = {
  id: 'm1', name: 'bienvenue', status: 'APPROVED', category: 'MARKETING', language: 'fr', body: 'Bonjour', headerFormat: null,
  isCarousel: false, editable: true,
};

/** Le même scénario, avec un bloc agent IA : de quoi cocher une dépendance (lot 2). */
const AGENT = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
const ETAT_AVEC_AGENT: EtatEnBase = {
  ...ETAT,
  scenario: {
    ...ETAT.scenario,
    graphe: { ...ETAT.scenario.graphe, nodes: [...ETAT.scenario.graphe.nodes, { id: 'g5', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: AGENT } }] },
  },
  dependances: { agents: [{ id: AGENT, label: 'Conseiller', fiches: 2, outils: [] }], requetes: [], sources: [], modelesEmail: [] },
};

interface Options {
  etat?: EtatEnBase;
  templatesDe?: DependancesDuplicationScenario['templatesDe'];
  ecrire?: DependancesDuplicationScenario['store']['ecrire'];
  declareTags?: DependancesDuplicationScenario['declareTags'];
  verrous?: ReturnType<typeof verrousEnMemoire>;
  modelesDe?: DependancesDuplicationScenario['modelesDe'];
  executerChezMeta?: DependancesDuplicationScenario['executerChezMeta'];
  creditIaOuvert?: boolean;
}

function monter(o: Options = {}) {
  const ecrits: Array<{ destination: string; nom: string; agentsCopies: string[]; flows: string[] }> = [];
  const tagsDeclares: string[][] = [];
  const traces: Array<{ tenantId: string; email: string | null; action: string; details?: unknown }> = [];
  const chezMeta: Array<{ destination: string; entree: EntreeMeta }> = [];
  let lectures = 0;
  let creditsLus = 0;
  const verrous = o.verrous ?? verrousEnMemoire();
  type Store = DependancesDuplicationScenario['store'];
  /**
   * Même forme qu'en production : une instance dont les méthodes dépendent de `this`. Un futur câblage qui recopierait
   * une méthode du store au lieu de passer l'instance ferait donc tomber toute cette suite.
   */
  class StoreDeTest {
    readonly #receveur = 'store-de-test';

    #verifierReceveur(): void {
      if (this.#receveur !== 'store-de-test') throw new Error('méthode du store détachée de son instance');
    }

    espaces(): ReturnType<Store['espaces']> {
      this.#verifierReceveur();
      lectures += 1;
      return Promise.resolve([{ id: SRC, nom: 'Source', waba: true }, { id: DST, nom: 'Destination', waba: true }]);
    }

    scenarios(t: string): ReturnType<Store['scenarios']> {
      this.#verifierReceveur();
      lectures += 1;
      return Promise.resolve(t === SRC ? [{ id: WF, nom: 'Accueil' }] : []);
    }

    lireEtat(s: string, w: string, d: string): ReturnType<Store['lireEtat']> {
      this.#verifierReceveur();
      lectures += 1;
      return Promise.resolve(s === SRC && w === WF && d === DST ? (o.etat ?? ETAT) : null);
    }

    flowsSource(): ReturnType<Store['flowsSource']> {
      this.#verifierReceveur();
      return Promise.resolve([]);
    }

    ecrire(...args: Parameters<Store['ecrire']>): ReturnType<Store['ecrire']> {
      this.#verifierReceveur();
      if (o.ecrire) return o.ecrire(...args);
      const [destination, , scenario, plan, flows] = args;
      ecrits.push({
        destination,
        nom: scenario.nom,
        agentsCopies: plan.copies.agents.map((a) => a.id),
        flows: [...(flows ?? new Map()).keys()],
      });
      return Promise.resolve({
        scenarioId: 'wf-copie', nom: `${scenario.nom} (copie)`, champsCrees: ['ville'], declencheursCopies: 0,
        dependancesCopiees: { agents: plan.copies.agents.map((a) => a.label), requetes: [], modelesEmail: [], sourcesAvecSecret: [] },
        debranches: plan.graphe.debranches,
      });
    }
  }
  const deps: DependancesDuplicationScenario = {
    store: new StoreDeTest(),
    templatesDe: o.templatesDe ?? (async (): Promise<TemplateDeLaWaba[]> => [{ nom: 'bienvenue', langue: 'fr', statut: 'APPROVED', boutons: [] }]),
    modelesDe: o.modelesDe ?? (async () => [BIENVENUE]),
    indicesDe: async () => [],
    executerChezMeta: async (destination, entree) => {
      chezMeta.push({ destination, entree });
      return o.executerChezMeta ? o.executerChezMeta(destination, entree) : { ok: true, flows: new Map(), crees: [], champsCrees: [] };
    },
    offreOuvreScenarios: async () => true,
    creditIaOuvert: async () => { creditsLus += 1; return o.creditIaOuvert ?? true; },
    declareTags: o.declareTags ?? (async (_t, tags) => { tagsDeclares.push(tags); }),
    verrous,
    audit: async (tenantId, actor, action, _cible, details) => { traces.push({ tenantId, email: actor.email, action, details }); },
  };
  const server = buildServer({ queue: new FakeQueue(), auth: acces.auth, opsDuplication: creerDuplicationScenario(deps) });
  return { server, ecrits, tagsDeclares, traces, chezMeta, verrous, lus: () => lectures, creditsLus: () => creditsLus };
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
    expect(ecrits).toEqual([{ destination: DST, nom: 'Accueil', agentsCopies: [], flows: [] }]);
    expect(tagsDeclares).toEqual([['vip']]);
    expect(lignes).toContainEqual(expect.objectContaining({ msg: 'ops_duplication_scenario', par: ADRESSE_OPS, source: SRC, destination: DST, copie: 'wf-copie' }));
    expect(verrous.tenues()).toEqual([]);
    await server.close();
  });

  it('les tags qui ne se déclarent pas ne changent rien au 201, et l’échec est journalisé', async () => {
    const { server } = monter({ declareTags: async () => { throw new Error('tags en panne'); } });
    const empreinte = await empreinteDe(server);
    const { resultat: res, lignes } = await capturerJournal(() => server.inject({
      method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte },
    }));
    expect(res.statusCode).toBe(201);
    expect(lignes).toContainEqual(expect.objectContaining({ msg: 'ops_duplication_tags_non_declares', destination: DST }));
    await server.close();
  });
});

describe('lot 2 : les dépendances cochées, la trace, les messages', () => {
  it('l’aperçu rend les dépendances du scénario, avec le nom qu’aurait leur copie', async () => {
    const { server } = monter({ etat: ETAT_AVEC_AGENT });
    const a = (await server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: corps })).json<{ apercu: { dependances: { agents: Array<{ nom: string; nomCopie: string }> } } }>().apercu;
    expect(a.dependances.agents).toEqual([expect.objectContaining({ nom: 'Conseiller', nomCopie: 'Conseiller' })]);
    await server.close();
  });

  it('un agent proposé à une destination sans crédit IA : signalé ; sans agent, le crédit n’est pas lu', async () => {
    const sansCredit = monter({ etat: ETAT_AVEC_AGENT, creditIaOuvert: false });
    const a = (await sansCredit.server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: corps }))
      .json<{ apercu: { signaux: string[]; blocages: string[] } }>().apercu;
    expect(a.signaux.some((s) => s.includes('crédit IA'))).toBe(true);
    expect(a.blocages).toEqual([]);
    await sansCredit.server.close();
    const sansAgent = monter({ creditIaOuvert: false });
    await sansAgent.server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: corps });
    expect(sansAgent.creditsLus()).toBe(0);
    await sansAgent.server.close();
  });

  it('🔴 une case qui désigne ce que le scénario ne désigne pas : 400, rien n’est écrit', async () => {
    const { server, ecrits } = monter({ etat: ETAT_AVEC_AGENT });
    const empreinte = await empreinteDe(server);
    const res = await server.inject({
      method: 'POST', url: '/ops/duplication', headers: ops,
      payload: { ...corps, empreinte, dupliquer: { agents: [INCONNU], requetes: [], modelesEmail: [] } },
    });
    expect(res.statusCode).toBe(400);
    expect(ecrits).toEqual([]);
    await server.close();
  });

  it('🔴 l’agent coché part avec le scénario ; la trace est écrite DANS la destination, au nom de l’exploitant', async () => {
    const { server, ecrits, traces } = monter({ etat: ETAT_AVEC_AGENT });
    const empreinte = await empreinteDe(server);
    const res = await server.inject({
      method: 'POST', url: '/ops/duplication', headers: ops,
      payload: { ...corps, empreinte, dupliquer: { agents: [AGENT], requetes: [], modelesEmail: [] } },
    });
    expect(res.statusCode).toBe(201);
    expect(ecrits).toEqual([{ destination: DST, nom: 'Accueil', agentsCopies: [AGENT], flows: [] }]);
    expect(res.json()).toMatchObject({ dependancesCopiees: { agents: ['Conseiller'] } });
    expect(traces).toEqual([{
      tenantId: DST, email: ADRESSE_OPS, action: 'ops.scenario_duplique',
      details: { scenario: 'Accueil (copie)', copies: { agents: ['Conseiller'], requetes: [], modelesEmail: [], sourcesAvecSecret: [], templates: [], flows: [] } },
    }]);
    await server.close();
  });

  it('un jeton WhatsApp invalide dans la destination : un message qui dit quoi faire, pas « réessayez »', async () => {
    const { server } = monter({ templatesDe: async (t) => { if (t === DST) throw new TokenInvalidError('waba-1'); return []; } });
    const res = await server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: corps });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string }>().error).toContain('reconnectez son numéro');
    await server.close();
  });

  it('une WABA sans jeton propre, que le jeton global ne peut pas lire : « vérifiez que son compte est relié », pas « réessayez »', async () => {
    // Le refus de permission que rend Meta au jeton global (code 200) : durable, réessayer n'y change rien.
    const refus = new MetaApiError(403, { message: 'Permissions error', code: 200, type: 'OAuthException' });
    const { server } = monter({ templatesDe: async (t) => { if (t === DST) throw refus; return []; } });
    const res = await server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: corps });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string }>().error).toContain('relié à notre application');
    await server.close();
  });
});

describe('lot 3 : les templates et les Flows recréés chez Meta', () => {
  const SANS_TEMPLATE = async (): Promise<TemplateDeLaWaba[]> => [];
  const cocher = (templates: Array<{ nom: string; langue: string }>) => ({ agents: [], requetes: [], modelesEmail: [], templates });

  it('🔴 un template coché se recrée chez Meta AVANT l’écriture en base, et la réponse le nomme', async () => {
    const { server, chezMeta, ecrits, traces } = monter({
      templatesDe: SANS_TEMPLATE,
      executerChezMeta: async () => ({ ok: true, flows: new Map(), crees: [{ sorte: 'template', nom: 'bienvenue', langue: 'fr', statut: 'PENDING', categorie: 'marketing' }], champsCrees: [] }),
    });
    const empreinte = await empreinteDe(server);
    const res = await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte, dupliquer: cocher([{ nom: 'bienvenue', langue: 'fr' }]) } });
    expect(res.statusCode).toBe(201);
    expect(chezMeta.map((x) => [x.destination, x.entree.copies.templates])).toEqual([[DST, [{ nom: 'bienvenue', langue: 'fr', flows: [] }]]]);
    expect(ecrits).toHaveLength(1);
    expect(res.json<{ crees: unknown[] }>().crees).toEqual([{ sorte: 'template', nom: 'bienvenue', langue: 'fr', statut: 'PENDING', categorie: 'marketing' }]);
    expect(traces.at(-1)!.details).toMatchObject({ copies: { templates: ['bienvenue (fr)'], flows: [] } });
    await server.close();
  });

  it('🔴 si la base échoue après Meta : les objets déjà créés sont rendus, sans second appel à Meta', async () => {
    let metaTerminee = false;
    let appelsMeta = 0;
    const { server, verrous } = monter({
      templatesDe: SANS_TEMPLATE,
      executerChezMeta: async () => {
        appelsMeta += 1;
        metaTerminee = true;
        return {
          ok: true,
          flows: new Map(),
          crees: [{ sorte: 'template', nom: 'bienvenue', langue: 'fr', statut: 'PENDING', categorie: 'marketing' }],
          champsCrees: [],
        };
      },
      ecrire: async () => {
        expect(metaTerminee).toBe(true);
        throw new Error('base en panne après Meta');
      },
    });
    const empreinte = await empreinteDe(server);
    const res = await server.inject({
      method: 'POST', url: '/ops/duplication', headers: ops,
      payload: { ...corps, empreinte, dupliquer: cocher([{ nom: 'bienvenue', langue: 'fr' }]) },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string; crees: unknown[] }>()).toMatchObject({
      error: expect.stringContaining('créé chez Meta y reste'),
      crees: [{ sorte: 'template', nom: 'bienvenue', langue: 'fr' }],
    });
    expect(appelsMeta).toBe(1);
    expect(verrous.tenues()).toEqual([]);
    await server.close();
  });

  it('🔴 un refus chez Meta : 422 qui liste ce qui a déjà été créé, et RIEN d’écrit en base', async () => {
    const { server, ecrits } = monter({
      templatesDe: SANS_TEMPLATE,
      executerChezMeta: async () => ({
        ok: false, refus: 'le template bienvenue (fr) : Meta a refusé le modèle', crees: [{ sorte: 'flow', nom: 'Inscription', id: '901', publie: true }], champsCrees: [],
      }),
    });
    const empreinte = await empreinteDe(server);
    const res = await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte, dupliquer: cocher([{ nom: 'bienvenue', langue: 'fr' }]) } });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string; crees: unknown[] }>()).toMatchObject({ crees: [{ sorte: 'flow', id: '901' }] });
    expect(res.json<{ error: string }>().error).toContain('arrêtée chez Meta');
    expect(ecrits).toEqual([]);
    await server.close();
  });

  it('sans case cochée : rien chez Meta, et la copie s’écrit quand même (le bloc arrivera débranché)', async () => {
    const { server, chezMeta, ecrits } = monter({ templatesDe: SANS_TEMPLATE });
    const empreinte = await empreinteDe(server);
    const apercu = await server.inject({ method: 'POST', url: '/ops/duplication/apercu', headers: ops, payload: corps });
    expect(apercu.json<{ apercu: { blocages: string[]; meta: { templates: Array<{ etat: string }> } } }>().apercu)
      .toMatchObject({ blocages: [], meta: { templates: [{ etat: 'a_recreer' }] } });
    const res = await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte } });
    expect(res.statusCode).toBe(201);
    expect(chezMeta).toEqual([]);
    expect(ecrits).toHaveLength(1);
    await server.close();
  });

  it('l’empreinte se compare AVANT les cases : un état changé et une case invalide disent « relancez l’aperçu »', async () => {
    let appels = 0;
    const { server } = monter({
      templatesDe: async () => [{ nom: 'bienvenue', langue: 'fr', statut: (appels += 1) === 1 ? 'APPROVED' : 'PENDING', boutons: [] }],
    });
    const empreinte = await empreinteDe(server);
    const res = await server.inject({
      method: 'POST', url: '/ops/duplication', headers: ops,
      payload: { ...corps, empreinte, dupliquer: { agents: [INCONNU], requetes: [], modelesEmail: [] } },
    });
    expect(res.statusCode).toBe(409);
    await server.close();
  });

  it('le bail du verrou couvre les appels à Meta : à 4 minutes, une autre duplication vers la même destination attend encore', async () => {
    let maintenant = 0;
    const verrous = verrousEnMemoire(() => maintenant);
    let pendantMeta: unknown = 'non joué';
    const { server } = monter({
      templatesDe: SANS_TEMPLATE,
      verrous,
      executerChezMeta: async () => {
        maintenant = 4 * 60_000;
        pendantMeta = await verrous.prendre([[`duplication-scenario:${DST}`, 1_000]]);
        return { ok: true, flows: new Map(), crees: [], champsCrees: [] };
      },
    });
    const empreinte = await empreinteDe(server);
    await server.inject({ method: 'POST', url: '/ops/duplication', headers: ops, payload: { ...corps, empreinte, dupliquer: cocher([{ nom: 'bienvenue', langue: 'fr' }]) } });
    expect(pendantMeta).toBeNull();
    await server.close();
  });
});
