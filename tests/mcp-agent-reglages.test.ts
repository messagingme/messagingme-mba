import { describe, it, expect } from 'vitest';
import { OUTILS, outilsPour, type DepsMcp } from '../src/mcp/outils';
import { OutilNonActivable, type OutilBibliotheque, type Rattachement } from '../src/agent/catalog';
import { consommateurAgent } from '../src/agent/consommateur';
import { ESSAIS_AFFICHES } from '../src/agent/test-runs';
import { JOURS_CONSOMMATION } from '../src/http/agents';
import { drapeauDOutil } from '../src/http/agent-tools';

/**
 * LES RÉGLAGES DE L'AGENT IA DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 3a) : la bibliothèque et les outils d'un
 * agent passent par le MÊME catalogue que ses onglets (un faux dont les méthodes lisent `this`, qui note l'espace) ;
 * l'historique, la mention d'IA et la fiche de connaissance par les fonctions de leurs routes.
 */
const T = 't1';
const AGENT = '00000000-0000-4000-8000-0000000000a1';
const OUTIL = '00000000-0000-4000-8000-0000000000b1';
const OUTIL2 = '00000000-0000-4000-8000-0000000000b2';
/** Un outil hors de la bibliothèque : une action, un outil maison. */
const ACTION = '00000000-0000-4000-8000-0000000000b9';
const FICHE = '00000000-0000-4000-8000-0000000000f1';
const MOI = { userId: 'u1', autorisationId: 'aut-1' };
const outil = (nom: string) => {
  const o = OUTILS.find((x) => x.nom === nom);
  if (!o) throw new Error(`outil absent : ${nom}`);
  return o;
};

const biblio = (id: string, name: string): OutilBibliotheque => ({
  id, name, title: name, description: `l’outil ${name}`, nePasUtiliser: '', origin: 'maison', risk: 'lecture', sourceId: null,
  mcpNonActivable: null, mcpIndisponibleLe: null, mcpPropose: true, inappelable: null,
} as unknown as OutilBibliotheque);

class FauxCatalogue {
  readonly appels: string[] = [];
  refusRattachement: Rattachement | null = null;
  activationImpossible: string | null = null;
  private noter(quoi: string, tenant: string, ...reste: unknown[]) { this.appels.push([quoi, tenant, ...reste].join(':')); }
  async listCatalogue(tenant: string) { this.noter('catalogue', tenant); return tenant === T ? [biblio(OUTIL, 'chercher'), biblio(OUTIL2, 'crm')] : []; }
  async offrablesPour(tenant: string, consommateur: string) { this.noter('offrables', tenant, consommateur); return [biblio(OUTIL2, 'crm')]; }
  async rattacher(tenant: string, agentId: string, outilId: string): Promise<Rattachement> {
    this.noter('rattacher', tenant, agentId, outilId);
    return this.refusRattachement ?? { ok: true };
  }
  async detacher(tenant: string, agentId: string, outilId: string) { this.noter('detacher', tenant, agentId, outilId); return tenant === T; }
  async activer(tenant: string, agentId: string, outilId: string, actif: boolean, par: string) {
    this.noter('activer', tenant, agentId, outilId, actif, par);
    if (this.activationImpossible) throw new OutilNonActivable(this.activationImpossible);
    return tenant === T ? ({ id: outilId } as never) : null;
  }
}

