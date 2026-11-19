import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';
import type { TemplateSummary } from '../meta/templates';
import type { WorkflowGraph, WorkflowNode } from '../workflow/graph';
import type { PgWorkflowStore } from '../workflow/store.pg';
import type { WorkflowExecutor } from '../workflow/executor';
import { programmerMenage, type DepsMenage } from '../workflow/modeles-de-bloc';
import { DELAI_PANIER_MAX, DELAI_PANIER_MIN, EVENEMENTS_SHOPIFY, type DonneeShopify, type EvenementShopify } from './donnees';
import { NOM_DU_SCENARIO, prefixeShopify, type LigneShopify } from './lignes';
import { blocVerrouille, estBlocVerrouille, MARQUE_PREMIER_BLOC } from './premier-bloc';
import type { PgShopifyStore } from './store.pg';

/**
 * LES LIGNES SHOPIFY, CÔTÉ GESTION (menu « Scénario », lot 5, tâche 8) : la porte unique de la console (routes) et des
 * outils MCP (`set_shopify_message`, `get_shopify_state`) pour la ligne d'un événement et son scénario.
 *
 * 🔴 LE SCÉNARIO D'UNE LIGNE NAÎT D'UN SEUL BLOC, LE TEMPLATE VERROUILLÉ (décisions 13 et 23) : marqué par le serveur
 * (`MARQUE_PREMIER_BLOC`), jamais par un corps reçu, publié tout de suite, sans template chez Meta tant que le marchand ne
 * l'a pas écrit. Éteindre une ligne ou mettre la boutique en pause arrête ses parcours (décision 15), au mieux : la règle
 * « encore voulu » les arrête de toute façon à leur prochain pas.
 */

export interface DepsLignesShopify {
  store: Pick<PgShopifyStore, 'lire' | 'lignes' | 'ligne' | 'poserLigne' | 'allumerLigne' | 'eteindreLigne' | 'mettreEnPause' | 'reprendre' | 'reglerDelaiPanier'>;
  /** Le magasin des scénarios, ENTIER (ses méthodes lisent `this`). */
  workflows: Pick<PgWorkflowStore, 'insert' | 'publish' | 'getById' | 'update' | 'publicationProgrammee'>;
  /** L'exécuteur des parcours, ENTIER. */
  parcours: Pick<WorkflowExecutor, 'arreterParcours'>;
  /** Les templates de l'espace chez Meta (`listerModeles`) : le statut et les boutons du premier template. */
  modeles(tenantId: string): Promise<readonly TemplateSummary[]>;
  /** Le ménage du template que le premier bloc remplace (spec § 5.1) : programmé, jamais supprimé ici. */
  menage: DepsMenage;
}

export type Refus = { ok: false; statut: 400 | 409 | 422 | 503; message: string };
export type Issue<T> = { ok: true; valeur: T } | Refus;
const refus = (statut: Refus['statut'], message: string): Refus => ({ ok: false, statut, message });

export { NOM_DU_SCENARIO };

/** Le graphe d'une ligne neuve : un seul bloc, le template verrouillé, sans template ni flèche. */
export function grapheDUneLigne(): WorkflowGraph {
  return { nodes: [{ id: 'depart', type: 'template', position: { x: 0, y: 0 }, data: { [MARQUE_PREMIER_BLOC]: true } }], edges: [] };
}

/** La ligne de l'événement ; créée ÉTEINTE avec son scénario publié si elle manque. */
export async function assurerLigne(deps: DepsLignesShopify, tenantId: string, evenement: EvenementShopify, par: string | null): Promise<LigneShopify> {
  const existante = await deps.store.ligne(tenantId, evenement);
  if (existante !== null) return existante;
  const { id } = await deps.workflows.insert(tenantId, NOM_DU_SCENARIO[evenement], grapheDUneLigne(), 'shopify');
  await deps.workflows.publish(id, tenantId);
  return deps.store.poserLigne(tenantId, { evenement, workflowId: id, par });
}

