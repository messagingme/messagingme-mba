import { createHash } from 'node:crypto';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from './graph';
import { MAX_NODES } from './graph';
import { parseParamHints, type ParamSource } from '../crm/template';
import { entreeDuGraphe } from '../../web/lib/partage/ouverture-scenario';
import { SORTIE_HUMAIN, SORTIE_TIMEOUT } from '../../web/lib/partage/sorties-agent';
import { ATTRIBUTS_RECETTE, type Branche, type Etape, type EtapeMessage, type EtapeTemplate, type Lu, type RefusRecette, type SourceRecette } from './recette';

/**
 * COMPILER UNE RECETTE EN GRAPHE, ET L'INVERSE (spec `docs/superpowers/specs/2026-11-02-scenarios-api-design.md`).
 *
 * Pur : ce que la recette nomme (templates chez Meta, agents, champs) a été lu avant (`ReferencesResolues`).
 *
 * 🔴 LE GRAPHE PRODUIT EST CELUI QUE LA CONSOLE ÉCRIT, champ pour champ : `templateButtons` recopiés du template
 * approuvé, branches `btn:<index du bouton>`, sorties de l'agent recopiées dans le bloc (`data.sorties`), arête libre
 * pour la réponse écrite. Le moteur ne connaît que cette forme ; une forme voisine y deviendrait un passe-plat muet.
 *
 * 🔴 L'IDENTIFIANT D'UN BLOC SE DÉRIVE DE SON CHEMIN DANS L'ARBRE (l'entrée, puis le texte de chaque bouton suivi), DE
 * SON TYPE ET DE LA SIGNATURE DE SES SORTIES (les boutons du template, les réponses rapides dans leur ordre). Un clic
 * revient par POSITION (`btn:<i>`) : un bloc dont les sorties ont bougé change donc d'id, et le contact qui attendait
 * sur l'ancien tombe dans le cas d'un bloc retiré au lieu de suivre la branche qui occupe désormais sa position. Un bloc
 * inchangé garde son id, et le contact reprend au bon endroit (`grapheDuRun` lit le graphe publié). Le code public
 * `nod_` (visé par `/v1/sends` et les « Aller à ») se reprend, lui, par le CHEMIN seul : il suit l'étape, pas ses sorties.
 */

export type TemplateResolu =
  | { etat: 'approuve'; boutons: ReadonlyArray<{ type: string; text: string } & Record<string, unknown>>; variables: number; indices: ReadonlyArray<{ position: number; source: ParamSource }> }
  | { etat: 'absent' }
  | { etat: 'non_approuve'; statut: string }
  | { etat: 'non_envoyable'; raison: string };
export interface AgentResolu { actif: boolean; label: string; sorties: ReadonlyArray<{ code: string; label: string }> }
export interface ReferencesResolues {
  templates: ReadonlyMap<string, TemplateResolu>;
  agents: ReadonlyMap<string, AgentResolu>;
  champs: ReadonlySet<string>;
}

export const cleTemplateRecette = (nom: string, langue: string): string => `${nom}|${langue}`;

/** Le nom du bloc qui clôt les sorties d'un agent : le même rôle que `BLOC_FIN` du répondeur, lisible dans la console. */
const NOM_FIN = 'Fin du parcours';
const PAS_X = 340;
const PAS_Y = 160;

const refus = (chemin: string, message: string, code: RefusRecette['code']): RefusRecette =>
  ({ ok: false, code, message: `${chemin} : ${message}`, chemin });

/** Un chemin dans l'arbre : des segments, sérialisés en JSON pour qu'aucun texte de bouton ne se confonde avec un autre. */
type Chemin = readonly string[];
const cle = (c: Chemin): string => JSON.stringify(c);
const idDe = (c: Chemin, type: string, signature: string): string =>
  `n_${createHash('sha256').update(JSON.stringify([c, type, signature])).digest('hex').slice(0, 16)}`;

const versSource = (s: SourceRecette): ParamSource =>
  'champ' in s ? { type: 'field', key: s.champ } : 'texte' in s ? { type: 'literal', value: s.texte } : { type: 'attribute', key: s.attribut };

const citeTextes = (textes: readonly string[]): string =>
  textes.length === 0 ? 'ce template n’a aucune réponse rapide' : `les réponses rapides du template sont ${textes.map((t) => `« ${t} »`).join(', ')}`;

