import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CodeApi } from '../api/erreurs';
import { MAX_NODES } from './graph';
import { QUESTION_LIMITES, QUESTION_MAX_ROWS, QUESTION_UNITS, UNIT_MS, WAIT_MAX_MS } from './engine';
import { LONGUEUR_MAX_ETIQUETTE } from '../crm/poser-etiquette';
import { VALEUR_ACCEPTEE } from '../api/modele-envoi';
import {
  MAX_REPONSES_RAPIDES, MAX_TEXTE_REPONSE_RAPIDE, TEXTE_MAX_AVEC_FICHIER_OU_BOUTON, TEXTE_MAX_SIMPLE,
} from '../../web/lib/partage/message-rapide';

/**
 * LA RECETTE D'UN SCÉNARIO, CE QUE L'API ET LE MCP REÇOIVENT (spec `docs/superpowers/specs/2026-11-02-scenarios-api-design.md`).
 *
 * Une arborescence sans identifiant ni position : le serveur la valide ici, puis la compile en graphe
 * (`recette-graphe.ts`). Le graphe brut n'est jamais accepté de l'extérieur : `parseGraph` ne regarde pas le contenu d'un
 * bloc, et un bloc mal rempli y devient un passe-plat muet.
 *
 * Les branches sont des LISTES et pas des objets indexés par leur texte : un moteur JavaScript range d'abord les clés
 * qui ressemblent à des entiers (« 1 », « 2 »), et l'ordre des réponses rapides est celui que le contact voit.
 */

export type SourceRecette = { champ: string } | { texte: string } | { attribut: 'name' | 'phone' };
export interface Branche { texte: string; suite: Etape }
export interface EtapeTemplate {
  template: { nom: string; langue: string; variables?: Record<string, SourceRecette> };
  boutons?: Branche[];
  autre_reponse?: Etape;
  /** Meta n'a pas pu livrer le template : la sortie « En cas d'échec » (poignée `non_livre`, 2026-11-20). */
  si_echec?: Etape;
}
export interface EtapeMessage {
  message: { texte: string; fichier?: { url: string } };
  reponses?: Branche[];
  autre_reponse?: Etape;
  suite?: Etape;
}
export interface EtapeAgent { agent: { agent_id: string } }
export interface EtapeHumain { humain: Record<string, never> }
/** Une ligne du menu d'une Question : ce que le contact choisit, et la suite de ce choix. */
export interface LigneMenu { titre: string; description?: string; suite: Etape }
export type UniteEcheance = (typeof QUESTION_UNITS)[number];
/** L'échéance « pas de réponse » d'une Question : les unités et le plafond du bloc Attente. */
export interface Echeance { valeur: number; unite: UniteEcheance }
/**
 * Une Question (lot 1 du CSM virtuel, B5) : elle attend la réponse du contact et la range dans `champ`. Avec un menu
 * (liste interactive WhatsApp), une suite par ligne et `autre_reponse` pour une réponse écrite ; sans menu, `suite`.
 * `sans_reponse` est la suite à l'échéance (une relance, l'équipe) : elle va avec `sans_reponse_apres`, jamais seule.
 */
export interface EtapeQuestion {
  question: { texte: string; champ?: string; bouton?: string; ranger_choix?: true; sans_reponse_apres?: Echeance };
  menu?: LigneMenu[];
  autre_reponse?: Etape;
  suite?: Etape;
  sans_reponse?: Etape;
}
/**
 * Une opération d'une Action, jouée dans l'ordre : poser une étiquette, en retirer, donner une valeur à un champ, en
 * vider. Le consentement n'en fait pas partie : il vient du contact, jamais d'une recette.
 */
export type Operation =
  | { etiquette: string }
  | { retirer_etiquettes: string[] }
  | { champ: string; valeur: string }
  | { vider_champs: string[] };
export interface EtapeAction { action: Operation[]; suite?: Etape }
export type Etape = EtapeTemplate | EtapeMessage | EtapeAgent | EtapeHumain | EtapeQuestion | EtapeAction;
export interface Recette { nom: string; entree: Etape }

/** Un refus, avec l'endroit exact de la recette : un appelant (souvent un modèle) doit pouvoir corriger sans deviner. */
export interface RefusRecette { ok: false; code: CodeApi; message: string; chemin: string }
export type Lu<T> = { ok: true; valeur: T } | RefusRecette;

