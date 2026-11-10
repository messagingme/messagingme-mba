/**
 * Les ÉLÉMENTS qu'un WhatsApp Flow renvoie, lus dans son flow_json (Julien, 2026-11-10). Pur, aucune IO.
 *
 * 🔴 CE QUE LA RÉPONSE PORTE, C'EST LE `payload` DE L'ACTION `complete`, ET RIEN D'AUTRE. Meta renvoie dans
 * `response_json` exactement les clés de ce `payload` (plus `flow_token`) : un champ de saisie que le `payload` ne cite
 * pas n'arrive jamais. C'est donc lui qu'on lit, sur chaque action `complete` du flow (il peut en avoir plusieurs, un
 * par écran final), et pas la liste des composants de saisie.
 *
 * Le libellé vient du composant que la valeur cite : `${form.prenom}` (ou `${screen.ECRAN.form.prenom}`) désigne le
 * composant `name: "prenom"` ; `${data.prenom}` désigne une donnée d'écran, apportée par le `payload` d'un `navigate`
 * précédent, qu'on remonte jusqu'à son composant. Un libellé introuvable, dynamique (`${...}`) ou une valeur constante
 * rendent la clé elle-même : on n'invente pas de nom.
 *
 * Le parcours est borné (profondeur, nombre de nœuds) : le flow_json vient de chez Meta, mais il est écrit par
 * quiconque a accès au Business Manager du client.
 */
import { CLES_TECHNIQUES_FORMULAIRE } from '../../web/lib/partage/rangement-formulaire';

export interface SortieFormulaire {
  /** La clé de l'élément dans la réponse (`response_json`). */
  cle: string;
  /** Le libellé du composant qui la saisit, ou la clé. */
  libelle: string;
}

const PROFONDEUR_MAX = 30;
const NOEUDS_MAX = 5_000;
const NOM = /^[A-Za-z0-9_]{1,80}$/;

type Obj = Record<string, unknown>;
const estObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Tous les objets du flow_json, en largeur, bornés. */
function objets(racine: unknown): Obj[] {
  const out: Obj[] = [];
  const file: Array<{ v: unknown; p: number }> = [{ v: racine, p: 0 }];
  while (file.length > 0 && out.length < NOEUDS_MAX) {
    const { v, p } = file.shift()!;
    if (p > PROFONDEUR_MAX) continue;
    const enfants = Array.isArray(v) ? v : estObj(v) ? Object.values(v) : [];
    if (estObj(v)) out.push(v);
    for (const e of enfants) if (e !== null && typeof e === 'object') file.push({ v: e, p: p + 1 });
  }
  return out;
}

/** L'action d'un objet (`on-click-action`, `on-select-action`...), si elle porte un nom et un `payload`. */
function actionsDe(o: Obj): Array<{ name: string; payload: Obj }> {
  const out: Array<{ name: string; payload: Obj }> = [];
  for (const [k, v] of Object.entries(o)) {
    if (!k.startsWith('on-') || !estObj(v)) continue;
    if (typeof v.name === 'string' && estObj(v.payload)) out.push({ name: v.name, payload: v.payload });
  }
  return out;
}

export function sortiesDuFlowJson(flowJson: unknown): SortieFormulaire[] {
  const tous = objets(flowJson);
  // Les composants nommés et leur libellé (statique seulement).
  const libelles = new Map<string, string>();
  for (const o of tous) {
    if (typeof o.name !== 'string' || !NOM.test(o.name) || typeof o.type !== 'string') continue;
    const l = typeof o.label === 'string' ? o.label.trim() : '';
    if (l !== '' && !l.includes('${') && !libelles.has(o.name)) libelles.set(o.name, l);
  }
  // Les données d'écran apportées par un `navigate` : clé -> expression d'origine.
  const donnees = new Map<string, string>();
  const completes: Obj[] = [];
  for (const o of tous) {
    for (const a of actionsDe(o)) {
      if (a.name === 'complete') completes.push(a.payload);
      else if (a.name === 'navigate' || a.name === 'data_exchange') {
        for (const [k, v] of Object.entries(a.payload)) if (typeof v === 'string' && !donnees.has(k)) donnees.set(k, v);
      }
    }
  }
  const libelleDe = (expr: unknown, cle: string): string => {
    let e = expr;
    for (let i = 0; i < 10 && typeof e === 'string'; i += 1) {
      const form = /^\$\{(?:screen\.[A-Za-z0-9_]+\.)?form\.([A-Za-z0-9_]+)\}$/.exec(e.trim());
      if (form) return libelles.get(form[1]!) ?? cle;
      const data = /^\$\{(?:screen\.[A-Za-z0-9_]+\.)?data\.([A-Za-z0-9_]+)\}$/.exec(e.trim());
      if (!data) return cle;
      e = donnees.get(data[1]!);
    }
    return cle;
  };
  const vues = new Set<string>();
  const out: SortieFormulaire[] = [];
  for (const p of completes) {
    for (const [cle, expr] of Object.entries(p)) {
      if (!NOM.test(cle) || CLES_TECHNIQUES_FORMULAIRE.includes(cle) || vues.has(cle)) continue;
      vues.add(cle);
      out.push({ cle, libelle: libelleDe(expr, cle) });
    }
  }
  return out;
}