interface Chantier {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  rang: number;
  /** Les blocs du graphe remplacé, par chemin : leur code `nod_` se reprend à type égal. */
  precedents: ReadonlyMap<string, WorkflowNode>;
}

/**
 * Compile une recette déjà lue (`lireRecette`). `precedent` : le graphe publié qu'elle remplace, dont les codes `nod_`
 * sont repris par chemin. Les blocs sans code en reçoivent un ensuite (`mintNodeCodes`, par l'appelant).
 */
export function compilerRecette(entree: Etape, refs: ReferencesResolues, precedent: WorkflowGraph | null): Lu<WorkflowGraph> {
  const chantier: Chantier = { nodes: [], edges: [], rang: 0, precedents: precedent ? decompiler(precedent).chemins : new Map() };
  const r = compilerEtape(entree, 'entree', ['e'], 0, refs, chantier);
  if (!r.ok) return r;
  if (chantier.nodes.length > MAX_NODES) return refus('entree', `${MAX_NODES} blocs au plus une fois compilé`, 'invalid_body');
  return { ok: true, valeur: { nodes: chantier.nodes, edges: chantier.edges } };
}

function poser(
  chantier: Chantier, chemin: Chemin, type: WorkflowNode['type'], profondeur: number, data: Record<string, unknown>, signature = '',
): string {
  const id = idDe(chemin, type, signature);
  const avant = chantier.precedents.get(cle(chemin));
  const code = avant?.type === type && typeof avant.data.code === 'string' && avant.data.code !== '' ? avant.data.code : null;
  chantier.nodes.push({ id, type, position: { x: profondeur * PAS_X, y: chantier.rang * PAS_Y }, data: code ? { ...data, code } : data });
  chantier.rang += 1;
  return id;
}

function relier(chantier: Chantier, source: string, cible: string, handle?: string): void {
  chantier.edges.push({ id: `${source}>${handle ?? 'libre'}`, source, target: cible, ...(handle ? { sourceHandle: handle } : {}) });
}

/** Compile une étape et rend l'id de son bloc. */
function compilerEtape(e: Etape, chemin: string, cheminArbre: Chemin, profondeur: number, refs: ReferencesResolues, chantier: Chantier): Lu<string> {
  if ('humain' in e) return { ok: true, valeur: poser(chantier, cheminArbre, 'inbox', profondeur, {}) };

  if ('agent' in e) {
    const agent = refs.agents.get(e.agent.agent_id);
    if (!agent || !agent.actif) return refus(`${chemin}.agent.agent_id`, 'aucun agent IA actif de cet espace ne porte cet identifiant (list_agents)', 'agent_unavailable');
    const id = poser(chantier, cheminArbre, 'agent', profondeur, {
      agentId: e.agent.agent_id, agentLabel: agent.label, sorties: agent.sorties.map((s) => ({ code: s.code, label: s.label })),
    }, JSON.stringify([e.agent.agent_id, agent.sorties.map((s) => s.code)]));
    // Comme le répondeur (`grapheDuRepondeur`) : chaque règle d'arrêt, l'escalade et le délai mènent à une fin
    // silencieuse ; `echec`, `plafond` et `sans_source` restent sans arête et remontent à l'équipe.
    const fin = poser(chantier, [...cheminArbre, 'fin'], 'action', profondeur + 1, { name: NOM_FIN });
    const handles = new Set([...agent.sorties.map((s) => `sortie:${s.code}`), `sortie:${SORTIE_HUMAIN}`, SORTIE_TIMEOUT]);
    for (const h of handles) relier(chantier, id, fin, h);
    return { ok: true, valeur: id };
  }

  if ('template' in e) return compilerTemplate(e, chemin, cheminArbre, profondeur, refs, chantier);
  return compilerMessage(e, chemin, cheminArbre, profondeur, refs, chantier);
}

function compilerBranches(
  source: string, branches: readonly Branche[], indexDe: (texte: string) => number, prefixe: string,
  chemin: string, cheminArbre: Chemin, profondeur: number, refs: ReferencesResolues, chantier: Chantier,
): Lu<null> {
  for (const [i, b] of branches.entries()) {
    const suite = compilerEtape(b.suite, `${chemin}.${prefixe}[${i}].suite`, [...cheminArbre, prefixe === 'boutons' ? 'b' : 'r', b.texte], profondeur + 1, refs, chantier);
    if (!suite.ok) return suite;
    relier(chantier, source, suite.valeur, `btn:${indexDe(b.texte)}`);
  }
  return { ok: true, valeur: null };
}

