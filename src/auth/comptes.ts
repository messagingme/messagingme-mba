import type { OrigineEspace } from '../user/store.pg';
import type { ConfirmationInscription, DemandeInscription, EspaceAConfirmer } from '../user/inscriptions';
import type { AcceptationInvitation, ApercuInvitation } from '../user/invitations';

/** Un compte rattaché à une adresse, actif ou révoqué. */
export interface CompteParAdresse {
  id: string;
  tenantId: string;
  tenantName: string;
  role: string;
  disabled: boolean;
}

/** Ce que l'authentification lit et écrit des comptes. Chaque méthode absente rend sa route 503. */
export interface ComptesAuthDep {
  /** Inscription libre : crée un espace et son admin. `passwordHash` null = compte Google seul. */
  createTenantWithAdmin?(
    workspaceName: string,
    admin: { email: string; name: string | null; passwordHash: string | null },
    origine: OrigineEspace,
  ): Promise<{ tenantId: string; userId: string }>;
  /** Pose (écrase) le hash de mot de passe d'un compte (reset / changement). */
  setPassword?(userId: string, hash: string): Promise<boolean>;
  /** Hash de mot de passe courant d'un compte (vérification au changement). null si absent/sans mdp. */
  getPasswordHash?(userId: string): Promise<string | null>;
  /** Le mot de passe de l'identité d'une adresse : `undefined` = inconnue, `null` = sans mot de passe. */
  motDePasseDeLAdresse?(email: string): Promise<string | null | undefined>;
  /** Compte par id : sert à émettre une session après invitation ou à retrouver l'adresse de la session. */
  getSessionUser?(userId: string): Promise<{ tenantId: string; role: string; email: string } | null>;
  /**
   * Les comptes OUVERTS d'une adresse, révoqués compris. Vide = adresse inconnue, ou qui n'a que des invitations en
   * attente : elles ne s'ouvrent que par leur page (lot identité C).
   */
  getByEmail?(email: string): Promise<CompteParAdresse[]>;
  /**
   * Le compte auquel rattacher un lien de réinitialisation, invitation en attente comprise : la réinitialisation prouve
   * l'adresse et n'ouvre rien. `null` = adresse inconnue, sans mot de passe, ou tout révoqué. Absente : aucun lien.
   */
  compteAReinitialiser?(email: string): Promise<string | null>;
  /** Ce que la page d'une invitation affiche avant tout geste. `null` = compte inconnu. */
  apercuInvitation?(userId: string): Promise<ApercuInvitation | null>;
  /**
   * L'acceptation d'une invitation, en une transaction : jeton consommé, identité verrouillée, mot de passe posé s'il est
   * fourni (seulement si l'adresse n'en a pas), drapeau levé.
   */
  accepterInvitation?(jeton: string, nouveauHash: string | null): Promise<AcceptationInvitation>;
  /** Horodate la dernière connexion réussie (page Équipe). */
  touchLastLogin?(userId: string): Promise<void>;
  /** Inscription d'une adresse inconnue, en attente du clic (lot identité B) : rend le jeton du lien, en clair. */
  demanderInscription?(demande: DemandeInscription, ttlMs: number): Promise<string>;
  /** Efface la demande d'un lien qui n'est pas parti. */
  oublierDemande?(jeton: string): Promise<void>;
  /** Le jeton désigne-t-il une demande vivante ? Lu avant le hachage du mot de passe : un jeton inventé ne coûte rien. */
  inscriptionVivante?(jeton: string): Promise<boolean>;
  /** Le clic : crée l'espace, l'identité prouvée et le compte admin, ou dit pourquoi rien n'est créé. */
  confirmerInscription?(jeton: string, espace: EspaceAConfirmer): Promise<ConfirmationInscription>;
}

/**
 * Marque une connexion réussie sans bloquer sa réponse. Une écriture de suivi ne doit pas transformer une
 * connexion valide en refus quand la base est momentanément saturée.
 */
export function marquerConnexion(comptes: Pick<ComptesAuthDep, 'touchLastLogin'> | undefined, userId: string): void {
  void comptes?.touchLastLogin?.(userId)?.catch(() => {});
}