export const PROFONDEUR_MAX_RECETTE = 20;
export const NOM_SCENARIO_MAX = 120;
/** Meta : 25 caractères pour le texte d'un bouton de template, 10 boutons au plus. */
export const MAX_TEXTE_BOUTON_TEMPLATE = 25;
export const MAX_BOUTONS_TEMPLATE = 10;
export const LONGUEUR_CHAMP_MAX = 64;
export const LONGUEUR_TEXTE_VARIABLE_MAX = 1024;
export const LONGUEUR_URL_FICHIER_MAX = 2048;
/** Chaque fichier se télécharge une fois à l'écriture pour être vérifié : leur nombre borne la durée de l'appel. */
export const MAX_FICHIERS_RECETTE = 10;
/** Les attributs de la fiche qu'une variable peut citer : le nom du profil WhatsApp et le numéro. */
export const ATTRIBUTS_RECETTE = ['name', 'phone'] as const;
/** Une Question : les plafonds de la liste interactive de WhatsApp, ceux du moteur (`QUESTION_LIMITES`). */
export const TEXTE_QUESTION_MAX = QUESTION_LIMITES.body;
export const BOUTON_MENU_MAX = QUESTION_LIMITES.bouton;
export const TITRE_LIGNE_MAX = QUESTION_LIMITES.titre;
export const DESCRIPTION_LIGNE_MAX = QUESTION_LIMITES.description;
export const LIGNES_MENU_MAX = QUESTION_MAX_ROWS;
/** L'échéance d'une Question : les unités et le plafond du bloc Attente (`WAIT_MAX_MS`, 30 jours). */
export const UNITES_ECHEANCE = QUESTION_UNITS;
export const ECHEANCE_MAX_JOURS = WAIT_MAX_MS / UNIT_MS.days;
/** Une Action : ses opérations, une étiquette (64 caractères, `poserEtiquette`), une valeur, une liste à retirer ou vider. */
export const OPERATIONS_MAX = 10;
export const ETIQUETTE_MAX = LONGUEUR_MAX_ETIQUETTE;
export const VALEUR_CHAMP_RECETTE_MAX = 1000;
export const LISTE_OPERATION_MAX = 20;

const refus = (chemin: string, message: string, code: CodeApi = 'invalid_body'): RefusRecette =>
  ({ ok: false, code, message: `${chemin} : ${message}`, chemin });

const SOURCE = z.union([
  z.object({ champ: z.string().trim().min(1).max(LONGUEUR_CHAMP_MAX) }).strict(),
  // Meta refuse un retour à la ligne, une tabulation ou cinq espaces de suite (132018), à CHAQUE envoi.
  z.object({ texte: z.string().min(1).max(LONGUEUR_TEXTE_VARIABLE_MAX).regex(VALEUR_ACCEPTEE) }).strict(),
  z.object({ attribut: z.enum(ATTRIBUTS_RECETTE) }).strict(),
]);
const TEMPLATE = z.object({
  nom: z.string().trim().min(1).max(512).regex(/^[a-z0-9_]+$/),
  langue: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2,3})?$/),
  variables: z.record(z.string().regex(/^[1-9][0-9]{0,2}$/), SOURCE).optional(),
}).strict();
const MESSAGE = z.object({
  texte: z.string(),
  fichier: z.object({
    url: z.string().trim().max(LONGUEUR_URL_FICHIER_MAX).regex(/^https:\/\/[^\s/]+\/?\S*$/),
  }).strict().optional(),
}).strict();
const AGENT = z.object({ agent_id: z.uuid() }).strict();
const HUMAIN = z.object({}).strict();
const BRANCHE = z.object({ texte: z.string(), suite: z.unknown() }).strict();
const QUESTION = z.object({
  texte: z.string(),
  champ: z.string().trim().min(1).max(LONGUEUR_CHAMP_MAX).optional(),
  bouton: z.string().trim().min(1).max(BOUTON_MENU_MAX).optional(),
  ranger_choix: z.boolean().optional(),
  sans_reponse_apres: z.object({ valeur: z.number().int().min(1), unite: z.enum(UNITES_ECHEANCE) }).strict().optional(),
}).strict();
const LIGNE = z.object({ titre: z.string(), description: z.string().optional(), suite: z.unknown() }).strict();
const ETIQUETTE = z.string().trim().min(1).max(ETIQUETTE_MAX);
const CLE_CHAMP = z.string().trim().min(1).max(LONGUEUR_CHAMP_MAX);
const OPERATION = z.union([
  z.object({ etiquette: ETIQUETTE }).strict(),
  z.object({ retirer_etiquettes: z.array(ETIQUETTE).min(1).max(LISTE_OPERATION_MAX) }).strict(),
  z.object({ champ: CLE_CHAMP, valeur: z.string().min(1).max(VALEUR_CHAMP_RECETTE_MAX) }).strict(),
  z.object({ vider_champs: z.array(CLE_CHAMP).min(1).max(LISTE_OPERATION_MAX) }).strict(),
]);

