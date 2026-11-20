import type { WebhookEvent } from './parse';
import { extraireTarif, type TarifsMetaSink } from './tarif-meta';
import type { AjustementCreditSink } from '../credit-whatsapp/ajustement';
import { asRecord } from './json';
import { tenter } from '../lib/tenter';
import { messageDe } from '../lib/erreur';

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface DeliveryStore {
  /**
   * Met à jour le statut de livraison d'un destinataire par message_id, et celui du message lui-même (`le` : l'instant
   * de l'accusé selon Meta, migration 0225). Retourne le nb de destinataires de campagne touchés.
   */
  updateDeliveryByMessageId(messageId: string, status: DeliveryStatus, error: string | null, errorCode: number | null, le: string | null): Promise<number>;
}

const VALID = new Set<DeliveryStatus>(['sent', 'delivered', 'read', 'failed']);

/** Code d'erreur Meta numérique depuis `errors[0].code` (number, ou string de chiffres). null sinon. */
function numericCode(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

/**
 * Extrait (messageId, status, error, errorCode) d'un objet statut Meta, ou null si inexploitable
 * (ex. statut d'un message entrant non issu d'une campagne, ou champ absent). `error` = texte aplati
 * `"<code> <titre>"` (affichage), `errorCode` = le code numérique isolé (breakdown analytics).
 */
export function extractDelivery(
  data: unknown,
): { messageId: string; status: DeliveryStatus; error: string | null; errorCode: number | null } | null {
  if (!data || typeof data !== 'object') return null;
  const s = data as { id?: unknown; status?: unknown; errors?: unknown };
  if (typeof s.id !== 'string' || typeof s.status !== 'string' || !VALID.has(s.status as DeliveryStatus)) {
    return null;
  }
  let error: string | null = null;
  let errorCode: number | null = null;
  if (Array.isArray(s.errors) && s.errors.length > 0) {
    const e = s.errors[0] as { code?: unknown; title?: unknown; message?: unknown };
    errorCode = numericCode(e.code);
    const parts = [e.code, e.title ?? e.message].filter((x) => x !== undefined && x !== null).map(String);
    error = parts.join(' ').trim() || null;
  }
  return { messageId: s.id, status: s.status as DeliveryStatus, error, errorCode };
}

/**
 * Ce que la remontée des signaux reçoit d'un accusé. Best-effort et gratuit par défaut : ce chemin traite chaque
 * accusé de la plateforme, le puits décide lui-même de ne rien lire, et il ne fait jamais échouer le traitement
 * d'une livraison.
 */
export interface AccuseDuStatut {
  messageId: string;
  status: DeliveryStatus;
  /** Le destinataire tel que Meta le nomme (`recipient_id`) : numéro en chiffres nus, ou BSUID. */
  waId: string | null;
  motif: string | null;
  codeMeta: number | null;
  /** L'instant daté par Meta (`timestamp`), en ISO ; `null` s'il manque. La file des accusés peut avoir du retard. */
  le: string | null;
}
export type SignalAccuse = (phoneNumberId: string, accuse: AccuseDuStatut) => Promise<void>;

/** Le destinataire d'un statut Meta, ou `null`. Ne lève jamais. */
export function destinataireDuStatut(data: unknown): string | null {
  const r = asRecord(data)['recipient_id'];
  return typeof r === 'string' && r.trim() !== '' ? r : null;
}

/** Le dernier instant Unix que l'on accepte (an 9999) : au-delà, `toISOString` lève, ou rend une année que Postgres refuse. */
const INSTANT_MAX_S = 253402300799;

/**
 * L'instant d'un statut Meta (secondes Unix), en ISO, ou `null`. Ne lève jamais : il est appelé hors de tout `try` sur
 * le chemin des accusés (le statut du message, migration 0225), et une exception y ferait rejouer le job entier.
 */
export function instantDuStatut(data: unknown): string | null {
  const brut = asRecord(data)['timestamp'];
  const secondes = typeof brut === 'string' || typeof brut === 'number' ? Number(brut) : Number.NaN;
  return Number.isFinite(secondes) && secondes > 0 && secondes <= INSTANT_MAX_S ? new Date(secondes * 1000).toISOString() : null;
}

/**
 * Rattache un accusé Meta au bloc de scénario qui a envoyé ce message (« Mes tableaux »). Optionnel ; un
 * identifiant qui n'appartient à aucun envoi de scénario ne crée rien.
 */
export interface NodeStatusSink {
  recordStatusForMessage(metaMessageId: string, kind: 'delivered' | 'read' | 'failed'): Promise<number>;
}
/** La clôture du parcours d'événement né sur un message que Meta n'a pas livré (lot 5). Rend le nombre de parcours clos. */
export interface ParcoursSurEchecSink {
  clorePremierNonLivre(metaMessageId: string): Promise<number>;
}

/**
 * L'accusé d'un template de scénario dont la sortie « En cas d'échec » est branchée (Julien, 2026-11-20) : le parcours qui
 * l'attend repart, par cette sortie sur `failed`, par sa suite sur `delivered` ou `read`. Implémenté par
 * `creerLivraisonTemplates` (`src/workflow/livraison-template.ts`) ; un message hors scénario ne coûte qu'une lecture.
 */
export interface LivraisonTemplatesSink {
  surAccuse(metaMessageId: string, status: 'delivered' | 'read' | 'failed'): Promise<void>;
}

/**
 * La remise du fil à l'agent de Meta, déclenchée par l'accusé de notre dernier envoi. Envoyer un message prend
 * le fil implicitement : relâcher dans la foulée d'un envoi relâcherait un fil que cet envoi reprend. Seul
 * l'accusé dit que Meta a fini de traiter l'envoi (il arrive en une seconde ; un retard vient de notre file).
 * Appelée pour chaque statut : l'implémentation rend la main tout de suite quand aucun fil n'attend ce message.
 * Optionnelle : sans elle, le balayage de contrôle rend les fils plus tard.
 */
export interface RemiseMbaSurAccuse {
  (messageId: string): Promise<void>;
}

/**
 * L'échec d'un message libre. Appelé seulement sur un `failed` qui n'a touché aucun destinataire de campagne
 * (dont la ligne porte déjà l'échec) : un statut ordinaire ne coûte aucune requête de plus. Implémenté par
 * `PgEchecsMessagesStore` (`src/delivery/echecs-messages.pg.ts`).
 */
export interface EchecsLibresSink {
  noter(e: { messageId: string; code: number | null; motif: string | null; tenantId?: string }): Promise<unknown>;
}

/**
 * Les puits secondaires d'un accusé, ce que `processStatuses` fait en plus de la livraison. 🔴 `tarifs` est
 * obligatoire : un puits qu'on peut omettre est un puits qu'on oublie ; un appel qui ne mesure pas les tarifs
 * le dit avec la fixture `aucunTarif` (`tests/webhook-fixtures.ts`).
 */
export interface PuitsAccuses {
  tarifs: TarifsMetaSink;
  /** Obligatoire aussi, pour la même raison ; les tests qui n'en parlent pas passent `aucunEchecLibre`. */
  echecsLibres: EchecsLibresSink;
  /**
   * Obligatoire aussi : la provision du Crédit WhatsApp se corrige à l'accusé, et un câblage qui l'oublierait
   * débiterait les échecs et les messages offerts jusqu'à la régularisation ; les tests passent `aucunAjustementCredit`.
   */
  ajustementCredit: AjustementCreditSink;
  nodeEvents?: NodeStatusSink;
  remiseMba?: RemiseMbaSurAccuse;
  /**
   * Lot 5 : un accusé `failed` clôt le parcours d'événement né sur ce message, s'il n'a pas quitté son bloc de départ
   * (`PgWorkflowRunStore.clorePremierNonLivre`). Le parcours naît quand Meta ACCEPTE le template ; non livré, il ne doit
   * ni garder la place du contact, ni empêcher une nouvelle tentative d'envoi de le faire renaître. Best-effort, comme
   * la mesure des blocs.
   */
  parcours?: ParcoursSurEchecSink;
  /** La sortie « En cas d'échec » des templates de scénario. Best-effort, comme la mesure des blocs. */
  livraisonTemplates?: LivraisonTemplatesSink;
  /** Les signaux ; requis au niveau du handler, seul appelant de production. */
  signaux?: SignalAccuse;
}

/**
 * Applique les événements de statut aux destinataires (par message_id), et ignore le reste. `nodeEvents` reçoit
 * le même statut pour la mesure par bloc, sauf `sent`, déjà compté par l'exécuteur à l'envoi. Best-effort sur la
 * mesure : une panne de compteur n'empêche pas la mise à jour d'une livraison. Les puits secondaires voyagent
 * dans `puits`, nommés et jamais positionnels.
 */
export async function processStatuses(
  events: WebhookEvent[],
  delivery: DeliveryStore,
  puits: PuitsAccuses,
): Promise<void> {
  const { tarifs, echecsLibres, ajustementCredit, nodeEvents, remiseMba, signaux, parcours, livraisonTemplates } = puits;
  for (const ev of events) {
    if (ev.source !== 'statuses') continue;
    const d = extractDelivery(ev.data);
    /**
     * Le tarif de Meta (`./tarif-meta.ts`), lu avant la garde de livraison : un statut que la livraison ignore peut
     * porter un tarif. Best-effort : une exception ferait rejouer tout le job ; un tarif manqué laisse le message
     * compté comme payant.
     */
    if (ev.phoneNumberId) {
      const t = extraireTarif(ev.data);
      if (t) {
        try {
          await tarifs.enregistrer(ev.phoneNumberId, t);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('tarif Meta non enregistré:', messageDe(err));
        }
      }
      /**
       * Le Crédit WhatsApp (`../credit-whatsapp/ajustement.ts`) : le tarif et le statut corrigent la provision du
       * message, au mieux (un ajustement manqué attend la régularisation). Un numéro hors de la ligne de crédit n'y
       * coûte qu'une lecture en cache.
       */
      const numero = ev.phoneNumberId;
      const wamid = t?.messageId ?? d?.messageId;
      if (wamid !== undefined) {
        await tenter('ajustement de la ligne de crédit ignoré:', () =>
          ajustementCredit.ajuster(numero, { wamid, tarif: t, statut: d?.status ?? null, livreLe: instantDuStatut(ev.data) }));
      }
    }
    if (!d) continue;
    /**
     * La sortie « En cas d'échec » d'un template de scénario, EN PREMIER : avant la livraison, pour que le destinataire de
     * campagne qui porte le même message sorte des relances avant que son échec ne soit écrit (un balayage pourrait le
     * relancer entre les deux) ; avant la remise du fil à l'agent de Meta, qui gèlerait la suite du parcours ; avant la
     * clôture du parcours d'événement non livré, que cette sortie reprend au lieu de le clore.
     */
    if (livraisonTemplates && d.status !== 'sent') {
      const statut = d.status;
      await tenter('accusé de template de scénario ignoré:', () => livraisonTemplates.surAccuse(d.messageId, statut));
    }
    // `le` : l'instant de l'accusé selon Meta, que le statut du message garde (`statut_le`, migration 0225).
    const touches = await delivery.updateDeliveryByMessageId(d.messageId, d.status, d.error, d.errorCode, instantDuStatut(ev.data));
    /**
     * L'échec d'un message libre (réponse d'Inbox, message d'API ou de bloc) : il ne touche aucun destinataire de
     * campagne (`touches` vaut 0), seul cas qui paie une requête de plus. Best-effort : une exception ferait
     * rejouer tout le job pour un journal.
     */
    if (d.status === 'failed' && touches === 0) {
      await tenter('échec de message libre non journalisé:', () => echecsLibres.noter({ messageId: d.messageId, code: d.errorCode, motif: d.error }));
    }
    /**
     * Tous les statuts, pas seulement `sent` ni les succès : on attend la preuve que Meta a fini de traiter l'envoi,
     * et un `failed` la porte aussi. Plusieurs statuts arrivent pour un même message : la consommation atomique en
     * base fait qu'un seul déclenche la remise. Best-effort : une remise ratée est rattrapée par le balayage, alors
     * qu'une exception ferait rejouer tout le job.
     */
    if (remiseMba) {
      await tenter('remise du fil à l’agent de Meta ignorée:', () => remiseMba(d.messageId));
    }
    // Lot 5 : le premier message d'un parcours d'événement non livré clôt ce parcours (best-effort).
    if (parcours && d.status === 'failed') {
      await tenter('parcours d’événement non clos après l’échec de son premier message:', () => parcours.clorePremierNonLivre(d.messageId));
    }
    if (nodeEvents && d.status !== 'sent') {
      try {
        await nodeEvents.recordStatusForMessage(d.messageId, d.status);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('mesure de bloc (statut) ignorée:', messageDe(err));
      }
    }
    // Les signaux, en dernier et isolés : ils ne décident de rien pour la livraison, et le puits ne lit rien quand
    // personne n'écoute.
    if (signaux && ev.phoneNumberId) {
      try {
        await signaux(ev.phoneNumberId, {
          messageId: d.messageId,
          status: d.status,
          waId: destinataireDuStatut(ev.data),
          motif: d.error,
          codeMeta: d.errorCode,
          le: instantDuStatut(ev.data),
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('signal d’accusé ignoré:', messageDe(err));
      }
    }
  }
}