function compilerTemplate(e: EtapeTemplate, chemin: string, cheminArbre: Chemin, profondeur: number, refs: ReferencesResolues, chantier: Chantier): Lu<string> {
  const { nom, langue } = e.template;
  const t = refs.templates.get(cleTemplateRecette(nom, langue)) ?? { etat: 'absent' as const };
  if (t.etat === 'absent') return refus(`${chemin}.template`, `aucun template « ${nom} » en langue « ${langue} » dans cet espace`, 'template_not_found');
  if (t.etat === 'non_approuve') return refus(`${chemin}.template`, `le template « ${nom} » (${langue}) n’est pas approuvé par Meta (statut ${t.statut}) : réessayez après son approbation`, 'template_not_approved');
  if (t.etat === 'non_envoyable') return refus(`${chemin}.template`, `le template « ${nom} » ne peut pas partir d’un scénario : ${t.raison}`, 'unsendable_target');

  // Les variables : celles de la recette, sinon les associations de la console, RECOPIÉES dans le bloc pour que
  // l'empreinte couvre ce qui partira.
  let sources: Array<{ position: number; source: ParamSource }>;
  if (e.template.variables) {
    sources = [];
    for (const [cle, s] of Object.entries(e.template.variables)) {
      const position = Number(cle);
      if (position > t.variables) return refus(`${chemin}.template.variables.${cle}`, `le template n’a que ${t.variables} variable(s)`, 'invalid_body');
      if ('champ' in s && !refs.champs.has(s.champ)) return refus(`${chemin}.template.variables.${cle}`, `aucun champ « ${s.champ} » dans cet espace (list_fields)`, 'field_unknown');
      sources.push({ position, source: versSource(s) });
    }
  } else {
    sources = t.indices.filter((i) => i.position <= t.variables).map((i) => ({ position: i.position, source: i.source }));
  }
  sources.sort((a, b) => a.position - b.position);
  // À l'entrée, `/v1/sends` remplit les variables par ses `params` ; plus loin, rien ne le ferait.
  const manquante = Array.from({ length: t.variables }, (_, k) => k + 1).find((p) => !sources.some((s) => s.position === p));
  if (manquante !== undefined && cheminArbre.length > 1) {
    return refus(`${chemin}.template.variables`, `la variable {{${manquante}}} n’a pas de source : donnez-la dans « variables »`, 'invalid_body');
  }

  const reponses = t.boutons.map((b, index) => ({ texte: b.text.trim(), index, rapide: b.type === 'QUICK_REPLY' })).filter((b) => b.rapide);
  const branches = e.boutons ?? [];
  for (const [i, b] of branches.entries()) {
    if (!reponses.some((r) => r.texte === b.texte)) {
      return refus(`${chemin}.boutons[${i}].texte`, `« ${b.texte} » n’est pas une réponse rapide du template ; ${citeTextes(reponses.map((r) => r.texte))}`, 'template_button_unknown');
    }
  }
  if (reponses.length === 0 && e.autre_reponse) {
    return refus(`${chemin}.autre_reponse`, 'un template sans réponse rapide termine le parcours : la réponse du contact va au répondeur de l’espace', 'invalid_body');
  }
  const orpheline = reponses.find((r) => !branches.some((b) => b.texte === r.texte));
  if (orpheline) {
    return refus(`${chemin}.boutons`, `la réponse rapide « ${orpheline.texte} » n’a pas de suite ; chaque réponse rapide en demande une, au besoin { "humain": {} }`, 'quick_reply_unwired');
  }

  const id = poser(chantier, cheminArbre, 'template', profondeur, {
    templateName: nom, language: langue, templateButtons: t.boutons.map((b) => ({ ...b })), variables: sources,
  }, JSON.stringify([nom, langue, t.boutons.map((b) => [b.type, b.text])]));
  const indexDe = (texte: string): number => reponses.find((r) => r.texte === texte)!.index;
  const b = compilerBranches(id, branches, indexDe, 'boutons', chemin, cheminArbre, profondeur, refs, chantier);
  if (!b.ok) return b;
  if (e.autre_reponse) {
    const autre = compilerEtape(e.autre_reponse, `${chemin}.autre_reponse`, [...cheminArbre, 'a'], profondeur + 1, refs, chantier);
    if (!autre.ok) return autre;
    relier(chantier, id, autre.valeur);
  }
  return { ok: true, valeur: id };
}

