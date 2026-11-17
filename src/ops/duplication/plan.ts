import { createHash } from 'node:crypto';
import type { WorkflowGraph } from '../../workflow/graph';
import type { AutomationRow } from '../../automation/match';
import type { UserFieldDef, UserFieldType } from '../../crm/types';
import type { TemplateSummary } from '../../meta/templates';
import { isSystemFieldKey } from '../../crm/fields';
import { nomDuBloc } from '../../workflow/aller-a';
import { copierGraphe, referencesDuGraphe, type GrapheCopie, type ReferenceDependance } from './graphe';
import { copierDeclencheurs, type DeclencheursCopies } from './declencheurs';
import {
  planifierDependances, type ApercuDependances, type ChoixDependances, type CopiesPrevues, type DependancesSource, type NomsPris,
} from './dependances';
import {
  PLAFOND_META, planifierMeta, signatureModele,
  type ApercuMeta, type ChoixMeta, type CopiesMeta, type EtatMeta, type FlowSource, type IndicesSource, type TemplateDeLaWaba,
} from './meta';

export type { TemplateDeLaWaba } from './meta';

/** Les cases cochées : les dépendances en base (lot 2), les templates et les Flows à recréer chez Meta (lot 3). */
export type ChoixDuplication = ChoixDependances & Partial<ChoixMeta>;

/**
 * LE PLAN D'UNE DUPLICATION DE SCÉNARIO ENTRE ESPACES (duplication depuis /ops, lot 1 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`). Pur : aucune IO.
 *
 * L'aperçu et l'exécution calculent le MÊME plan à partir de l'état lu (`EtatDuplication`) : l'aperçu le montre,
 * l'exécution le refait et compare l'empreinte avant d'écrire quoi que ce soit. Une empreinte différente veut dire que
 * l'un des deux espaces a changé entre les deux (scénario modifié, champ créé, template apparu) : on refuse plutôt que
 * d'écrire autre chose que ce qui a été montré.
 *
 * 🔴 L'EMPREINTE SE CALCULE SUR L'ÉTAT LU, PAS SUR LE PLAN : la copie tire des codes de blocs neufs à chaque calcul
 * (`mintNodeCodes`), donc deux plans du même état diffèrent toujours par leurs codes.
 */

export interface EtatDuplication {
  source: { id: string; nom: string };
  destination: { id: string; nom: string; codeClient: string };
  /** `graphe` = le brouillon s'il existe, sinon le publié : on copie ce que l'auteur voit. */
  scenario: { id: string; nom: string; graphe: WorkflowGraph };
  automationsDuScenario: AutomationRow[];
  automationsDeLaDestination: AutomationRow[];
  champsSource: UserFieldDef[];
  champsDestination: UserFieldDef[];
  /** Noms des scénarios publics de la destination. */
  nomsPrisDestination: string[];
  /** Templates de la WABA de destination ; `null` = l'espace n'a pas de WABA. */
  templatesDestination: TemplateDeLaWaba[] | null;
  /**
   * Les templates de la WABA source que le scénario envoie, lus en entier par `listerModeles` (adresses d'origine des
   * boutons remises) : pour comparer les boutons d'un template réutilisé, et pour recréer un absent ; `null` = illisibles.
   */
  modelesSource: TemplateSummary[] | null;
  /** Les Flows de la source que le scénario ouvre (blocs Flow, boutons Flow de ses templates), lus dans sa base (lot 3). */
  flowsSource: FlowSource[];
  /** Les indications de variables de ces templates dans la source, recopiées avec eux (lot 3). */
  indicesSource: IndicesSource[];
  /** L'offre de la destination ouvre-t-elle les scénarios ? Sinon la copie y restera inutilisable. */
  offreOuvreScenarios: boolean;
  /**
   * La destination peut-elle consommer de l'IA (`acces_credit_ia`, `src/agent/acces-credit.ts`) ? Aucune offre ne ferme
   * l'agent IA : c'est son crédit qui le fait taire. Lu seulement quand un agent est proposé, `true` sinon.
   */
  creditIaOuvert: boolean;
  /** Ce que le scénario désigne dans la source et qui peut le suivre (lot 2). */
  dependances: DependancesSource;
  /** Les noms déjà pris dans la destination, pour les copies des dépendances (lot 2). */
  nomsPris: NomsPris;
}

