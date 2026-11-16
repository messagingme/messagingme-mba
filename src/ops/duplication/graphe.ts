import type { WorkflowGraph, WorkflowNode, WorkflowNodeType } from '../../workflow/graph';
import { mintNodeCodes } from '../../workflow/node-codes';
import { famillesDeCondition } from '../../workflow/conditions';
import { emailRecipientsOf, sourceDuBlocJs } from '../../workflow/engine';
import { reglagesQuestion } from '../../workflow/question-piece';
import { nomDuBloc } from '../../workflow/aller-a';
import { tagsInGraph } from '../../workflow/tags-du-graphe';
import { parseParamHints } from '../../crm/template';
import { isSystemFieldKey } from '../../crm/fields';
import { sousActions, champsAVider } from '../../../web/lib/partage/actions-bloc';
import { lignesDuBloc } from '../../../web/lib/partage/extraire-json';

/**
 * LA COPIE D'UN GRAPHE VERS UN AUTRE ESPACE (duplication depuis /ops, lot 1 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`, « Ce que devient chaque bloc »).
 * Pur : aucune IO.
 *
 * Trois sorts possibles pour un bloc :
 *  - DÉBRANCHÉ : il pointe un objet de l'espace source (un bloc d'un scénario, un membre, un agent, un appel de la
 *    bibliothèque, une boîte et un modèle d'e-mail, un Flow de la WABA). Ses références sont vidées, le bloc reste, et
 *    il est listé pour le récapitulatif. Un bloc vide se joue en passe-plat (`actionOf` rend null), et « assigner »
 *    sans personne envoie la conversation au pot commun.
 *  - COLLECTÉ : il nomme ce qui se recrée dans la destination par son NOM (clés de champ, tags, templates). Le bloc
 *    passe tel quel ; le plan (`plan.ts`) décide de créer, de réutiliser ou de bloquer.
 *  - RECOPIÉ : il ne porte rien de propre à l'espace.
 *
 * 🔴 LE `switch` EST EXHAUSTIF SUR `WorkflowNodeType` : un type de bloc ajouté plus tard ne compile pas tant qu'on n'a pas
 * décidé de son sort ici. Sans cette garde, un bloc neuf qui pointe un objet de l'espace partirait branché sur la source.
 */

export type RaisonDebranche = 'aller_a' | 'assignation' | 'agent' | 'appel_api' | 'email' | 'flow';

export interface BlocDebranche { nodeId: string; nom: string; type: WorkflowNodeType; raison: RaisonDebranche }

export interface GrapheCopie {
  graphe: WorkflowGraph;
  debranches: BlocDebranche[];
  /** Clés de champ nommées par le graphe, hors clés système, sans doublon. */
  clesDeChamp: string[];
  /** Tags que le graphe pose (`tagsInGraph`), à déclarer dans la destination. */
  tags: string[];
  /** Templates nommés par le graphe, une fois chacun. */
  templates: Array<{ nom: string; langue: string }>;
}

interface SortDuBloc {
  data: Record<string, unknown>;
  raison: RaisonDebranche | null;
  champs: string[];
  template?: { nom: string; langue: string };
}

const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const recopie = (data: Record<string, unknown>, champs: string[] = []): SortDuBloc => ({ data, raison: null, champs });

/** Vide les références du bloc. Il n'est listé que s'il pointait quelque chose : un bloc déjà vide n'est pas débranché. */
function debrancher(data: Record<string, unknown>, cles: readonly string[], raison: RaisonDebranche, champs: string[] = []): SortDuBloc {
  const pointait = cles.some((k) => texte(data[k]) !== '');
  const vide: Record<string, unknown> = { ...data };
  for (const k of cles) vide[k] = '';
  return { data: vide, raison: pointait ? raison : null, champs };
}

/** Les clés des clauses `field` et `datetime` d'un groupe, lues défensivement (`data` est opaque). */
function clesDesClauses(clauses: readonly unknown[]): string[] {
  return clauses.flatMap((c) => {
    const o = c !== null && typeof c === 'object' ? (c as Record<string, unknown>) : {};
    return (o.kind === 'field' || o.kind === 'datetime') ? [texte(o.key)] : [];
  });
}

