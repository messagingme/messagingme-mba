import { lireVariables } from '../../agent/requetes';
import { lireCibleOutilAgent, type CibleOutilAgent } from '../../agent/outils-maison';
import { normaliserEtiquette } from '../../crm/poser-etiquette';
import { variablesDuTexte } from '../../crm/render';
import { nomLibre, nomOutilLibre } from './nommage';
import type { ReferenceDependance } from './graphe';

/**
 * LES DÉPENDANCES D'UN SCÉNARIO DUPLIQUÉ (lot 2 ; plan `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-2.md`).
 * Pur : à partir de ce que le scénario source désigne (agents, appels API, modèles d'e-mail) et de ce que la base en a
 * lu, dit pour l'aperçu sous quel nom chacun arriverait, et pour l'écriture ce que les cases cochées font créer.
 *
 * Ce qui suit un agent coché : ses outils maison et ses actions (ils lui appartiennent), et ses outils d'appel API avec
 * leur requête et leur source. Ne suivent pas : un outil MCP (déclaré par un serveur, à reconnecter), et un outil maison
 * qui vise un AUTRE scénario que celui qu'on copie (celui qui vise le scénario copié est rebranché sur la copie).
 *
 * 🔴 LES CHOIX SONT BORNÉS : une case cochée doit désigner une dépendance que le scénario source référence. Un id hors
 * de cette liste (un agent d'un autre espace glissé dans le corps) rend `choixInvalides` non vide et AUCUNE copie.
 */

export interface OutilSource {
  id: string;
  nom: string;
  origine: 'mba' | 'http' | 'mcp';
  /** L'outil appartient à l'agent (`agent_tools.agent_id`) : outil maison ou action, copié sous le même nom. */
  proprietaire: boolean;
  binding: unknown;
  requeteId: string | null;
}
export interface AgentSource { id: string; label: string; fiches: number; outils: OutilSource[] }
export interface RequeteSource { id: string; label: string; sourceId: string; variables: unknown }
export interface SourceSource { id: string; label: string; secret: boolean }
export interface ModeleEmailSource { id: string; nom: string; sujet: string; corps: string }
export interface DependancesSource {
  agents: AgentSource[];
  requetes: RequeteSource[];
  sources: SourceSource[];
  modelesEmail: ModeleEmailSource[];
}
/** Les noms déjà pris dans la destination, par table (les outils : ceux de l'espace, `agent_id` nul). */
export interface NomsPris { agents: string[]; requetes: string[]; sources: string[]; modelesEmail: string[]; outils: string[] }
export interface ChoixDependances { agents: string[]; requetes: string[]; modelesEmail: string[] }

export type RaisonOutilNonCopie = 'mcp' | 'autre_scenario' | 'cible_illisible';

export interface ApercuDependances {
  agents: Array<{
    id: string; nom: string; nomCopie: string; fiches: number;
    outilsCopies: Array<{ nom: string; nomCopie: string }>;
    outilsNonCopies: Array<{ nom: string; raison: RaisonOutilNonCopie }>;
  }>;
  requetes: Array<{ id: string; nom: string; nomCopie: string; source: { nom: string; nomCopie: string; secret: boolean } }>;
  modelesEmail: Array<{ id: string; nom: string; nomCopie: string }>;
}

/** Ce que les cases cochées font créer, dans l'ordre d'écriture. Les ids sont ceux de la SOURCE. */
export interface CopiesPrevues {
  sources: Array<{ id: string; label: string }>;
  requetes: Array<{ id: string; label: string; sourceId: string }>;
  modelesEmail: Array<{ id: string; nom: string }>;
  agents: Array<{
    id: string;
    label: string;
    /** `binding` : la cible lue dans la source, à rebrancher à l'écriture ; `sourceId` : la source de sa requête. */
    outils: Array<{ id: string; nom: string; proprietaire: boolean; requeteId: string | null; sourceId: string | null; binding: unknown }>;
  }>;
}

export interface PlanDependances {
  apercu: ApercuDependances;
  copies: CopiesPrevues;
  /** Clés de champ et tags que les copies nomment : à créer, ou à déclarer, dans la destination. */
  clesDeChamp: string[];
  tags: string[];
  choixInvalides: string[];
}

const AUCUNE_COPIE: CopiesPrevues = { sources: [], requetes: [], modelesEmail: [], agents: [] };

/** Les scénarios qu'une cible d'outil maison vise. */
function scenariosDeLaCible(c: CibleOutilAgent): string[] {
  if (c.handler === 'envoyer_bloc' || c.handler === 'lancer_scenario') return [c.workflowId];
  if (c.handler === 'enchainer') return c.etapes.flatMap((e) => (e.type === 'bloc' || e.type === 'scenario' ? [e.workflowId] : []));
  return [];
}