const CLES_ETAPE = {
  template: ['template', 'boutons', 'autre_reponse', 'si_echec'],
  message: ['message', 'reponses', 'autre_reponse', 'suite'],
  agent: ['agent'],
  humain: ['humain'],
  question: ['question', 'menu', 'autre_reponse', 'suite', 'sans_reponse'],
  action: ['action', 'suite'],
} as const;
type Forme = keyof typeof CLES_ETAPE;

/** Le chemin d'un problème Zod, à la suite de celui de l'objet lu. */
function cheminDe(base: string, morceaux: ReadonlyArray<PropertyKey>): string {
  return morceaux.reduce<string>((c, m) => (typeof m === 'number' ? `${c}[${m}]` : `${c}.${String(m)}`), base);
}

/** Une phrase française par problème Zod : le message anglais de Zod n'est pas montrable à un client. */
function phraseZod(i: z.core.$ZodIssue): string {
  switch (i.code) {
    case 'unrecognized_keys': return `clé inconnue : ${i.keys.join(', ')}`;
    case 'too_big': return `trop long ou trop nombreux (${String(i.maximum)} au plus)`;
    case 'too_small': return 'vide';
    case 'invalid_type': return `type invalide (attendu : ${i.expected})`;
    case 'invalid_union': return 'forme inconnue';
    case 'invalid_value': return `valeur non admise (${i.values.map(String).join(', ')})`;
    case 'invalid_format': return 'format invalide';
    case 'invalid_key': return 'clé invalide';
    default: return 'valeur invalide';
  }
}

function lireAvec<T>(schema: z.ZodType<T>, brut: unknown, chemin: string): Lu<T> {
  const r = schema.safeParse(brut);
  if (r.success) return { ok: true, valeur: r.data };
  const i = r.error.issues[0]!;
  return refus(cheminDe(chemin, i.path), phraseZod(i));
}

interface Compte { etapes: number }

function lireBranches(brut: unknown, chemin: string, max: number, maxTexte: number, profondeur: number, compte: Compte): Lu<Branche[]> {
  if (!Array.isArray(brut)) return refus(chemin, 'une liste attendue');
  if (brut.length > max) return refus(chemin, `${max} au plus`);
  const vus = new Set<string>();
  const sortie: Branche[] = [];
  for (const [i, b] of brut.entries()) {
    const ici = `${chemin}[${i}]`;
    const lu = lireAvec(BRANCHE, b, ici);
    if (!lu.ok) return lu;
    const texte = lu.valeur.texte.trim();
    if (texte === '') return refus(`${ici}.texte`, 'vide');
    if (texte.length > maxTexte) return refus(`${ici}.texte`, `${maxTexte} caractères au plus`);
    if (vus.has(texte)) return refus(`${ici}.texte`, `« ${texte} » figure deux fois`);
    vus.add(texte);
    const suite = lireEtape(lu.valeur.suite, `${ici}.suite`, profondeur + 1, compte);
    if (!suite.ok) return suite;
    sortie.push({ texte, suite: suite.valeur });
  }
  return { ok: true, valeur: sortie };
}

