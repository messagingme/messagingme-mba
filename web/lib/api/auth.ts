'use client';

/**
 * Connexion, inscription, mot de passe, Google.
 *
 * Sorti de `lib/api.ts` le 2026-09-01 (lot 5 du programme II), qui pesait 1 874 lignes. Le socle HTTP
 * (`./http`) etait deja extrait : ce decoupage-ci ne separe que des surfaces d'appel, sans etat partage.
 * `lib/api.ts` reste le point d'entree et reexporte tout, donc AUCUN des 67 importeurs ne change.
 */

import type { ChampPub } from '../pub';
import { request, ApiError } from '../http';
import { estCorpsCodeRefuse } from '../second-facteur';

export interface LoginResult {
  token: string;
  user: { email: string; role: string; tenantId: string };
}
/** Un espace accessible avec l'adresse saisie, tel que l'écran de choix le présente. */
export interface WorkspaceChoice { tenantId: string; tenantName: string; role: string }
/**
 * Réponse d'un login quand l'adresse donne accès à PLUSIEURS espaces : aucune session n'est émise, il faut
 * choisir. `choiceToken` ne vaut que pour `chooseWorkspace`, et le serveur le refuse comme jeton d'API.
 */
export interface LoginChoice {
  choiceToken: string;
  workspaces: WorkspaceChoice[];
}
/** Ce qui suit le second facteur, ou le remplace quand il n'est pas dû : une session, ou un choix d'espace. */
export type SuiteConnexion = LoginResult | LoginChoice;
/**
 * LE SECOND FACTEUR, AVANT TOUTE SESSION (plan du 2026-09-25). Aucun de ces jetons n'ouvre quoi que ce soit : il
 * ne vaut que pour l'étape suivante, et le serveur le refuse comme session.
 * - `mfaToken` : l'identité a un facteur actif, on demande son code ;
 * - `enrolToken` : administrateur d'un espace qui exige le second facteur, sans facteur : il en pose un avant d'entrer.
 */
export type EtapeSecondFacteur = { mfaToken: string } | { enrolToken: string };
/** Le login rend une session, un choix d'espace, ou une étape du second facteur. */
export type LoginOutcome = SuiteConnexion | EtapeSecondFacteur;
export function isLoginChoice<T extends LoginResult>(r: T | LoginChoice): r is LoginChoice {
  return (r as LoginChoice).choiceToken !== undefined;
}
export function estEtapeSecondFacteur(r: LoginOutcome): r is EtapeSecondFacteur {
  return 'mfaToken' in r || 'enrolToken' in r;
}
/** Deuxième temps : on présente le jeton de choix et l'espace retenu, et on obtient une vraie session. */
export function chooseWorkspace(choiceToken: string, tenantId: string): Promise<LoginResult> {
  return request<LoginResult>('/auth/choose-workspace', { method: 'POST', body: JSON.stringify({ choiceToken, tenantId }) });
}
export function login(email: string, password: string): Promise<LoginOutcome> {
  // `etape` : un 401 ici veut dire « identifiants invalides », pas « session perdue » (il n'y en a pas encore).
  return request<LoginOutcome>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, 'etape');
}
/**
 * La réponse d'une demande d'inscription pour une adresse INCONNUE (lot identité B) : un lien est parti, rien n'est créé.
 * L'espace, le mot de passe et la session viennent au clic, sur la page du lien (`confirmerInscription`).
 */
export interface LienEnvoye { lienEnvoye: true }
export function estLienEnvoye(r: unknown): r is LienEnvoye {
  return typeof r === 'object' && r !== null && (r as { lienEnvoye?: unknown }).lienEnvoye === true;
}
/**
 * Inscription libre. Une adresse INCONNUE reçoit un lien (`LienEnvoye`, lot identité B) ; une adresse CONNUE qui donne
 * son mot de passe ajoute un espace dont elle devient administratrice. Un espace neuf n'exige pas le second facteur
 * (décision de Julien du 2026-10-13) : la réponse est la session. Une étape seulement si l'adresse a déjà un facteur
 * (son code) ou est admin d'un autre espace qui l'exige (l'enrôlement). Une API d'avant le lot rend encore la session
 * pour une adresse inconnue : les trois formes se lisent, ce qui laisse la console partir avant l'API.
 * `langue`, `offre`, `application`, `fbc` et `fbp` voyagent avec la demande jusqu'au clic ; `turnstile` est le jeton du
 * défi anti-robot, quand la console le pose.
 */
