/**
 * Les demandes d'inscription par e-mail en attente du clic (lot identité B, migration 0279). Les types que le magasin
 * (`PgUserStore`), l'authentification (`ComptesAuthDep`) et leurs faux de test partagent.
 *
 * 🔴 L'INVARIANT : seuls des secrets posés par le titulaire PROUVÉ de l'adresse ouvrent l'identité qu'elle crée. La
 * demande ne garde donc ni mot de passe, ni nom d'espace, ni nom, ni accord publicitaire : un tiers peut remplir le
 * formulaire avec l'adresse d'autrui, et si le titulaire clique quand même, c'est lui qui pose tout au clic.
 */

/** Ce qu'une demande garde : rien que la personne qui reçoit le lien ne choisirait elle-même. */
export interface DemandeInscription {
  email: string;
  langue: 'fr' | 'en';
  /** La demande vient du choix du Pro (vitrine, `signup?offre=pro`) : l'arrivée après le clic mène à la souscription. */
  offrePro: boolean;
  /** La demande vient d'une connexion d'application (`/autoriser`) : après le clic, retour à l'onglet de connexion. */
  application: boolean;
  /** Les identifiants publicitaires du formulaire, servis seulement si l'accord est donné au clic. */
  pubFbc: string | null;
  pubFbp: string | null;
}

/** Ce que la personne qui a reçu le lien choisit au clic. */
export interface EspaceAConfirmer {
  workspaceName: string;
  name: string | null;
  passwordHash: string;
}

export type ConfirmationInscription =
  | {
      statut: 'cree';
      tenantId: string;
      userId: string;
      email: string;
      langue: 'fr' | 'en';
      offrePro: boolean;
      application: boolean;
      pubFbc: string | null;
      pubFbp: string | null;
    }
  /** Échu, déjà servi, effacé par la confirmation d'un autre lien de la même adresse, ou inconnu. */
  | { statut: 'lien_invalide' }
  /** L'adresse a reçu une identité entre la demande et le clic : rien n'est créé, la demande reste. */
  | { statut: 'adresse_connue' };
