import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { AnnotationsMcp, OutilMcp } from './outils';
import { RefusOutil, texteObligatoire, valeurOuRefus } from './saisie';
import { ecriture, LOURDE, personneRequise, plafondCouteux, signataire } from './outils-agent';
import { proposer } from '../mise-en-ligne/mise-en-ligne';
import { boutonDuOui } from './outils-mise-en-ligne';
import { transcrireVocal, type InboxDep, type InboxRouteDeps } from '../http/inbox';
import { MAX_REPRISE_S, reglerReprise, type ReglagesDep } from '../http/settings';
import { estUuid } from '../http/scope';
import { parCause } from '../inbox/evenements';
import { ECRANS, LISTES } from './ecran';

/**
 * L'INBOX DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 2a, plan
 * `docs/superpowers/plans/2026-11-26-csm-lot1-i-reste-du-lot.md`). 🔴 Aucune logique propre : les marques d'une
 * conversation sont les MÊMES écritures que ses boutons (`archiverConversation`, `signalerConversation`, `marquerUrgente`,
 * `marquerTraitee`, `marquerLue`), signées de qui les demande ; la transcription est celle du bouton (`transcrireVocal`,
 * payée sur le crédit IA, idempotente) ; les réglages de prise et de reprise passent par les MÊMES écritures que l'écran
 * (`setAgentsPeuventPrendre`, `reglerReprise`). Les compteurs de la console, en cache court par copie de l'API, suivent au
 * renouvellement suivant, comme entre deux copies. 🔴 Effacer les messages d'une conversation (livraison 2b) part sur le
 * OUI d'un admin, comme le bouton « Effacer le contenu » lui est réservé : rien ne les rattrape (l'action
 * `effacement_messages` du oui de mise en ligne, `src/mise-en-ligne/envois.ts`).
 */
export interface DepsInboxMcp {
  /** Les marques d'une conversation : le MÊME dépôt que les boutons (`PgInboxStore`, passé entier). */
  marquesConversation: Pick<InboxDep, 'archiverConversation' | 'signalerConversation' | 'marquerUrgente' | 'marquerTraitee'>;
  /** La conversation ouverte comme l'Inbox l'ouvre, dans l'espace : la marquer lue, transcrire un vocal. */
  ouvrirConversation: InboxRouteDeps['ouvrirConversation'];
  /** Les réglages de la prise et de la reprise : le MÊME magasin que l'écran (`PgSettingsStore`, passé entier). */
  reglagesInbox: Pick<ReglagesDep, 'get' | 'setAgentsPeuventPrendre' | 'setControlHandbackSeconds'>;
}

const lecture = (title: string): AnnotationsMcp => ({ title, readOnlyHint: true, openWorldHint: false });
const CONVERSATION = { type: 'string' as const, minLength: 1, maxLength: 100, description: 'The conversation id (list_conversations).' };
const INCONNUE = 'conversation inconnue dans cet espace';

/** Un booléen facultatif : absent, rien ne change (B0d) ; présent, un booléen et rien d'autre. */
function booleen(args: Record<string, unknown>, cle: string): boolean | undefined {
  const v = args[cle];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new RefusOutil(`${cle} : true ou false`, 'invalid_args');
  return v;
}

