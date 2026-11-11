/**
 * Les champs d'un contact que le serveur et la console doivent nommer pareil : les types d'un champ perso, les
 * champs de base (« système ») et les champs socle.
 */

/**
 * La clé du champ booléen de consentement par défaut (WhatsApp opt-in), créé à la volée quand un écran OptIn de
 * formulaire n'a pas de cible explicite. Clé stable, jamais dérivée d'un libellé mutable ; un OptIn qui pointe dessus
 * est un mapping PAR DÉFAUT (cible vide dans l'éditeur), pas un choix explicite.
 */
export const WHATSAPP_OPTIN_FIELD_KEY = 'whatsapp_optin';

/** Les types d'un champ perso : la console les propose, le serveur les accepte (la base les contraint aussi, ce que
 *  `tests/integration/user-fields-types.integration.test.ts` vérifie). */
export const USER_FIELD_KINDS = ['text', 'number', 'date', 'datetime', 'boolean', 'url', 'json'] as const;
export type UserFieldKind = (typeof USER_FIELD_KINDS)[number];

/**
 * Le type `json` (spec du 2026-11-11) : la réponse ENTIÈRE d'un bloc « Appel API », relue ensuite par un bloc
 * d'extraction. Il ne se remplit que par un scénario (Appel API, Fonction JS), l'API publique et le MCP : ni la saisie
 * de la fiche, ni l'import CSV, ni un webhook entrant ou un formulaire. Son type ne change plus après la création, dans
 * aucun sens.
 */
export const TYPE_JSON = 'json' satisfies UserFieldKind;

/** Plafond d'une valeur `json`, en octets UTF-8 de sa forme compacte. Au-delà : refusée, jamais tronquée. */
export const MAX_OCTETS_CHAMP_JSON = 16 * 1024;

/**
 * Les types qu'une SAISIE peut viser (fiche, import CSV, webhook entrant, création à la main) : tous sauf `json`.
 * La console les propose là où une personne tape une valeur.
 */
export const USER_FIELD_KINDS_SAISIS = USER_FIELD_KINDS.filter((k) => k !== TYPE_JSON);

/** La forme compacte d'un JSON valide sous le plafond, ou `null` (texte qui n'est pas du JSON, ou trop gros). */
export function jsonDeChamp(valeur: string): string | null {
  let lu: unknown;
  try {
    lu = JSON.parse(valeur);
  } catch {
    return null;
  }
  const compact = JSON.stringify(lu);
  return new TextEncoder().encode(compact).length <= MAX_OCTETS_CHAMP_JSON ? compact : null;
}

/**
 * Les champs de BASE, dans l'ordre d'affichage : attributs du contact (`name`, `phone`, `bsuid`, `wa_id`, lus hors de
 * `contacts.fields`) et champs socle (`prenom`, `email`). Non supprimables, non renommables. Leur code public se
 * calcule (`fld_<code>_sys_<clé>`) et le serveur le résout sans toucher la base.
 */
export const SYSTEM_FIELD_KEYS = ['name', 'prenom', 'nom_de_famille', 'phone', 'bsuid', 'wa_id', 'email'] as const;
export type SystemFieldKey = (typeof SYSTEM_FIELD_KEYS)[number];

/**
 * Le libellé de chaque champ de base, `[fr, en]`. La console l'affiche ; le serveur refuse qu'un champ perso porte
 * l'un d'eux, dans l'une ou l'autre langue, sinon il fabriquerait un doublon indiscernable.
 */
export const SYSTEM_FIELD_LABELS: Readonly<Record<SystemFieldKey, readonly [string, string]>> = {
  // Le nom du PROFIL WhatsApp (`contacts.profile_name`), que chaque message entrant réécrit : « Nom WhatsApp » depuis
  // qu'un vrai « Nom » existe (2026-10-21), sinon deux champs de base portaient le même libellé.
  name: ['Nom WhatsApp', 'WhatsApp name'],
  prenom: ['Prénom', 'First name'],
  // Le nom de famille, rangé sur la fiche (`contacts.fields`) et jamais écrasé. Clé `nom_de_famille` et non `nom` :
  // `nom` désigne déjà le nom du profil dans les connecteurs, les paramètres d'outils et les adresses de boutons.
  nom_de_famille: ['Nom', 'Last name'],
  phone: ['Téléphone', 'Phone'],
  bsuid: ['BSUID', 'BSUID'],
  wa_id: ['WhatsApp ID', 'WhatsApp ID'],
  email: ['Email', 'Email'],
};

/**
 * Les champs SOCLE : des champs de base rangés dans `contacts.fields`, que le serveur MATÉRIALISE à la première
 * écriture (avec ce libellé et ce type). Ils n'existent donc pas dans `user_fields` tant que personne ne les a
 * remplis : la fiche contact leur donne une ligne dédiée, toujours affichée, même vide.
 */
export const SOCLE_FIELDS: ReadonlyArray<{ key: SystemFieldKey; label: string; type: UserFieldKind }> = [
  { key: 'prenom', label: 'Prénom', type: 'text' },
  { key: 'nom_de_famille', label: 'Nom', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
];
