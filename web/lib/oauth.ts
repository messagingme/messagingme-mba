import type { ChampPub } from './pub';
import { ApiError, langue, request } from './http';
import { lireNomEspace } from './api/compte';
import type { Session } from './session';

/**
 * CONNECTER CLAUDE À UN ESPACE, VU DE LA CONSOLE (lot 2b du plan `docs/superpowers/plans/2026-10-03-oauth-mcp.md`).
 *
 * Deux écrans s'en servent : la page de consentement `/autoriser`, où l'on arrive depuis Claude, et la section
 * « Applications autorisées » de la page des clés d'API, où un admin révoque. Les routes et leurs codes sont celles
 * de l'API (`src/http/oauth.ts`, `src/http/oauth-consentement.ts`).
 *
 * 🔴 LES APPELS DU CONSENTEMENT PASSENT EN MODE `etape` (`request`, `lib/http.ts`) : un 401 y dit « jeton Google
 * refusé » ou « preuve expirée », jamais « session de la console tombée ». En mode `session`, une personne connectée
 * à la console qui se trompe de compte Google en perdrait sa session, sur une page qui ne la lui a pas demandée.
 */

/**
 * Comment le nom d'un client est établi (lot 15) : recopié par nous (Claude, Claude Code), prouvé par le domaine de sa
 * fiche d'identité (ChatGPT), ou déclaré par l'application qui s'est enregistrée (Cursor, VS Code).
 */
export type MarqueClient = 'epingle' | 'domaine' | 'declaree';

/** Ce que la page affiche AVANT tout bouton : le client, l'hôte de retour, les droits demandés. */
export interface DemandeAffichee {
  /** Le nom du client (« Claude Code », « Claude », « ChatGPT »), donné par le serveur. */
  client: string;
  /** Absente d'une API d'avant le lot 15 : la page la traite comme `epingle`. */
  marque?: MarqueClient;
  /** Le domaine qui publie la fiche d'un client `domaine` ; `null` sinon. */
  domaine?: string | null;
  /** L'hôte où partira le code : `localhost`, `127.0.0.1` ou `claude.ai`. */
  hoteDeRetour: string;
  /** `mcp:read`, `mcp:write`, ou les deux. */
  droits: string[];
}

/** Un espace de la personne connectée par Google. `admin` dit si elle peut y autoriser Claude ; le serveur le relit au clic. */
export interface EspaceOauth { tenantId: string; nom: string; admin: boolean }

/** Ce que rend « Continuer avec Google » : une preuve signée, liée à CETTE demande, et les espaces de la personne. */
export interface ChoixOauth {
  choix: string;
  /** L'adresse était inconnue : son espace vient d'être créé, et elle en est l'admin. */
  nouveau: boolean;
  espaces: EspaceOauth[];
}

/**
 * Le code que l'API rend sur une demande expirée ou illisible (`DEMANDE_EXPIREE`, `src/oauth/autoriser.ts`), en 400
 * et jamais en 401 sur les quatre routes. Parité tenue par `tests/web-oauth-parite.test.ts`.
 */
export const CODE_DEMANDE_EXPIREE = 'demande_expiree';

/** La demande que la page présente a expiré (dix minutes) ou ne se relit plus : seule une nouvelle connexion depuis Claude en donne une autre. */
export function estDemandeExpiree(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && (err.corps as { code?: unknown } | undefined)?.code === CODE_DEMANDE_EXPIREE;
}

const poster = <T>(chemin: string, corps: Record<string, string | ChampPub>): Promise<T> =>
  request<T>(chemin, { method: 'POST', body: JSON.stringify(corps) }, 'etape');

export function lireDemande(demande: string): Promise<DemandeAffichee> {
  return poster('/oauth/consentement/demande', { demande });
}

/**
 * Adresse inconnue : le serveur crée son espace et son admin au passage (`nouveau`), dans la langue de la page, lue au
 * clic (`langue()`) : le nom de l'espace et ses e-mails (aide à la connexion, lot 2b).
 */
export function continuerAvecGoogle(demande: string, idToken: string, pub?: ChampPub): Promise<ChoixOauth> {
  return poster('/oauth/consentement/google', { demande, idToken, langue: langue(), ...(pub ? { pub } : {}) });
}

