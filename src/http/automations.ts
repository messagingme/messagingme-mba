import type { FastifyInstance } from 'fastify';
import { forbidNonAdmin } from '../auth/middleware';
import type { Guard } from '../auth/middleware';
import { AUTOMATION_TRIGGER_KINDS, OPERATEURS_CONVERSATION_ANALYSEE, OPERATEURS_DEVIENT, isAutomationTriggerKind, keywordsOf } from '../automation/match';
import { SENTIMENTS } from '../analysis/schema';
import { CLES_FILTRABLES, estCleFiltrable, lireFiltreFiche } from '../crm/filtre-fiche';
import { coerceConfigAvantDate, UNITES_DELAI, DELAI_MAX_MINUTES } from '../automation/avant-date';
import type { AutomationRow, AutomationTriggerKind } from '../automation/match';
import type { AutomationInput } from '../automation/store.pg';
import type { Rayon } from '../workflow/rayon';
import type { ActionDeLEspace } from '../agent/actions.pg';
import type { UserFieldDef } from '../crm/types';
import { STATUT_REFUS_OFFRE, corpsRefusFonction } from '../offres/refus';
import { espaceVerifie, estUuid, nonEmpty } from './scope';
import type { WorkflowGraph } from '../workflow/graph';
import { avertissementDeLAutomation } from '../workflow/fenetre-moteur';

/**
 * L'avertissement de fenêtre d'une automation, qui ne fait JAMAIS tomber la liste (relecture de 2b-1) : il ne fait que
 * prévenir, et un graphe illisible ou une analyse en échec laissent la ligne sans phrase.
 */
