import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { OutilMcp } from './outils';
import { RefusOutil, familleDuRefus, texteObligatoire, valeurOuRefus } from './saisie';
import { AGENT_ID, ecriture, lecture, signataire } from './outils-agent';
import { drapeauDOutil, rattachementDOutil, type OutilsAgentDep } from '../http/agent-tools';
import type { AgentCatalogueRouteDeps } from '../http/agent-catalogue';
import { lireHistorique } from '../http/historique';
import { lireMentionIa, reglerMentionIa, type ReglagesDep } from '../http/settings';
import { JOURS_CONSOMMATION, type AgentsRouteDeps } from '../http/agents';
import { estUuid } from '../http/scope';
import { messageDuRefus, type OutilBibliotheque } from '../agent/catalog';
import { consommateurAgent } from '../agent/consommateur';
import { modifierFiche } from '../agent/connaissance';
import { MAX_CORPS, MAX_TITRE } from '../agent/scrape';
import { ESSAIS_AFFICHES } from '../agent/test-runs';
import { FREQUENCES_MENTION_IA } from '../agent/agent-store';
import { MAX_LIGNES_HISTORIQUE, type HistoriqueStore } from '../reglages/historique';
import { ECRANS, LISTES } from './ecran';

/**
 * LES RÉGLAGES DE L'AGENT IA DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 3a, plan
 * `docs/superpowers/plans/2026-11-26-csm-lot1-i-reste-du-lot.md`). 🔴 Aucune logique propre : la bibliothèque d'outils
 * et les outils d'un agent sont le MÊME catalogue que ses onglets (`rattachementDOutil`, `drapeauDOutil`, extraites de
 * leurs routes) ; l'historique, la mention d'IA et la fiche de connaissance passent par les fonctions de leurs routes
 * (`lireHistorique`, `reglerMentionIa`, `modifierFiche`) ; les essais gardés et la consommation sont les MÊMES lectures que
 * la page de l'agent. L'autonomie sur un appel irréversible, le branchement d'un connecteur et la suppression d'un agent
 * suivent (livraison 3b).
 */
export interface DepsAgentReglagesMcp {
  /** La bibliothèque d'outils de l'espace et les outils d'un agent : le MÊME catalogue que les onglets (`PgToolCatalog`). */
  bibliothequeOutils: Pick<OutilsAgentDep, 'offrablesPour' | 'rattacher' | 'detacher' | 'activer'> & AgentCatalogueRouteDeps;
  /** L'historique des réglages, le MÊME que l'écran (`PgHistoriqueStore`). */
  historiqueReglages: Pick<HistoriqueStore, 'lister'>;
  /** La mention d'IA : le MÊME réglage que Sécurité > IA (`PgSettingsStore`). */
  mentionIa: Pick<ReglagesDep, 'get' | 'setMentionIaFrequence'>;
  /** Ce que chaque agent dit de lui (`PgAgentStore`), sous le réglage de l'espace. */
  agentsConformite: { listerPourConformite(tenantId: string): Promise<Array<{ id: string; label: string; status: string; mentionIa: string }>> };
  /** La consommation et les messages d'un agent : les MÊMES lectures que sa page (`PgAgentSessionStore`). */
  sessionsAgents: AgentsRouteDeps['sessions'];
}

const OUTIL_ID = { type: 'string' as const, format: 'uuid', minLength: 1, maxLength: 100, description: 'The tool id (get_agent, list_agent_tool_library).' };
const AGENT_INCONNU = 'agent introuvable dans cet espace (list_agents)';
/** Rattacher un outil déjà donné à cet agent : le même état que demandé, donc un succès (l'outil est idempotent). */
const DEJA_RATTACHE = messageDuRefus({ ok: false, refus: 'deja_rattache' });
/** Les lignes d'historique rendues par défaut : chacune porte l'état d'avant et d'après, une fiche supprimée comprise. */
const LIGNES_HISTORIQUE_OUTIL = 50;

