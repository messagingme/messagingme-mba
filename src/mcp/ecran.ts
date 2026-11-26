import { config } from '../config';

/**
 * L'ÉCRAN DE CE QU'UN OUTIL VIENT DE FAIRE (lot 1 du CSM virtuel, B0b, plan
 * `docs/superpowers/plans/2026-11-24-csm-lot1-b0-contrats.md`).
 *
 * Un agent qui configure un espace emmène le client sur ce qu'il vient de créer : la fiche de l'agent, le scénario, la
 * conversation. Chaque outil d'écriture déclare son écran (`OutilMcp.ecran`), et le serveur l'ajoute au résultat. Le
 * client doit pouvoir y retoucher seul la fois suivante : c'est l'objet du cadrage, son autonomie et pas sa dépendance.
 *
 * 🔴 UN CHEMIN DE LA CONSOLE, JAMAIS UNE ADRESSE : la base est `APP_URL`, celle des liens d'e-mail (des pages du front),
 * posée au rendu par `adresseEcran`. Un écran qui n'a pas d'accès direct à l'objet donne sa liste, jamais une page qui
 * n'existe pas : `tests/mcp-ecran.test.ts` relie chaque liste à un dossier de `web/app`.
 */

/** Un identifiant lisible, encodé pour l'adresse, ou `null`. */
const ident = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? encodeURIComponent(v.trim()) : null);

/** Les listes de la console, quand l'objet n'a pas d'écran à lui (ou que l'outil ne le connaît pas). */
export const LISTES = {
  /** L'Accueil, où vit la carte « Qui répond au client » (`set_default_responder`). */
  accueil: '/accueil',
  agents: '/agents',
  campagnes: '/campaigns',
  champs: '/fields',
  cles: '/developers/keys',
  contacts: '/contacts',
  /** Contenu > Étiquettes (lot 1 du CSM virtuel, B10). */
  etiquettes: '/tags',
  inbox: '/inbox',
  integrations: '/integrations',
  messagesShopify: '/automations/shopify',
  modeles: '/templates',
  numero: '/connecter-whatsapp',
  offre: '/offre',
  parametres: '/parametres',
  scenarios: '/workflows',
  /** Sécurité > IA (l'annonce d'IA) ; la promesse de transfert se règle par agent depuis 0330 (outil « Passer la main »). */
  securiteIa: '/securite/ia',
  /** Sécurité > Consentement, où vit l'appel prévenu à chaque désabonnement (`set_optout_push`). */
  consentement: '/securite/consentement',
  webhooks: '/developers/evenements',
  widgets: '/widgets',
} as const;

/**
 * Les écrans qui ouvrent un objet précis, d'après les paramètres que lisent leurs pages. ⚠️ La fiche d'un contact n'en a
 * pas : la page des contacts ne lit aucun paramètre (un lien `/contacts?c=` ouvre la liste), donc un outil sur un contact
 * renvoie à la liste.
 */
export const ECRANS = {
  agent: (agentId: unknown, onglet?: 'connaissance' | 'outils'): string => {
    const a = ident(agentId);
    return a === null ? LISTES.agents : `/agents?id=${a}${onglet === undefined ? '' : `&tab=${onglet}`}`;
  },
  conversation: (conversationId: unknown): string => {
    const c = ident(conversationId);
    return c === null ? LISTES.inbox : `/inbox?c=${c}`;
  },
  scenario: (scenarioId: unknown): string => {
    const s = ident(scenarioId);
    return s === null ? LISTES.scenarios : `/workflows?open=${s}`;
  },
  /** La page du oui de mise en ligne (CSM, B2) : le récapitulatif et le bouton qu'un admin clique. */
  miseEnLigne: (id: unknown): string => {
    const m = ident(id);
    return m === null ? LISTES.scenarios : `/mise-en-ligne?id=${m}`;
  },
} as const;

/** Lit un champ d'un résultat d'outil (l'objet rendu à l'agent), sans rien supposer de sa forme. */
export function lire(resultat: unknown, ...chemin: readonly string[]): unknown {
  let v: unknown = resultat;
  for (const cle of chemin) {
    if (typeof v !== 'object' || v === null || !Object.hasOwn(v, cle)) return undefined;
    v = (v as Record<string, unknown>)[cle];
  }
  return v;
}

/** L'adresse complète d'un écran de la console. */
export const adresseEcran = (chemin: string): string => `${config.APP_URL.replace(/\/+$/, '')}${chemin}`;
