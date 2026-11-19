import type { TemplateParam } from '../crm/template';
import type { ParamHint } from '../crm/template-hints.pg';
import { actionOf, type WorkflowButton } from '../workflow/engine';
import type { WorkflowGraph, WorkflowNode } from '../workflow/graph';
import type { WorkflowRow } from '../workflow/store.pg';
import type { Rayon } from '../workflow/rayon';
import { sourcesDuBloc } from '../workflow/template-send';
import { DONNEES_PAR_EVENEMENT, type DonneeShopify, type EvenementShopify } from './donnees';
import { MARQUE_PREMIER_BLOC, estPremierBlocVerrouille } from '../../web/lib/partage/premier-bloc';

/**
 * LE PREMIER BLOC D'UNE LIGNE SHOPIFY (menu « Scénario », lot 5, décisions 13 et 23) : le template que le circuit envoie
 * quand l'événement arrive, et sur lequel le parcours d'événement naît. Partagé par la réception des commandes, la relance
 * des paniers et l'état de la boutique ; depuis le lot 6, par les lignes HubSpot (le même premier bloc, sur leur rayon).
 *
 * 🔴 LE GRAPHE PUBLIÉ, JAMAIS LE BROUILLON : un client réel ne tombe jamais dans un brouillon. Le bloc est celui que le
 * serveur a MARQUÉ en créant le scénario (`MARQUE_PREMIER_BLOC`), pas « le premier sans flèche entrante » : un bloc orphelin
 * deviendrait l'entrée. Il se lit comme l'envoi le lit (`actionOf` : le nom sans ses espaces, la langue absente lue « fr »),
 * sinon la naissance du parcours refuserait un modèle qui ne correspond plus au bloc.
 */

/** La marque du premier bloc d'un scénario Shopify (et HubSpot au lot 6), posée par le serveur dans `data` : une seule
 *  source, partagée avec le builder (`web/lib/partage/premier-bloc.ts`). */
export { MARQUE_PREMIER_BLOC };

export function estBlocVerrouille(n: WorkflowNode): boolean {
  return estPremierBlocVerrouille(n.data);
}

/** Le bloc marqué d'un graphe, s'il y en a exactement un. */
export function blocVerrouille(graphe: WorkflowGraph): WorkflowNode | null {
  const marques = graphe.nodes.filter(estBlocVerrouille);
  return marques.length === 1 ? marques[0]! : null;
}

/**
 * LE VERROU DU PREMIER BLOC (décisions 13 et 23, lot 5 tâche 9) : dans un scénario d'un rayon d'automation (Shopify, et
 * HubSpot depuis le lot 6), le bloc marqué reste le MÊME (`attendu`, l'identifiant du bloc marqué du graphe en place), reste
 * un template, et rien n'y mène (ni flèche, ni « Aller à » du scénario). La marque n'est posée que par le serveur : en poser
 * une, l'ôter ou la déplacer par un corps reçu est refusé, comme un graphe en place qui n'en a plus (`attendu` null). Rend
 * la phrase du refus, ou null.
 */
export function refusDuVerrou(graphe: WorkflowGraph, attendu: string | null): string | null {
  const bloc = blocVerrouille(graphe);
  if (attendu === null || bloc === null || bloc.id !== attendu) {
    return 'le premier bloc d’une automation (le template qui l’ouvre) ne se supprime pas et ne se déplace pas';
  }
  if (bloc.type !== 'template') return 'le premier bloc d’une automation reste un template';
  if (graphe.edges.some((e) => e.target === bloc.id)) return 'rien n’y mène : le premier bloc ouvre le scénario de l’automation';
  const code = typeof bloc.data.code === 'string' ? bloc.data.code : null;
  if (code !== null && graphe.nodes.some((n) => n.type === 'aller_a' && n.data.cible === code)) {
    return 'un « Aller à » ne vise jamais le premier bloc d’une automation';
  }
  return null;
}