export function signup(input: {
  workspaceName?: string; email: string; password?: string; name?: string; pub?: ChampPub;
  langue?: 'fr' | 'en'; offre?: 'pro'; application?: boolean; fbc?: string; fbp?: string; turnstile?: string;
}): Promise<EtapeSecondFacteur | SuiteConnexion | LienEnvoye> {
  return request<EtapeSecondFacteur | SuiteConnexion | LienEnvoye>('/auth/signup', { method: 'POST', body: JSON.stringify(input) });
}
/**
 * Le code d'un refus de l'inscription, lu dans le corps de l'erreur (`adresse_connue`, `lien_invalide`, `defi`), ou
 * `null` : un écran choisit sa suite sur ce code, jamais sur le texte du message.
 */
export function codeDuRefus(err: unknown): string | null {
  if (!(err instanceof ApiError) || typeof err.corps !== 'object' || err.corps === null) return null;
  const code = (err.corps as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
/** Ce que la confirmation rend avec la session : d'où venait la demande, pour l'arrivée après le clic. */
export interface SuiteInscription { offre: 'pro' | null; application: boolean; langue: 'fr' | 'en' }
/**
 * Le clic sur le lien d'inscription : le nom de l'espace, le nom, le mot de passe et l'accord se choisissent ici.
 * En mode `etape` : aucune session n'existe encore pour CE compte, et un refus (400 lien mort, 409 adresse connue)
 * ne doit jamais vider une autre session ouverte dans le navigateur.
 */
export function confirmerInscription(input: {
  jeton: string; workspaceName: string; name?: string; password: string; pub?: ChampPub;
}): Promise<(EtapeSecondFacteur | SuiteConnexion) & { inscription?: SuiteInscription }> {
  return request<(EtapeSecondFacteur | SuiteConnexion) & { inscription?: SuiteInscription }>(
    '/auth/signup/confirm', { method: 'POST', body: JSON.stringify(input) }, 'etape',
  );
}

// --- Second facteur : les étapes de la connexion (sans session) -----------------------------------------------

/** Le secret d'un enrôlement : `uri` pour le QR code, `secret` (base32) pour la saisie à la main. */
export interface CleTotp { secret: string; uri: string }

/**
 * Le code (application ou secours) d'une connexion. `codesSecoursRestants` n'est rendu que si un code de secours a
 * servi. `S` : ce que la connexion ouvre au bout, une session d'espace (défaut) ou d'exploitation (`SessionOpsOuverte`),
 * fixé par l'étape que le serveur a signée, pas par cet appel.
 */
export function verifierCodeConnexion<S = SuiteConnexion>(mfaToken: string, code: string): Promise<S & { codesSecoursRestants?: number }> {
  return request('/auth/mfa/verifier', { method: 'POST', body: JSON.stringify({ mfaToken, code }) }, 'etape');
}
export function enrolerConnexion(enrolToken: string): Promise<CleTotp> {
  return request('/auth/mfa/enroler', { method: 'POST', body: JSON.stringify({ enrolToken }) }, 'etape');
}
/** Le premier code prouve que l'application lit le bon secret. Rend les dix codes de secours, et la suite. */
export function activerConnexion<S = SuiteConnexion>(enrolToken: string, code: string): Promise<S & { codesSecours: string[] }> {
  return request('/auth/mfa/activer', { method: 'POST', body: JSON.stringify({ enrolToken, code }) }, 'etape');
}

// --- La connexion d'exploitation (`/ops`) ---------------------------------------------------------------------

/** Au bout d'une connexion d'exploitation : une session d'exploitation, jamais une session d'espace. */
export interface SessionOpsOuverte { sessionOps: string; email: string }

/**
 * Se connecter à l'exploitation : le compte habituel, puis TOUJOURS le second facteur (code, ou enrôlement pour
 * une adresse de la liste qui n'en a pas). Le serveur refuse en 403 une adresse hors de la liste.
 */
export function loginOps(email: string, password: string): Promise<EtapeSecondFacteur> {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, ops: true }) }, 'etape');
}
/** Idem par Google : Google prouve l'adresse, jamais le second facteur, qui reste exigé. */
export function loginOpsGoogle(idToken: string): Promise<EtapeSecondFacteur> {
  return request('/auth/google', { method: 'POST', body: JSON.stringify({ idToken, ops: true }) }, 'etape');
}

