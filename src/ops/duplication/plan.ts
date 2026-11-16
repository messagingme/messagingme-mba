import { createHash } from 'node:crypto';
import type { WorkflowGraph } from '../../workflow/graph';
import type { AutomationRow } from '../../automation/match';
import type { UserFieldDef, UserFieldType } from '../../crm/types';
import { copierGraphe, type GrapheCopie } from './graphe';
import { copierDeclencheurs, type DeclencheursCopies } from './declencheurs';

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

export interface TemplateDeLaWaba { nom: string; langue: string; statut: string }

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
  /** L'offre de la destination ouvre-t-elle les scénarios ? Sinon la copie y restera inutilisable. */
  offreOuvreScenarios: boolean;
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

export function planifierDuplication(etat: EtatDuplication): PlanDuplication {
  const graphe = copierGraphe(etat.scenario.graphe, etat.destination.codeClient);
  const declencheurs = copierDeclencheurs(etat.automationsDuScenario, etat.automationsDeLaDestination);

  const source = new Map(etat.champsSource.map((c) => [c.key, c]));
  const destination = new Map(etat.champsDestination.map((c) => [c.key, c]));
  const champsACreer: UserFieldDef[] = [];
  const champsEnConflit: PlanDuplication['champsEnConflit'] = [];
  const champsInconnus: string[] = [];
  for (const cle of new Set([...graphe.clesDeChamp, ...declencheurs.clesDeChamp])) {
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

  return {
    nomCopie: nomDeLaCopie(etat.scenario.nom, etat.nomsPrisDestination),
    graphe, declencheurs, champsACreer, champsEnConflit, champsInconnus, templatesAbsents, templatesNonApprouves, signaux, blocages,
    empreinte: createHash('sha256').update(jsonStable(etat)).digest('hex'),
  };
}
