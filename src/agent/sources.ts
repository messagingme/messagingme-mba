/**
 * Les sources externes d'outils : l'adresse de base d'un système client, son mode d'authentification et son
 * secret.
 *
 * 🔴 Deux projections qui ne se mélangent pas : `SourceVue` (ce qu'une route rend, jamais le secret) et
 * `SourceAppel` (ce que le résolveur lit, secret déchiffré). Une projection unique finirait par renvoyer le
 * secret à l'écran le jour où quelqu'un ajoute un champ, sans que rien ne casse.
 *
 * L'adresse de base est figée ici : c'est la garde anti-SSRF, le modèle ne compose qu'un gabarit de chemin
 * et `src/agent/http-cible.ts` vérifie que la cible reste sous cette adresse.
 */

export type KindSource = 'http' | 'mcp';
export type AuthSource = 'none' | 'bearer' | 'header' | 'oauth_password';

/**
 * Ce qui n'est PAS secret dans une connexion OAuth par identifiant et mot de passe (`grant_type=password`, Keycloak
 * et ses pareils) : lisible à l'écran. Le mot de passe est le secret de la source, chiffré comme les autres
 * (`auth_secret_enc`). Le jeton obtenu n'est jamais stocké : `src/agent/jeton-oauth.ts` le garde en mémoire.
 */
export interface ConfigOAuth {
  /** L'adresse où demander le jeton, publique et en HTTPS, vérifiée comme l'adresse de base. */
  tokenUrl: string;
  clientId: string;
  username: string;
  /** Vide = aucun `scope` envoyé. */
  scope: string;
}
export type StatutSource = 'draft' | 'active' | 'disabled';

/** Ce qu'une route rend. Le secret n'y est pas, et il ne doit jamais y entrer. */
export interface SourceVue {
  id: string;
  tenantId: string;
  kind: KindSource;
  label: string;
  baseUrl: string;
  authKind: AuthSource;
  authHeaderName: string | null;
  /** La connexion OAuth, sans le mot de passe. `null` hors du mode `oauth_password`. */
  oauth: ConfigOAuth | null;
  /** Le secret existe-t-il. Sa valeur ne sort jamais du serveur. */
  aAuthentification: boolean;
  /**
   * Le secret actuel a-t-il déjà été posé chez Meta ? Meta ne rend jamais un secret, on ne peut pas comparer :
   * le drapeau retombe à `false` dès qu'on touche à l'authentification, et la publication suivante repose le
   * secret. À secret inchangé, publier deux fois ne fait rien.
   */
  secretPublie: boolean;
  status: StatutSource;
  lastOkAt: string | null;
  lastError: string | null;
  /** Nombre d'outils actifs qui en dépendent : c'est ce qui refuse une suppression qui rendrait un agent muet. */
  outilsActifs: number;
  /**
   * Nombre d'agents qui tapent dans cette source : une source appartient au workspace, et sans ce chiffre on
   * la supprimerait en croyant qu'elle n'appartient qu'à l'agent depuis lequel on la voit.
   */
  agents: number;
}

/** Ce que le résolveur lit : le secret est déchiffré ici, au moment de l'appel. */
export interface SourceAppel {
  id: string;
  /**
   * 🔴 Requis : sans lui, un résolveur MCP pourrait parler MCP à un connecteur HTTP, avec le secret du client.
   * La clé étrangère de `source_kind` ne couvre pas les lignes anciennes (MATCH SIMPLE).
   */
  kind: KindSource;
  baseUrl: string;
  authKind: AuthSource;
  authHeaderName: string | null;
  /** Pour `oauth_password` : `authSecret` est alors le mot de passe. */
  oauth: ConfigOAuth | null;
  authSecret: string | null;
  status: StatutSource;
}

export interface CreationSource {
  kind: KindSource;
  label: string;
  baseUrl: string;
  authKind: AuthSource;
  authHeaderName?: string;
  oauth?: ConfigOAuth;
  authSecret?: string;
}

export interface PatchSource {
  label?: string;
  baseUrl?: string;
  authKind?: AuthSource;
  authHeaderName?: string | null;
  /** Absent = inchangé. Remplacée entière : ses quatre morceaux vont ensemble. */
  oauth?: ConfigOAuth;
  /** Absent = inchangé. Un secret qu'on ne renvoie pas ne doit pas s'effacer parce qu'on a renommé la source. */
  authSecret?: string;
  status?: StatutSource;
}

/** Le libellé est déjà pris pour ce tenant. Erreur typée : la route rend 409, pas 500. */
export class LabelSourceDejaPris extends Error {
  constructor(label: string) { super(`une source nommée « ${label} » existe déjà`); this.name = 'LabelSourceDejaPris'; }
}

/** La source porte encore des appels enregistrés (`connector_requests`, `on delete restrict` de 0105). Erreur typée : 409. */
export class SourcePorteDesAppels extends Error {
  constructor() {
    super('ce connecteur porte encore des appels enregistrés : supprimez-les d’abord, puis le connecteur');
    this.name = 'SourcePorteDesAppels';
  }
}

export interface SourceStore {
  lister(tenantId: string): Promise<SourceVue[]>;
  parId(tenantId: string, id: string): Promise<SourceVue | null>;
  creer(tenantId: string, input: CreationSource): Promise<SourceVue>;
  patch(tenantId: string, id: string, patch: PatchSource): Promise<SourceVue | null>;
  /** `false` = introuvable. Le refus « des outils actifs en dépendent » est porté par la route, pas ici. */
  supprimer(tenantId: string, id: string): Promise<boolean>;
  /** Rend le secret en clair ; chaque lecteur vérifie le `kind` (inventaire tenu par `tests/sources-kind.test.ts`). */
  pourAppel(tenantId: string, id: string): Promise<SourceAppel | null>;
  /** Résultat de la dernière épreuve. Best-effort chez l'appelant : jamais bloquant. */
  marquerEpreuve(tenantId: string, id: string, ok: boolean, erreur?: string): Promise<void>;
  /**
   * Le secret courant vient d'être posé chez Meta. Appelée après l'accusé de réception de Meta, jamais avant :
   * sinon un échec passerait pour un secret publié, et la publication suivante ne le reposerait plus.
   */
  marquerSecretPublie(tenantId: string, id: string): Promise<void>;
}
