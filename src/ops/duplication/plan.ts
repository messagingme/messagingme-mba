import { createHash } from 'node:crypto';
import type { WorkflowGraph } from '../../workflow/graph';
import type { AutomationRow } from '../../automation/match';
import type { UserFieldDef, UserFieldType } from '../../crm/types';
import { isSystemFieldKey } from '../../crm/fields';
import { copierGraphe, referencesDuGraphe, type GrapheCopie, type ReferenceDependance } from './graphe';
import { copierDeclencheurs, type DeclencheursCopies } from './declencheurs';
import {
  planifierDependances, type ApercuDependances, type ChoixDependances, type CopiesPrevues, type DependancesSource, type NomsPris,
} from './dependances';

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

export interface TemplateDeLaWaba { nom: string; langue: string; statut: string; boutons: Array<{ type: string; texte: string }> }

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
  /** Templates de la WABA source, pour comparer les boutons d'un template réutilisé ; `null` = illisibles (lot 2). */
  templatesSource: TemplateDeLaWaba[] | null;
  /** L'offre de la destination ouvre-t-elle les scénarios ? Sinon la copie y restera inutilisable. */
  offreOuvreScenarios: boolean;
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

/** Une liste de templates dans un ordre fixe : Meta peut rendre la même liste dans un autre ordre (relecture du lot 1). */
const trierTemplates = (l: TemplateDeLaWaba[] | null): TemplateDeLaWaba[] | null => (
  l === null ? null : [...l].sort((a, b) => (a.nom === b.nom ? a.langue.localeCompare(b.langue) : a.nom.localeCompare(b.nom)))
);

const memesBoutons = (a: TemplateDeLaWaba['boutons'], b: TemplateDeLaWaba['boutons']): boolean => (
  a.length === b.length && a.every((x, i) => x.type === b[i]!.type && x.texte === b[i]!.texte)
);

/** `choix` : les cases cochées (lot 2). Il n'entre pas dans l'empreinte, qui ne dit que l'état des deux espaces. */
export function planifierDuplication(etat: EtatDuplication, choix?: ChoixDependances): PlanDuplication {
  const graphe = copierGraphe(etat.scenario.graphe, etat.destination.codeClient);
  const declencheurs = copierDeclencheurs(etat.automationsDuScenario, etat.automationsDeLaDestination);
  const references = referencesDuGraphe(etat.scenario.graphe);
  const dependances = planifierDependances(etat.dependances, etat.nomsPris, etat.scenario.id, references, choix);

  const source = new Map(etat.champsSource.map((c) => [c.key, c]));
  const destination = new Map(etat.champsDestination.map((c) => [c.key, c]));
  const champsACreer: UserFieldDef[] = [];
  const champsEnConflit: PlanDuplication['champsEnConflit'] = [];
  const champsInconnus: string[] = [];
  const clesDependances = dependances.clesDeChamp.filter((c) => c !== '' && !isSystemFieldKey(c));
  for (const cle of new Set([...graphe.clesDeChamp, ...declencheurs.clesDeChamp, ...clesDependances])) {
    const s = source.get(cle);
    const d = destination.get(cle);
    if (d && s && d.type !== s.type) champsEnConflit.push({ cle, typeSource: s.type, typeDestination: d.type });
    else if (!d && s) champsACreer.push({ key: s.key, label: s.label, type: s.type });
    else if (!d && !s) champsInconnus.push(cle);
  }

  const blocages: string[] = [];
  const signaux: string[] = [];
  if (etat.source.id === etat.destination.id) blocages.push('la source et la destination sont le même espace');
  const templatesAbsents: PlanDuplication['templatesAbsents'] = [];
  const templatesNonApprouves: TemplateDeLaWaba[] = [];
  if (etat.templatesDestination === null) {
    blocages.push('l’espace de destination n’a pas de WABA : ses templates ne se lisent pas, et le scénario n’y enverrait rien');
  } else {
    for (const t of graphe.templates) {
      const trouve = etat.templatesDestination.find((w) => w.nom === t.nom && w.langue === t.langue);
      if (!trouve) templatesAbsents.push(t);
      else if (trouve.statut !== 'APPROVED') templatesNonApprouves.push(trouve);
    }
  }
  for (const t of templatesAbsents) {
    blocages.push(`le template ${t.nom} (${t.langue}) n’existe pas dans la WABA de destination : créez-le là-bas, puis relancez l’aperçu`);
  }
  for (const t of templatesNonApprouves) {
    signaux.push(`le template ${t.nom} (${t.langue}) existe dans la destination mais n’est pas approuvé (${t.statut})`);
  }
  if (!etat.offreOuvreScenarios) signaux.push('l’offre de la destination n’inclut pas les scénarios : la copie y restera inutilisable tant qu’elle n’en change pas');
  for (const cle of champsInconnus) signaux.push(`le champ ${cle} est utilisé par le scénario mais défini nulle part : il n’est pas créé`);

  // Un template réutilisé dont les boutons diffèrent de la source : une fois publiée, la copie suivrait la branche d'un
  // autre bouton (le bloc garde les `templateButtons` de la source). Signalé, sans blocage (relecture du lot 1).
  const reutilises = etat.templatesDestination === null ? [] : graphe.templates.flatMap((t) => {
    const d = etat.templatesDestination!.find((w) => w.nom === t.nom && w.langue === t.langue);
    return d ? [d] : [];
  });
  if (reutilises.length > 0 && etat.templatesSource === null) {
    signaux.push('les templates de la source n’ont pas pu être lus : les boutons des templates réutilisés n’ont pas été comparés');
  }
  for (const d of reutilises) {
    const s = etat.templatesSource?.find((w) => w.nom === d.nom && w.langue === d.langue);
    if (s && !memesBoutons(s.boutons, d.boutons)) {
      signaux.push(`le template ${d.nom} (${d.langue}) de la destination n’a pas les mêmes boutons que celui de la source : vérifiez les branches du bloc`);
    }
  }
  if (graphe.imagesSource.length > 0) {
    signaux.push(`${graphe.imagesSource.length} image(s) des messages restent hébergées par l’espace source : elles disparaîtront s’il est supprimé`);
  }

  const etatTrie: EtatDuplication = {
    ...etat, templatesDestination: trierTemplates(etat.templatesDestination), templatesSource: trierTemplates(etat.templatesSource),
  };
  return {
    nomCopie: nomDeLaCopie(etat.scenario.nom, etat.nomsPrisDestination),
    graphe, declencheurs, champsACreer, champsEnConflit, champsInconnus, templatesAbsents, templatesNonApprouves, signaux, blocages,
    empreinte: createHash('sha256').update(jsonStable(etatTrie)).digest('hex'),
    references,
    dependances: dependances.apercu,
    copies: dependances.copies,
    choixInvalides: dependances.choixInvalides,
    tagsDependances: dependances.tags,
  };
}