/** Les clés de champ et les tags qu'une cible d'outil maison nomme. */
function nomsDeLaCible(c: CibleOutilAgent): { cles: string[]; tags: string[] } {
  switch (c.handler) {
    case 'poser_tag': return { cles: [], tags: [c.tag] };
    case 'ecrire_variable': return { cles: [c.champ], tags: [] };
    case 'enchainer': return {
      cles: c.etapes.flatMap((e) => (e.type === 'demander' || e.type === 'valeur' ? [e.champ] : [])),
      tags: c.etapes.flatMap((e) => (e.type === 'tag' ? [e.tag] : [])),
    };
    case 'qualifier_transferer': return { cles: c.questions.map((q) => q.champ), tags: [] };
    default: return { cles: [], tags: [] };
  }
}

/** Un outil suit-il l'agent, et sinon pourquoi ? Un outil d'appel suit toujours ; ses requête et source avec lui. */
export function sortDeLOutil(o: OutilSource, scenarioSource: string): { suit: true } | { suit: false; raison: RaisonOutilNonCopie } {
  if (o.origine === 'mcp') return { suit: false, raison: 'mcp' };
  if (o.origine === 'http') return { suit: true };
  const cible = lireCibleOutilAgent(o.binding);
  // Un outil maison sans cible (terminer, escalader, chercher…) n'en a pas besoin pour exister.
  if (cible === null) return isObjetAvecHandlerACible(o.binding) ? { suit: false, raison: 'cible_illisible' } : { suit: true };
  return scenariosDeLaCible(cible).every((w) => w === scenarioSource) ? { suit: true } : { suit: false, raison: 'autre_scenario' };
}

/** Un `binding` qui annonce un handler à cible mais ne se lit pas : il ne serait ni exposé ni exécuté. */
function isObjetAvecHandlerACible(binding: unknown): boolean {
  const h = binding !== null && typeof binding === 'object' ? (binding as Record<string, unknown>).handler : undefined;
  return ['poser_tag', 'ecrire_variable', 'envoyer_bloc', 'lancer_scenario', 'declencher_action', 'enchainer', 'qualifier_transferer'].includes(String(h));
}

/**
 * La cible d'un outil maison copié, rebranchée sur le scénario COPIÉ : son `workflowId` et ses codes de bloc (`codes`,
 * l'ancien code vers le nouveau). N'est appelée que pour un outil qui suit (`sortDeLOutil`). Pur.
 */
export function rebrancherCible(binding: unknown, scenarioSource: string, scenarioCopie: string, codes: ReadonlyMap<string, string>): unknown {
  const cible = lireCibleOutilAgent(binding);
  if (cible === null) return binding;
  const w = (id: string): string => (id === scenarioSource ? scenarioCopie : id);
  const c = (code: string): string => codes.get(code) ?? code;
  if (cible.handler === 'envoyer_bloc') return { ...cible, workflowId: w(cible.workflowId), code: c(cible.code) };
  if (cible.handler === 'lancer_scenario') return { ...cible, workflowId: w(cible.workflowId) };
  if (cible.handler === 'enchainer') {
    return {
      ...cible,
      etapes: cible.etapes.map((e) => (e.type === 'bloc' ? { ...e, workflowId: w(e.workflowId), code: c(e.code) }
        : e.type === 'scenario' ? { ...e, workflowId: w(e.workflowId) } : e)),
    };
  }
  return binding;
}