/** Le clic « Autoriser dans <espace> » après Google : rend l'adresse de retour du client, code compris. */
export function autoriserParGoogle(demande: string, choix: string, tenantId: string): Promise<{ adresse: string }> {
  return poster('/oauth/consentement/autoriser', { demande, choix, tenantId });
}

/** Le même clic avec la session de la console : l'espace est celui de la session. */
export function autoriserParSession(tenantId: string, demande: string): Promise<{ adresse: string }> {
  return poster(`/tenants/${tenantId}/oauth/autoriser`, { demande });
}

/**
 * Le bouton direct « Autoriser dans <espace> » n'est offert qu'à une session de la console dont le rôle est admin
 * (spec, section 3). Une session d'OBSERVATION (`/ops`) n'en a jamais : elle est en lecture seule, le serveur
 * refuserait le clic, et un exploitant n'a pas à ouvrir l'espace d'un client à Claude.
 */
export function peutAutoriserDirectement(session: Session | null): session is Session {
  return session !== null && session.role === 'admin' && session.observation === undefined;
}

/** Ce que la page sait à l'ouverture, avant tout clic. */
export type Ouverture =
  | { etat: 'absente' }
  | { etat: 'expiree' }
  | { etat: 'erreur'; message: string }
  | { etat: 'prete'; demande: DemandeAffichee; espaceDirect: { tenantId: string; nom: string } | null };

/**
 * L'OUVERTURE DE LA PAGE, ET RIEN D'AUTRE : lire la demande, puis le nom de l'espace de la session si elle peut
 * autoriser directement. 🔴 AUCUNE AUTORISATION ICI : le code ne s'émet qu'au clic, sur un écran qui a montré le
 * client, l'hôte de retour et les droits (spec, section 3 : le consentement n'est jamais sauté).
 *
 * Le nom se lit par la route de l'admin (`GET /tenants/:id/nom`), ce qui vérifie au passage que la session vit encore
 * et que son rôle est toujours admin : un refus, quel qu'il soit, retire seulement le bouton direct, et le mode
 * `etape` laisse la session de la console en place.
 */
export async function ouvrirConsentement(demande: string | null, session: Session | null): Promise<Ouverture> {
  if (demande === null || demande === '') return { etat: 'absente' };
  let lue: DemandeAffichee;
  try {
    lue = await lireDemande(demande);
  } catch (err) {
    if (estDemandeExpiree(err)) return { etat: 'expiree' };
    return { etat: 'erreur', message: err instanceof Error ? err.message : String(err) };
  }
  if (!peutAutoriserDirectement(session)) return { etat: 'prete', demande: lue, espaceDirect: null };
  const nom = await lireNomEspace(session.tenantId, 'etape').then((r) => r.nom, () => null);
  return { etat: 'prete', demande: lue, espaceDirect: nom === null ? null : { tenantId: session.tenantId, nom } };
}

/**
 * Ce que l'écran annonce, droit par droit. Un droit absent n'est pas annoncé : une demande en lecture seule ne dit
 * pas que Claude pourra répondre.
 */
export function capacitesAnnoncees(droits: readonly string[]): { lire: boolean; faire: boolean } {
  return { lire: droits.includes('mcp:read'), faire: droits.includes('mcp:write') };
}

/**
 * 🔴 LA PAGE NE PART QUE VERS L'HÔTE QU'ELLE A MONTRÉ, en `http` ou `https`. L'adresse vient de notre API, qui l'a
 * construite sur une adresse de retour vérifiée ; la relire ici garde vraie la promesse de l'écran (« retour vers
 * localhost ») et ferme la porte à une adresse `javascript:`, que `location.assign` exécuterait.
 */
export function adresseDeRetourSure(adresse: string, hoteAffiche: string): boolean {
  try {
    const u = new URL(adresse);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname === hoteAffiche;
  } catch {
    return false;
  }
}