export interface PlanDuplication {
  /** Indicatif : l'écriture refait la boucle sous le verrou de nom, et le nom qu'elle rend fait foi. */
  nomCopie: string;
  graphe: GrapheCopie;
  declencheurs: DeclencheursCopies;
  champsACreer: UserFieldDef[];
  champsEnConflit: Array<{ cle: string; typeSource: UserFieldType; typeDestination: UserFieldType }>;
  /** Clés nommées par le scénario sans définition ni dans la source ni dans la destination : rien à créer. */
  champsInconnus: string[];
  templatesAbsents: Array<{ nom: string; langue: string }>;
  templatesNonApprouves: TemplateDeLaWaba[];
  signaux: string[];
  blocages: string[];
  empreinte: string;
  /** Les dépendances que le scénario désigne, bloc par bloc (lot 2). */
  references: ReferenceDependance[];
  /** Pour l'aperçu : chaque dépendance, le nom qu'aurait sa copie, son secret, les outils qui suivraient ou non. */
  dependances: ApercuDependances;
  /** Ce que les cases cochées font créer ; vide sans choix, ou si un choix est invalide. */
  copies: CopiesPrevues;
  /** Les ids cochés que le scénario ne désigne pas : la route refuse (400). */
  choixInvalides: string[];
  /** Les tags que nomment les outils copiés, à déclarer avec ceux du graphe et des déclencheurs. */
  tagsDependances: string[];
  /** Pour l'aperçu : chaque template et chaque Flow, son sort, sa case (lot 3). */
  meta: ApercuMeta;
  /** Ce que les cases cochées font recréer chez Meta, Flows d'abord ; vide sans choix. */
  copiesMeta: CopiesMeta;
  /** Les blocs template qui arrivent débranchés : leur template n'est ni réutilisé ni coché. */
  templatesADebrancher: string[];
  /** Les champs à créer AVANT la soumission chez Meta (adresses des boutons des templates cochés). */
  champsAvantMeta: UserFieldDef[];
}

/** Comparaison d'un nom de scénario comme `nomPrisSousVerrou` : sans la casse ni les espaces aux bords. */
export const nomCompare = (nom: string): string => nom.trim().toLowerCase();

/** « X (copie) », puis « X (copie 2) »… : le premier nom libre parmi `pris`. */
export function nomDeLaCopie(nom: string, pris: readonly string[]): string {
  const occupes = new Set(pris.map(nomCompare));
  let candidat = `${nom} (copie)`;
  for (let n = 2; occupes.has(nomCompare(candidat)); n += 1) candidat = `${nom} (copie ${n})`;
  return candidat;
}