function compilerMessage(e: EtapeMessage, chemin: string, cheminArbre: Chemin, profondeur: number, refs: ReferencesResolues, chantier: Chantier): Lu<string> {
  const reponses = e.reponses ?? [];
  const id = poser(chantier, cheminArbre, 'quick_message', profondeur, {
    body: e.message.texte, quickReplies: reponses.map((r) => r.texte), ...(e.message.fichier ? { imageUrl: e.message.fichier.url } : {}),
  }, JSON.stringify(reponses.map((r) => r.texte)));
  const b = compilerBranches(id, reponses, (texte) => reponses.findIndex((r) => r.texte === texte), 'reponses', chemin, cheminArbre, profondeur, refs, chantier);
  if (!b.ok) return b;
  const libre = e.autre_reponse ?? e.suite;
  if (libre) {
    const champ = e.autre_reponse ? 'autre_reponse' : 'suite';
    const suite = compilerEtape(libre, `${chemin}.${champ}`, [...cheminArbre, e.autre_reponse ? 'a' : 's'], profondeur + 1, refs, chantier);
    if (!suite.ok) return suite;
    relier(chantier, id, suite.valeur);
  }
  return { ok: true, valeur: id };
}

// ─── Décompiler ────────────────────────────────────────────────────────────────────────────────────────────────

const indescriptible = (raison: string): RefusRecette => ({
  ok: false, code: 'scenario_not_describable', chemin: 'graphe',
  message: `ce scénario ne se décrit plus par une recette (${raison}) : il a été modifié dans la console, et seule la console peut le modifier`,
});

const versRecette = (s: ParamSource): SourceRecette | null => {
  if (s.type === 'field') return { champ: s.key };
  if (s.type === 'literal') return { texte: s.value };
  if (s.type === 'attribute' && (ATTRIBUTS_RECETTE as readonly string[]).includes(s.key)) return { attribut: s.key as 'name' | 'phone' };
  return null;
};

/**
 * Relit la recette d'un graphe : pour `GET /v1/scenarios/:id` et pour l'empreinte qui garde un remplacement. Refuse
 * (`scenario_not_describable`) tout ce que la recette ne sait pas dire : un type de bloc hors des quatre, des branches
 * qui se rejoignent, un bloc que l'entrée n'atteint pas, une réponse rapide sans suite.
 */
export function decompilerGraphe(g: WorkflowGraph): Lu<Etape> {
  return decompiler(g).lu;
}

/** La recette d'un graphe, et chacun de ses blocs par son chemin (celui que `compilerRecette` lui donnerait). */
function decompiler(g: WorkflowGraph): { lu: Lu<Etape>; chemins: Map<string, WorkflowNode> } {
  const chemins = new Map<string, WorkflowNode>();
  const lu = lireGraphe(g, chemins);
  return { lu, chemins: lu.ok ? chemins : new Map() };
}

