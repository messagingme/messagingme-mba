import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import {
  FILIERES_NUMERO, MODES_NUMERO, prixDuNumero, type PrixNumero,
} from '../../web/lib/partage/parcours-numero';
import type { AnnotationsMcp, DepsMcp, OutilMcp, PersonneMcp } from './outils';
import { RefusOutil, valeurOuRefus } from './saisie';
import { MESSAGE_OPERATIONS_LOURDES } from '../auth/plafond-partage';
import type { Issue } from '../lib/issue';
import type { EtatConnexion } from '../otp/etat-connexion';
import type { EtatDeLEspace } from '../stripe/abonnements.pg';
import {
  DELAI_ATTENTE_MS, type AccompagnementConnexionNumeroMcp,
} from './connexion-numero';

export { DELAI_ATTENTE_MS, PAS_ATTENTE_MS, modeDuLienNeuf, rappelDuLien } from './connexion-numero';

/**
 * LES OUTILS DE LA CONNEXION DU NUMÉRO (lot 3c, livraison A, spec `docs/superpowers/specs/2026-10-06-lien-attente-abonnement-design.md`).
 *
 * Le client ne passe jamais par la console (décision de Julien du 2026-10-06) : `start_whatsapp_connection` lui donne
 * un lien qui ouvre la page de connexion du numéro de SON espace, sans écran de connexion, pendant une heure ;
 * `watch_whatsapp_connection` attend le prochain changement (numéro attribué, code capté, numéro connecté) et rend le
 * code pour que Claude l'affiche dans le terminal.
 *
 * 🔴 Les deux exigent une PERSONNE : le lien agit en son nom (la garde relit à chaque appel qu'elle est encore admin),
 * et l'attente rend un code de vérification. Invisibles derrière une clé d'API.
 */
export interface DepsNumeroMcp {
  /** Le parcours de connexion : démarrage, attente et consignes forment désormais une seule capacité. */
  connexion: AccompagnementConnexionNumeroMcp;
  /** L'état courant sert aussi à la lecture de l'abonnement. */
  etat(tenantId: string): Promise<EtatConnexion>;
  ouvrirPortail(tenantId: string, payeur: string): Promise<Issue<{ url: string }>>;
  abonnement(tenantId: string): Promise<EtatDeLEspace | null>;
  ouvrirAbonnement(tenantId: string, payeur: string): Promise<Issue<{ url: string }>>;
  suiteDuPro(tenantId: string): Promise<{ finPrevueLe: Date | null; rendreNumero: boolean } | null>;
  rendreLeNumero(tenantId: string, rendre: boolean): Promise<boolean>;
}

const jour = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10));
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * Le rappel que porte chaque réponse d'outil MCP de l'espace (lot 4) : en retard, la date de la coupure ; suspendu, la
 * coupure et, si le numéro est gardé, sa libération. Rien dans les autres états. `src/mcp/serveur.ts` l'ajoute.
 */
export function rappelDeLAbonnement(a: EtatDeLEspace | null): string | null {
  if (a === null) return null;
  if (a.etat === 'en_retard') {
    // Sans date de coupure, rien ne sera coupé (un autre numéro que le numéro fourni envoie) : aucune date inventée.
    return a.coupureLe === null
      ? 'Rappel : le renouvellement de l’abonnement du numéro WhatsApp fourni a échoué. resubscribe_number donne le lien pour régler.'
      : `Rappel : le renouvellement de l’abonnement du numéro WhatsApp a échoué. Sans paiement, ses envois seront coupés le ${jour(a.coupureLe)}. `
        + 'resubscribe_number donne le lien pour régler.';
  }
  if (a.etat === 'suspendu') {
    return a.finiLe !== null
      ? `Les envois du numéro WhatsApp sont coupés : son abonnement est terminé. Sans réabonnement, le numéro sera libéré le ${jour(a.liberationLe)}. `
        + 'resubscribe_number donne le lien pour se réabonner au même numéro.'
      : 'Les envois du numéro WhatsApp sont coupés : son abonnement est impayé. resubscribe_number donne le lien pour régler.';
  }
  return null;
}

/**
 * Le rappel de la suite du numéro à la fin prévue du Pro (lot 6, B2b, décision de Julien : la console, Claude et un
 * e-mail l'annoncent). Rien tant que le Pro court sans fin, ni sans numéro fourni (`null`).
 */