/** Ce qu'un outil de la bibliothèque montre à Claude : de quoi le choisir, sans sa mécanique. */
const vueBibliotheque = (o: OutilBibliotheque) => ({
  id: o.id, name: o.name, title: o.title, description: o.description, origin: o.origin, risk: o.risk,
  // Pourquoi un agent ne pourrait pas l'appeler : `null` quand il le peut.
  inappelable: o.inappelable, mcp_propose: o.mcpPropose,
  // Un outil de cet agent porte déjà ce nom : le rattachement sera refusé.
  nom_pris: o.nomPris,
});

/** Un booléen facultatif : absent, rien ne change (B0d) ; présent, un booléen et rien d'autre. */
function booleen(args: Record<string, unknown>, cle: string): boolean | undefined {
  const v = args[cle];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new RefusOutil(`${cle} : true ou false`, 'invalid_args');
  return v;
}

/** L'agent, vérifié dans l'espace avant toute lecture qui le suppose (une liste vide ne dirait pas « inconnu »). */
async function agentDeLEspace(deps: Parameters<OutilMcp['executer']>[0], tenantId: string, args: Record<string, unknown>): Promise<string> {
  const id = texteObligatoire(args, 'agent_id', 100);
  if (!estUuid(id) || (await deps.agentIa.gestion.agents.complet(tenantId, id)) === null) throw new RefusOutil(AGENT_INCONNU, 'not_found');
  return id;
}