/**
 * 🔴 SANS COMPTE GOOGLE, LE DÉTOUR RAMÈNE AU CONSENTEMENT (2026-10-27). La page d'autorisation envoie à l'inscription ou
 * à la connexion par mot de passe avec sa demande, et ces pages y reviennent une fois la session ouverte, au lieu de
 * l'accueil ou du tunnel de la Free. Seule la demande voyage, jamais une adresse : la destination est l'une de ces
 * trois pages, donc aucune redirection ouverte, et le consentement relit la demande auprès de l'API comme à son arrivée.
 */
export function avecDemande(page: '/autoriser' | '/signup' | '/login', demande: string | null): string {
  return demande === null ? page : `${page}?demande=${encodeURIComponent(demande)}`;
}

/** La demande que porte l'adresse de la page (`?demande=`), ou `null`. */
export function demandeDeLAdresse(recherche: string): string | null {
  const d = new URLSearchParams(recherche).get('demande');
  return d === null || d === '' ? null : d;
}

// --- « Applications autorisées » (page des clés d'API, admin) --------------------------------------------------

/**
 * Une autorisation de l'espace, telle que la liste la rend : ni jeton, ni empreinte, ni échéance. Vivante, ou finie mais
 * avec une création encore vivante (`connectee` faux, lot D de l'audit).
 */
export interface AutorisationOauth {
  id: string;
  clientId: string;
  /** Le nom du client, donné par le serveur. */
  client: string;
  /** Lot 15 : comment ce nom est établi, et l'hôte où le client reçoit son code. Absents d'une API plus ancienne. */
  marque?: MarqueClient;
  clientHote?: string | null;
  userId: string;
  email: string;
  nom: string | null;
  scopes: string[];
  creeLe: string;
  dernierUsageLe: string | null;
  /**
   * Lot D de l'audit : ce que l'application a créé et qui vit encore (clés d'API, adresses de webhook), que sa révocation
   * coupe. Absent d'une API plus ancienne, qui ne les coupe pas : la boîte n'en parle alors pas.
   */
  creations?: { cles: Array<{ id: string; name: string }>; adresses: Array<{ id: string; url: string }> };
  /**
   * Faux pour une application dont l'accès est fini (déconnectée par elle-même, jeton rejoué, fin de vie), listée parce
   * que ce qu'elle a créé vit encore (lot D de l'audit). Absent d'une API plus ancienne : connectée.
   */
  connectee?: boolean;
}

/** L'application connectée qui a créé une clé ou une adresse de webhook (lot D de l'audit), telle que le serveur la nomme. */
export interface ApplicationCreatrice {
  nom: string;
  marque: MarqueClient;
  hote: string | null;
}

type Traduire = (fr: string, en: string) => string;

/**
 * Ce qui se dit d'un client à côté de son nom, partout où il s'affiche (« Applications autorisées », provenance d'une
 * clé ou d'une adresse) : un nom DÉCLARÉ se dit tel, et l'hôte où il reçoit son code se montre. 🔴 Un client enregistré
 * peut se déclarer « Claude Code » : la mention « non vérifié » ne doit manquer à aucun de ces écrans. `null` : rien à dire.
 */
export function provenanceClient(marque: MarqueClient | undefined, hote: string | null | undefined, t: Traduire): string | null {
  const mentions = [marque === 'declaree' ? t('non vérifié', 'unverified') : null, hote ? t(`retour vers ${hote}`, `returns to ${hote}`) : null]
    .filter((x): x is string => x !== null);
  return mentions.length === 0 ? null : mentions.join(' · ');
}

/** « Créée par Claude Code », suivi de la provenance d'un client déclaré ; `null` pour une création de la console. */
export function creeeParApplication(application: ApplicationCreatrice | null | undefined, t: Traduire): string | null {
  if (!application) return null;
  const provenance = provenanceClient(application.marque, application.hote, t);
  return t(`Créée par ${application.nom}`, `Created by ${application.nom}`) + (provenance ? ` · ${provenance}` : '');
}

/**
 * Le message de la boîte de révocation. Depuis le lot D de l'audit, révoquer coupe aussi ce que l'application a créé :
 * la boîte NOMME chaque clé et chaque adresse avant le clic, et dit que l'application qui s'en sert s'arrêtera. Une
 * API d'avant le lot ne rend pas les créations, et ne les coupe pas : le message ne promet alors rien de plus.
 */