export function rappelDeLaSuiteDuPro(s: { finPrevueLe: Date | null; rendreNumero: boolean } | null): string | null {
  if (s === null || s.finPrevueLe === null) return null;
  return s.rendreNumero
    ? `Rappel : la formule Pro de l’espace se termine le ${jour(s.finPrevueLe)}, et le numéro WhatsApp fourni sera alors rendu (ses `
      + 'envois coupés, puis libéré 7 jours après). return_number_at_plan_end avec rendre = false le garde.'
    : `Rappel : la formule Pro de l’espace se termine le ${jour(s.finPrevueLe)}. Le numéro WhatsApp fourni passera alors à 3,50 € HT `
      + 'par mois sur la même carte ; return_number_at_plan_end avec rendre = true le rend à la place.';
}

/** La forme d'une empreinte (`empreinteEtat`) : seize chiffres hexadécimaux. */
const EMPREINTE_RE = /^[0-9a-f]{16}$/;

/** Une écriture est toujours `destructiveHint: true` (règle du répertoire de Claude, voir `AnnotationsMcp`). */
const ecriture = (title: string, idempotentHint: boolean): AnnotationsMcp =>
  ({ title, readOnlyHint: false, destructiveHint: true, idempotentHint, openWorldHint: false });

function signataire(personne: PersonneMcp | null): string {
  if (personne === null) throw new RefusOutil('connexion OAuth requise : cet outil agit au nom d’une personne');
  return personne.userId;
}

const PRIX_DIT: Record<PrixNumero, string> = {
  inclus: 'inclus en formule Pro',
  essai: '3,50 € HT par mois, déduits de la première facture de formule Pro, non remboursés sans formule Pro au bout de l’essai (essai en cours)',
  payant: '3,50 € HT par mois',
};

