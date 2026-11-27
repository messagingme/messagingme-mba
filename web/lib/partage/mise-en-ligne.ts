/**
 * LE OUI DE MISE EN LIGNE (lot 1 du CSM virtuel, B2) : ce que la page de la console montre d'une mise en ligne, tel que
 * l'API le rend (`src/mise-en-ligne/mise-en-ligne.ts`, `vueDe`). Un seul contrat pour les deux bouts : le serveur et la
 * page l'importent d'ici, une dérive ne compile pas.
 */

/** Ce que `propose_go_live` demande : publier, restaurer, brancher le répondeur. */
export const TYPES_ACTION = ['publier', 'restaurer', 'repondeur'] as const;
/**
 * Les envois au oui (lot 1 du CSM virtuel, B8) : lancer, programmer ou reprendre une campagne, effacer des contacts,
 * envoyer un modèle ou faire partir un scénario vers UNE personne, choisir l'appel de connecteur prévenu à chaque
 * désabonnement (B10, livraison 1c : des données partent chez un tiers), et effacer les messages d'une conversation (B10,
 * livraison 2b : rien ne les rattrape). Ils sont préparés par LEURS outils (`prepare_campaign`, `control_campaign`,
 * `prepare_contacts_deletion`, `send_template_to_contact`, `send_scenario_to_contact`, `set_optout_push`,
 * `erase_conversation_messages`), jamais par `propose_go_live`, et chacun est SEUL dans sa mise en ligne.
 */
export const TYPES_ENVOI = ['campagne', 'suppression', 'modele', 'envoi_scenario', 'poussee_optout', 'effacement_messages'] as const;
export type TypeAction = (typeof TYPES_ACTION)[number] | (typeof TYPES_ENVOI)[number];

/**
 * Le résultat d'une action, une fois exécutée : `programme` = la publication attend la validation d'un template par Meta ;
 * `branche` = le répondeur, ou l'appel prévenu des désabonnements, branché ; `debranche` = plus aucun appel prévenu.
 */
export type ResultatAction =
  | { ok: true; etat: 'publie' | 'programme' | 'branche' | 'debranche' }
  /**
   * Une campagne : `envoyee` (elle part), `programmee` (à sa date), `reprise` (une pause levée), `deja_partie` (lancée
   * avant cette exécution : par celle qu'une coupure a interrompue, ou depuis la console). `destinataires` : ceux en
   * attente montrés au clic.
   */
  | { ok: true; etat: 'envoyee' | 'programmee' | 'reprise' | 'deja_partie'; destinataires: number }
  /** Une suppression : ce que CETTE exécution a effacé (une reprise après une coupure ne recompte pas le déjà fait). */
  | { ok: true; etat: 'supprimes'; contacts: number; conversations: number; messages: number }
  /**
   * Les messages d'une conversation : `effacee`, ceux que CETTE exécution a effacés ; `deja_effacee`, une reprise les trouve
   * déjà partis (par l'exécution qu'une coupure a interrompue, ou depuis l'Inbox) et n'efface rien.
   */
  | { ok: true; etat: 'effacee'; messages: number }
  | { ok: true; etat: 'deja_effacee' }
  /**
   * Un envoi à UNE personne (un modèle, un scénario) : `envoi`, son identifiant (`send_id`, sa ligne dans Campagnes). Une
   * reprise après une coupure rend le même, sans rien renvoyer.
   */
  | { ok: true; etat: 'envoye'; envoi: string }
  | { ok: false; code: string; message: string };

/**
 * `proposee` : le bouton attend le clic ; `expiree` : 24 heures sont passées ; `en_cours` ; `interrompue` : une panne l'a
 * arrêtée, un nouveau clic la reprend après la dernière action faite ; `faite` ; `echouee` : une action a été refusée,
 * la suite n'est pas partie.
 */
export type EtatVue = 'proposee' | 'expiree' | 'en_cours' | 'interrompue' | 'faite' | 'echouee';

/** Jamais les graphes : ce qui sera publié est résumé par le récapitulatif, écrit par le serveur. */
export interface VueMiseEnLigne {
  id: string;
  libelle: string;
  recapitulatif: string[];
  etat: EtatVue;
  expireLe: string;
  accepteeLe: string | null;
  termineeLe: string | null;
  /**
   * `scenario` pour une publication, le répondeur ou un scénario envoyé à une personne, `campagne` pour une campagne,
   * `conversation` pour l'effacement de ses messages (la page la lie : l'admin la voit avant de cliquer) ; une suppression
   * et un modèle envoyé n'ont que leur nom.
   */
  actions: Array<{ type: TypeAction; nom: string; scenario?: string; campagne?: string; conversation?: string; version?: number; resultat: ResultatAction | null }>;
}