/** Les lignes du menu d'une Question : titre exigé et distinct, description facultative, une suite chacune. */
function lireLignes(brut: unknown, chemin: string, profondeur: number, compte: Compte): Lu<LigneMenu[]> {
  if (!Array.isArray(brut)) return refus(chemin, 'une liste attendue');
  if (brut.length > LIGNES_MENU_MAX) return refus(chemin, `${LIGNES_MENU_MAX} lignes au plus`);
  const vus = new Set<string>();
  const sortie: LigneMenu[] = [];
  for (const [i, l] of brut.entries()) {
    const ici = `${chemin}[${i}]`;
    const lu = lireAvec(LIGNE, l, ici);
    if (!lu.ok) return lu;
    const titre = lu.valeur.titre.trim();
    if (titre === '') return refus(`${ici}.titre`, 'vide');
    if (titre.length > TITRE_LIGNE_MAX) return refus(`${ici}.titre`, `${TITRE_LIGNE_MAX} caractères au plus`);
    if (vus.has(titre)) return refus(`${ici}.titre`, `« ${titre} » figure deux fois`);
    vus.add(titre);
    const description = (lu.valeur.description ?? '').trim();
    if (description.length > DESCRIPTION_LIGNE_MAX) return refus(`${ici}.description`, `${DESCRIPTION_LIGNE_MAX} caractères au plus`);
    const suite = lireEtape(lu.valeur.suite, `${ici}.suite`, profondeur + 1, compte);
    if (!suite.ok) return suite;
    sortie.push({ titre, ...(description !== '' ? { description } : {}), suite: suite.valeur });
  }
  return { ok: true, valeur: sortie };
}

/**
 * Une Question : la question, son menu, ses suites. Chaque combinaison que le moteur ne jouerait pas est refusée avec
 * son chemin : un bouton ou un choix à ranger sans menu, `suite` avec menu, une échéance sans sa suite et l'inverse.
 */
function lireQuestion(
  objet: Record<string, unknown>, chemin: string, profondeur: number, compte: Compte,
  lireSiPresente: (cle: string) => Lu<Etape | undefined>,
): Lu<Etape> {
  const q = lireAvec(QUESTION, objet.question, `${chemin}.question`);
  if (!q.ok) return q;
  const { texte, champ, bouton, ranger_choix: ranger, sans_reponse_apres: echeance } = q.valeur;
  if (texte.trim() === '') return refus(`${chemin}.question.texte`, 'vide');
  if (texte.length > TEXTE_QUESTION_MAX) return refus(`${chemin}.question.texte`, `${TEXTE_QUESTION_MAX} caractères au plus`);
  if (echeance && echeance.valeur * UNIT_MS[echeance.unite] > WAIT_MAX_MS) {
    return refus(`${chemin}.question.sans_reponse_apres`, `${ECHEANCE_MAX_JOURS} jours au plus`);
  }
  if (ranger === true && champ === undefined) return refus(`${chemin}.question.ranger_choix`, 'ranger le choix demande « champ »');
  const etape: EtapeQuestion = {
    question: {
      texte, ...(champ ? { champ } : {}), ...(bouton ? { bouton } : {}), ...(ranger === true ? { ranger_choix: true as const } : {}),
      ...(echeance ? { sans_reponse_apres: echeance } : {}),
    },
  };
  if (objet.menu !== undefined) {
    const m = lireLignes(objet.menu, `${chemin}.menu`, profondeur, compte);
    if (!m.ok) return m;
    if (m.valeur.length > 0) etape.menu = m.valeur;
  }
  if (etape.menu) {
    if (objet.suite !== undefined) return refus(`${chemin}.suite`, 'avec un menu, les suites sont ses lignes et « autre_reponse » (la réponse écrite)');
    const autre = lireSiPresente('autre_reponse');
    if (!autre.ok) return autre;
    if (autre.valeur) etape.autre_reponse = autre.valeur;
  } else {
    if (bouton !== undefined) return refus(`${chemin}.question.bouton`, 'sans menu, pas de bouton : il ouvre la liste des lignes');
    if (ranger === true) return refus(`${chemin}.question.ranger_choix`, 'sans menu, il n’y a pas de choix à ranger');
    if (objet.autre_reponse !== undefined) return refus(`${chemin}.autre_reponse`, 'sans menu, la réponse écrite va dans « suite »');
    const suite = lireSiPresente('suite');
    if (!suite.ok) return suite;
    if (suite.valeur) etape.suite = suite.valeur;
  }
  if (echeance && objet.sans_reponse === undefined) {
    return refus(`${chemin}.sans_reponse`, 'une échéance demande sa suite : une relance, ou l’équipe ({ "humain": {} })');
  }
  if (!echeance && objet.sans_reponse !== undefined) {
    return refus(`${chemin}.sans_reponse`, 'sans « question.sans_reponse_apres », la question attend sans échéance : rien ne mène ici');
  }
  const sans = lireSiPresente('sans_reponse');
  if (!sans.ok) return sans;
  if (sans.valeur) etape.sans_reponse = sans.valeur;
  return { ok: true, valeur: etape };
}

