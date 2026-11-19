/**
 * L'ACCUEIL D'UN NOUVEAU MEMBRE DANS LA CONSOLE (plan 2026-11-19-accueil-pro) : ce que la fenêtre de bienvenue propose,
 * et les étapes de la visite. Logique pure, tenue par `accueil-console.test.ts` ; les écrans sont
 * `components/AccueilBienvenue.tsx` et `components/VisiteConsole.tsx`.
 */

/** L'événement qui lance la visite, depuis la fenêtre ou depuis le panneau d'aide. La coquille l'écoute. */
export const VISITE_EVENT = 'mba:visite';

export type CleRaccourci = 'numero' | 'campagne' | 'agent' | 'outil';
export interface Raccourci { cle: CleRaccourci; href: string; fr: string; en: string }

const TOUS: readonly Raccourci[] = [
  { cle: 'numero', href: '/connecter-whatsapp', fr: 'Connecter mon numéro', en: 'Connect my number' },
  { cle: 'campagne', href: '/campaigns/nouvelle', fr: 'Lancer une campagne', en: 'Launch a campaign' },
  { cle: 'agent', href: '/agents', fr: 'Construire un agent IA', en: 'Build an AI agent' },
  { cle: 'outil', href: '/integrations', fr: 'Brancher un outil', en: 'Connect a tool' },
];

/**
 * Les raccourcis à montrer. Les quatre mènent à des écrans d'administrateur (`accesAutorise`, `lib/nav.ts`) : un membre
 * qui ne l'est pas (agent, manager, en Business et au-delà) n'en voit AUCUN, sinon la coquille le renverrait à l'Inbox
 * après avoir marqué son choix (relecture du lot). Il garde « Faire le tour » et « Ne plus afficher ». Le numéro
 * disparaît dès qu'il y en a un ; tant que ce n'est pas su (`aNumero` à `null`), il n'est pas proposé.
 */
export function raccourcisAccueil(admin: boolean, aNumero: boolean | null): Raccourci[] {
  if (!admin) return [];
  return TOUS.filter((r) => r.cle !== 'numero' || aNumero === false);
}

/**
 * Une étape de la visite : l'élément de la console qu'elle montre, et sa phrase. `cible` est un sélecteur CSS sur un
 * attribut que la coquille pose (`data-nav` sur les entrées du menu, `data-testid` sur l'onglet Inbox et l'aide).
 */
export interface EtapeVisite { cible: string; fr: string; en: string }

export const ETAPES_VISITE: readonly EtapeVisite[] = [
  {
    cible: '[data-nav="accueil"]',
    fr: 'L’Accueil : votre numéro WhatsApp, qui répond à vos clients, et vos chiffres du mois.',
    en: 'Home: your WhatsApp number, who answers your customers, and your figures for the month.',
  },
  {
    cible: '[data-testid="onglet-inbox"]',
    fr: 'L’Inbox : vos conversations avec vos clients, pour leur répondre vous-même.',
    en: 'Inbox: your conversations with your customers, to answer them yourself.',
  },
  {
    cible: '[data-nav="contacts"]',
    fr: 'Le mini-CRM : vos contacts, leurs étiquettes et leurs champs.',
    en: 'mini-CRM: your contacts, their tags and their fields.',
  },
  {
    cible: '[data-nav="campagnes"]',
    fr: 'Les campagnes : un message à toute une liste de contacts, avec un modèle approuvé par Meta.',
    en: 'Campaigns: one message to a whole list of contacts, with a template approved by Meta.',
  },
  {
    cible: '[data-nav="ia"]',
    fr: 'AI Agent : l’agent de Meta, et les agents IA que vous construisez pour répondre à vos clients.',
    en: 'AI Agent: Meta’s agent, and the AI agents you build to answer your customers.',
  },
  {
    cible: '[data-nav="tools"]',
    fr: 'Tools : brancher vos outils (Shopify, HubSpot, vos API) et poser la bulle WhatsApp sur votre site.',
    en: 'Tools: connect your tools (Shopify, HubSpot, your APIs) and put the WhatsApp bubble on your site.',
  },
  {
    cible: '[data-testid="aide-bouton"]',
    fr: 'L’aide : posez une question à tout moment. Elle permet aussi de refaire cette visite.',
    en: 'Help: ask a question at any time. It also lets you take this tour again.',
  },
];

/**
 * Les étapes dont l'élément est réellement à l'écran : une entrée repliée dans le tiroir du téléphone, ou absente parce
 * que l'offre ou le rôle la retire, est SAUTÉE, jamais pointée dans le vide. `visible` dit si un sélecteur désigne un
 * élément affiché.
 */
export function etapesVisibles(etapes: readonly EtapeVisite[], visible: (cible: string) => boolean): EtapeVisite[] {
  return etapes.filter((e) => visible(e.cible));
}