/** JSON aux clés triées : deux lectures du même état donnent le même texte, quel que soit l'ordre des colonnes. */
function jsonStable(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(jsonStable).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jsonStable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Une liste dans un ordre fixe : Meta peut rendre la même liste dans un autre ordre (relecture du lot 1). */
const parNomEtLangue = <T>(l: readonly T[], nom: (x: T) => string, langue: (x: T) => string): T[] => (
  [...l].sort((a, b) => (nom(a) === nom(b) ? langue(a).localeCompare(langue(b)) : nom(a).localeCompare(nom(b))))
);

const memesBoutons = (a: TemplateDeLaWaba['boutons'], b: TemplateDeLaWaba['boutons']): boolean => (
  a.length === b.length && a.every((x, i) => x.type === b[i]!.type && x.texte === b[i]!.texte)
);

const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Les templates et les blocs Flow du graphe source, avec les blocs qui les portent (lot 3). La route les lit aussi. */
export function templatesEtFlowsDuGraphe(g: WorkflowGraph): Pick<EtatMeta, 'templates' | 'blocsFlow'> {
  const templates = new Map<string, EtatMeta['templates'][number]>();
  const blocsFlow: EtatMeta['blocsFlow'] = [];
  for (const n of g.nodes) {
    if (n.type === 'template') {
      const nom = texte(n.data.templateName);
      if (nom === '') continue;
      // Même repli de langue que l'envoi (`actionOf`) et que `copierGraphe`.
      const langue = String(n.data.language ?? 'fr');
      const k = `${nom}\u0000${langue}`;
      const t = templates.get(k) ?? { nom, langue, blocs: [] };
      t.blocs.push({ nodeId: n.id, nom: nomDuBloc(n) });
      templates.set(k, t);
    } else if (n.type === 'flow') {
      const flowId = texte(n.data.flowId);
      if (flowId !== '') blocsFlow.push({ nodeId: n.id, nom: nomDuBloc(n), flowId, flowNom: texte(n.data.flowName) });
    }
  }
  return { templates: [...templates.values()], blocsFlow };
}

/** `choix` : les cases cochées (lots 2 et 3). Il n'entre pas dans l'empreinte, qui ne dit que l'état des deux espaces. */
export function planifierDuplication(etat: EtatDuplication, choix?: ChoixDuplication): PlanDuplication {
  const graphe = copierGraphe(etat.scenario.graphe, etat.destination.codeClient);
  const declencheurs = copierDeclencheurs(etat.automationsDuScenario, etat.automationsDeLaDestination);
  const references = referencesDuGraphe(etat.scenario.graphe);
  const dependances = planifierDependances(
    etat.dependances, etat.nomsPris, { id: etat.scenario.id, codes: new Set(graphe.codes.keys()) }, references, choix,
  );
  const duGraphe = templatesEtFlowsDuGraphe(etat.scenario.graphe);
  // Seuls les templates que le scénario envoie comptent : un template créé ou approuvé ailleurs, dans l'une des deux WABA,
  // ne change ni le plan ni l'empreinte (relecture du lot 2).
  const designe = (nom: string, langue: string): boolean => duGraphe.templates.some((t) => t.nom === nom && t.langue === langue);
  const templatesDestination = etat.templatesDestination?.filter((w) => designe(w.nom, w.langue)) ?? null;
  const modelesSource = etat.modelesSource?.filter((t) => designe(t.name, t.language)) ?? null;
  const meta = planifierMeta({
    ...duGraphe, destination: templatesDestination, source: modelesSource, flowsSource: etat.flowsSource, indicesSource: etat.indicesSource,
    nomsFlowsPris: etat.nomsPris.flows, champsSource: etat.champsSource, champsDestination: etat.champsDestination,
  }, choix ? { templates: choix.templates ?? [], flows: choix.flows ?? [] } : undefined);

  const source = new Map(etat.champsSource.map((c) => [c.key, c]));
  const destination = new Map(etat.champsDestination.map((c) => [c.key, c]));
  const champsACreer: UserFieldDef[] = [];
  const champsEnConflit: PlanDuplication['champsEnConflit'] = [];
  const champsInconnus: string[] = [];
  const clesDependances = [...dependances.clesDeChamp, ...meta.clesDeChamp].filter((c) => c !== '' && !isSystemFieldKey(c));
  for (const cle of new Set([...graphe.clesDeChamp, ...declencheurs.clesDeChamp, ...clesDependances])) {
    const s = source.get(cle);
    const d = destination.get(cle);
    if (d && s && d.type !== s.type) champsEnConflit.push({ cle, typeSource: s.type, typeDestination: d.type });
    else if (!d && s) champsACreer.push({ key: s.key, label: s.label, type: s.type });
    else if (!d && !s) champsInconnus.push(cle);
  }

  // Par dépendance, les champs que sa copie créerait (la même règle que `champsACreer`), qu'elle soit cochée ou non.
  const seraCree = (cle: string): boolean => !isSystemFieldKey(cle) && source.has(cle) && !destination.has(cle);
  const apercuDependances: ApercuDependances = {
    agents: dependances.apercu.agents.map((a) => ({ ...a, champs: a.champs.filter(seraCree) })),
    requetes: dependances.apercu.requetes.map((r) => ({ ...r, champs: r.champs.filter(seraCree) })),
    modelesEmail: dependances.apercu.modelesEmail.map((m) => ({ ...m, champs: m.champs.filter(seraCree) })),
  };

  const blocages: string[] = [];
  const signaux: string[] = [];
  if (etat.source.id === etat.destination.id) blocages.push('la source et la destination sont le même espace');
  if (templatesDestination === null) {
    blocages.push('l’espace de destination n’a pas de WABA : ses templates ne se lisent pas, et le scénario n’y enverrait rien');
  }
  // Un template absent ne bloque plus (lot 3, décision de Julien) : il a sa case, ou arrive débranché.
  const templatesAbsents = meta.apercu.templates.filter((t) => t.etat !== 'reutilise').map((t) => ({ nom: t.nom, langue: t.langue }));
  const templatesNonApprouves = (templatesDestination ?? []).filter((w) => w.statut !== 'APPROVED');
  for (const t of templatesNonApprouves) {
    signaux.push(`le template ${t.nom} (${t.langue}) existe dans la destination mais n’est pas approuvé (${t.statut})`);
  }
  if (meta.depasse) {
    blocages.push(`plus de ${PLAFOND_META} templates et Flows à recréer chez Meta : décochez-en, la duplication dépasserait le temps d’une requête`);
  }
  if (!etat.offreOuvreScenarios) signaux.push('l’offre de la destination n’inclut pas les scénarios : la copie y restera inutilisable tant qu’elle n’en change pas');
  if (!etat.creditIaOuvert && etat.dependances.agents.length > 0) {
    signaux.push('la destination n’a pas de crédit IA (épuisé, ou plafond du mois atteint) : un agent copié n’y répondra pas tant qu’elle n’en a pas');
  }
  for (const cle of champsInconnus) signaux.push(`le champ ${cle} est utilisé par le scénario mais défini nulle part : il n’est pas créé`);

  // Un template réutilisé dont les boutons diffèrent de la source : une fois publiée, la copie suivrait la branche d'un
  // autre bouton (le bloc garde les `templateButtons` de la source). Signalé, sans blocage (relecture du lot 1).
  const reutilises = templatesDestination ?? [];
  if (reutilises.length > 0 && modelesSource === null) {
    signaux.push('les templates de la source n’ont pas pu être lus : les boutons des templates réutilisés n’ont pas été comparés');
  }
  for (const d of reutilises) {
    const s = modelesSource?.find((t) => t.name === d.nom && t.language === d.langue);
    if (s && !memesBoutons((s.buttons ?? []).map((b) => ({ type: b.type, texte: b.text })), d.boutons)) {
      signaux.push(`le template ${d.nom} (${d.langue}) de la destination n’a pas les mêmes boutons que celui de la source : vérifiez les branches du bloc`);
    }
  }
  if (graphe.imagesSource.length > 0) {
    signaux.push(`${graphe.imagesSource.length} image(s) des messages restent hébergées par l’espace source : elles disparaîtront s’il est supprimé`);
  }

  // L'empreinte : l'état lu, les listes dans un ordre fixe, et d'un template de la source sa signature seule (l'adresse
  // de ses médias, que Meta signe à chaque lecture, la ferait changer d'un appel à l'autre).
  const etatEmpreinte = {
    ...etat,
    templatesDestination: templatesDestination === null ? null : parNomEtLangue(templatesDestination, (w) => w.nom, (w) => w.langue),
    modelesSource: modelesSource === null ? null : parNomEtLangue(modelesSource, (t) => t.name, (t) => t.language).map(signatureModele),
    flowsSource: [...etat.flowsSource].sort((a, b) => a.id.localeCompare(b.id)),
    indicesSource: parNomEtLangue(etat.indicesSource, (i) => i.nom, (i) => i.langue),
  };
  return {
    nomCopie: nomDeLaCopie(etat.scenario.nom, etat.nomsPrisDestination),
    graphe, declencheurs, champsACreer, champsEnConflit, champsInconnus, templatesAbsents, templatesNonApprouves, signaux, blocages,
    empreinte: createHash('sha256').update(jsonStable(etatEmpreinte)).digest('hex'),
    references,
    dependances: apercuDependances,
    copies: dependances.copies,
    choixInvalides: [...dependances.choixInvalides, ...meta.choixInvalides],
    tagsDependances: dependances.tags,
    meta: meta.apercu,
    copiesMeta: meta.copies,
    templatesADebrancher: meta.templatesADebrancher,
    champsAvantMeta: meta.champsAvantMeta,
  };
}