export const OUTILS_NUMERO: OutilMcp[] = [
  {
    ...ficheOutilMcp('return_number_at_plan_end'),
    fonction: null,
    description:
      'Chooses what becomes of the provided WhatsApp number at the END of the workspace\'s Pro plan: rendre = true '
      + 'gives it back (its sends are cut when Pro ends, then it is released 7 days later); rendre = false keeps it, at '
      + '€3.50 excl. VAT a month on the same card as Pro. Reversible while Pro runs; refused without a running Pro. '
      + 'This choice belongs to the person and is made at their explicit request.',
    annotations: ecriture('Give back the number when Pro ends', true),
    entree: {
      type: 'object',
      properties: { rendre: { type: 'boolean', description: 'true: give the number back when Pro ends; false: keep it.' } },
      required: ['rendre'],
      additionalProperties: false,
    },
    async executer(deps: DepsMcp, tenantId, args, personne) {
      signataire(personne);
      if (typeof args.rendre !== 'boolean') throw new RefusOutil('paramètre « rendre » requis : true ou false');
      if (!(await deps.numero.rendreLeNumero(tenantId, args.rendre))) {
        throw new RefusOutil('Cet espace n’a pas de formule Pro en cours : il n’y a pas de fin de formule Pro où rendre le numéro.');
      }
      return { rendre_numero: args.rendre };
    },
  },
  {
    ...ficheOutilMcp('get_number_subscription'),
    fonction: null,
    description:
      'The subscription of the provided WhatsApp number (€3.50 excl. VAT a month): its status (actif, en_retard after '
      + 'a failed payment, resilie), the end of the paid period, and the number. `abonnement: null`: the workspace has '
      + 'no paid provided number. `inclus_dans_le_pro: true`: the workspace\'s plan (Pro, Business or Entreprise) includes the number, there is '
      + 'nothing to pay.',
    annotations: { title: 'Read the number subscription', readOnlyHint: true, openWorldHint: false },
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps: DepsMcp, tenantId) {
      // L'état calculé est un complément : une lecture qui échoue ne prive pas Claude du statut (jaune 7 de A).
      const [e, a] = await Promise.all([deps.numero.etat(tenantId), deps.numero.abonnement(tenantId).catch(() => null)]);
      return {
        abonnement: e.abonnement?.statut ?? null,
        prochaine_echeance: e.abonnement?.periodeFin ?? null,
        numero_fourni: e.fourni,
        prix: PRIX_DIT[prixDuNumero(e)],
        inclus_dans_le_pro: e.inclusDansLePro,
        // Lot 4 : l'état calculé (actif, fin_prevue, en_retard, suspendu, libere) et ses dates.
        etat: a?.etat ?? null,
        fin_prevue: iso(a?.finPrevueLe),
        coupure_le: iso(a?.coupureLe),
        liberation_le: iso(a?.liberationLe),
      };
    },
  },
  {
    ...ficheOutilMcp('manage_number_subscription'),
    fonction: null,
    description:
      'Returns the URL of the Stripe customer portal for the number subscription: change card, read invoices, '
      + 'cancel. The person acts on that page themselves. Counts toward the workspace\'s heavy operations.',
    // Monde ouvert : une session est créée chez Stripe. Une de plus à chaque appel. Destructrice pour la règle du
    // répertoire de Claude (voir `AnnotationsMcp`).
    annotations: { title: 'Manage the number subscription', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps: DepsMcp, tenantId, _args, personne) {
      const payeur = signataire(personne);
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw new RefusOutil(`${MESSAGE_OPERATIONS_LOURDES} (réessayer dans ${Math.max(1, Math.ceil(c.attenteMs / 1000))} s)`);
      return valeurOuRefus(await deps.numero.ouvrirPortail(tenantId, payeur));
    },
  },
  {
    ...ficheOutilMcp('resubscribe_number'),
    fonction: null,
    description:
      'Renews the subscription of the provided WhatsApp number when it is unpaid or ended, and returns the URL the '
      + 'person uses. Unpaid (late, or suspended for non-payment): the Stripe portal, to pay the open invoice or change '
      + 'card. Ended, number still held: a new payment, which gives back the SAME number without going through Meta\'s '
      + 'window again. Cancellation scheduled: the portal, to undo it. Counts toward the workspace\'s heavy operations.',
    // Monde ouvert : une session est créée chez Stripe. Destructrice pour la règle du répertoire de Claude.
    annotations: { title: 'Renew the number subscription', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps: DepsMcp, tenantId, _args, personne) {
      const payeur = signataire(personne);
      const a = await deps.numero.abonnement(tenantId);
      if (a === null || a.etat === 'libere') {
        throw new RefusOutil('Cet espace n’a plus d’abonnement de numéro à renouveler : pour un nouveau numéro fourni, '
          + 'start_whatsapp_connection en mode « fourni ».');
      }
      if (a.etat === 'actif') throw new RefusOutil('L’abonnement du numéro est actif : rien à renouveler.');
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw new RefusOutil(`${MESSAGE_OPERATIONS_LOURDES} (réessayer dans ${Math.max(1, Math.ceil(c.attenteMs / 1000))} s)`);
      if (a.etat === 'suspendu' && a.finiLe !== null) {
        return {
          ...valeurOuRefus(await deps.numero.ouvrirAbonnement(tenantId, payeur)),
          consigne: 'Donne ce lien à la personne : le paiement rend le même numéro, et ses envois repartent dès que Stripe '
            + 'l’a confirmé (get_number_subscription le dit).',
        };
      }
      return {
        ...valeurOuRefus(await deps.numero.ouvrirPortail(tenantId, payeur)),
        consigne: a.etat === 'fin_prevue'
          ? 'Donne ce lien à la personne : dans le portail de Stripe, elle peut annuler la résiliation programmée.'
          : 'Donne ce lien à la personne : dans le portail de Stripe, elle paie la facture en attente ou change de carte.',
      };
    },
  },
  {
    ...ficheOutilMcp('start_whatsapp_connection'),
    fonction: null,
    description:
      'Returns the link that opens the connection page of the workspace\'s WhatsApp number, without going through the '
      + 'console, valid for one hour: the person goes through Meta\'s window there. `fourni`: a dedicated number is '
      + 'provided (€3.50 excl. VAT a month, paid on the page before it is assigned; included, with nothing to pay, for '
      + 'a workspace on Pro, except during its trial, when it is paid and the €3.50 are deducted from the first Pro '
      + 'month), whose verification code arrives here through watch_whatsapp_connection. `apporte`: the '
      + 'person\'s own number, used in no WhatsApp app; a number used in WhatsApp (the regular app, once the person '
      + 'installed WhatsApp Business on the same phone, which takes it over with its chats) or in the WhatsApp Business '
      + 'app goes through `coexistence`, never to another number. `coexistence`: the person\'s own number, kept in the WhatsApp Business app on their phone; messages sent '
      + 'through Messaging Me are official templates billed by Meta, those typed in the app stay free (filiere api only). '
      + 'Without a Meta Business account, Meta\'s window creates it along the way, in `apporte` and `fourni` as in '
      + '`coexistence`: a person without the WhatsApp Business app chooses, as the setup skill asks, between installing '
      + 'it (free) and keeping it like coexistence, or connecting their number, or a provided one, as an API number. '
      + '`fourni_application`: for a person who chose the WhatsApp Business app (installed first if needed, or as a 2nd '
      + 'account in it, two at most per app), a number we provide (priced like `fourni`), put IN the app, whose account '
      + 'they create with it (its verification code '
      + 'arrives here), then kept there through Meta\'s window, like coexistence (filiere api only); a connection '
      + 'started that way resumes in the mode that numero.reprise of get_setup_state names. When the workspace took the credit line and has no number yet, the link of `fourni` and '
      + '`apporte` opens the connection without a card at Meta, and the consigne gives its conditions; the credit line never '
      + 'pays a number that keeps the app. When the person chose the credit line and the workspace has not taken it yet '
      + '(on Pro or a confirmed Business), call take_credit_line first and give this link only once the option is paid: '
      + 'a number connected before would stay paid by its card at Meta. '
      + 'Refused if the workspace already has a connected number, except `coexistence` for a number linked by QR code, '
      + 'which moves to the API on the same number.',
    // Il ne touche rien chez un tiers et ne crée rien : un lien signé de plus à chaque appel.
    annotations: ecriture('Open the WhatsApp number connection', false),
    entree: {
      type: 'object',
      properties: {
        mode: {
          type: 'string', enum: [...MODES_NUMERO],
          description: 'fourni: a number we provide; apporte: the person\'s own number; coexistence: the person\'s own number, '
            + 'kept in the WhatsApp Business app; fourni_application: a number we provide, put in the person\'s WhatsApp '
            + 'Business app and kept there.',
        },
        // 🔴 Plus aucune voie par QR code proposée (Julien, 2026-10-30) : sans compte Meta Business, la fenêtre de Meta
        // crée le compte en chemin. Depuis le lot 4 du 2026-11-17, la personne choisit l'application (installée d'abord
        // s'il le faut, gardée comme en coexistence) ou l'API (apporte ou fourni). La valeur `application` reste acceptée
        // pour un lien déjà en cours ; rien ne la propose plus.
        filiere: {
          type: 'string', enum: [...FILIERES_NUMERO],
          description: 'Leave it out: api, the official WhatsApp API. application, the link of the WhatsApp Business app by QR '
            + 'code, is no longer offered: never propose it. Without a Meta Business account, Meta\'s window creates the '
            + 'account along the way: the person connects their own number (apporte) or a number we provide (fourni) as an '
            + 'API number, or keeps the WhatsApp Business app, installed first if needed (coexistence, or fourni_application '
            + 'with a number we provide put in it).',
        },
        numero: {
          type: 'string', maxLength: 30,
          description: 'With filiere application and mode apporte only: the phone number of the WhatsApp Business app account, in '
            + 'international format (country code included).',
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const userId = signataire(personne);
      return deps.numero.connexion.demarrer(tenantId, userId, {
        mode: args.mode, filiere: args.filiere, numero: args.numero,
      });
    },
  },
  {
    ...ficheOutilMcp('watch_whatsapp_connection'),
    fonction: null,
    description:
      'Waits for the next change in the number connection (number assigned, verification code received, number '
      + `connected) and returns the state, after ${DELAI_ATTENTE_MS / 1000} seconds at most. With the fingerprint `
      + 'returned by the previous call (etat_connu), only something new wakes it up; without it, the state is returned '
      + 'at once. When `code` is present, it is the code the person copies into Meta\'s window. Successive calls follow '
      + 'the connection until `connecte: true`; with mode `coexistence`, until `coexistence: true`, a number linked by QR '
      + 'code staying `connecte` until Meta links it to the API, the WhatsApp Business app kept. With mode '
      + '`fourni_application`, the code is typed in the WhatsApp Business app, not in Meta\'s window. `lien`: while nothing '
      + 'has moved yet, a fresh link to the same connection page, signed for the given mode; null without a mode, or when '
      + 'that mode differs from the way already chosen.',
    // Écriture parce qu'il rend un code de vérification ; NON idempotent depuis le lot 1 de l'aide à la connexion (jaune 3) :
    // tant que rien n'a bougé, chaque réponse signe un lien neuf, comme chaque appel de start_whatsapp_connection.
    annotations: ecriture('Follow the WhatsApp number connection', false),
    entree: {
      type: 'object',
      properties: {
        etat_connu: {
          type: 'string', maxLength: 16, pattern: EMPREINTE_RE.source,
          description: 'The fingerprint returned by the previous call; absent on the initial call.',
        },
        filiere: { type: 'string', enum: [...FILIERES_NUMERO], description: 'The filiere chosen with start_whatsapp_connection (default api).' },
        mode: {
          type: 'string', enum: [...MODES_NUMERO],
          description: 'The mode chosen with start_whatsapp_connection: coexistence and fourni_application change what is '
            + 'awaited, and the fresh link (`lien`) is signed for it.',
        },
      },
      additionalProperties: false,
    },
    async executer(deps: DepsMcp, tenantId, args, personne) {
      const userId = signataire(personne);
      return deps.numero.connexion.suivre(tenantId, userId, {
        etatConnu: args.etat_connu, filiere: args.filiere, mode: args.mode,
      });
    },
  },
];