/** Les parcours d'un préfixe d'origine s'arrêtent, au mieux : une panne se journalise, le geste du marchand passe. */
export async function arreterLesParcours(deps: DepsLignesShopify, tenantId: string, prefixe: string, motif: string): Promise<void> {
  try {
    await deps.parcours.arreterParcours(tenantId, { prefixe }, motif);
  } catch (err) {
    journaliser('error', 'shopify_arret_parcours_en_echec', { tenantId, motif, erreur: messageDe(err) });
  }
}

/** La boutique de l'espace, connectée : sans elle, aucune ligne ne se règle. */
async function boutiqueConnectee(deps: DepsLignesShopify, tenantId: string): Promise<Issue<{ domaine: string }>> {
  const b = await deps.store.lire(tenantId);
  if (b === null) return refus(409, 'Aucune boutique Shopify n’est branchée à cet espace : connect_shopify d’abord.');
  if (b.etat === 'coupee') return refus(409, 'La boutique est coupée : rebranchez-la avant de régler ses automations.');
  return { ok: true, valeur: { domaine: b.domaine } };
}

/**
 * L'interrupteur d'une ligne (et le délai du panier). Allumer crée la ligne si elle manque ; éteindre arrête ses parcours.
 * Éteindre une automation qui n'a pas de ligne ne crée rien et rend `null` : elle est déjà éteinte.
 */
export async function reglerLigne(
  deps: DepsLignesShopify, tenantId: string, evenement: EvenementShopify, r: { actif: boolean; delaiMinutes?: number }, par: string | null,
): Promise<Issue<LigneShopify | null>> {
  if (r.delaiMinutes !== undefined && (evenement !== 'checkout_abandoned' || !Number.isInteger(r.delaiMinutes)
    || r.delaiMinutes < DELAI_PANIER_MIN || r.delaiMinutes > DELAI_PANIER_MAX)) {
    return refus(400, `delaiMinutes : pour le panier abandonné seulement, un nombre entier de ${DELAI_PANIER_MIN} à ${DELAI_PANIER_MAX} minutes.`);
  }
  const b = await boutiqueConnectee(deps, tenantId);
  if (!b.ok) return b;
  if (r.actif) {
    await assurerLigne(deps, tenantId, evenement, par);
    await deps.store.allumerLigne(tenantId, evenement, par);
  } else if (await deps.store.eteindreLigne(tenantId, evenement, par)) {
    await arreterLesParcours(deps, tenantId, prefixeShopify(b.valeur.domaine, evenement), 'ligne éteinte');
  }
  if (r.delaiMinutes !== undefined) await deps.store.reglerDelaiPanier(tenantId, r.delaiMinutes);
  return { ok: true, valeur: await deps.store.ligne(tenantId, evenement) };
}

/** La pause de la boutique (décision 15) : ses parcours s'arrêtent ; la reprise n'arrête rien. `changee` : faux si déjà fait. */
export async function reglerPause(deps: DepsLignesShopify, tenantId: string, pause: boolean): Promise<Issue<{ changee: boolean }>> {
  const b = await boutiqueConnectee(deps, tenantId);
  if (!b.ok) return b;
  if (!pause) return { ok: true, valeur: { changee: await deps.store.reprendre(tenantId) } };
  const changee = await deps.store.mettreEnPause(tenantId);
  if (changee) await arreterLesParcours(deps, tenantId, prefixeShopify(b.valeur.domaine), 'boutique en pause');
  return { ok: true, valeur: { changee } };
}

/** La liste des templates de l'espace chez Meta, ou `null` quand elle ne se lit pas (journalisé, jamais levé). */
async function lireModeles(deps: DepsLignesShopify, tenantId: string): Promise<readonly TemplateSummary[] | null> {
  try {
    return await deps.modeles(tenantId);
  } catch (err) {
    journaliser('warn', 'shopify_liste_modeles_illisible', { tenantId, erreur: messageDe(err) });
    return null;
  }
}