function lireGraphe(g: WorkflowGraph, chemins: Map<string, WorkflowNode>): Lu<Etape> {
  const entree = entreeDuGraphe(g);
  if (!entree) return indescriptible('aucun bloc');
  const parId = new Map(g.nodes.map((n) => [n.id, n]));
  const sortantes = new Map<string, WorkflowEdge[]>();
  for (const e of g.edges) sortantes.set(e.source, [...(sortantes.get(e.source) ?? []), e]);
  const vus = new Set<string>();

  const lire = (id: string, ici: Chemin): Lu<Etape> => {
    const n = parId.get(id);
    if (!n) return indescriptible('une branche mène à un bloc absent');
    if (vus.has(id)) return indescriptible('deux branches mènent au même bloc');
    vus.add(id);
    chemins.set(cle(ici), n);
    const aretes = sortantes.get(id) ?? [];
    const libre = aretes.filter((a) => a.sourceHandle === undefined);
    if (libre.length > 1) return indescriptible('deux suites libres sur un même bloc');

    if (n.type === 'inbox') {
      if (aretes.length > 0 || (typeof n.data.assigneA === 'string' && n.data.assigneA.trim() !== '')) return indescriptible('un passage à l’équipe avec une suite ou une affectation');
      return { ok: true, valeur: { humain: {} } };
    }

    if (n.type === 'agent') {
      const agentId = String(n.data.agentId ?? '').trim();
      const cibles = new Set(aretes.map((a) => a.target));
      if (agentId === '' || cibles.size > 1) return indescriptible('un agent IA dont les sorties mènent à des suites');
      for (const c of cibles) {
        const fin = parId.get(c);
        if (!fin || fin.type !== 'action' || fin.data.actionKind !== undefined || (sortantes.get(c) ?? []).length > 0 || vus.has(c)) {
          return indescriptible('un agent IA dont les sorties mènent à des suites');
        }
        vus.add(c);
        chemins.set(cle([...ici, 'fin']), fin);
      }
      return { ok: true, valeur: { agent: { agent_id: agentId } } };
    }

    if (n.type === 'template') {
      const nom = String(n.data.templateName ?? '').trim();
      const boutons = Array.isArray(n.data.templateButtons) ? (n.data.templateButtons as Array<{ type?: unknown; text?: unknown }>) : [];
      const variables = parseParamHints(n.data.variables);
      if (nom === '' || variables === null) return indescriptible('un template incomplet');
      const etape: EtapeTemplate = { template: { nom, langue: String(n.data.language ?? 'fr') } };
      if (variables.length > 0) {
        const parPosition: Record<string, SourceRecette> = {};
        for (const v of variables) {
          const s = versRecette(v.source);
          if (!s) return indescriptible('une variable de template d’une source que la recette ne connaît pas');
          parPosition[String(v.position)] = s;
        }
        etape.template.variables = parPosition;
      }
      const rapides = boutons.map((b, i) => ({ i, texte: String(b.text ?? '').trim(), rapide: b.type === 'QUICK_REPLY' })).filter((b) => b.rapide);
      const branches: Branche[] = [];
      for (const r of rapides) {
        const a = aretes.find((x) => x.sourceHandle === `btn:${r.i}`);
        if (!a) return indescriptible('une réponse rapide sans suite');
        const suite = lire(a.target, [...ici, 'b', r.texte]);
        if (!suite.ok) return suite;
        branches.push({ texte: r.texte, suite: suite.valeur });
      }
      if (aretes.some((a) => a.sourceHandle !== undefined && !rapides.some((r) => a.sourceHandle === `btn:${r.i}`))) return indescriptible('une sortie de template inconnue');
      if (branches.length > 0) etape.boutons = branches;
      if (libre[0]) {
        if (rapides.length === 0) return indescriptible('un template sans réponse rapide suivi d’une étape');
        const autre = lire(libre[0].target, [...ici, 'a']);
        if (!autre.ok) return autre;
        etape.autre_reponse = autre.valeur;
      }
      return { ok: true, valeur: etape };
    }

    if (n.type === 'quick_message') {
      if (n.data.lienActif === true) return indescriptible('un message à bouton de lien');
      const textes = Array.isArray(n.data.quickReplies) ? (n.data.quickReplies as unknown[]).map((q) => String(q ?? '').trim()) : [];
      if (textes.some((t) => t === '')) return indescriptible('une réponse rapide vide');
      const fichier = String(n.data.imageUrl ?? '').trim();
      const etape: EtapeMessage = { message: { texte: String(n.data.body ?? ''), ...(fichier !== '' ? { fichier: { url: fichier } } : {}) } };
      const branches: Branche[] = [];
      for (const [i, texte] of textes.entries()) {
        const a = aretes.find((x) => x.sourceHandle === `btn:${i}`);
        if (!a) return indescriptible('une réponse rapide sans suite');
        const suite = lire(a.target, [...ici, 'r', texte]);
        if (!suite.ok) return suite;
        branches.push({ texte, suite: suite.valeur });
      }
      if (aretes.some((a) => a.sourceHandle !== undefined && !/^btn:\d+$/.test(a.sourceHandle))) return indescriptible('une sortie de message inconnue');
      if (branches.length > 0) etape.reponses = branches;
      if (libre[0]) {
        const suite = lire(libre[0].target, [...ici, branches.length > 0 ? 'a' : 's']);
        if (!suite.ok) return suite;
        if (branches.length > 0) etape.autre_reponse = suite.valeur;
        else etape.suite = suite.valeur;
      }
      return { ok: true, valeur: etape };
    }

    return indescriptible(`un bloc de type « ${n.type} »`);
  };

  const r = lire(entree.id, ['e']);
  if (!r.ok) return r;
  if (vus.size !== g.nodes.length) return indescriptible('un bloc que l’entrée n’atteint pas');
  return r;
}
