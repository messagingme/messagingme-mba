/**
 * « BIEN DÉMARRER » (plan 2026-11-24-guide-demarrage, lot 2) : les cinq étapes de la checklist, dans l'ordre de Julien,
 * cochées d'après l'état réel de l'espace (`GET /demarrage`). Logique pure, tenue par `bien-demarrer.test.ts` ; les écrans
 * sont `AccueilBienvenue.tsx` (la fenêtre) et `CarteBienDemarrer.tsx` (la carte de l'Accueil).
 *
 * ⚠️ À NE PAS CONFONDRE avec `lib/demarrer.ts`, la page finale du tunnel de la Base.
 */
import type { EtatDemarrage } from './api/compte';

export type CleEtape = keyof EtatDemarrage;

/** Un geste d'une étape : son écran. `fonction` : la fonction d'offre qu'il demande (absente = toujours ouverte). */
export interface Geste { cle: string; href: string; fr: string; en: string; fonction?: 'scenarios' }

export interface Etape {
  cle: CleEtape;
  titre: { fr: string; en: string };
  detail: { fr: string; en: string };
  /** L'ordre de grandeur, montré à côté du bouton : une promesse, pas une mesure. */
  minutes: number;
  gestes: readonly Geste[];
}

export const ETAPES: readonly Etape[] = [
  {
    cle: 'numero', minutes: 5,
    titre: { fr: 'Relier votre numéro WhatsApp', en: 'Connect your WhatsApp number' },
    detail: { fr: 'Le numéro qui parlera à vos clients.', en: 'The number that will talk to your customers.' },
    gestes: [{ cle: 'numero', href: '/connecter-whatsapp', fr: 'Relier', en: 'Connect' }],
  },
  {
    cle: 'outil', minutes: 3,
    titre: { fr: 'Brancher votre boutique ou votre CRM', en: 'Connect your store or your CRM' },
    detail: { fr: 'Shopify, HubSpot ou votre propre outil.', en: 'Shopify, HubSpot or your own tool.' },
    gestes: [{ cle: 'outil', href: '/integrations', fr: 'Brancher', en: 'Connect' }],
  },
  {
    cle: 'scenarioOuCampagne', minutes: 5,
    titre: { fr: 'Premier scénario ou première campagne', en: 'First scenario or first campaign' },
    detail: { fr: 'Un message automatique, ou un envoi à vos contacts importés.', en: 'An automatic message, or a send to your imported contacts.' },
    gestes: [
      { cle: 'scenario', href: '/workflows', fr: 'Un scénario', en: 'A scenario', fonction: 'scenarios' },
      { cle: 'campagne', href: '/campaigns/nouvelle', fr: 'Une campagne', en: 'A campaign' },
    ],
  },
  {
    cle: 'agent', minutes: 4,
    titre: { fr: 'Un agent IA qui répond à vos clients', en: 'An AI agent that answers your customers' },
    detail: { fr: 'Vous décrivez votre activité, il s’écrit tout seul.', en: 'You describe your business, it writes itself.' },
    gestes: [{ cle: 'agent', href: '/agents', fr: 'Construire', en: 'Build' }],
  },
  {
    cle: 'bulle', minutes: 2,
    titre: { fr: 'La bulle WhatsApp sur votre site', en: 'The WhatsApp bubble on your website' },
    detail: { fr: 'Vos visiteurs vous écrivent en un clic.', en: 'Your visitors message you in one click.' },
    gestes: [{ cle: 'bulle', href: '/widgets', fr: 'Poser', en: 'Add' }],
  },
];

export interface EtapeVue extends Etape { faite: boolean; gestes: Geste[] }
export interface Progression { etapes: EtapeVue[]; faites: number; total: number; prochaine: CleEtape | null; complete: boolean }

/**
 * La checklist telle qu'elle s'affiche. `etat` à `null` (route absente d'une API plus ancienne, panne) : rien n'est coché,
 * jamais une erreur. `fonctionOuverte` retire un geste que l'offre ferme ; une étape garde toujours au moins un geste.
 */
export function progression(etat: EtatDemarrage | null, fonctionOuverte: (f: 'scenarios') => boolean): Progression {
  const etapes = ETAPES.map((e) => {
    const gestes = e.gestes.filter((g) => !g.fonction || fonctionOuverte(g.fonction));
    return { ...e, faite: etat?.[e.cle] === true, gestes: gestes.length > 0 ? gestes : [...e.gestes] };
  });
  const faites = etapes.filter((e) => e.faite).length;
  const prochaine = etapes.find((e) => !e.faite)?.cle ?? null;
  return { etapes, faites, total: etapes.length, prochaine, complete: faites === etapes.length };
}