export const OUTILS_AGENT_REGLAGES: OutilMcp[] = [
  {
    ...ficheOutilMcp('list_agent_tool_library'),
    fonction: null,
    description: 'The tool library of the workspace (connector calls and MCP server tools; built-in tools are given by '
      + 'set_agent_tools, actions by set_agent_action), as the Tools tab shows it. With agent_id: only the tools that can '
      + 'still be given to that agent (update_agent_tool then attaches one). inappelable says why an agent could not call '
      + 'a tool, null when it can; mcp_propose false: the MCP tool is not offered to the agents of the workspace; nom_pris: '
      + 'that agent already has a tool with this name.',
    annotations: lecture('List the agent tool library'),
    entree: {
      type: 'object',
      properties: { agent_id: { ...AGENT_ID, description: 'An agent id: only the tools it can still be given. Omitted: the whole library.' } },
      additionalProperties: false,
    },
    async executer(deps, tenantId, args) {
      if (args.agent_id === undefined) return { outils: (await deps.bibliothequeOutils.listCatalogue(tenantId)).map(vueBibliotheque) };
      const id = await agentDeLEspace(deps, tenantId, args);
      return { outils: (await deps.bibliothequeOutils.offrablesPour(tenantId, consommateurAgent(id))).map(vueBibliotheque) };
    },
  },
  {
    ...ficheOutilMcp('update_agent_tool'),
    fonction: null,
    description: 'Changes one tool of an AI agent, as its Tools tab does: attached true attaches a tool of the workspace '
      + 'library to this agent, disabled (list_agent_tool_library with agent_id gives them); enabled true exposes a tool '
      + 'of the agent to the model under the signed-in person\'s name, false withdraws it without deleting anything '
      + '(get_agent gives the ids of its tools). Only the fields provided change, what is omitted is not touched; attaching '
      + 'comes before enabling. Detaching is done in the console, which says what goes with it (an action and its history, '
      + 'a connector call without another agent); an action is deleted by delete_agent_action. Autonomy on an '
      + 'irreversible call is set in the console.',
    annotations: ecriture('Update a tool of an AI agent', true, false),
    entree: {
      type: 'object',
      properties: {
        agent_id: AGENT_ID,
        tool_id: OUTIL_ID,
        attached: { type: 'boolean', enum: [true], description: 'true attaches a library tool to this agent, disabled.' },
        enabled: { type: 'boolean', description: 'true enables the tool for this agent, false disables it.' },
      },
      required: ['agent_id', 'tool_id'],
      additionalProperties: false,
    },
    ecran: (args) => ECRANS.agent(args.agent_id, 'outils'),
    async executer(deps, tenantId, args, personne) {
      const par = signataire(personne);
      const id = texteObligatoire(args, 'agent_id', 100);
      const outil = texteObligatoire(args, 'tool_id', 100);
      const attache = booleen(args, 'attached');
      const actif = booleen(args, 'enabled');
      if (attache === undefined && actif === undefined) throw new RefusOutil('rien à changer : attached ou enabled', 'invalid_args');
      // 🔴 Détacher détruit une action et son historique, ou un appel de connecteur dont c'est le dernier agent : depuis
      // Claude, on retire un outil en le désactivant, ce qui ne détruit rien ; la console fait confirmer le reste.
      if (attache === false) {
        throw new RefusOutil('attached : true seulement. Pour retirer un outil à cet agent sans rien détruire : enabled false ; '
          + 'une action se supprime par delete_agent_action (son historique part avec) ; détacher se fait dans la console, qui '
          + 'dit ce qui part.', 'invalid_args');
      }
      if (!estUuid(id)) throw new RefusOutil(AGENT_INCONNU, 'not_found');
      const b = deps.bibliothequeOutils;
      if (attache === true) {
        // La bibliothèque seule : une action d'un autre agent, un outil maison ou réservé à l'agent de Meta n'en sont pas.
        if (!(await b.listCatalogue(tenantId)).some((o) => o.id === outil)) {
          throw new RefusOutil('cet outil n’est pas dans la bibliothèque de l’espace (list_agent_tool_library) : un outil maison '
            + 'se donne par set_agent_tools, une action par set_agent_action', 'not_found');
        }
        const r = await rattachementDOutil(b, tenantId, id, outil, true);
        if (!r.ok && r.erreur !== DEJA_RATTACHE) valeurOuRefus(r);
      }
      if (actif !== undefined) {
        const r = await drapeauDOutil((t, a, i, v, p) => b.activer(t, a, i, v, p), tenantId, id, outil, actif, par);
        // Rattaché dans ce même appel puis refusé à l'activation : le refus le dit, l'outil reste rattaché, inactif.
        if (!r.ok && attache === true) throw new RefusOutil(`outil rattaché à l’agent, inactif ; son activation est refusée : ${r.erreur}`, familleDuRefus(r.statut));
        valeurOuRefus(r);
      }
      return { agent_id: id, tool_id: outil, ...(attache === undefined ? {} : { attached: attache }), ...(actif === undefined ? {} : { enabled: actif }) };
    },
  },
  {
    ...ficheOutilMcp('list_agent_tests'),
    fonction: null,
    description: `The last tests of an AI agent kept from its sandbox (test_agent or the console), most recent first, `
      + `${ESSAIS_AFFICHES} at most: the conversation sent, the answer, how it ended, the tools it called and what it cost.`,
    annotations: lecture('List the tests of an AI agent'),
    entree: { type: 'object', properties: { agent_id: AGENT_ID }, required: ['agent_id'], additionalProperties: false },
    async executer(deps, tenantId, args) {
      const id = await agentDeLEspace(deps, tenantId, args);
      return { essais: await deps.agentIa.essai.essais.lister(tenantId, id, ESSAIS_AFFICHES) };
    },
  },
  {
    ...ficheOutilMcp('get_settings_history'),
    fonction: null,
    description: 'Who changed what in the settings of Meta\'s agent (surface mba) or of an AI agent (surface agent, with '
      + `agent_id), most recent first, as the History tab shows it, each line with the state before and after: `
      + `${LIGNES_HISTORIQUE_OUTIL} lines by default, ${MAX_LIGNES_HISTORIQUE} at most. tronquee: older lines exist.`,
    annotations: lecture('Read the settings history'),
    entree: {
      type: 'object',
      properties: {
        surface: { type: 'string', enum: ['mba', 'agent'], description: 'mba: Meta\'s agent of the workspace; agent: an AI agent.' },
        agent_id: { ...AGENT_ID, description: 'The AI agent, for surface agent only.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIGNES_HISTORIQUE, description: `Lines (1 to ${MAX_LIGNES_HISTORIQUE}).` },
      },
      required: ['surface'],
      additionalProperties: false,
    },
    async executer(deps, tenantId, args) {
      return valeurOuRefus(await lireHistorique({ historique: deps.historiqueReglages }, tenantId, {
        surface: args.surface,
        ...(args.agent_id === undefined ? {} : { agentId: args.agent_id }),
        limite: args.limit ?? LIGNES_HISTORIQUE_OUTIL,
      }));
    },
  },
  {
    ...ficheOutilMcp('get_ai_disclosure'),
    fonction: null,
    description: 'How often the AI agents of the workspace say that they are an AI (frequence: '
      + `${FREQUENCES_MENTION_IA.join(', ')}; reglee false: nothing was set and the default applies), and what each `
      + 'agent says. Meta\'s agent is not listed: Meta already writes "AI" under its messages.',
    annotations: lecture('Read the AI disclosure'),
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps, tenantId) {
      return lireMentionIa({ reglages: deps.mentionIa, agents: deps.agentsConformite }, tenantId);
    },
  },
  {
    ...ficheOutilMcp('set_ai_disclosure'),
    fonction: null,
    description: `Sets how often the AI agents say that they are an AI (${FREQUENCES_MENTION_IA.join(', ')}), as Security `
      + '> AI does, under the signed-in person\'s name. "jamais" is the brand\'s explicit choice: the obligation only '
      + 'applies when AI is not obvious from the context. There is no going back to "not set".',
    annotations: ecriture('Set the AI disclosure', true, false),
    entree: {
      type: 'object',
      properties: { frequency: { type: 'string', enum: [...FREQUENCES_MENTION_IA], description: 'The frequency.' } },
      required: ['frequency'],
      additionalProperties: false,
    },
    ecran: () => LISTES.securiteIa,
    async executer(deps, tenantId, args, personne) {
      const userId = signataire(personne);
      return valeurOuRefus(await reglerMentionIa({ reglages: deps.mentionIa, audit: deps.journal }, tenantId, args.frequency, { auth: { userId } }));
    },
  },
  {
    ...ficheOutilMcp('get_agent_usage'),
    fonction: null,
    description: `What an AI agent consumed over the last ${JOURS_CONSOMMATION} days, as its page shows it: conversations `
      + '(sessions), tokens, cost in micro-euros, and the messages exchanged in its conversations.',
    annotations: lecture('Read the usage of an AI agent'),
    entree: { type: 'object', properties: { agent_id: AGENT_ID }, required: ['agent_id'], additionalProperties: false },
    async executer(deps, tenantId, args) {
      const id = await agentDeLEspace(deps, tenantId, args);
      const [consommation, messages] = await Promise.all([
        deps.sessionsAgents.consommation(tenantId, id, JOURS_CONSOMMATION),
        deps.sessionsAgents.messagesTenus(tenantId, id, JOURS_CONSOMMATION),
      ]);
      return { consommation, messages, jours: JOURS_CONSOMMATION };
    },
  },
  {
    ...ficheOutilMcp('update_knowledge'),
    fonction: null,
    description: `Changes a knowledge entry of an AI agent (list_knowledge gives its id): its title (${MAX_TITRE} characters `
      + `at most), its body (${MAX_CORPS}), or both. Only the fields provided change, what is omitted is not touched.`,
    annotations: ecriture('Update a knowledge entry', true, false),
    entree: {
      type: 'object',
      properties: {
        agent_id: AGENT_ID,
        fiche_id: { type: 'string', format: 'uuid', minLength: 1, maxLength: 100, description: 'The entry id (list_knowledge).' },
        titre: { type: 'string', minLength: 1, maxLength: MAX_TITRE, description: 'The new topic of the entry.' },
        corps: { type: 'string', minLength: 1, maxLength: MAX_CORPS, description: 'What the agent can say about it.' },
      },
      required: ['agent_id', 'fiche_id'],
      additionalProperties: false,
    },
    ecran: (args) => ECRANS.agent(args.agent_id, 'connaissance'),
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const id = texteObligatoire(args, 'agent_id', 100);
      const fiche = texteObligatoire(args, 'fiche_id', 100);
      if (!estUuid(id)) throw new RefusOutil(AGENT_INCONNU, 'not_found');
      const r = valeurOuRefus(await modifierFiche(deps.agentIa.connaissance, tenantId, id, fiche, {
        ...(args.titre === undefined ? {} : { titre: args.titre }),
        ...(args.corps === undefined ? {} : { corps: args.corps }),
      }));
      return { fiche: r };
    },
  },
];