function monter() {
  const catalogue = new FauxCatalogue();
  const reglages = { frequence: null as string | null, ecrits: [] as string[] };
  const journal: Array<{ action: string; userId: string | null; detail: unknown }> = [];
  const modifs: Array<{ tenant: string; agent: string; fiche: string; patch: unknown }> = [];
  const historique: Array<{ tenant: string; filtre: unknown }> = [];
  const deps = {
    bibliothequeOutils: catalogue,
    agentIa: {
      gestion: { agents: { complet: async (tenant: string, id: string) => (tenant === T && id === AGENT ? { id } : null) } },
      essai: { essais: { lister: async (tenant: string, agentId: string, limite: number) => [{ tenant, agentId, limite }] } },
      connaissance: {
        connaissance: {
          modifier: async (tenant: string, agent: string, fiche: string, patch: unknown) => {
            // Comme Postgres : un identifiant qui n'est pas un uuid fait lever la requête (22P02).
            if (!/^[0-9a-f-]{36}$/.test(fiche)) throw new Error('22P02 : invalid input syntax for type uuid');
            modifs.push({ tenant, agent, fiche, patch });
            return tenant === T && fiche === FICHE ? { id: fiche, ...(patch as object) } : null;
          },
        },
      },
    },
    historiqueReglages: { lister: async (tenant: string, filtre: unknown) => { historique.push({ tenant, filtre }); return [{ id: 'h1' }]; } },
    mentionIa: {
      get: async () => ({ mentionIaFrequence: reglages.frequence }),
      setMentionIaFrequence: async (tenant: string, f: string) => { reglages.ecrits.push(`${tenant}:${f}`); reglages.frequence = f; },
    },
    agentsConformite: { listerPourConformite: async (tenant: string) => (tenant === T ? [{ id: AGENT, label: 'Conseiller', status: 'active', mentionIa: 'session' }] : []) },
    sessionsAgents: {
      consommation: async (tenant: string, agentId: string, jours: number) => ({ sessions: 3, tokensEntree: 10, tokensSortie: 5, coutMicroEur: 1200, jours, tenant, agentId }),
      messagesTenus: async () => 42,
    },
    journal: async (_t: string, acteur: { userId: string | null }, action: string, _cible: unknown, detail: unknown) => { journal.push({ action, userId: acteur.userId, detail }); },
  } as unknown as DepsMcp;
  return { deps, catalogue, reglages, journal, modifs, historique };
}

