/**
 * Règles PURES du mapping « champ de formulaire -> champ contact ». N'importe QUE des modules eux-mêmes purs
 * (aucun React, aucun Next, rien du DOM) : ce module est testé depuis la suite racine
 * (`tests/web-flow-mapping.test.ts`) par import relatif, ce qui n'est possible que si toute sa chaîne
 * d'imports reste hors de l'arbre web (le tsconfig racine n'a pas la lib DOM).
 */
import { normalizeText } from './normalize';
import { WHATSAPP_OPTIN_FIELD_KEY } from './partage/champs';

/**
 * Cible PAR DÉFAUT d'un champ de formulaire : le serveur l'applique tout seul quand `saveTo` est absent.
 *  - consentement (optin) -> le champ booléen de consentement (`whatsapp_optin`), qui ouvre le statut opt-in ;
 *  - tout autre type -> la clé dérivée du champ lui-même.
 */
export function defaultSaveTo(type: string, fieldKey: string): string {
  return type === 'optin' ? WHATSAPP_OPTIN_FIELD_KEY : fieldKey;
}

/**
 * Cette cible stockée est-elle le mapping PAR DÉFAUT (par opposition à un choix EXPLICITE de l'utilisateur) ?
 *
 * Sert au round-trip d'édition (`toBElems`) : un mapping par défaut doit revenir dans l'éditeur avec un `saveTo`
 * VIDE. Sinon l'éditeur ré-sérialiserait une cible explicite que l'utilisateur n'a jamais choisie, et pour un
 * optin le serveur la revaliderait comme cible booléenne, ce qui peut BLOQUER la ré-édition du formulaire.
 * Une cible absente (champ jamais mappé) compte aussi comme défaut.
 */
export function isDefaultSaveTo(type: string, target: string | undefined, fieldKey: string): boolean {
  if (!target) return true;
  return target === defaultSaveTo(type, fieldKey);
}

/**
 * Cible « Nom WhatsApp » (profile_name), l'ancienne cible « Nom » (voir `BASE_SAVE_FIELDS`), qui n'est plus proposée
 * mais reste routée pour les formulaires qui la portent. SENTINELLE `@profile_name` : le `@` ne peut JAMAIS être produit
 * par `slugify` (qui n'émet que `[a-z0-9]` séparés par `_`), donc la cible « Nom » est IMPOSSIBLE à obtenir par
 * collision de slug d'un libellé quelconque. Le routage report vers profile_name (src/webhooks/flow-mapping.ts,
 * PROFILE_NAME_TARGET) ne se déclenche donc QUE sur le choix EXPLICITE du champ de base, jamais par défaut.
 * ⚠️ Doit rester STRICTEMENT égale à PROFILE_NAME_TARGET côté serveur (test anti-drift).
 */
export const PROFILE_NAME_SAVE_KEY = '@profile_name';

/**
 * Un champ de BASE ciblable comme destination d'un champ de formulaire : les trois champs socle, rangés dans
 * `contacts.fields` (`SOCLE_FIELDS`).
 *
 * 🔴 « Nom » est le NOM DE FAMILLE (`nom_de_famille`) depuis le 2026-11-10 (choix de Julien). Il visait le nom du
 * PROFIL WhatsApp (`PROFILE_NAME_SAVE_KEY`), que chaque message reçu réécrit : la valeur saisie disparaissait au message
 * suivant, et le vrai champ « Nom », créé le 2026-10-21, n'était pas proposé. Un formulaire déjà réglé sur le profil
 * le garde (le serveur route toujours la sentinelle) : l'éditeur l'affiche alors sous `NOM_WHATSAPP`.
 */
export interface BaseSaveField { key: string; label: string }
export const BASE_SAVE_FIELDS: BaseSaveField[] = [
  { key: 'prenom', label: 'Prénom' },
  { key: 'nom_de_famille', label: 'Nom' },
  { key: 'email', label: 'Email' },
];

/** L'ancienne cible « Nom », le profil WhatsApp : plus proposée, seulement affichée sur un formulaire qui l'a gardée. */
export const NOM_WHATSAPP: BaseSaveField = { key: PROFILE_NAME_SAVE_KEY, label: 'Nom WhatsApp' };

const normalizeLabel = normalizeText;

// Synonymes (normalisés) -> champ de base. Correspondance EXACTE sur le libellé normalisé : « prenom » et
// « nom » ne se marchent donc jamais dessus (pas de piège de sous-chaîne « nom » ⊂ « prenom »).
const SYNONYMS: Record<string, string[]> = {
  email: ['email', 'e-mail', 'mail', 'courriel', 'adresse email', 'adresse e-mail', 'adresse mail'],
  prenom: ['prenom', 'first name', 'firstname', 'given name'],
  // « name » seul n'y est pas : en anglais, il désigne le plus souvent le nom COMPLET, pas le nom de famille.
  nom_de_famille: ['nom', 'nom de famille', 'last name', 'lastname', 'surname', 'family name'],
};

/**
 * Suggère le champ de BASE correspondant au libellé d'un champ de formulaire (ex. « Email » -> email, « Nom » ->
 * nom_de_famille, « Prénom » -> prenom), insensible à la casse et aux accents. null si le libellé ne correspond à aucun
 * champ de base. Sert à proposer « enregistrer sur le champ de base » dans le builder (jamais imposé).
 */
export function suggestBaseField(label: string): BaseSaveField | null {
  const n = normalizeLabel(label);
  if (n === '') return null;
  for (const f of BASE_SAVE_FIELDS) {
    if (SYNONYMS[f.key]!.includes(n)) return f;
  }
  return null;
}