function sortDuBloc(n: WorkflowNode): SortDuBloc {
  const d = n.data;
  switch (n.type) {
    case 'aller_a': return debrancher(d, ['cible', 'cibleLibelle'], 'aller_a');
    case 'inbox': return debrancher(d, ['assigneA', 'assigneNom'], 'assignation');
    case 'agent': return debrancher(d, ['agentId', 'agentLabel'], 'agent');
    case 'http': return debrancher(d, ['requestId', 'requeteLabel'], 'appel_api', [texte(d.champCible)]);
    case 'email': {
      const champs = (emailRecipientsOf(d.to) ?? []).flatMap((r) => (r.kind === 'field' ? [r.field] : []));
      return debrancher(d, ['emailAccountId', 'templateId'], 'email', champs);
    }
    case 'flow': return debrancher(d, ['flowId', 'flowName'], 'flow');
    case 'template': {
      const nom = texte(d.templateName);
      const variables: unknown[] = Array.isArray(d.variables) ? d.variables : [];
      const champs = variables.flatMap((v) => parseParamHints([v]) ?? []).flatMap((h) => (h.source.type === 'field' ? [h.source.key] : []));
      // Même repli de langue que l'envoi (`actionOf`).
      return { ...recopie(d, champs), ...(nom !== '' ? { template: { nom, langue: String(d.language ?? 'fr') } } : {}) };
    }
    case 'question': return recopie(d, [reglagesQuestion(n).champ ?? '']);
    case 'action': return recopie(d, sousActions(d).flatMap((sa) => {
      if (sa.actionKind === 'set_field') return [texte(sa.fieldKey ?? sa.key)];
      if (sa.actionKind === 'clear_field') return champsAVider(sa).map((c) => c.key);
      return [];
    }));
    case 'field': return recopie(d, [texte(d.fieldKey ?? d.key)]);
    case 'condition': return recopie(d, famillesDeCondition(d).flatMap((f) => clesDesClauses(f.groupe.clauses)));
    // La source d'un bloc JS ancien vit encore dans `data.code`, que la copie refait : elle passe dans `data.js` avant.
    case 'js': return recopie({ ...d, js: sourceDuBlocJs(d) }, [texte(d.champSource), texte(d.champCible)]);
    case 'extraire': return recopie(d, [texte(d.champSource), ...lignesDuBloc(d).map((l) => l.champCible)]);
    case 'tag':
    case 'quick_message':
    case 'rcs_message':
    case 'wait':
    case 'vers_mba':
    case 'mba_handoff':
    case 'mba_disable':
      return recopie(d);
    default: {
      const jamais: never = n.type;
      throw new Error(`bloc sans règle de copie : ${String(jamais)}`);
    }
  }
}

/**
 * Copie un graphe (le brouillon de la source, lu par le store) pour l'espace de destination. Ids, positions, types et
 * arêtes sont gardés : les déclencheurs visent un `node.id`, et les sorties d'un agent passent par ses arêtes. Chaque
 * code public est refait au code client de la destination (`mintNodeCodes`, après avoir retiré celui de la source).
 */
export function copierGraphe(source: WorkflowGraph, codeClientDestination: string): GrapheCopie {
  const debranches: BlocDebranche[] = [];
  const cles = new Set<string>();
  const templates = new Map<string, { nom: string; langue: string }>();
  const nodes = source.nodes.map((n): WorkflowNode => {
    const sort = sortDuBloc(n);
    if (sort.raison !== null) debranches.push({ nodeId: n.id, nom: nomDuBloc(n), type: n.type, raison: sort.raison });
    for (const c of sort.champs) if (c !== '' && !isSystemFieldKey(c)) cles.add(c);
    if (sort.template) templates.set(`${sort.template.nom}\u0000${sort.template.langue}`, sort.template);
    return { ...n, data: { ...sort.data, code: undefined } };
  });
  const graphe = mintNodeCodes({ nodes, edges: source.edges }, codeClientDestination);
  return { graphe, debranches, clesDeChamp: [...cles], tags: tagsInGraph(graphe), templates: [...templates.values()] };
}