function avertir(...args: Parameters<typeof avertissementDeLAutomation>): string | null {
  try {
    return avertissementDeLAutomation(...args);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('avertissement de fenêtre ignoré:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Les automations, pour l'écran « Autres ». Chaque méthode nomme son rayon (menu « Scénario », lot 6) : cet écran ne lit,
 * ne modifie et ne supprime que le sien (`RAYON_DE_L_ECRAN`), même par identifiant.
 */
export interface AutomationsDep {
  list(tenantId: string, rayon: Rayon): Promise<AutomationRow[]>;
  /** Une automation par id (scopée tenant). Lecture ciblée : `list` est capée, donc aveugle au-delà du plafond. */
  getById(id: string, tenantId: string, rayon: Rayon): Promise<AutomationRow | null>;
  create(tenantId: string, input: AutomationInput): Promise<{ id: string }>;
  update(id: string, tenantId: string, rayon: Rayon, patch: Partial<Omit<AutomationInput, 'rayon'>>): Promise<boolean>;
  remove(id: string, tenantId: string, rayon: Rayon): Promise<boolean>;
}

/**
 * Le rayon de l'écran Automation (« Autres ») : celui du Builder. Il ne liste, ne crée, ne relit, ne modifie et ne supprime
 * que lui (décision 1 ; lot 6 pour les écritures par identifiant) : une ligne HubSpot ne s'y touche jamais, même par son
 * identifiant.
 */
const RAYON_DE_L_ECRAN = 'general' satisfies Rayon;

/**
 * Lot 6 du menu « Scénario » (décision 8, spec § 2.3) : le changement d'étape d'un deal devient une ligne d'Automation >
 * HubSpot. Il ne se crée plus ici ; une automation qui l'a déjà reste modifiable sous lui jusqu'à la bascule (6b).
 */
export const REFUS_ETAPE_DE_DEAL = 'Le changement d’étape d’un deal HubSpot se règle désormais dans Automation > HubSpot.';

export interface AutomationRouteDeps {
  automations: AutomationsDep;
  /** Les actions des agents IA de l'espace (`PgActionsAgent.listerDeLEspace`), pour le déclencheur `agent_action`. */
  actionsDeLEspace(tenantId: string): Promise<ActionDeLEspace[]>;
  /** Les définitions de champs de l'espace : un rappel ne peut lire qu'un champ date et heure existant. */
  champsDeLEspace(tenantId: string): Promise<Array<Pick<UserFieldDef, 'key' | 'type'>>>;
  /**
   * Le scénario ciblé est-il un scénario de CET espace et de CE rayon ? Garde d'appartenance (comme la campagne
   * workflow) et de cloisonnement (menu « Scénario », décision 1) : un scénario d'un autre rayon se refuse comme un
   * inconnu.
   */
  scenarioDuRayon(workflowId: string, tenantId: string, rayon: Rayon): Promise<boolean>;
  /**
   * Les graphes PUBLIÉS des scénarios de la liste, en une lecture, pour l'avertissement de fenêtre de chaque automation
   * (décision 17 : l'écran prévient, l'enregistrement passe toujours).
   */
  graphesPublies(tenantId: string, ids: readonly string[]): Promise<Map<string, WorkflowGraph>>;
  /**
   * L'offre de l'espace ouvre-t-elle l'analyse des conversations (l'Entreprise seule depuis la spec offres v2, livraison
   * 5) ? Un déclencheur né d'une analyse ne se crée pas sans elle : l'automation ne partirait jamais.
   */
  analyseOuverte(tenantId: string): Promise<boolean>;
}

/**
 * Les déclencheurs nés d'une analyse : ils ne partent que là où l'analyse tourne. PAS « risque élevé » : un STOP, un silence
 * ou un numéro injoignable le font monter sans aucune analyse (`src/engagement/risque.ts`).
 */
const DECLENCHEURS_D_ANALYSE: ReadonlySet<AutomationTriggerKind> = new Set(['conversation_analyzed', 'analyse_devient']);

/**
 * Les types qu'on crée depuis cet écran : ceux du chemin chaud moins `webhook`, que son propre écran possède, et moins le
 * changement d'étape d'un deal, parti sous Automation > HubSpot (lot 6). Dérivé de `AUTOMATION_TRIGGER_KINDS`, pour que le
 * message d'erreur cite tous les types.
 */
const TYPES_CREABLES_ICI = AUTOMATION_TRIGGER_KINDS.filter((k) => k !== 'webhook' && k !== 'hubspot_deal_stage');

/**
 * Borne haute de l'anti-rebond réglé : 7 jours, comme le gel de contrôle. Les défauts propres à un déclencheur
 * (30 jours pour « risque élevé », 7 pour « un champ d'analyse devient », `antiRebondParDefaut`) s'appliquent au
 * déclenchement, sans passer par cette borne.
 */
const MAX_COOLDOWN = 7 * 24 * 3600;
/** Plancher pour les déclencheurs nés d'une analyse : doit rester au-dessus du délai d'inactivité qui déclenche
 *  une analyse (25 min par défaut), sinon le scénario et l'analyse se relancent mutuellement. Voir `refuseIfLoopy`. */
const MIN_ANALYSIS_COOLDOWN = 3600;
/** Au plus dix filtres sur « conversation analysée » : une borne de donnée cliente, comme les filtres de contacts. */
const MAX_FILTRES_ANALYSE = 10;

/**
 * Un filtre de dernière analyse dans une config, relu par la règle des filtres de contacts et borné aux
 * opérateurs donnés. Rend la raison d'un refus, ou null. 🔴 Refuser plutôt que garder : une config qui ne se relit
 * pas ne déclencherait jamais, et l'automation paraîtrait active pour rien.
 */
function raisonFiltreAnalyse(x: unknown, operateurs: readonly string[]): string | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return 'filtre invalide (objet {cle, op, valeur})';
  const o = x as Record<string, unknown>;
  if (!estCleFiltrable(o.cle)) return `champ d'analyse invalide (${CLES_FILTRABLES.join(' | ')})`;
  if (typeof o.op !== 'string' || !operateurs.includes(o.op)) return `opérateur invalide pour ce déclencheur (${operateurs.join(' | ')})`;
  const lu = lireFiltreFiche(o.cle, o.op, o.valeur);
  return lu.ok ? null : lu.raison;
}

/**
 * Refuse une combinaison (type, anti-rebond) qui rouvrirait la boucle analyse <-> scénario. Raisonne sur l'état
 * effectif, jamais sur le seul corps : la boucle s'ouvre en baissant le délai comme en changeant de type.
 * Rend le message d'erreur, ou null.
 */
function refuseIfLoopy(kind: AutomationTriggerKind | undefined, cooldown: number | null | undefined): string | null {
  // « Un champ devient » aussi : son « devient » freine, mais une analyse qui oscille (négatif, neutre, négatif)
  // rouvrirait la même boucle avec un délai de zéro.
  if (kind !== 'conversation_analyzed' && kind !== 'analyse_devient') return null;
  if (cooldown === undefined || cooldown === null) return null; // null = défaut du serveur, largement au-dessus
  if (cooldown >= MIN_ANALYSIS_COOLDOWN) return null;
  const nom = kind === 'analyse_devient' ? '« un champ d’analyse devient »' : '« conversation analysée »';
  return `pour ${nom}, l'anti-rebond doit valoir au moins ${MIN_ANALYSIS_COOLDOWN} s (ou null pour le défaut) : le scénario rouvre l'analyse en écrivant, un délai plus court boucle`;
}

/** Config du déclencheur, validée selon son type. Renvoie un message d'erreur, ou null si tout va bien. */
function validateTriggerConfig(kind: AutomationTriggerKind, cfg: Record<string, unknown>): string | null {
  if (kind === 'keyword') {
    if (!Array.isArray(cfg.keywords)) return 'keywords (tableau) requis pour un déclencheur mot-clé';
    if (keywordsOf(cfg).length === 0) return 'au moins un mot-clé non vide est requis';
    if (cfg.mode !== undefined && cfg.mode !== 'contains' && cfg.mode !== 'equals') return "mode invalide ('contains' | 'equals')";
    return null;
  }
  if (kind === 'ctwa_ad') {
    // `adId` facultatif, contrairement au tag ou à l'étape de deal : vide veut dire « n'importe quelle pub »,
    // ce qui est le montage le plus courant et reste borné aux messages venus d'une pub. Fourni, il doit
    // être exploitable : un identifiant vide ne matcherait jamais et l'automation paraîtrait active pour rien.
    if (cfg.adId !== undefined && cfg.adId !== null && cfg.adId !== '' && !nonEmpty(cfg.adId)) {
      return 'adId invalide (identifiant de publicité, ou vide pour « n’importe quelle pub »)';
    }
    return null;
  }
  if (kind === 'tag_added') {
    // Sans tag, l'automation partirait sur n'importe quel tag posé : on refuse plutôt que de deviner.
    if (!nonEmpty(cfg.tag)) return 'tag requis pour un déclencheur « tag ajouté »';
    return null;
  }
  if (kind === 'conversation_analyzed') {
    // Les filtres sont facultatifs (aucun = déclenche à chaque analyse, choix explicite), mais s'ils sont fournis
    // ils doivent être exploitables : un sentiment hors nomenclature ne matcherait jamais. La liste des
    // sentiments vient du schéma de l'analyse, plus d'une copie.
    const s = cfg.sentiment;
    if (s !== undefined && s !== null && s !== '' && !(SENTIMENTS as readonly unknown[]).includes(s)) {
      return `sentiment invalide (${SENTIMENTS.map((v) => `'${v}'`).join(' | ')})`;
    }
    if (cfg.unresolvedOnly !== undefined && typeof cfg.unresolvedOnly !== 'boolean') return 'unresolvedOnly (booléen)';
    if (cfg.filtres !== undefined) {
      if (!Array.isArray(cfg.filtres) || cfg.filtres.length > MAX_FILTRES_ANALYSE) return `filtres (tableau d'au plus ${MAX_FILTRES_ANALYSE} filtres)`;
      for (const f of cfg.filtres) {
        const raison = raisonFiltreAnalyse(f, OPERATEURS_CONVERSATION_ANALYSEE);
        if (raison) return raison;
      }
    }
    return null;
  }
  if (kind === 'analyse_devient') {
    // Un champ, un opérateur, une valeur : le filtre que la nouvelle copie doit satisfaire et l'ancienne non.
    return raisonFiltreAnalyse(cfg, OPERATEURS_DEVIENT);
  }
  if (kind === 'hubspot_deal_stage') {
    // Sans étape, l'automation partirait sur tout changement d'étape du portail : on refuse plutôt que de
    // deviner. L'identifiant vient de HubSpot et est opaque : on vérifie qu'il est là, pas sa forme.
    if (!nonEmpty(cfg.stageId)) return 'stageId requis pour un déclencheur « étape de deal »';
    if (!nonEmpty(cfg.pipelineId)) return 'pipelineId requis pour un déclencheur « étape de deal »';
    // `stageLabel` est facultatif et décoratif (réaffiche « Devis envoyé » sans rappeler HubSpot). Il n'entre jamais
    // dans le matching : un renommage côté HubSpot casserait l'automation en silence.
    if (cfg.stageLabel !== undefined && typeof cfg.stageLabel !== 'string') return 'stageLabel (texte)';
    return null;
  }
  if (kind === 'avant_date') {
    // Un champ et un délai, sinon l'automation ne saurait ni quoi regarder ni quand partir. Même coercition que le
    // balayage : une config acceptée ici est exploitable là-bas. `sens` n'a rien à valider : absent ou aberrant, il
    // retombe sur « avant » (le refuser rejetterait des configurations déjà en base).
    if (!nonEmpty(cfg.fieldKey)) return 'fieldKey requis pour un déclencheur « avant ou après une date »';
    if (!coerceConfigAvantDate(cfg)) {
      return `délai invalide : un entier positif et une unité parmi ${UNITES_DELAI.join(' | ')}, sans dépasser ${DELAI_MAX_MINUTES / (24 * 60)} jours`;
    }
    return null;
  }
  if (kind === 'agent_action') {
    // Sans action, l'automation partirait sur toutes les actions de l'espace : on refuse plutôt que de deviner. Une action
    // d'un autre espace ne correspondrait jamais (les événements sont ceux de l'espace) : la forme suffit.
    if (!estUuid(cfg.actionId)) return 'actionId requis pour un déclencheur « action de l’agent IA » (l’identifiant de l’action)';
    return null;
  }
  if (kind === 'webhook') {
    // Fermé ici : les automations `webhook` sont possédées par un webhook entrant (écran Tools > Webhooks) et
    // exclues de cette liste. En créer une ici ferait une automation active que son écran ne montre pas.
    return 'un déclencheur « webhook » se configure depuis l’écran Tools > Webhooks';
  }
  // new_contact et risque_eleve : aucune config. Un type ajouté à `AUTOMATION_TRIGGER_KINDS` sans branche arrive
  // ici : se demander alors ce qu'il exige (analyse_devient l'a fait, juste au-dessus).
  return null;
}

/** Les références vivantes ne peuvent pas être validées par la seule forme du JSON. */
async function validateTriggerReferences(
  tenant: string,
  kind: AutomationTriggerKind,
  cfg: Record<string, unknown>,
  deps: AutomationRouteDeps,
): Promise<string | null> {
  if (kind === 'avant_date') {
    const champ = (await deps.champsDeLEspace(tenant)).find((f) => f.key === cfg.fieldKey);
    if (!champ) return 'fieldKey inconnu pour cet espace';
    if (champ.type !== 'datetime') return 'fieldKey doit désigner un champ « date et heure »';
  }
  if (kind === 'agent_action' && !(await deps.actionsDeLEspace(tenant)).some((a) => a.id === cfg.actionId)) {
    return 'actionId inconnu pour cet espace';
  }
  return null;
}

/**
 * Corps commun création/modification. Renvoie l'erreur (400) ou l'input normalisé, et à part la case d'accord marketing :
 * un booléen seulement (absent = inchangé, pour qu'une console d'avant restée ouverte n'efface rien). Son tampon
 * (`AutomationInput.accordMarketing`) n'est jamais lu du corps : la route le pose depuis la session.
 */
function parseBody(body: unknown, partial: boolean): { error: string } | { input: Partial<Omit<AutomationInput, 'rayon'>>; accord?: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Partial<AutomationInput> = {};
  if (b.accordMarketing !== undefined && typeof b.accordMarketing !== 'boolean') return { error: 'accordMarketing (booléen)' };
  const accord = b.accordMarketing as boolean | undefined;

  if (b.name !== undefined || !partial) {
    if (!nonEmpty(b.name)) return { error: 'name requis' };
    out.name = b.name.trim().slice(0, 120);
  }
  if (b.triggerKind !== undefined || !partial) {
    if (!isAutomationTriggerKind(b.triggerKind)) {
      return { error: `triggerKind invalide (${TYPES_CREABLES_ICI.map((k) => `'${k}'`).join(' | ')})` };
    }
    out.triggerKind = b.triggerKind;
  }
  if (b.triggerConfig !== undefined || !partial) {
    const cfg = b.triggerConfig;
    if (cfg !== undefined && (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg))) return { error: 'triggerConfig invalide (objet)' };
    out.triggerConfig = (cfg as Record<string, unknown>) ?? {};
  }
  if (b.workflowId !== undefined || !partial) {
    if (!nonEmpty(b.workflowId)) return { error: 'workflowId requis' };
    out.workflowId = b.workflowId;
  }
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return { error: 'enabled (booléen)' };
    out.enabled = b.enabled;
  } else if (!partial) {
    out.enabled = false; // une automation neuve ne part jamais sans activation explicite
  }
  if (b.conditionGroup !== undefined) {
    if (b.conditionGroup !== null && (typeof b.conditionGroup !== 'object' || Array.isArray(b.conditionGroup))) {
      return { error: 'conditionGroup invalide (objet ou null)' };
    }
    out.conditionGroup = b.conditionGroup;
  } else if (!partial) {
    out.conditionGroup = null;
  }
  if (b.startNodeId !== undefined) {
    if (b.startNodeId !== null && !nonEmpty(b.startNodeId)) return { error: 'startNodeId invalide (chaîne ou null)' };
    out.startNodeId = b.startNodeId === null ? null : (b.startNodeId as string);
  } else if (!partial) {
    out.startNodeId = null;
  }
  if (b.cooldownSeconds !== undefined) {
    const c = b.cooldownSeconds;
    if (c !== null && (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > MAX_COOLDOWN)) {
      return { error: `cooldownSeconds invalide (entier 0..${MAX_COOLDOWN}, ou null pour le défaut)` };
    }
    out.cooldownSeconds = c as number | null;
  } else if (!partial) {
    out.cooldownSeconds = null;
  }

  // La config n'a de sens que rapportée à son type. Sur un PATCH, modifier l'un sans l'autre laisserait passer
  // une config invalide (ex. `{triggerConfig:{keywords:[]}}` -> automation « active » mais qui ne part jamais) :
  // on exige donc les deux ensemble, plutôt que de valider à moitié.
  const kindGiven = out.triggerKind !== undefined;
  const cfgGiven = out.triggerConfig !== undefined;
  if (kindGiven !== cfgGiven) {
    return { error: 'triggerKind et triggerConfig se modifient ENSEMBLE (la config dépend du type de déclencheur)' };
  }
  if (kindGiven && cfgGiven) {
    const msg = validateTriggerConfig(out.triggerKind!, out.triggerConfig!);
    if (msg) return { error: msg };
  }
  return { input: out, accord };
}

