import { journaliser } from '../lib/journal';
import { messageDe } from '../lib/erreur';
import type { TemplateSummary } from '../meta/templates';
import { RELIER_EN_COEXISTENCE, type Filiere } from '../application/comptes';
import { countTemplateVariables } from '../crm/template';
import type { WorkflowGraph, WorkflowNode } from '../workflow/graph';
import type { PgWorkflowStore } from '../workflow/store.pg';
import type { WorkflowExecutor } from '../workflow/executor';
import { programmerMenage, type DepsMenage, type IssueCreationDeBloc } from '../workflow/modeles-de-bloc';
import { EXEMPLES_DONNEES } from '../../web/lib/partage/shopify-messages';
import { DELAI_PANIER_MAX, DELAI_PANIER_MIN, DONNEES_SHOPIFY, EVENEMENTS_SHOPIFY, type DonneeShopify, type EvenementShopify } from './donnees';
import { NOM_DU_SCENARIO, prefixeShopify, type LigneShopify } from './lignes';
import { corpsStandard } from './messages-standard';
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
  workflows: Pick<PgWorkflowStore, 'insert' | 'publish' | 'getById' | 'update' | 'publicationProgrammee' | 'programmer'>;
  /** L'exécuteur des parcours, ENTIER. */
  parcours: Pick<WorkflowExecutor, 'arreterParcours'>;
  /** Les templates de l'espace chez Meta (`listerModeles`) : le statut et les boutons du premier template. */
  modeles(tenantId: string): Promise<readonly TemplateSummary[]>;
  /** Le ménage du template que le premier bloc remplace (spec § 5.1) : programmé, jamais supprimé ici. */
  menage: DepsMenage;
  /**
   * Un template écrit depuis un bloc (`creerModeleDuBloc` lié à ses magasins par le câblage) : le message standard
   * (2026-11-20) passe par la porte du builder, son nom généré côté serveur et sa ligne `modeles_de_bloc`.
   */
  creerModele(tenantId: string, e: { workflowId: string; nodeId: string; corps: Record<string, unknown>; par: string | null }): Promise<IssueCreationDeBloc>;
  /** La filière de l'espace (`filiereDe`) : sur un numéro relié par QR code, aucun template ne part. */
  filiere(tenantId: string): Promise<Filiere | null>;
}

export type Refus = { ok: false; statut: 400 | 409 | 422 | 503; message: string };
export type Issue<T> = { ok: true; valeur: T } | Refus;
const refus = (statut: Refus['statut'], message: string): Refus => ({ ok: false, statut, message });

/**
 * Le refus d'un message Shopify actif sur un numéro relié par QR code (2026-10-24, `brancherMessage` ; l'interrupteur de la
 * console depuis 2026-11-20), et sa suite : la coexistence, après laquelle les messages se règlent en modèles.
 */