/** Un « Aller à » de ce graphe vise-t-il le premier bloc verrouillé d'un de ces graphes (ceux des autres scénarios) ? */
export function viseUnPremierBloc(graphe: WorkflowGraph, autres: readonly WorkflowGraph[]): boolean {
  const cibles = new Set(graphe.nodes.flatMap((n) => (n.type === 'aller_a' && typeof n.data.cible === 'string' ? [n.data.cible] : [])));
  if (cibles.size === 0) return false;
  return autres.some((g) => g.nodes.some((n) => estBlocVerrouille(n) && typeof n.data.code === 'string' && cibles.has(n.data.code)));
}

export interface LecturesPremierBloc {
  /** Le magasin des scénarios, passé ENTIER (ses méthodes lisent `this`). */
  workflows: { getById(id: string, tenantId: string): Promise<WorkflowRow | null> };
  /** Les indices des templates (`template_param_hints`), passés entiers. */
  indices: { get(tenantId: string, name: string, language: string): Promise<ParamHint[]> };
}

export type PremierBloc =
  | {
    etat: 'pret';
    workflowId: string;
    noeudId: string;
    modele: string;
    langue: string;
    /** Dans l'ordre du template : le pont donne à chaque réponse rapide son payload `btn:<i>`. */
    boutons: WorkflowButton[];
    /** Les sources effectives, par position : celles du template, remplacées par celles du bloc. */
    params: TemplateParam[];
    /** Une flèche part du bloc : sans elle, le premier message part seul et aucun parcours ne naît. */
    aUneSuite: boolean;
  }
  /**
   * `scenario_absent` : aucun scénario du rayon demandé sous cet identifiant dans l'espace ; `bloc_absent` : pas
   * exactement un bloc marqué, ou ce n'est pas un template ; `sans_modele` : le template n'est pas encore écrit.
   */
  | { etat: 'illisible'; raison: 'scenario_absent' | 'bloc_absent' | 'sans_modele' };

/**
 * `rayon` : celui de la ligne qui lit (`shopify`, ou `hubspot` au lot 6), REQUIS : une ligne ne lit jamais le scénario d'un
 * autre rayon, et un rayon oublié ne compilerait pas plutôt que de retomber sur Shopify en silence.
 */
export async function premierBloc(
  l: LecturesPremierBloc, tenantId: string, workflowId: string, rayon: Exclude<Rayon, 'general'>,
): Promise<PremierBloc> {
  const wf = await l.workflows.getById(workflowId, tenantId);
  // `getById` ignore le rayon : un scénario d'un autre rayon sous cet identifiant n'est pas celui d'une ligne.
  if (wf === null || wf.rayon !== rayon) return { etat: 'illisible', raison: 'scenario_absent' };
  const bloc = blocVerrouille(wf.graph);
  if (bloc === null || bloc.type !== 'template') return { etat: 'illisible', raison: 'bloc_absent' };
  const action = actionOf(bloc);
  if (action === null || action.kind !== 'sendTemplate') return { etat: 'illisible', raison: 'sans_modele' };
  const indices = await l.indices.get(tenantId, action.templateName, action.language);
  const params = sourcesDuBloc(indices, action.sources)
    .map((s) => ({ position: s.position, source: s.source }))
    .sort((a, b) => a.position - b.position);
  return {
    etat: 'pret', workflowId, noeudId: bloc.id, modele: action.templateName, langue: action.language,
    boutons: action.buttons, params, aUneSuite: wf.graph.edges.some((e) => e.source === bloc.id),
  };
}

/**
 * Une donnée de l'événement que le premier bloc demande et qui manque : une source `variable` que cet événement ne sait
 * pas remplir (`DONNEES_PAR_EVENEMENT`), ou qu'il n'a pas reçue. Rien ne part alors (`donnee_manquante`) : jamais
 * l'exemple du template à la place. Les autres sources (champ de la fiche, date, texte fixe) se jugent à l'envoi.
 */
export function donneeManquante(
  params: readonly TemplateParam[], evenement: EvenementShopify, valeurs: Partial<Record<DonneeShopify, string>>,
): boolean {
  const permises: readonly string[] = DONNEES_PAR_EVENEMENT[evenement];
  return params.some((p) => p.source.type === 'variable'
    && (!permises.includes(p.source.key) || valeurs[p.source.key as DonneeShopify] === undefined));
}