export const OUTILS_INBOX: OutilMcp[] = [
  {
    ...ficheOutilMcp('update_conversation'),
    fonction: 'inbox',
    description: 'Marks a conversation as the buttons of the conversation screen do: archived (out of the active lists, or '
      + 'back), flagged (for a teammate to look at), urgent (first in the conversations to handle), done (handled; false '
      + 'takes the mark off and the conversation goes back where its last message ranks it; the next message of the '
      + 'contact reopens it anyway), and read: true (its unread badge goes out; there is no unread back). Done and archived '
      + 'take the urgency off, so urgent: true cannot come with them. Only the fields provided change, what is omitted is '
      + 'not touched. Returns the marks set.',
    annotations: ecriture('Update a conversation', true, false),
    entree: {
      type: 'object',
      properties: {
        conversation_id: CONVERSATION,
        archived: { type: 'boolean', description: 'true archives, false brings back.' },
        flagged: { type: 'boolean', description: 'true flags, false removes the flag.' },
        urgent: { type: 'boolean', description: 'true marks urgent, false removes the urgency.' },
        done: { type: 'boolean', description: 'true marks it handled, false takes the mark off.' },
        read: { type: 'boolean', enum: [true], description: 'true marks it read.' },
      },
      required: ['conversation_id'],
      additionalProperties: false,
    },
    ecran: (args) => ECRANS.conversation(args.conversation_id),
    async executer(deps, tenantId, args, personne) {
      const id = texteObligatoire(args, 'conversation_id', 100);
      const archived = booleen(args, 'archived');
      const flagged = booleen(args, 'flagged');
      const urgent = booleen(args, 'urgent');
      const done = booleen(args, 'done');
      const read = booleen(args, 'read');
      if (read === false) throw new RefusOutil('read : true seulement (une conversation ne redevient pas non lue)', 'invalid_args');
      if (archived === undefined && flagged === undefined && urgent === undefined && done === undefined && read === undefined) {
        throw new RefusOutil('rien à changer : archived, flagged, urgent, done ou read', 'invalid_args');
      }
      // Traité et Archivé lèvent l'urgence (`basculerRangement`) : la poser avec eux la lèverait aussitôt, ou la laisserait
      // sur une conversation rangée, qui remonterait en tête au prochain message pour une raison périmée (décision 0216).
      if (urgent === true && (done === true || archived === true)) {
        throw new RefusOutil('urgent : Traité et Archivé lèvent l’urgence, elle ne se pose pas avec eux', 'invalid_args');
      }
      // `estUuid` avant la base, comme les routes : un identifiant mal formé ferait lever Postgres.
      if (!estUuid(id)) throw new RefusOutil(INCONNUE, 'not_found');
      // L'auteur, comme `assign_conversation` : la personne du jeton, ou la cause pour une clé (un agent tiers).
      const par = personne ? { collaborateur: personne.userId } : parCause('agent tiers (MCP)');
      const m = deps.marquesConversation;
      const ecrire = async (ok: Promise<boolean>): Promise<void> => {
        if (!(await ok)) throw new RefusOutil(INCONNUE, 'not_found');
      };
      if (archived !== undefined) await ecrire(m.archiverConversation(tenantId, id, archived, par));
      if (flagged !== undefined) await ecrire(m.signalerConversation(tenantId, id, flagged, par));
      if (urgent !== undefined) await ecrire(m.marquerUrgente(tenantId, id, urgent, par));
      if (done !== undefined) await ecrire(m.marquerTraitee(tenantId, id, done, par));
      if (read === true) {
        const conversation = await deps.ouvrirConversation(tenantId, id);
        if (!conversation) throw new RefusOutil(INCONNUE, 'not_found');
        await conversation.marquerLue();
      }
      return {
        conversation_id: id,
        ...(archived === undefined ? {} : { archived }), ...(flagged === undefined ? {} : { flagged }),
        ...(urgent === undefined ? {} : { urgent }), ...(done === undefined ? {} : { done }), ...(read === true ? { read } : {}),
      };
    },
  },
  {
    ...ficheOutilMcp('transcribe_message'),
    fonction: 'inbox',
    description: 'Transcribes the voice message of a message (get_messages gives its id), as the button of the conversation '
      + 'screen does, and translates it into French or English if asked. Paid from the workspace AI credit, like in the '
      + 'console: the transcript once, asked again it is not paid twice; a translation into another language than the last '
      + 'one is paid again. ' + LOURDE,
    annotations: ecriture('Transcribe a voice message', true, true),
    entree: {
      type: 'object',
      properties: {
        conversation_id: CONVERSATION,
        message_id: { type: 'string', minLength: 1, maxLength: 36, description: 'The message id (get_messages).' },
        translate_to: { type: 'string', enum: ['fr', 'en'], description: 'Translate the transcript into this language.' },
      },
      required: ['conversation_id', 'message_id'],
      additionalProperties: false,
    },
    ecran: (args) => ECRANS.conversation(args.conversation_id),
    async executer(deps, tenantId, args) {
      const id = texteObligatoire(args, 'conversation_id', 100);
      const message = texteObligatoire(args, 'message_id', 36);
      // `estUuid` avant la base : un identifiant de conversation mal formé ferait lever Postgres, donc un échec interne.
      if (!estUuid(id)) throw new RefusOutil(INCONNUE, 'not_found');
      // Le serveur ne valide pas les énumérations : une autre langue ferait payer sans rien traduire, sans le dire.
      const langue = args.translate_to;
      if (langue !== undefined && langue !== 'fr' && langue !== 'en') throw new RefusOutil('translate_to : fr ou en', 'invalid_args');
      await plafondCouteux(deps, tenantId);
      const r = await transcrireVocal(deps, tenantId, id, message, langue);
      if (!r.ok) throw new RefusOutil(typeof r.corps.error === 'string' ? r.corps.error : 'transcription refusée', r.famille);
      return r.valeur;
    },
  },
  {
    ...ficheOutilMcp('erase_conversation_messages'),
    fonction: 'inbox',
    description: 'Prepares the erasure of all the messages of a conversation, received and sent, for good: nothing brings '
      + 'them back. Nothing is erased until an administrator clicks the button of the go_live link in the console, after '
      + 'reading how many messages go. The conversation stays in the inbox, empty; with no message from the contact left, '
      + 'the 24-hour window closes until they write again. The click reads again that the conversation still has the same '
      + 'number of messages. get_go_live with go_live_id then tells what was done.',
    annotations: ecriture('Erase the messages of a conversation', false, false),
    entree: {
      type: 'object',
      properties: { conversation_id: CONVERSATION },
      required: ['conversation_id'],
      additionalProperties: false,
    },
    ecran: (args) => ECRANS.conversation(args.conversation_id),
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const id = texteObligatoire(args, 'conversation_id', 100);
      // 🔴 Au oui : rien ne rattrape un effacement. L'outil prépare (le relevé refuse un identifiant mal formé avant la
      // base), l'admin clique.
      const oui = valeurOuRefus(await proposer(
        deps.misesEnLigne, tenantId, personneRequise(personne), [{ type: 'effacement_messages', conversation: id }],
      ));
      return {
        go_live: boutonDuOui(oui),
        a_savoir: `Rien n’est effacé : un administrateur clique « ${oui.libelle} » dans la console, après avoir lu ce qui part. `
          + 'Après le clic, get_go_live avec go_live_id dit ce qui a été fait.',
      };
    },
  },
  {
    ...ficheOutilMcp('get_inbox_settings'),
    fonction: 'inbox',
    description: 'Who can take a conversation from the shared pool (agents_can_take: an agent can assign themself a '
      + 'conversation nobody has; never reassign one), and the handback delay (handback_seconds: how long scenarios and '
      + 'Meta\'s agent stay silent after a person takes over; 0: never automatically, null: the server default). The '
      + 'delay is shown in the console with the settings of Meta\'s agent (Business and Enterprise), not in a Pro workspace.',
    annotations: lecture('Read the inbox settings'),
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps, tenantId) {
      const r = await deps.reglagesInbox.get(tenantId);
      return { agents_can_take: r.agentsPeuventPrendre, handback_seconds: r.controlHandbackSeconds };
    },
  },
  {
    ...ficheOutilMcp('update_inbox_settings'),
    fonction: 'inbox',
    description: 'Sets who can take a conversation from the shared pool (agents_can_take) and the handback delay '
      + '(handback_seconds: 0 to 604800, 0 for never automatically, null for the server default), as the settings screens '
      + 'do. Only the fields provided change, what is omitted is not touched. Returns both settings.',
    annotations: ecriture('Update the inbox settings', true, false),
    entree: {
      type: 'object',
      properties: {
        agents_can_take: { type: 'boolean', description: 'true: an agent can take a conversation nobody has.' },
        handback_seconds: { type: ['integer', 'null'], minimum: 0, maximum: MAX_REPRISE_S, description: 'Seconds; 0: never automatically; null: the server default.' },
      },
      additionalProperties: false,
    },
    ecran: () => LISTES.parametres,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const prendre = booleen(args, 'agents_can_take');
      if (prendre === undefined && args.handback_seconds === undefined) {
        throw new RefusOutil('rien à changer : agents_can_take ou handback_seconds', 'invalid_args');
      }
      if (args.handback_seconds !== undefined) {
        const r = await reglerReprise(deps.reglagesInbox, tenantId, args.handback_seconds);
        if (!r.ok) throw new RefusOutil(r.erreur, 'invalid_args');
      }
      if (prendre !== undefined) await deps.reglagesInbox.setAgentsPeuventPrendre(tenantId, prendre);
      const apres = await deps.reglagesInbox.get(tenantId);
      return { agents_can_take: apres.agentsPeuventPrendre, handback_seconds: apres.controlHandbackSeconds };
    },
  },
];