/** Une opération, ses listes sans doublon : la forme rendue est celle que la relecture redonnera. */
function operationPropre(o: z.infer<typeof OPERATION>): Operation {
  if ('retirer_etiquettes' in o) return { retirer_etiquettes: [...new Set(o.retirer_etiquettes)] };
  if ('vider_champs' in o) return { vider_champs: [...new Set(o.vider_champs)] };
  return o;
}

function lireEtape(brut: unknown, chemin: string, profondeur: number, compte: Compte): Lu<Etape> {
  if (profondeur > PROFONDEUR_MAX_RECETTE) return refus(chemin, `profondeur de ${PROFONDEUR_MAX_RECETTE} étapes au plus`);
  if ((compte.etapes += 1) > MAX_NODES) return refus(chemin, `${MAX_NODES} étapes au plus`);
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return refus(chemin, 'une étape attendue');
  const objet = brut as Record<string, unknown>;
  const formes = (Object.keys(CLES_ETAPE) as Forme[]).filter((f) => f in objet);
  if (formes.length !== 1) {
    return refus(chemin, 'exactement une forme attendue parmi template, message, agent, humain, question, action');
  }
  const forme = formes[0]!;
  const permises: readonly string[] = CLES_ETAPE[forme];
  const inconnue = Object.keys(objet).find((k) => !permises.includes(k));
  if (inconnue !== undefined) return refus(chemin, `clé inconnue : ${inconnue}`);
  const lireSiPresente = (cle: string): Lu<Etape | undefined> =>
    objet[cle] === undefined ? { ok: true, valeur: undefined } : lireEtape(objet[cle], `${chemin}.${cle}`, profondeur + 1, compte);

  if (forme === 'agent') {
    const a = lireAvec(AGENT, objet.agent, `${chemin}.agent`);
    return a.ok ? { ok: true, valeur: { agent: a.valeur } } : a;
  }
  if (forme === 'humain') {
    const h = lireAvec(HUMAIN, objet.humain, `${chemin}.humain`);
    return h.ok ? { ok: true, valeur: { humain: {} } } : h;
  }
  if (forme === 'question') return lireQuestion(objet, chemin, profondeur, compte, lireSiPresente);
  if (forme === 'action') {
    if (!Array.isArray(objet.action)) return refus(`${chemin}.action`, 'une liste d’opérations attendue');
    if (objet.action.length === 0) return refus(`${chemin}.action`, 'vide');
    if (objet.action.length > OPERATIONS_MAX) return refus(`${chemin}.action`, `${OPERATIONS_MAX} opérations au plus`);
    const operations: Operation[] = [];
    for (const [i, o] of objet.action.entries()) {
      const lu = lireAvec(OPERATION, o, `${chemin}.action[${i}]`);
      if (!lu.ok) return lu;
      operations.push(operationPropre(lu.valeur));
    }
    const suite = lireSiPresente('suite');
    if (!suite.ok) return suite;
    return { ok: true, valeur: { action: operations, ...(suite.valeur ? { suite: suite.valeur } : {}) } };
  }
  if (forme === 'template') {
    const t = lireAvec(TEMPLATE, objet.template, `${chemin}.template`);
    if (!t.ok) return t;
    const etape: EtapeTemplate = { template: t.valeur };
    if (objet.boutons !== undefined) {
      const b = lireBranches(objet.boutons, `${chemin}.boutons`, MAX_BOUTONS_TEMPLATE, MAX_TEXTE_BOUTON_TEMPLATE, profondeur, compte);
      if (!b.ok) return b;
      if (b.valeur.length > 0) etape.boutons = b.valeur;
    }
    const autre = lireSiPresente('autre_reponse');
    if (!autre.ok) return autre;
    if (autre.valeur) etape.autre_reponse = autre.valeur;
    const echec = lireSiPresente('si_echec');
    if (!echec.ok) return echec;
    if (echec.valeur) etape.si_echec = echec.valeur;
    return { ok: true, valeur: etape };
  }

  const m = lireAvec(MESSAGE, objet.message, `${chemin}.message`);
  if (!m.ok) return m;
  const etape: EtapeMessage = { message: { texte: m.valeur.texte, ...(m.valeur.fichier ? { fichier: m.valeur.fichier } : {}) } };
  if (objet.reponses !== undefined) {
    const r = lireBranches(objet.reponses, `${chemin}.reponses`, MAX_REPONSES_RAPIDES, MAX_TEXTE_REPONSE_RAPIDE, profondeur, compte);
    if (!r.ok) return r;
    if (r.valeur.length > 0) etape.reponses = r.valeur;
  }
  if (m.valeur.texte.trim() === '') return refus(`${chemin}.message.texte`, 'vide');
  // Meta borne le corps d'un interactif et la légende d'un fichier à 1 024 ; un texte simple à 4 096.
  const plafond = etape.reponses || etape.message.fichier ? TEXTE_MAX_AVEC_FICHIER_OU_BOUTON : TEXTE_MAX_SIMPLE;
  if (m.valeur.texte.length > plafond) return refus(`${chemin}.message.texte`, `${plafond} caractères au plus`);
  // Un message sans réponse rapide n'attend pas le contact (`walk`, moteur) : sa seule suite est l'étape d'après.
  if (etape.reponses) {
    if (objet.suite !== undefined) return refus(`${chemin}.suite`, 'un message à réponses rapides attend le contact : ses suites sont ses réponses et « autre_reponse »');
    const autre = lireSiPresente('autre_reponse');
    if (!autre.ok) return autre;
    if (autre.valeur) etape.autre_reponse = autre.valeur;
  } else {
    if (objet.autre_reponse !== undefined) return refus(`${chemin}.autre_reponse`, 'un message sans réponse rapide n’attend pas le contact : son étape d’après va dans « suite »');
    const suite = lireSiPresente('suite');
    if (!suite.ok) return suite;
    if (suite.valeur) etape.suite = suite.valeur;
  }
  return { ok: true, valeur: etape };
}