/** Les réponses rapides d'un template, dans l'ordre : leurs index sont les branches `btn:<i>` du bloc. */
const reponsesRapides = (boutons: ReadonlyArray<{ type: string; text: string }>): string[] =>
  boutons.flatMap((b) => (b.type === 'QUICK_REPLY' ? [b.text] : []));

/**
 * Le graphe dont le bloc verrouillé reçoit ces données, à sa place ; `null` sans bloc verrouillé. 🔴 Seules les clés du
 * template changent, comme quand le constructeur en choisit un : la sortie « Pas de réponse » (`timeoutValue`,
 * `timeoutUnit`, décision 12), le code du bloc et ce que l'éditeur y range restent (décision 7, relecture de 5b).
 */
function avecLePremierBloc(graphe: WorkflowGraph, data: Record<string, unknown>): WorkflowGraph | null {
  if (blocVerrouille(graphe) === null) return null;
  const nodes: WorkflowNode[] = graphe.nodes.map((n) => (estBlocVerrouille(n) ? { ...n, data: { ...n.data, ...data, [MARQUE_PREMIER_BLOC]: true } } : n));
  return { nodes, edges: graphe.edges };
}

/**
 * Le template du premier bloc, posé par `set_shopify_message` : la ligne et son scénario naissent s'ils manquent, le bloc
 * verrouillé reçoit le template, sa langue, ses boutons tels que Meta les a, et ses données (sources `variable`, position
 * par position). 🔴 La suite du scénario est gardée : un template dont les réponses rapides ne mènent plus aux mêmes
 * branches est refusé quand une flèche part d'elles. Le publié change aussitôt : une version programmée (en attente de Meta,
 * lot 3) est annulée par la publication, et `programmationAnnulee` le dit ; le brouillon en cours reçoit le même bloc, pour
 * que le builder ne remette pas l'ancien en ligne.
 */
export interface PremierBlocPose {
  ligne: LigneShopify;
  /** Une version programmée du scénario attendait Meta : cette publication l'a annulée. */
  programmationAnnulee: boolean;
}

export async function brancherLePremierBloc(
  deps: DepsLignesShopify, tenantId: string,
  b: { evenement: EvenementShopify; modele: string; langue: string; variables: readonly DonneeShopify[] }, par: string | null,
): Promise<Issue<PremierBlocPose>> {
  const boutique = await boutiqueConnectee(deps, tenantId);
  if (!boutique.ok) return boutique;
  // La liste chez Meta d'abord : illisible (Meta en panne, jeton invalide), le geste est refusé AVANT toute écriture.
  const liste = await lireModeles(deps, tenantId);
  if (liste === null) return refus(503, 'La liste des templates n’a pas pu être lue chez Meta : réessayez dans un instant.');
  const tpl = liste.find((t) => t.name === b.modele && t.language === b.langue);
  if (tpl === undefined) return refus(422, `Le modèle « ${b.modele} » (${b.langue}) n’existe pas chez Meta pour cet espace.`);
  const boutons = (tpl.buttons ?? []).map((x) => ({ type: x.type, text: x.text }));
  const ligne = await assurerLigne(deps, tenantId, b.evenement, par);
  const wf = await deps.workflows.getById(ligne.workflowId, tenantId);
  if (wf === null || wf.rayon !== 'shopify') return refus(409, 'Le scénario de cette automation est introuvable.');
  const bloc = blocVerrouille(wf.graph);
  if (bloc === null) return refus(409, 'Le scénario de cette automation n’a plus son premier bloc.');
  const avant = reponsesRapides(Array.isArray(bloc.data.templateButtons) ? bloc.data.templateButtons as Array<{ type: string; text: string }> : []);
  const apres = reponsesRapides(boutons);
  const branche = wf.graph.edges.find((e) => e.source === bloc.id && typeof e.sourceHandle === 'string'
    && e.sourceHandle.startsWith('btn:') && avant[Number(e.sourceHandle.slice(4))] !== apres[Number(e.sourceHandle.slice(4))]);
  if (branche !== undefined) {
    return refus(409, `Les réponses rapides de « ${b.modele} » ne sont plus celles d’où part la suite du scénario : modifiez-le dans le builder.`);
  }
  const data = {
    // Les cartes d'un carrousel suivent le template, comme au choix dans le constructeur : celles de l'ancien ne valent plus.
    templateName: b.modele, language: b.langue, templateButtons: boutons, templateCards: [],
    variables: b.variables.map((key, i) => ({ position: i + 1, source: { type: 'variable', key } })),
  };
  const publie = avecLePremierBloc(wf.graph, data);
  if (publie === null) return refus(409, 'Le scénario de cette automation n’a plus son premier bloc.');
  const programmee = await deps.workflows.publicationProgrammee(wf.id, tenantId);
  await deps.workflows.publish(wf.id, tenantId, publie);
  await programmerMenage(deps.menage, tenantId, 'shopify', wf.graph, publie);
  const brouillon = wf.draftGraph ? avecLePremierBloc(wf.draftGraph, data) : null;
  if (brouillon !== null) await deps.workflows.update(wf.id, tenantId, { graph: brouillon });
  return { ok: true, valeur: { ligne: (await deps.store.ligne(tenantId, b.evenement)) ?? ligne, programmationAnnulee: programmee !== null } };
}