describe('les réglages de l’agent IA depuis Claude (CSM, B10, livraison 3a)', () => {
  it('🔴 les écritures sont réservées à une personne ; les lectures ouvertes à une clé de lecture', () => {
    const cle = outilsPour({ scopes: ['mcp:read', 'mcp:write'], personne: null }).map((o) => o.nom);
    for (const nom of ['update_agent_tool', 'set_ai_disclosure', 'update_knowledge']) expect(cle, nom).not.toContain(nom);
    const lecture = outilsPour({ scopes: ['mcp:read'], personne: null }).map((o) => o.nom);
    for (const nom of ['list_agent_tool_library', 'list_agent_tests', 'get_settings_history', 'get_ai_disclosure', 'get_agent_usage']) {
      expect(lecture, nom).toContain(nom);
    }
  });

  it('list_agent_tool_library : la bibliothèque de l’espace, ou ce qu’un agent de l’espace peut encore recevoir', async () => {
    const { deps, catalogue } = monter();
    const tout = await outil('list_agent_tool_library').executer(deps, T, {}, MOI) as { outils: Array<{ id: string; name: string }> };
    expect(tout.outils.map((o) => o.name)).toEqual(['chercher', 'crm']);
    expect(tout.outils[0]).toMatchObject({ id: OUTIL, inappelable: null, mcp_propose: true });
    const offrables = await outil('list_agent_tool_library').executer(deps, T, { agent_id: AGENT }, MOI) as { outils: unknown[] };
    expect(offrables.outils).toHaveLength(1);
    expect(catalogue.appels).toEqual([`catalogue:${T}`, `offrables:${T}:${consommateurAgent(AGENT)}`]);
    // Un agent d'un autre espace, ou mal formé : introuvable, et rien n'est lu pour lui.
    for (const [tenant, agent] of [['t2', AGENT], [T, 'agent-1']] as const) {
      await expect(outil('list_agent_tool_library').executer(deps, tenant, { agent_id: agent }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    }
    expect(catalogue.appels).toHaveLength(2);
  });

  it('🔴 update_agent_tool : rattacher (la bibliothèque seule) puis activer au nom de la personne ; seul ce qui est donné change', async () => {
    const { deps, catalogue } = monter();
    expect(await outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: OUTIL, attached: true, enabled: true }, MOI))
      .toEqual({ agent_id: AGENT, tool_id: OUTIL, attached: true, enabled: true });
    expect(catalogue.appels).toEqual([`catalogue:${T}`, `rattacher:${T}:${AGENT}:${OUTIL}`, `activer:${T}:${AGENT}:${OUTIL}:true:u1`]);
    await outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: OUTIL, enabled: false }, MOI);
    expect(catalogue.appels.slice(3)).toEqual([`activer:${T}:${AGENT}:${OUTIL}:false:u1`]);
  });

  it('🔴 update_agent_tool ne détache jamais (une action et son historique partiraient) ; hors de la bibliothèque, rien n’est rattaché', async () => {
    const { deps, catalogue } = monter();
    await expect(outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: ACTION, attached: false }, MOI))
      .rejects.toMatchObject({ code: 'invalid_args', message: expect.stringMatching(/enabled false/) });
    expect(catalogue.appels).toEqual([]);
    await expect(outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: ACTION, attached: true }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    expect(catalogue.appels).toEqual([`catalogue:${T}`]);
  });

  it('update_agent_tool : un rattachement déjà fait vaut succès ; rattaché puis refusé à l’activation, le refus le dit', async () => {
    const { deps, catalogue } = monter();
    catalogue.refusRattachement = { ok: false, refus: 'deja_rattache' };
    expect(await outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: OUTIL, attached: true, enabled: true }, MOI))
      .toEqual({ agent_id: AGENT, tool_id: OUTIL, attached: true, enabled: true });
    catalogue.refusRattachement = null;
    catalogue.activationImpossible = 'outil MCP indisponible';
    await expect(outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: OUTIL, attached: true, enabled: true }, MOI))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringMatching(/^outil rattaché à l’agent, inactif ; son activation est refusée : outil MCP indisponible/) });
  });

  it('update_agent_tool : rien à changer, activer un outil détaché, une valeur bancale sont refusés ; les refus du catalogue gardent leur cause', async () => {
    const { deps, catalogue } = monter();
    for (const args of [{ agent_id: AGENT, tool_id: OUTIL }, { agent_id: AGENT, tool_id: OUTIL, attached: false, enabled: true }, { agent_id: AGENT, tool_id: OUTIL, enabled: 'oui' }]) {
      await expect(outil('update_agent_tool').executer(deps, T, args, MOI), JSON.stringify(args)).rejects.toMatchObject({ code: 'invalid_args' });
    }
    expect(catalogue.appels).toEqual([]);
    catalogue.refusRattachement = { ok: false, refus: 'nom_pris' };
    await expect(outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: OUTIL, attached: true }, MOI)).rejects.toMatchObject({ code: 'conflict' });
    catalogue.refusRattachement = { ok: false, refus: 'introuvable' };
    await expect(outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: OUTIL, attached: true }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    catalogue.activationImpossible = 'schéma non représentable';
    await expect(outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: OUTIL, enabled: true }, MOI))
      .rejects.toMatchObject({ code: 'conflict', message: 'schéma non représentable' });
    // Un outil ou un agent d'un autre espace : introuvable.
    catalogue.activationImpossible = null;
    await expect(outil('update_agent_tool').executer(deps, 't2', { agent_id: AGENT, tool_id: OUTIL, enabled: true }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    await expect(outil('update_agent_tool').executer(deps, T, { agent_id: AGENT, tool_id: 'outil-1', enabled: true }, MOI)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('🔴 drapeauDOutil (la route et l’outil) : poser un drapeau sans personne identifiée est refusé, sans rien écrire', async () => {
    const ecrits: string[] = [];
    const ecrire = async (t: string, a: string, i: string, v: boolean, par: string) => { ecrits.push(`${t}:${v}:${par}`); return { id: i } as never; };
    expect(await drapeauDOutil(ecrire, T, AGENT, OUTIL, true, '')).toMatchObject({ ok: false, statut: 403 });
    // Lever un drapeau, lui, ne nomme personne.
    expect(await drapeauDOutil(ecrire, T, AGENT, OUTIL, false, '')).toMatchObject({ ok: true });
    expect(ecrits).toEqual([`${T}:false:`]);
  });

  it('list_agent_tests et get_agent_usage : les lectures de la page de l’agent, sur un agent de l’espace', async () => {
    const { deps } = monter();
    expect(await outil('list_agent_tests').executer(deps, T, { agent_id: AGENT }, MOI)).toEqual({ essais: [{ tenant: T, agentId: AGENT, limite: ESSAIS_AFFICHES }] });
    expect(await outil('get_agent_usage').executer(deps, T, { agent_id: AGENT }, MOI)).toEqual({
      consommation: { sessions: 3, tokensEntree: 10, tokensSortie: 5, coutMicroEur: 1200, jours: JOURS_CONSOMMATION, tenant: T, agentId: AGENT },
      messages: 42, jours: JOURS_CONSOMMATION,
    });
    for (const nom of ['list_agent_tests', 'get_agent_usage']) {
      await expect(outil(nom).executer(deps, 't2', { agent_id: AGENT }, MOI), nom).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('get_settings_history : les refus de la route, la surface d’un agent filtrée sur lui', async () => {
    const { deps, historique } = monter();
    expect(await outil('get_settings_history').executer(deps, T, { surface: 'agent', agent_id: AGENT, limit: 5 }, MOI)).toEqual({ lignes: [{ id: 'h1' }], tronquee: false });
    expect(historique).toEqual([{ tenant: T, filtre: { surface: 'agent', surfaceId: AGENT, limite: 5 } }]);
    // Sans limite : 50 lignes, chacune porte l'état d'avant et d'après.
    await outil('get_settings_history').executer(deps, T, { surface: 'mba' }, MOI);
    expect(historique[1]).toEqual({ tenant: T, filtre: { surface: 'mba', limite: 50 } });
    for (const args of [{ surface: 'agent' }, { surface: 'mba', agent_id: AGENT }, { surface: 'autre' }]) {
      await expect(outil('get_settings_history').executer(deps, T, args, MOI), JSON.stringify(args)).rejects.toMatchObject({ code: 'invalid_args' });
    }
  });

  it('🔴 la mention d’IA : le défaut effectif à la lecture ; le réglage tracé au nom de la personne, seulement quand il change', async () => {
    const { deps, reglages, journal } = monter();
    expect(await outil('get_ai_disclosure').executer(deps, T, {}, MOI)).toMatchObject({ frequence: 'session', reglee: false, agents: [{ id: AGENT }] });
    expect(await outil('set_ai_disclosure').executer(deps, T, { frequency: 'chaque_message' }, MOI)).toEqual({ frequence: 'chaque_message' });
    await outil('set_ai_disclosure').executer(deps, T, { frequency: 'chaque_message' }, MOI);
    expect(reglages.ecrits).toEqual([`${T}:chaque_message`, `${T}:chaque_message`]);
    expect(journal).toEqual([{ action: 'ia.mention_reglee', userId: 'u1', detail: { frequence: 'chaque_message', frequenceAvant: null } }]);
    await expect(outil('set_ai_disclosure').executer(deps, T, { frequency: 'souvent' }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    expect(await outil('get_ai_disclosure').executer(deps, T, {}, MOI)).toMatchObject({ frequence: 'chaque_message', reglee: true });
  });

  it('update_knowledge : seul ce qui est donné change ; rien à changer, une fiche inconnue ou mal formée sont refusés', async () => {
    const { deps, modifs } = monter();
    expect(await outil('update_knowledge').executer(deps, T, { agent_id: AGENT, fiche_id: FICHE, corps: 'Ouvert le samedi.' }, MOI))
      .toEqual({ fiche: { id: FICHE, corps: 'Ouvert le samedi.' } });
    expect(modifs).toEqual([{ tenant: T, agent: AGENT, fiche: FICHE, patch: { corps: 'Ouvert le samedi.' } }]);
    await expect(outil('update_knowledge').executer(deps, T, { agent_id: AGENT, fiche_id: FICHE }, MOI)).rejects.toMatchObject({ code: 'invalid_args' });
    await expect(outil('update_knowledge').executer(deps, T, { agent_id: AGENT, fiche_id: '00000000-0000-4000-8000-0000000000f2', titre: 'Horaires' }, MOI))
      .rejects.toMatchObject({ code: 'not_found' });
    await expect(outil('update_knowledge').executer(deps, T, { agent_id: AGENT, fiche_id: 'fiche-1', titre: 'Horaires' }, MOI)).rejects.toMatchObject({ code: 'not_found' });
    expect(modifs).toHaveLength(2);
  });
});
