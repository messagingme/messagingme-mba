import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { AnnotationsMcp, DepsMcp, OutilMcp } from './outils';
import { RefusOutil, refusDuCoeur, refusDuPlafond, texteObligatoire } from './saisie';
import { LISTES } from './ecran';
import { lireMiseEnService } from './mise-en-service';
import { makeJournal } from '../audit/journal';
import { RateLimiter } from '../auth/rate-limit';
import type { AccountStatusResponse } from '../http/account';
import { MESSAGE_MAX, SUBJECT_MAX, type SupportRouteDeps } from '../http/support';
import { journaliser } from '../lib/journal';
import { CompteChez360dialog } from '../meta/credentials';
import {
  DELAI_ENTRE_CODES_MS, type IssueActivationNumero, type IssueDemandeCodeNumero, type TracerConnexionNumero,
} from '../account/connexion-numero';

/**
 * LES PRÉREQUIS D'UNE MISE EN SERVICE (lot 1 du CSM virtuel, B7, plan `docs/superpowers/plans/2026-11-26-csm-lot1-g-prerequis.md`) :
 * lire l'état du compte WhatsApp, faire envoyer le code du numéro et l'activer, écrire au Support. 🔴 Aucune logique
 * ici : chaque outil appelle le service que la console appelle (les mêmes dépendances, passées par le câblage), avec
 * les mêmes gardes et le même quota de Meta ; les écritures exigent une personne.
 */
export interface DepsPrerequisMcp {
  prerequis: {
    /** La lecture de l'Accueil (`lireEtatDuCompte`, `src/http/account.ts`) sur les dépendances de sa route. */
    etatDuCompte(tenantId: string): Promise<AccountStatusResponse>;
    /** `demanderCodeNumero` sur les dépendances de `POST /numero/code`. */
    demanderCode(tenantId: string, methode: 'VOICE' | 'SMS'): Promise<IssueDemandeCodeNumero>;
    /** `activerNumero` sur les dépendances de `POST /numero/activer`. */
    activer(tenantId: string, code: string | undefined, tracer: TracerConnexionNumero): Promise<IssueActivationNumero>;
    /** Les dépendances de `POST /support`, les mêmes objets. */
    support: SupportRouteDeps;
  };
}

/**
 * Les bornes du formulaire de support de la console (`src/http/support.ts`), sous un nom de CE module, réexporté par
 * `src/mcp/outils.ts` : le test des bornes lit le nom écrit à l'appel de `texteObligatoire`, et un import y serait
 * réécrit en `__vi_import_0__.X`, un nombre en `5e3`.
 */
export const SUJET_SUPPORT_MAX = SUBJECT_MAX;
export const MESSAGE_SUPPORT_MAX = MESSAGE_MAX;

/** La phrase de la console pour un numéro relié par 360dialog (`src/server.ts`) : rien ne part chez Meta. */
const PAS_POUR_360DIALOG = 'Cette fonction n’est pas disponible pour un numéro relié par 360dialog.';

/** Un service du numéro qui parle à Meta : un compte 360dialog devient le refus lisible de la console, pas une panne. */
async function chezMeta<T>(appel: () => Promise<T>): Promise<T> {
  try {
    return await appel();
  } catch (err) {
    if (err instanceof CompteChez360dialog) throw new RefusOutil(PAS_POUR_360DIALOG, 'conflict');
    throw err;
  }
}

/**
 * Le plafond du formulaire de la console, cinq demandes par minute et par personne, propre à cet outil comme le sien
 * l'est à sa route : une demande au Support part chez l'équipe par e-mail.
 */
const plafondSupport = new RateLimiter(5, 60_000);

const ecriture = (title: string): AnnotationsMcp => ({ title, readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });

/** Le contexte joint par le SERVEUR à une demande au Support : l'état de mise en service, jamais écrit par Claude. */
async function contexteDeLEspace(deps: DepsMcp, tenantId: string): Promise<string> {
  try {
    const e = await lireMiseEnService(deps, tenantId);
    return JSON.stringify(e, null, 1);
  } catch {
    // Une lecture en panne n'empêche jamais la demande de partir : l'équipe sait seulement qu'il manque.
    return 'indisponible (la lecture de l’état a échoué)';
  }
}

export const OUTILS_PREREQUIS: OutilMcp[] = [
  {
    ...ficheOutilMcp('get_account_status'),
    fonction: null,
    description: 'The workspace\'s WhatsApp account as the console Home shows it, read again at Meta on each call: the '
      + 'number, its display name (verifiedName) and its review status (nameStatus), the quality (GREEN, YELLOW, RED), the '
      + 'messaging limit tier, the number status, the code verification status (codeVerificationStatus), the business '
      + 'verification (businessVerificationStatus), Marketing Messages (marketingMessagesLiteApiStatus), a payment blocked '
      + 'by Meta (paiementMetaBloque), and the status dot with its reason (status). hasNumber false: no number yet '
      + '(start_whatsapp_connection).',
    annotations: { title: 'Read the WhatsApp account status', readOnlyHint: true, openWorldHint: true },
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps: DepsMcp, tenantId) {
      return deps.prerequis.etatDuCompte(tenantId);
    },
  },
  {
    ...ficheOutilMcp('request_number_code'),
    fonction: null,
    description: 'Asks Meta to send the verification code of the workspace\'s connected number, like the console Home, '
      + 'before activate_number: by a voice call (VOICE, the default) or by SMS (never on a VoIP number). Meta allows 10 '
      + 'requests per 72 hours, then refuses any code to this number until the window passes: request another code only '
      + 'after the person says the previous one did not arrive, and one minute apart at least. A number already verified '
      + 'needs no code (activate_number without one); a number connected through coexistence has nothing to activate. '
      + 'Counts toward the workspace\'s heavy operations.',
    annotations: ecriture('Request the number verification code'),
    entree: {
      type: 'object',
      properties: {
        methode: { type: 'string', enum: ['VOICE', 'SMS'], description: 'VOICE (a call, the default) or SMS.' },
      },
      additionalProperties: false,
    },
    ecran: () => LISTES.accueil,
    async executer(deps: DepsMcp, tenantId, args) {
      const methode = args.methode === undefined || args.methode === null ? 'VOICE' : args.methode;
      if (methode !== 'VOICE' && methode !== 'SMS') throw new RefusOutil('paramètre « methode » : VOICE ou SMS', 'invalid_args');
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw refusDuPlafond(c.attenteMs);
      const r = await chezMeta(() => deps.prerequis.demanderCode(tenantId, methode));
      // Un 429 dit la minute entre deux codes : l'agent reçoit le délai, en chiffre.
      if (!r.ok) {
        throw refusDuCoeur({ statut: r.statut, message: r.error, ...(r.statut === 429 ? { reessayerDansS: DELAI_ENTRE_CODES_MS / 1000 } : {}) });
      }
      return { envoye: true, methode: r.methode, consigne: 'Le code arrive sur le numéro : demande-le à la personne, puis activate_number avec ce code.' };
    },
  },
  {
    ...ficheOutilMcp('activate_number'),
    fonction: null,
    description: 'Activates the workspace\'s connected number on the WhatsApp Cloud API, like the console Home: verifies '
      + 'the code when the number still needs it (request_number_code first), then registers it. No automatic retry: '
      + 'a failure leaves the number to activate. Counts toward the workspace\'s heavy operations.',
    annotations: ecriture('Activate the number'),
    entree: {
      type: 'object',
      properties: {
        code: { type: 'string', minLength: 1, maxLength: 20, description: 'The code Meta sent by call or SMS. Absent when the number is already verified.' },
      },
      additionalProperties: false,
    },
    ecran: () => LISTES.accueil,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      if (personne === null) throw new RefusOutil('cet outil agit au nom d’une personne', 'forbidden');
      const code = args.code === undefined || args.code === null ? undefined : texteObligatoire(args, 'code', 20);
      const c = await deps.couteux.consommer(tenantId);
      if (!c.accepte) throw refusDuPlafond(c.attenteMs);
      // La même trace que la console (`numero.active`), au nom de la personne.
      const journal = makeJournal(deps.journal);
      const r = await chezMeta(() => deps.prerequis.activer(tenantId, code, async (trace) => {
        if (trace.action === 'numero.active') {
          await journal(tenantId, { auth: { userId: personne.userId } }, trace.action, { kind: 'phone_number', id: trace.phoneNumberId }, {
            verificationFaite: trace.verificationFaite, via: 'mcp',
          });
        }
      }));
      if (!r.ok) throw refusDuCoeur({ statut: r.statut, message: r.error });
      return { actif: true, ...(r.deja ? { deja: true } : {}) };
    },
  },
  {
    ...ficheOutilMcp('contact_support'),
    fonction: null,
    description: 'Writes to the Messaging Me Support team, like the console\'s support form, on behalf of the person: '
      + `sujet (${SUJET_SUPPORT_MAX} characters) and message (${MESSAGE_SUPPORT_MAX}). The server joins the workspace's `
      + 'context itself (the get_setup_state reading: plan, number, agents, responder, warnings) and answers to the '
      + 'person\'s account address. 5 requests per minute at most. Use it when a blocker is the team\'s to solve (a '
      + 'refusal Meta does not explain, a payment), after saying it to the person.',
    annotations: ecriture('Write to Support'),
    entree: {
      type: 'object',
      properties: {
        sujet: { type: 'string', minLength: 1, maxLength: SUJET_SUPPORT_MAX, description: 'The subject of the request.' },
        message: { type: 'string', minLength: 1, maxLength: MESSAGE_SUPPORT_MAX, description: 'What blocks, in the person\'s words.' },
      },
      required: ['sujet', 'message'],
      additionalProperties: false,
    },
    ecran: () => LISTES.accueil,
    async executer(deps: DepsMcp, tenantId, args, personne) {
      if (personne === null) throw new RefusOutil('cet outil agit au nom d’une personne', 'forbidden');
      const sujet = texteObligatoire(args, 'sujet', SUJET_SUPPORT_MAX);
      const message = texteObligatoire(args, 'message', MESSAGE_SUPPORT_MAX);
      const s = deps.prerequis.support;
      if (!s.enabled) throw new RefusOutil('le Support n’est pas joignable d’ici pour le moment', 'unavailable');
      if (!plafondSupport.take(personne.userId)) throw new RefusOutil('trop de demandes au Support : réessaie dans une minute', 'rate_limited');
      // L'adresse de réponse est lue en base depuis la personne, jamais prise des arguments.
      const email = await s.getUserEmail(personne.userId).catch(() => null);
      const prioritaire = await s.prioritaire(tenantId).catch(() => false);
      const contexte = await contexteDeLEspace(deps, tenantId);
      try {
        await s.sendSupport({
          tenantId,
          userId: personne.userId,
          email,
          subject: prioritaire ? `[Prioritaire, Business] ${sujet}` : sujet,
          message: `${message}\n\n---\nÉcrit par Claude au nom de la personne. Contexte de l’espace, joint par le serveur :\n${contexte}`,
        });
      } catch (err) {
        // Journaliser avant de masquer, comme la route : une panne de l'envoi et un bug rendraient sinon le même refus.
        journaliser('error', 'support_send_failed', { tenantId, userId: personne.userId, via: 'mcp', erreur: err });
        throw new RefusOutil('envoi impossible pour le moment, réessaie plus tard', 'unavailable');
      }
      return { envoye: true, reponse_a: email };
    },
  },
];