export function planifierDependances(
  d: DependancesSource,
  pris: NomsPris,
  scenarioSource: string,
  references: readonly ReferenceDependance[],
  choix?: ChoixDependances,
): PlanDependances {
  const requetes = new Map(d.requetes.map((r) => [r.id, r]));
  const sources = new Map(d.sources.map((s) => [s.id, s]));

  // Les noms de TOUTES les copies possibles, dans un ordre fixe : l'aperçu les montre, l'écriture prend les mêmes.
  const occupes = {
    agents: [...pris.agents], requetes: [...pris.requetes], sources: [...pris.sources],
    modelesEmail: [...pris.modelesEmail], outils: [...pris.outils],
  };
  const allouer = (liste: string[], nom: string, casse: 'sensible' | 'insensible'): string => {
    const n = nomLibre(nom, liste, casse);
    liste.push(n);
    return n;
  };
  const nomSource = new Map(d.sources.map((s) => [s.id, allouer(occupes.sources, s.label, 'insensible')]));
  const nomRequete = new Map(d.requetes.map((r) => [r.id, allouer(occupes.requetes, r.label, 'insensible')]));
  const nomModele = new Map(d.modelesEmail.map((m) => [m.id, allouer(occupes.modelesEmail, m.nom, 'sensible')]));
  const nomAgent = new Map(d.agents.map((a) => [a.id, allouer(occupes.agents, a.label, 'insensible')]));
  const nomOutil = new Map<string, string>();
  // 🔴 Un nom par consommateur (`atc_nom_par_consommateur_uidx`) : renommé, un outil de l'espace ne doit prendre le nom
  // d'aucune action d'un agent qui le consomme, actions que l'index de l'espace ignore.
  const actionsDesConsommateurs = (outil: string): string[] => d.agents
    .filter((a) => a.outils.some((o) => o.id === outil))
    .flatMap((a) => a.outils.filter((o) => o.proprietaire).map((o) => o.nom));
  for (const a of d.agents) {
    for (const o of a.outils) {
      if (nomOutil.has(o.id)) continue;
      // Un outil de l'agent garde son nom (unique par agent) ; un outil de l'espace prend un nom libre de la destination.
      if (o.proprietaire) { nomOutil.set(o.id, o.nom); continue; }
      const n = nomOutilLibre(o.nom, [...occupes.outils, ...actionsDesConsommateurs(o.id)]);
      occupes.outils.push(n);
      nomOutil.set(o.id, n);
    }
  }

  const apercu: ApercuDependances = {
    agents: d.agents.map((a) => ({
      id: a.id, nom: a.label, nomCopie: nomAgent.get(a.id)!, fiches: a.fiches,
      outilsCopies: a.outils.filter((o) => sortDeLOutil(o, scenarioSource).suit).map((o) => ({ nom: o.nom, nomCopie: nomOutil.get(o.id)! })),
      outilsNonCopies: a.outils.flatMap((o) => {
        const s = sortDeLOutil(o, scenarioSource);
        return s.suit ? [] : [{ nom: o.nom, raison: s.raison }];
      }),
    })),
    requetes: d.requetes.map((r) => {
      const s = sources.get(r.sourceId);
      return {
        id: r.id, nom: r.label, nomCopie: nomRequete.get(r.id)!,
        source: { nom: s?.label ?? '', nomCopie: nomSource.get(r.sourceId) ?? '', secret: s?.secret ?? false },
      };
    }),
    modelesEmail: d.modelesEmail.map((m) => ({ id: m.id, nom: m.nom, nomCopie: nomModele.get(m.id)! })),
  };

  const vide: PlanDependances = { apercu, copies: AUCUNE_COPIE, clesDeChamp: [], tags: [], choixInvalides: [] };
  if (!choix) return vide;

  const referencees = (sorte: ReferenceDependance['sorte']) => new Set(references.filter((r) => r.sorte === sorte).map((r) => r.id));
  const choixInvalides = [
    ...choix.agents.filter((id) => !referencees('agent').has(id) || !d.agents.some((a) => a.id === id)),
    ...choix.requetes.filter((id) => !referencees('requete').has(id) || !requetes.has(id)),
    ...choix.modelesEmail.filter((id) => !referencees('modele_email').has(id) || !d.modelesEmail.some((m) => m.id === id)),
  ];
  if (choixInvalides.length > 0) return { ...vide, choixInvalides };

  const cles = new Set<string>();
  const tags = new Set<string>();
  const agents: CopiesPrevues['agents'] = [];
  const requetesACopier = new Set(choix.requetes);
  for (const a of d.agents.filter((x) => choix.agents.includes(x.id))) {
    const outils = a.outils.filter((o) => sortDeLOutil(o, scenarioSource).suit);
    for (const o of outils) {
      if (o.requeteId !== null) requetesACopier.add(o.requeteId);
      const cible = o.origine === 'mba' ? lireCibleOutilAgent(o.binding) : null;
      if (cible) {
        const n = nomsDeLaCible(cible);
        n.cles.forEach((k) => cles.add(k));
        n.tags.forEach((t) => { const e = normaliserEtiquette(t); if (e !== '') tags.add(e); });
      }
    }
    agents.push({
      id: a.id, label: nomAgent.get(a.id)!,
      outils: outils.map((o) => ({
        id: o.id, nom: nomOutil.get(o.id)!, proprietaire: o.proprietaire, requeteId: o.requeteId,
        sourceId: o.requeteId === null ? null : (requetes.get(o.requeteId)?.sourceId ?? null), binding: o.binding,
      })),
    });
  }
  const requetesCopiees = [...requetesACopier].flatMap((id) => {
    const r = requetes.get(id);
    return r ? [r] : [];
  });
  for (const r of requetesCopiees) {
    for (const v of lireVariables(r.variables)) if (v.origine.type === 'champ') cles.add(v.origine.cle);
  }
  const sourcesACopier = [...new Set(requetesCopiees.map((r) => r.sourceId))].filter((id) => sources.has(id));
  const modeles = d.modelesEmail.filter((m) => choix.modelesEmail.includes(m.id));
  for (const m of modeles) for (const k of [...variablesDuTexte(m.sujet), ...variablesDuTexte(m.corps)]) cles.add(k);

  return {
    apercu,
    copies: {
      sources: sourcesACopier.map((id) => ({ id, label: nomSource.get(id)! })),
      requetes: requetesCopiees.map((r) => ({ id: r.id, label: nomRequete.get(r.id)!, sourceId: r.sourceId })),
      modelesEmail: modeles.map((m) => ({ id: m.id, nom: nomModele.get(m.id)! })),
      agents,
    },
    clesDeChamp: [...cles],
    tags: [...tags],
    choixInvalides: [],
  };
}