export function messageRevocation(a: AutorisationOauth, t: Traduire): string {
  // Déconnectée (par elle-même, un jeton rejoué, sa fin de vie) : il ne reste à couper que ce qu'elle a créé.
  const deconnectee = a.connectee === false;
  const debut = deconnectee
    ? t(
      `« ${a.client} », autorisé par ${personneDe(a)}, n’est plus connecté, mais ce qu’il a créé vit encore.`,
      `“${a.client}”, authorized by ${personneDe(a)}, is no longer connected, but what it created is still live.`,
    )
    : t(
      `Révoquer l’accès de « ${a.client} », autorisé par ${personneDe(a)} ? Son prochain appel sera refusé, et il devra demander une nouvelle autorisation.`,
      `Revoke “${a.client}” access, authorized by ${personneDe(a)}? Its next call will be refused, and it will have to ask for a new authorization.`,
    );
  const cles = a.creations?.cles ?? [];
  const adresses = a.creations?.adresses ?? [];
  if (cles.length === 0 && adresses.length === 0) return debut;
  const nomsFr = cles.map((c) => `« ${c.name} »`).join(', ');
  const nomsEn = cles.map((c) => `“${c.name}”`).join(', ');
  const urls = adresses.map((w) => w.url).join(', ');
  const parties = [
    cles.length === 0 ? null : cles.length === 1
      ? t(`la clé d’API ${nomsFr} sera révoquée`, `the API key ${nomsEn} will be revoked`)
      : t(`les clés d’API ${nomsFr} seront révoquées`, `the API keys ${nomsEn} will be revoked`),
    adresses.length === 0 ? null : adresses.length === 1
      ? t(`le webhook ${urls} sera mis en pause`, `the webhook ${urls} will be paused`)
      : t(`les webhooks ${urls} seront mis en pause`, `the webhooks ${urls} will be paused`),
  ].filter((x): x is string => x !== null);
  const liaison = deconnectee
    ? t('Révoquer l’arrête : ', 'Revoking stops it: ')
    : t('Ce qu’il a créé s’arrête avec lui : ', 'What it created stops with it: ');
  // Une adresse coupée peut être celle qui répond aux clients : leurs messages vont alors à l'équipe, et les événements
  // de la pause ne repartent pas (critique du lot D).
  const repondeur = adresses.length === 0 ? '' : ` ${t(
    'Si un de ces webhooks répond à vos clients, leurs messages iront à votre équipe, et les événements de la pause ne seront pas renvoyés.',
    'If one of these webhooks answers your customers, their messages will go to your team, and events sent during the pause will not be resent.',
  )}`;
  return `${debut} ${liaison}${parties.join(t(' et ', ' and '))}. ${t(
    'L’application qui s’en sert cessera de fonctionner ; pour la garder en marche, créez d’abord de quoi les remplacer, dans la console ou depuis une autre connexion de Claude.',
    'The application that uses them will stop working; to keep it running, first create their replacements, in the console or from another Claude connection.',
  )}${repondeur}`;
}

/**
 * Mode `session` par défaut, comme les clés d'API voisines : sur cette page, un 401 veut bien dire que la session de
 * la console est tombée, et la coquille propose de se reconnecter.
 */
export async function listerAutorisations(tenantId: string): Promise<AutorisationOauth[]> {
  // Une réponse sans la liste ne doit pas emporter la page des clés, dont cette section n'est qu'une partie.
  return (await request<{ autorisations?: AutorisationOauth[] }>(`/tenants/${tenantId}/oauth/autorisations`)).autorisations ?? [];
}

/** L'appel suivant de Claude échoue en 401, et il redemande une connexion. 404 : inconnue ou déjà révoquée. */
export function revoquerAutorisation(tenantId: string, id: string): Promise<{ id: string; revoked: boolean }> {
  return request(`/tenants/${tenantId}/oauth/autorisations/${id}`, { method: 'DELETE' });
}

/** Qui a autorisé : son nom affiché, sinon son adresse, comme partout dans la console. */
export function personneDe(a: Pick<AutorisationOauth, 'nom' | 'email'>): string {
  return a.nom !== null && a.nom.trim() !== '' ? a.nom : a.email;
}