/** Lit une recette reçue de l'extérieur. Ne lève jamais. */
export function lireRecette(brut: unknown): Lu<Recette> {
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return refus('corps', 'un objet { nom, entree } attendu');
  const objet = brut as Record<string, unknown>;
  const inconnue = Object.keys(objet).find((k) => k !== 'nom' && k !== 'entree');
  if (inconnue !== undefined) return refus('corps', `clé inconnue : ${inconnue}`);
  const nom = typeof objet.nom === 'string' ? objet.nom.trim() : '';
  if (nom === '') return refus('nom', 'vide');
  if (nom.length > NOM_SCENARIO_MAX) return refus('nom', `${NOM_SCENARIO_MAX} caractères au plus`);
  const entree = lireEtape(objet.entree, 'entree', 1, { etapes: 0 });
  if (!entree.ok) return entree;
  if (referencesDe(entree.valeur).fichiers.length > MAX_FICHIERS_RECETTE) {
    return refus('entree', `${MAX_FICHIERS_RECETTE} fichiers distincts au plus par scénario`);
  }
  return { ok: true, valeur: { nom, entree: entree.valeur } };
}

/**
 * LA RECETTE TELLE QUE LE CONTRAT OPENAPI LA DÉCRIT (`src/api/openapi/registre.ts`). Le contrat ne porte pas de schéma
 * récursif (chaque référence doit se résoudre dans le document) : l'étape d'entrée est décrite en entier, une étape
 * imbriquée est un objet de la même forme. Les bornes sont les constantes de `lireRecette`, qui reste le seul juge.
 */