export const PHRASE_SHOPIFY_QR_CODE = 'Sur un numéro relié par QR code, les messages Shopify ne peuvent pas partir : WhatsApp ne '
  + `laisse pas écrire en premier à un client. Pour écrire en premier tout en gardant l’application WhatsApp Business, ${RELIER_EN_COEXISTENCE}`;

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
  // Une ligne déjà allumée (la console renvoie `actif: true` avec un nouveau délai du panier) : ni refus ni proposition.
  if (r.actif && (await deps.store.ligne(tenantId, evenement))?.actif !== true) {
    // Sur un numéro relié par QR code, chaque événement finirait `filiere_differente` : refusé ici, comme `set_shopify_message`.
    if ((await deps.filiere(tenantId)) === 'application') return refus(409, PHRASE_SHOPIFY_QR_CODE);
    await assurerLigne(deps, tenantId, evenement, par);
    // Un cas encore vide (création sautée au branchement, boutique branchée avant le 2026-11-20) reçoit son message
    // standard ; un cas qui a son message n'est pas touché. Jamais levé : l'allumage passe.
    await proposerMessageStandard(deps, tenantId, evenement, par);
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

/** Le bloc verrouillé de ce graphe nomme-t-il un template ? */
const nommeUnModele = (g: WorkflowGraph | null | undefined): boolean => {
  const bloc = g ? blocVerrouille(g) : null;
  return typeof bloc?.data.templateName === 'string' && bloc.data.templateName.trim() !== '';
};

/**
 * Ce que devient la proposition du message standard : posé (programmé ou publié), déjà là (rien de touché), numéro relié
 * par QR code, refusé par Meta ou sans compte WhatsApp Business (rien dans le scénario), panne (journalisée).
 */
export type IssueProposition = 'propose' | 'deja' | 'filiere_application' | 'non_cree' | 'echec';

/**
 * LE MESSAGE STANDARD D'UNE LIGNE (Julien, 2026-11-20, spec `2026-11-20-shopify-messages-standard-design.md`) : au
 * branchement de la boutique, et au premier allumage d'un cas encore vide. La ligne naît (ou se retrouve) ÉTEINTE ; le
 * template standard se crée par la porte du builder (`creerModeleDuBloc` : nom généré côté serveur, jamais le motif de
 * l'ancien assistant que le ménage supprimerait ; ligne `modeles_de_bloc`, donc ménagé le jour où le marchand le remplace).
 *
 * 🔴 PENDANT LA VALIDATION DE META, LE TEMPLATE VA DANS UNE VERSION PROGRAMMÉE (décision 18), JAMAIS DANS LE PUBLIÉ : une
 * ligne allumée pendant l'attente n'envoie rien (`premier_message_absent`) au lieu de consommer chaque événement en
 * `modele_refuse`, et l'approbation met en ligne par le chemin existant (`tenterMiseEnLigne`, filet de dix minutes). La
 * programmation n'a pas d'auteur (`par` nul) : c'est elle qui retient l'e-mail « en ligne », faux pour une ligne éteinte.
 * Le brouillon reçoit le même bloc, pour que l'éditeur montre le message proposé.
 *
 * Jamais par-dessus le message du marchand : un template dans le publié, la version programmée ou le brouillon arrête
 * tout. Jamais levée : le branchement et l'allumage passent quoi qu'il arrive ici.
 */
export async function proposerMessageStandard(
  deps: DepsLignesShopify, tenantId: string, evenement: EvenementShopify, par: string | null,
): Promise<IssueProposition> {
  try {
    if ((await deps.filiere(tenantId)) === 'application') return 'filiere_application';
    const ligne = await assurerLigne(deps, tenantId, evenement, par);
    const wf = await deps.workflows.getById(ligne.workflowId, tenantId);
    if (wf === null || wf.rayon !== 'shopify') return 'echec';
    const programmee = await deps.workflows.publicationProgrammee(wf.id, tenantId);
    if (nommeUnModele(wf.graph) || nommeUnModele(wf.draftGraph) || nommeUnModele(programmee?.graphe)) return 'deja';
    const bloc = blocVerrouille(wf.draftGraph ?? wf.graph);
    if (bloc === null) return 'echec';
    const { corps, variables } = corpsStandard(evenement);
    const cree = await deps.creerModele(tenantId, { workflowId: wf.id, nodeId: bloc.id, corps, par });
    if (!cree.ok || cree.etat === 'refuse') {
      journaliser('warn', 'shopify_message_standard_non_cree', { tenantId, evenement, erreur: cree.ok ? 'refusé par Meta' : cree.erreur });
      return 'non_cree';
    }
    const data = {
      templateName: cree.modele, language: cree.langue, templateButtons: [], templateCards: [],
      variables: variables.map((key, i) => ({ position: i + 1, source: { type: 'variable', key } })),
    };
    const version = avecLePremierBloc(wf.graph, data);
    if (version === null) return 'echec';
    if (cree.etat === 'approuve') {
      await deps.workflows.publish(wf.id, tenantId, version);
      await programmerMenage(deps.menage, tenantId, 'shopify', wf.graph, version);
    } else {
      await deps.workflows.programmer(wf.id, tenantId, null, version);
    }
    const brouillon = avecLePremierBloc(wf.draftGraph ?? wf.graph, data);
    if (brouillon !== null) await deps.workflows.update(wf.id, tenantId, { graph: brouillon });
    journaliser('info', 'shopify_message_standard_propose', { tenantId, evenement, etat: cree.etat });
    return 'propose';
  } catch (err) {
    journaliser('error', 'shopify_message_standard_en_echec', { tenantId, evenement, erreur: messageDe(err) });
    return 'echec';
  }
}

/** Les messages standard des trois événements, en parallèle (des scénarios distincts) : au branchement de la boutique. */
export async function proposerLesMessagesStandard(deps: DepsLignesShopify, tenantId: string, par: string | null): Promise<IssueProposition[]> {
  return Promise.all(EVENEMENTS_SHOPIFY.map((e) => proposerMessageStandard(deps, tenantId, e, par)));
}

/** Le message en vigueur d'une ligne, pour l'aperçu de la console : son corps, son pied, un exemple par variable. */
export interface ApercuLigne {
  corps: string;
  pied: string | null;
  /** Par position : `exemples[0]` remplace {{1}}. Une donnée Shopify vaut son exemple ; une autre source reste en repère. */
  exemples: string[];
  /** Par position, la donnée Shopify reliée (`null` pour une autre source) : ce que `set_shopify_message` doit renvoyer. */
  donnees: Array<DonneeShopify | null>;
  /** Le template attend Meta (une version programmée, ou un statut en attente). */
  enValidation: boolean;
}

const estDonnee = (k: unknown): k is DonneeShopify => typeof k === 'string' && (DONNEES_SHOPIFY as readonly string[]).includes(k);

/** L'aperçu du template que nomme le bloc verrouillé de ce graphe ; `null` sans template, ou introuvable chez Meta. */
function apercuDe(g: WorkflowGraph | null, modeles: readonly TemplateSummary[], programmee: boolean): ApercuLigne | null {
  const bloc = g === null ? null : blocVerrouille(g);
  const nom = typeof bloc?.data.templateName === 'string' ? bloc.data.templateName.trim() : '';
  if (bloc === null || nom === '') return null;
  const tpl = modeles.find((t) => t.name === nom && t.language === String(bloc.data.language ?? 'fr'));
  if (tpl === undefined || typeof tpl.body !== 'string') return null;
  const sources = Array.isArray(bloc.data.variables) ? bloc.data.variables as Array<{ position?: unknown; source?: { type?: unknown; key?: unknown; value?: unknown } }> : [];
  const positions = Array.from({ length: countTemplateVariables(tpl.body) }, (_, i) => sources.find((v) => v.position === i + 1)?.source);
  const donnees = positions.map((s) => (s?.type === 'variable' && estDonnee(s.key) ? s.key : null));
  const exemples = positions.map((s, i) => {
    const d = donnees[i];
    if (d) return EXEMPLES_DONNEES[d];
    if (s?.type === 'literal' && typeof s.value === 'string' && s.value !== '') return s.value;
    return `{{${i + 1}}}`;
  });
  const statut = String(tpl.status ?? '').toUpperCase();
  return { corps: tpl.body, pied: tpl.footer ?? null, exemples, donnees, enValidation: programmee || statut === 'PENDING' || statut === 'IN_APPEAL' };
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
  /** Le message en vigueur (celui de la version programmée s'il y en a une, sinon du publié), pour la bulle de la console. */
  apercu: ApercuLigne | null;
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
    const programmee = wf === null ? null : await deps.workflows.publicationProgrammee(wf.id, tenantId);
    // L'aperçu : la version programmée d'abord (le message standard en validation, ou un nouveau texte), sinon le publié.
    const apercu = (programmee !== null ? apercuDe(programmee.graphe, modeles, true) : null) ?? apercuDe(graphe, modeles, false);
    etats.push({
      evenement: l.evenement, actif: l.actif, workflowId: l.workflowId, scenario: wf?.name ?? null,
      modele: nom, langue, etatChezMeta: tpl?.status ?? null, blocs: graphe?.nodes.length ?? 0,
      versionProgrammee: programmee !== null, apercu,
    });
  }
  return etats;
}