/** Une ligne, telle que la console et `get_shopify_state` la montrent. */
export interface EtatLigne {
  evenement: EvenementShopify;
  actif: boolean;
  workflowId: string;
  /** Le nom du scénario. */
  scenario: string | null;
  /** Le premier template, publié ; `null` tant qu'il n'est pas écrit. */
  modele: string | null;
  langue: string | null;
  /** Son statut chez Meta (`APPROVED`, `PENDING`, `REJECTED`...) ; `null` sans template ou introuvable. */
  etatChezMeta: string | null;
  /** Le nombre de blocs du scénario publié : 1, seul le premier message part. */
  blocs: number;
  /** Une version du scénario attend Meta pour sa mise en ligne (lot 3) : la console dit « nouvelle version en validation ». */
  versionProgrammee: boolean;
}

/** Les lignes de l'espace, dans l'ordre des événements, chacune lue avec son scénario publié et son template chez Meta. */
export async function etatDesLignes(deps: DepsLignesShopify, tenantId: string): Promise<EtatLigne[]> {
  const lignes = await deps.store.lignes(tenantId);
  if (lignes.length === 0) return [];
  // Illisible chez Meta : l'état se lit quand même, sans l'état de chaque template (la carte et get_shopify_state ne
  // tombent pas avec Meta ; relecture de 5b).
  const modeles = (await lireModeles(deps, tenantId)) ?? [];
  const etats: EtatLigne[] = [];
  for (const l of [...lignes].sort((a, c) => EVENEMENTS_SHOPIFY.indexOf(a.evenement) - EVENEMENTS_SHOPIFY.indexOf(c.evenement))) {
    const wf = await deps.workflows.getById(l.workflowId, tenantId);
    const graphe = wf !== null && wf.rayon === 'shopify' ? wf.graph : null;
    const bloc = graphe === null ? null : blocVerrouille(graphe);
    const nom = typeof bloc?.data.templateName === 'string' && bloc.data.templateName.trim() !== '' ? bloc.data.templateName.trim() : null;
    const langue = nom === null ? null : String(bloc?.data.language ?? 'fr');
    const tpl = nom === null ? undefined : modeles.find((t) => t.name === nom && t.language === langue);
    etats.push({
      evenement: l.evenement, actif: l.actif, workflowId: l.workflowId, scenario: wf?.name ?? null,
      modele: nom, langue, etatChezMeta: tpl?.status ?? null, blocs: graphe?.nodes.length ?? 0,
      versionProgrammee: wf !== null && (await deps.workflows.publicationProgrammee(wf.id, tenantId)) !== null,
    });
  }
  return etats;
}
