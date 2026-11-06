/**
 * L'ACCEPTATION D'UNE INVITATION (lot identité C, migration 0281). Un compte créé par une invitation n'ouvre rien et ne
 * compte pour rien tant qu'elle n'est pas acceptée, et elle ne s'accepte que sur sa page `/invite/<jeton>` : par Google à
 * l'adresse invitée, par le mot de passe ACTUEL d'une adresse qui en a un, ou par un mot de passe choisi pour une adresse
 * qui n'en a pas. Ces types vivent à part du magasin : la route et les faux des tests les importent sans Postgres.
 */

/** Ce que la page affiche avant tout geste. `invitant` null : invitation d'avant le lot, ou compte invitant supprimé. */
export interface ApercuInvitation {
  espace: string;
  adresse: string;
  invitant: { nom: string | null; adresse: string } | null;
  /** L'adresse a déjà un mot de passe : la page demande l'actuel, et l'acceptation n'en écrit aucun. */
  aUnMotDePasse: boolean;
}

export type AcceptationInvitation =
  | { statut: 'acceptee'; userId: string }
  /** Jeton inconnu, échu ou déjà servi, ou compte supprimé : rien n'est écrit. */
  | { statut: 'invalide' }
  /** L'adresse a reçu un mot de passe entre l'aperçu et l'envoi : il faut désormais l'actuel. Rien n'est écrit, jeton intact. */
  | { statut: 'mot_de_passe_existe' };