const suiteDoc = z.record(z.string(), z.unknown()).describe('Another step, of the same shape as entree: exactly one of template, message, agent, humain, question, action.');
const brancheDoc = z.strictObject({ texte: z.string().min(1), suite: suiteDoc });
const etapeDoc = z.union([
  z.strictObject({
    template: z.strictObject({
      nom: z.string().min(1).max(512).describe('An APPROVED template of the workspace.'),
      langue: z.string().describe('Its language code, e.g. fr or en_US.'),
      variables: z.record(z.string(), z.union([
        z.strictObject({ champ: z.string().min(1).max(LONGUEUR_CHAMP_MAX) }),
        z.strictObject({ texte: z.string().min(1).max(LONGUEUR_TEXTE_VARIABLE_MAX).describe('No line break, no tab, at most four spaces in a row (Meta refuses them at every send).') }),
        z.strictObject({ attribut: z.enum(ATTRIBUTS_RECETTE) }),
      ])).optional().describe('Position ({{1}} is "1") to source. Absent: the field associations set in the console.'),
    }),
    boutons: z.array(brancheDoc.extend({ texte: z.string().min(1).max(MAX_TEXTE_BOUTON_TEMPLATE) })).max(MAX_BOUTONS_TEMPLATE).optional()
      .describe('One branch per QUICK_REPLY button of the template, named by its exact text; every quick reply needs one.'),
    autre_reponse: suiteDoc.optional().describe('The contact writes instead of tapping a button. Only for a template with quick replies.'),
    si_echec: suiteDoc.optional().describe('Meta could not deliver the template (failed status): the fallback step, e.g. a free message, an AI agent or { "humain": {} }.'),
  }),
  z.strictObject({
    message: z.strictObject({
      texte: z.string().min(1).max(TEXTE_MAX_SIMPLE).describe(`${TEXTE_MAX_SIMPLE} characters; ${TEXTE_MAX_AVEC_FICHIER_OU_BOUTON} with a file or quick replies.`),
      fichier: z.strictObject({
        url: z.string().max(LONGUEUR_URL_FICHIER_MAX).describe('A public https address, read at each send: JPEG, PNG or GIF image, MP4 video, PDF.'),
      }).optional(),
    }),
    reponses: z.array(brancheDoc.extend({ texte: z.string().min(1).max(MAX_TEXTE_REPONSE_RAPIDE) })).max(MAX_REPONSES_RAPIDES).optional()
      .describe(`Up to ${MAX_REPONSES_RAPIDES} quick replies, distinct, in the order the contact sees them.`),
    autre_reponse: suiteDoc.optional().describe('With quick replies: the contact writes instead of tapping.'),
    suite: suiteDoc.optional().describe('Without quick replies: the step played right after (the message does not wait).'),
  }),
  z.strictObject({ agent: z.strictObject({ agent_id: z.uuid() }).describe('An active AI agent of the workspace; it ends the scenario.') }),
  z.strictObject({ humain: z.strictObject({}).describe('Hands the conversation to the team; it ends the scenario.') }),
  z.strictObject({
    question: z.strictObject({
      texte: z.string().min(1).max(TEXTE_QUESTION_MAX).describe('The question sent to the contact, who answers it.'),
      champ: z.string().min(1).max(LONGUEUR_CHAMP_MAX).optional().describe('A field of the workspace: the written answer is stored in it.'),
      bouton: z.string().min(1).max(BOUTON_MENU_MAX).optional().describe('With a menu only: the label of the button that opens the list.'),
      ranger_choix: z.boolean().optional().describe('With a menu and champ only: true stores the title of the chosen line in the field.'),
      sans_reponse_apres: z.strictObject({ valeur: z.number().int().min(1), unite: z.enum(UNITES_ECHEANCE) }).optional()
        .describe(`No answer after this delay (${ECHEANCE_MAX_JOURS} days at most): sans_reponse is played. Absent: the question waits with no end.`),
    }),
    menu: z.array(z.strictObject({
      titre: z.string().min(1).max(TITRE_LIGNE_MAX), description: z.string().max(DESCRIPTION_LIGNE_MAX).optional(), suite: suiteDoc,
    })).max(LIGNES_MENU_MAX).optional().describe(`A WhatsApp list of up to ${LIGNES_MENU_MAX} lines with distinct titles; every line needs its step.`),
    autre_reponse: suiteDoc.optional().describe('With a menu: the contact writes instead of choosing a line.'),
    suite: suiteDoc.optional().describe('Without a menu: the step played after the answer.'),
    sans_reponse: suiteDoc.optional().describe('Required with sans_reponse_apres, refused without: the step played when the delay runs out (a reminder, the team).'),
  }),
  z.strictObject({
    action: z.array(z.union([
      z.strictObject({ etiquette: z.string().min(1).max(ETIQUETTE_MAX).describe('Adds this tag to the contact.') }),
      z.strictObject({ retirer_etiquettes: z.array(z.string().min(1).max(ETIQUETTE_MAX)).min(1).max(LISTE_OPERATION_MAX) }),
      z.strictObject({
        champ: z.string().min(1).max(LONGUEUR_CHAMP_MAX).describe('A field of the workspace.'),
        valeur: z.string().min(1).max(VALEUR_CHAMP_RECETTE_MAX).describe('Its value, as text, matching the field type.'),
      }),
      z.strictObject({ vider_champs: z.array(z.string().min(1).max(LONGUEUR_CHAMP_MAX)).min(1).max(LISTE_OPERATION_MAX) }),
    ])).min(1).max(OPERATIONS_MAX).describe('Operations played in order, never the contact\'s consent: add a tag, remove tags, give a field a value, clear fields.'),
    suite: suiteDoc.optional().describe('The step played right after.'),
  }),
]);
export const schemaRecetteDoc = z.strictObject({
  nom: z.string().min(1).max(NOM_SCENARIO_MAX).describe('Unique in the workspace, case-insensitive.'),
  entree: etapeDoc,
}).describe(`A scenario recipe, at most ${PROFONDEUR_MAX_RECETTE} steps deep, ${MAX_NODES} steps and ${MAX_FICHIERS_RECETTE} distinct files. Every write publishes at once.`);
export const schemaRemplacementDoc = schemaRecetteDoc.extend({
  empreinte: z.string().optional().describe('The fingerprint read by GET, if not sent in If-Match.'),
});

