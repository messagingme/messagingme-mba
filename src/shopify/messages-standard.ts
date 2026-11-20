import {
  adresseDuBoutonPanier, BOUTON_PANIER, BOUTON_QUESTION, DONNEES_PAR_EVENEMENT, EXEMPLES_DONNEES, LIGNE_PANIER_AGENT, PIED_STOP, TEXTES_PROPOSES,
  evenementDe, type AutomationShopify, type DonneeShopify, type EvenementShopify,
} from '../../web/lib/partage/shopify-messages';

/**
 * LES MESSAGES STANDARD D'UNE BOUTIQUE (Julien, 2026-11-20, spec `docs/superpowers/specs/2026-11-20-shopify-messages-standard-design.md`) :
 * le texte proposé de chaque événement (`TEXTES_PROPOSES`), écrit avec des repères nommés (`{{first_name}}`), devient le
 * corps d'un template à variables numérotées, au format de `POST /templates`. Les repères deviennent les sources
 * `variable` du premier bloc, JAMAIS des indices du template (que la validation des indices refuse).
 */

/** Ce que Meta accepte d'un corps : 1 024 caractères, et ce dépôt en relie dix au plus à des données. */
const CORPS_MAX = 1024;
const VARIABLES_MAX = 10;
const REPERE = /\{\{\s*([a-z_]+)\s*\}\}/g;

export type CorpsDeModele =
  | { ok: true; corps: string; variables: DonneeShopify[]; exemples: string[] }
  | { ok: false; message: string };

/**
 * Un texte à repères vers un corps de template : chaque repère devient {{1}}, {{2}}... dans l'ordre d'apparition, et la
 * liste des variables suit le même ordre. Seules les données que l'événement sait remplir sont permises. (Repris de
 * l'assistant retiré au lot 5b, `e4be79bfe^:src/shopify/preparation.ts`.)
 */
export function versCorps(evenement: EvenementShopify, texte: string): CorpsDeModele {
  const permises = DONNEES_PAR_EVENEMENT[evenement];
  const variables: DonneeShopify[] = [];
  let inconnu: string | null = null;
  const corps = texte.trim().replace(REPERE, (tout, cle: string) => {
    const donnee = permises.find((d) => d === cle);
    if (!donnee) {
      inconnu ??= cle;
      return tout;
    }
    variables.push(donnee);
    return `{{${variables.length}}}`;
  });
  if (inconnu !== null) return { ok: false, message: `{{${inconnu}}} n’est pas une donnée de cet événement.` };
  if (variables.length > VARIABLES_MAX) return { ok: false, message: `${VARIABLES_MAX} données au plus dans un message.` };
  // Meta refuse un corps qui commence ou finit par une variable.
  if (/^\{\{\d+\}\}/.test(corps) || /\{\{\d+\}\}$/.test(corps)) return { ok: false, message: 'le message ne peut ni commencer ni finir par une donnée.' };
  if (corps.length > CORPS_MAX) return { ok: false, message: `${CORPS_MAX} caractères au plus.` };
  return { ok: true, corps, variables, exemples: variables.map((v) => EXEMPLES_DONNEES[v]) };
}

/** Le message standard d'un événement : le corps de création (français) et les données de ses variables, par position. */
export interface MessageStandard {
  corps: {
    category: 'UTILITY' | 'MARKETING'; language: 'fr'; body: string; example: string[]; footer?: string;
    buttons?: Array<{ type: 'URL'; text: string; url: string } | { type: 'QUICK_REPLY'; text: string }>;
  };
  variables: DonneeShopify[];
}

/**
 * Commandes en UTILITY ; le panier en MARKETING (une relance après une attente), avec la consigne STOP en pied (spec
 * § 2.4), et son lien derrière le bouton « Reprendre mon panier » (2026-11-20) : `https://<boutique>/{panier_shopify}`,
 * que la création change en lien tracé et que notre redirection mène au panier de celui qui clique. La relance avec agent
 * IA (2026-11-20) : le MÊME message, plus la réponse rapide « Vous avez une question ? » après le lien, que son scénario
 * relie au bloc Agent IA (`avecLAgent`, `./lignes-gestion.ts`). Un texte standard
 * invalide est une faute de ce dépôt, que `tests/shopify-messages-standard.test.ts` attrape : elle lève.
 */
export function corpsStandard(automation: AutomationShopify, domaine: string): MessageStandard {
  const evenement = evenementDe(automation);
  const lu = versCorps(evenement, TEXTES_PROPOSES[evenement].fr);
  if (!lu.ok) throw new Error(`message standard ${automation} invalide : ${lu.message}`);
  const panier = evenement === 'checkout_abandoned';
  const question = automation === LIGNE_PANIER_AGENT ? [{ type: 'QUICK_REPLY' as const, text: BOUTON_QUESTION.fr }] : [];
  return {
    corps: {
      category: panier ? 'MARKETING' : 'UTILITY', language: 'fr', body: lu.corps, example: lu.exemples,
      ...(panier ? { footer: PIED_STOP.fr, buttons: [{ type: 'URL' as const, text: BOUTON_PANIER.fr, url: adresseDuBoutonPanier(domaine) }, ...question] } : {}),
    },
    variables: lu.variables,
  };
}
