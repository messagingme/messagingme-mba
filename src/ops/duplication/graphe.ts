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
  /**
   * L'ancien code public de chaque bloc vers le nouveau (lot 2) : un outil d'agent copié qui visait un bloc du scénario
   * copié vise le même bloc de la copie.
   */
  codes: ReadonlyMap<string, string>;
  /** Les images des messages rapides et RCS hébergées par l'espace source (`/m/`) : elles meurent avec lui. */
  imagesSource: string[];
}

/** Ce qu'un bloc du graphe désigne dans l'espace source et qui peut être dupliqué avec lui (lot 2). */
export type SorteDependance = 'agent' | 'requete' | 'modele_email';
export interface ReferenceDependance { nodeId: string; sorte: SorteDependance; id: string }

/** Les copies d'une duplication, de l'id source vers la copie. */
export interface Rebranchements {
  agents: ReadonlyMap<string, { id: string; nom: string }>;
  requetes: ReadonlyMap<string, { id: string; nom: string }>;
  modelesEmail: ReadonlyMap<string, string>;
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

/**
 * Les clés des clauses `field` et `datetime` d'un groupe, lues défensivement (`data` est opaque). Sert aussi aux
 * conditions des déclencheurs (`declencheurs.ts`), qui ont la même forme.
 */
export function clesDesClauses(clauses: readonly unknown[]): string[] {
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
  const imagesSource: string[] = [];
  const nodes = source.nodes.map((n): WorkflowNode => {
    const sort = sortDuBloc(n);
    if (sort.raison !== null) debranches.push({ nodeId: n.id, nom: nomDuBloc(n), type: n.type, raison: sort.raison });
    for (const c of sort.champs) if (c !== '' && !isSystemFieldKey(c)) cles.add(c);
    if (sort.template) templates.set(`${sort.template.nom}\u0000${sort.template.langue}`, sort.template);
    if ((n.type === 'quick_message' || n.type === 'rcs_message') && estImageDeLEspace(n.data.imageUrl)) imagesSource.push(texte(n.data.imageUrl));
    return { ...n, data: { ...sort.data, code: undefined } };
  });
  const graphe = mintNodeCodes({ nodes, edges: source.edges }, codeClientDestination);
  const codes = new Map<string, string>();
  for (const n of source.nodes) {
    const ancien = texte(n.data.code);
    const nouveau = graphe.nodes.find((x) => x.id === n.id)?.data.code;
    if (ancien !== '' && typeof nouveau === 'string') codes.set(ancien, nouveau);
  }
  return {
    graphe, debranches, clesDeChamp: [...cles], tags: tagsInGraph(graphe), templates: [...templates.values()], codes, imagesSource,
  };
}

/** Une image servie par `/m/` est un fichier de la médiathèque de l'espace (`src/http/rcs-media.ts`). */
function estImageDeLEspace(v: unknown): boolean {
  const u = texte(v);
  if (u === '') return false;
  try { return new URL(u).pathname.startsWith('/m/'); } catch { return u.startsWith('/m/'); }
}

/** Ce que le graphe désigne et qui peut partir avec lui (lot 2) : les mêmes clés que `copierGraphe` vide. */
export function referencesDuGraphe(graphe: WorkflowGraph): ReferenceDependance[] {
  return graphe.nodes.flatMap((n): ReferenceDependance[] => {
    const id = texte(n.type === 'agent' ? n.data.agentId : n.type === 'http' ? n.data.requestId : n.type === 'email' ? n.data.templateId : '');
    if (id === '') return [];
    const sorte: SorteDependance = n.type === 'agent' ? 'agent' : n.type === 'http' ? 'requete' : 'modele_email';
    return [{ nodeId: n.id, sorte, id }];
  });
}

/**
 * Pose les copies sur les blocs qui désignaient leur original. Un agent ou une requête rebranchés sortent des blocs
 * débranchés ; un e-mail y reste, sa boîte d'envoi ne suit jamais. Pur : la copie d'origine n'est pas modifiée.
 */
export function rebrancher(copie: GrapheCopie, references: readonly ReferenceDependance[], r: Rebranchements): GrapheCopie {
  const rebranches = new Set<string>();
  const nodes = copie.graphe.nodes.map((n): WorkflowNode => {
    let data = n.data;
    for (const ref of references.filter((x) => x.nodeId === n.id)) {
      if (ref.sorte === 'agent') {
        const a = r.agents.get(ref.id);
        if (a) { data = { ...data, agentId: a.id, agentLabel: a.nom }; rebranches.add(n.id); }
      } else if (ref.sorte === 'requete') {
        const q = r.requetes.get(ref.id);
        if (q) { data = { ...data, requestId: q.id, requeteLabel: q.nom }; rebranches.add(n.id); }
      } else {
        const m = r.modelesEmail.get(ref.id);
        if (m) data = { ...data, templateId: m };
      }
    }
    return data === n.data ? n : { ...n, data };
  });
  return {
    ...copie,
    graphe: { nodes, edges: copie.graphe.edges },
    debranches: copie.debranches.filter((d) => !rebranches.has(d.nodeId)),
  };
}