/** Les sous-étapes d'une étape, dans l'ordre où le contact peut les rencontrer. */
export function sousEtapes(e: Etape): Etape[] {
  if ('template' in e) return [...(e.boutons ?? []).map((b) => b.suite), ...(e.autre_reponse ? [e.autre_reponse] : []), ...(e.si_echec ? [e.si_echec] : [])];
  if ('message' in e) {
    return [...(e.reponses ?? []).map((b) => b.suite), ...(e.autre_reponse ? [e.autre_reponse] : []), ...(e.suite ? [e.suite] : [])];
  }
  if ('question' in e) {
    return [
      ...(e.menu ?? []).map((l) => l.suite), ...(e.autre_reponse ? [e.autre_reponse] : []), ...(e.suite ? [e.suite] : []),
      ...(e.sans_reponse ? [e.sans_reponse] : []),
    ];
  }
  if ('action' in e) return e.suite ? [e.suite] : [];
  return [];
}

/** Ce que la recette nomme et que le serveur doit aller lire avant de la compiler. */
export function referencesDe(entree: Etape): { templates: Array<{ nom: string; langue: string }>; agents: string[]; champs: string[]; fichiers: string[] } {
  const templates = new Map<string, { nom: string; langue: string }>();
  const agents = new Set<string>();
  const champs = new Set<string>();
  const fichiers = new Set<string>();
  const visiter = (e: Etape): void => {
    if ('template' in e) {
      templates.set(`${e.template.nom}|${e.template.langue}`, { nom: e.template.nom, langue: e.template.langue });
      for (const s of Object.values(e.template.variables ?? {})) if ('champ' in s) champs.add(s.champ);
    } else if ('message' in e) {
      if (e.message.fichier) fichiers.add(e.message.fichier.url);
    } else if ('agent' in e) {
      agents.add(e.agent.agent_id);
    } else if ('question' in e) {
      if (e.question.champ) champs.add(e.question.champ);
    } else if ('action' in e) {
      for (const o of e.action) {
        if ('champ' in o) champs.add(o.champ);
        if ('vider_champs' in o) for (const c of o.vider_champs) champs.add(c);
      }
    }
    sousEtapes(e).forEach(visiter);
  };
  visiter(entree);
  return { templates: [...templates.values()], agents: [...agents], champs: [...champs], fichiers: [...fichiers] };
}

function canonique(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonique);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonique((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/**
 * L'empreinte d'une recette : ce qui protège un remplacement contre une modification faite entre-temps. Elle porte sur
 * la RECETTE et pas sur le graphe : la console réenregistre un scénario à la simple ouverture (les positions bougent),
 * et une empreinte du graphe refuserait l'API à tort.
 */
export function empreinteRecette(e: Etape): string {
  return createHash('sha256').update(JSON.stringify(canonique(e))).digest('hex').slice(0, 32);
}