/**
 * Le tampon de l'attestation, posé ICI depuis la session et jamais recopié du corps : cocher atteste au nom du compte
 * connecté (l'adresse et la date sont posées par la base), décocher efface, absent ne touche rien. Sur une automation
 * déjà attestée, le store garde le tampon d'origine.
 */
function tamponAccord(accord: boolean | undefined, userId: string | undefined): Pick<AutomationInput, 'accordMarketing'> {
  if (accord === undefined) return {};
  return { accordMarketing: accord ? { par: userId ?? null } : null };
}

/**
 * Automations : déclencher un scénario sur un événement. Lecture ouverte à tout compte authentifié, écritures
 * admin (une automation active écrit au client sans relecture humaine : c'est un pouvoir d'envoi).
 */
export function registerAutomations(app: FastifyInstance, deps: AutomationRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde };

  app.get('/tenants/:tenantId/automations', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const lues = await deps.automations.list(tenant, RAYON_DE_L_ECRAN);
    const graphes = await deps.graphesPublies(tenant, [...new Set(lues.map((a) => a.workflowId))]);
    const automations = lues.map((a) => {
      const graphe = graphes.get(a.workflowId);
      return { ...a, avertissementFenetre: graphe ? avertir(a.triggerKind, a.startNodeId, graphe) : null };
    });
    // L'adresse de l'admin qui a coché la case d'accord marketing ne sort que pour un admin (relecture du lot 3b) : un
    // agent lit la liste, il n'a pas à connaître l'adresse d'un collègue. Qui (son identifiant) et quand restent.
    if (req.auth?.role === 'admin') return reply.code(200).send({ automations });
    return reply.code(200).send({
      automations: automations.map((a) => (a.accordMarketing ? { ...a, accordMarketing: { ...a.accordMarketing, email: null } } : a)),
    });
  });

  // Le menu du déclencheur « action de l'agent IA » : les actions posées sur les agents de l'espace. Lecture ouverte à
  // tout compte authentifié, comme la liste des automations.
  app.get('/tenants/:tenantId/automations/actions-agent', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    return reply.code(200).send({ actions: await deps.actionsDeLEspace(tenant) });
  });

  app.post('/tenants/:tenantId/automations', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (forbidNonAdmin(req, reply)) return;
    const parsed = parseBody(req.body, false);
    if ('error' in parsed) return reply.code(400).send({ error: parsed.error });
    // L'écran Automation (« Autres ») ne crée que des automations du Builder ; un `rayon` du corps n'est jamais lu.
    const input = { ...parsed.input, rayon: RAYON_DE_L_ECRAN } as AutomationInput;
    // Lot 6 : le changement d'étape d'un deal se crée sous Automation > HubSpot, plus ici.
    if (input.triggerKind === 'hubspot_deal_stage') return reply.code(400).send({ error: REFUS_ETAPE_DE_DEAL });
    if (DECLENCHEURS_D_ANALYSE.has(input.triggerKind) && !(await deps.analyseOuverte(tenant))) {
      return reply.code(STATUT_REFUS_OFFRE).send(corpsRefusFonction('analyse'));
    }
    // 🔴 Le scénario ciblé doit appartenir à l'espace, sinon une automation d'un client démarrerait le scénario
    // d'un autre.
    if (!(await deps.scenarioDuRayon(input.workflowId, tenant, input.rayon))) {
      return reply.code(400).send({ error: 'workflowId inconnu pour ce tenant' });
    }
    const reference = await validateTriggerReferences(tenant, input.triggerKind, input.triggerConfig, deps);
    if (reference) return reply.code(400).send({ error: reference });
    const boucle = refuseIfLoopy(input.triggerKind, input.cooldownSeconds);
    if (boucle) return reply.code(400).send({ error: boucle });
    const { id } = await deps.automations.create(tenant, { ...input, ...tamponAccord(parsed.accord, req.auth?.userId) });
    // La réponse rend le booléen reçu, jamais le tampon : il se relit par la liste.
    return reply.code(201).send({ id, ...input, ...(parsed.accord === undefined ? {} : { accordMarketing: parsed.accord }) });
  });

  app.patch('/tenants/:tenantId/automations/:id', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (forbidNonAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const parsed = parseBody(req.body, true);
    if ('error' in parsed) return reply.code(400).send({ error: parsed.error });
    // La case seule est une modification : cocher ou décocher sans renvoyer le déclencheur.
    if (Object.keys(parsed.input).length === 0 && parsed.accord === undefined) return reply.code(400).send({ error: 'rien à modifier' });
    if (parsed.input.workflowId !== undefined) {
      // Le scénario visé doit être du rayon de l'AUTOMATION, relu en base : le rayon ne se modifie pas.
      const visee = await deps.automations.getById(id, tenant, RAYON_DE_L_ECRAN);
      if (!visee) return reply.code(404).send({ error: 'automation inconnue' });
      if (!(await deps.scenarioDuRayon(parsed.input.workflowId, tenant, visee.rayon))) {
        return reply.code(400).send({ error: 'workflowId inconnu pour ce tenant' });
      }
    }
    // Relire l'état quand le corps ne suffit pas : un changement de délai peut rouvrir une boucle, et une
    // activation seule ne doit pas ranimer une référence supprimée depuis l'enregistrement précédent.
    const verifieBoucle = parsed.input.triggerKind !== undefined || parsed.input.cooldownSeconds !== undefined;
    const besoinRelecture = (verifieBoucle && (parsed.input.triggerKind === undefined || parsed.input.cooldownSeconds === undefined))
      || (parsed.input.enabled === true && parsed.input.triggerKind === undefined);
    const courant = besoinRelecture ? await deps.automations.getById(id, tenant, RAYON_DE_L_ECRAN) : null;
    if (besoinRelecture && !courant) return reply.code(404).send({ error: 'automation inconnue' });
    // Passer à un déclencheur d'analyse est une création ; une automation qui l'a déjà (un espace descendu de
    // l'Entreprise) reste modifiable sous lui. Le changement d'étape d'un deal de même (lot 6) : il ne se crée plus ici.
    const kindDemande = parsed.input.triggerKind;
    const versAnalyseFermee = kindDemande !== undefined && DECLENCHEURS_D_ANALYSE.has(kindDemande) && !(await deps.analyseOuverte(tenant));
    if (versAnalyseFermee || kindDemande === 'hubspot_deal_stage') {
      const avant = courant ?? await deps.automations.getById(id, tenant, RAYON_DE_L_ECRAN);
      if (!avant) return reply.code(404).send({ error: 'automation inconnue' });
      if (avant.triggerKind !== kindDemande) {
        return versAnalyseFermee
          ? reply.code(STATUT_REFUS_OFFRE).send(corpsRefusFonction('analyse'))
          : reply.code(400).send({ error: REFUS_ETAPE_DE_DEAL });
      }
    }
    if (parsed.input.triggerKind !== undefined || parsed.input.enabled === true) {
      const reference = await validateTriggerReferences(
        tenant,
        (parsed.input.triggerKind ?? courant!.triggerKind),
        (parsed.input.triggerConfig ?? courant!.triggerConfig),
        deps,
      );
      if (reference) return reply.code(400).send({ error: reference });
    }
    if (verifieBoucle) {
      const kindEffectif = parsed.input.triggerKind ?? courant?.triggerKind;
      const cooldownEffectif = parsed.input.cooldownSeconds !== undefined ? parsed.input.cooldownSeconds : courant?.cooldownSeconds;
      const boucle = refuseIfLoopy(kindEffectif, cooldownEffectif);
      if (boucle) return reply.code(400).send({ error: boucle });
    }
    const ok = await deps.automations.update(id, tenant, RAYON_DE_L_ECRAN, { ...parsed.input, ...tamponAccord(parsed.accord, req.auth?.userId) });
    if (!ok) return reply.code(404).send({ error: 'automation inconnue' });
    return reply.code(200).send({ id, ...parsed.input, ...(parsed.accord === undefined ? {} : { accordMarketing: parsed.accord }) });
  });

  app.delete('/tenants/:tenantId/automations/:id', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    if (forbidNonAdmin(req, reply)) return;
    const { id } = req.params as { id: string };
    const ok = await deps.automations.remove(id, tenant, RAYON_DE_L_ECRAN);
    if (!ok) return reply.code(404).send({ error: 'automation inconnue' });
    return reply.code(204).send();
  });
}