// --- Second facteur : la page Compte (avec session) --------------------------------------------------------------

export interface EtatSecondFacteur {
  actif: boolean;
  activeLe: string | null;
  codesSecoursRestants: number;
  /** Admin d'un espace qui l'exige, ou adresse d'exploitation : la désactivation lui est refusée. */
  obligatoire: boolean;
  /** Pourquoi elle est obligatoire. Absent d'une API antérieure au 2026-10-13. */
  raison?: 'espace' | 'exploitation' | null;
}
export function lireSecondFacteur(): Promise<EtatSecondFacteur> {
  return request('/auth/mfa/moi');
}
/** Le mot de passe est exigé : une session volée ne doit pas poser son facteur sur le compte (403 s'il est faux). */
export function enrolerMoi(motDePasse: string): Promise<CleTotp> {
  return request('/auth/mfa/moi/enroler', { method: 'POST', body: JSON.stringify({ motDePasse }) });
}
export function activerMoi(code: string): Promise<{ codesSecours: string[] }> {
  return request('/auth/mfa/moi/activer', { method: 'POST', body: JSON.stringify({ code }) }, 'code');
}
/** Dix codes neufs ; les anciens cessent de valoir. Un code est exigé, même avec une session. */
export function regenererCodesSecours(code: string): Promise<{ codesSecours: string[] }> {
  return request('/auth/mfa/moi/codes', { method: 'POST', body: JSON.stringify({ code }) }, 'code');
}
/** `token` : la session neuve (le retrait du facteur coupe toutes celles d'avant), à ranger par `remplacerJeton`. */
export function desactiverSecondFacteur(code: string): Promise<{ ok: boolean; token?: string }> {
  return request('/auth/mfa/moi/desactiver', { method: 'POST', body: JSON.stringify({ code }) }, 'code');
}

/** Le serveur a refusé le CODE (faux, rejoué, hors fenêtre) : on reste sur l'étape. */
export function estCodeRefuse(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401 && estCorpsCodeRefuse(err.corps);
}
/** Mot de passe perdu : renvoie toujours 200 (anti-énumération). */
export function forgotPassword(email: string): Promise<{ ok: boolean; message: string }> {
  return request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}
export function resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
  return request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
}
/** `token` : la session neuve (le changement coupe toutes celles d'avant), à ranger par `remplacerJeton`. */
export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; token?: string }> {
  return request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}
/** Config publique d'auth : le front l'utilise pour afficher (ou non) le bouton Google. */
export function getAuthConfig(): Promise<{ googleClientId: string; googleEnabled: boolean }> {
  return request('/auth/config', { method: 'GET' });
}
/** Résultat Google : session + `isNew` (email inconnu -> nouvel espace créé -> `arriveeDUnNouvelEspace`, le tunnel de la Base ou la souscription du Pro). */
export interface GoogleResult extends LoginResult {
  isNew: boolean;
}
/**
 * Se connecter avec Google : envoie le jeton ID au serveur, renvoie une session (login OU nouvel espace), ou un
 * CHOIX quand l'adresse ouvre plusieurs espaces, exactement comme `login`. `pub` : l'accord publicitaire coché (pixel,
 * lot 3), absent sans la case.
 */
export function loginWithGoogle(idToken: string, pub?: ChampPub): Promise<GoogleResult | LoginChoice> {
  return request<GoogleResult | LoginChoice>('/auth/google', { method: 'POST', body: JSON.stringify({ idToken, ...(pub ? { pub } : {}) }) });
}
