import { z } from 'zod';
import { journaliser } from '../lib/journal';
import { TYPE_MESSAGE_SANS_SUITE, type EvenementAgent } from './evenement';

/**
 * L'ISSUE D'UN ÉVÉNEMENT ENVOYÉ À L'AGENT DE META, RELUE APRÈS COUP, ET UNE RELANCE SUR UNE PANNE DE META
 * (plan `docs/superpowers/plans/2026-11-10-relance-evenement-agent.md`).
 *
 * Le `POST agent_event` rend `accepted` et rien d'autre : Meta traite ensuite, et seul un `GET` dit l'issue. Mesuré le
 * 2026-11-10 sur MUTAC : un `message_sans_suite` accepté, traité dix secondes, puis `failed` sur
 * `internal_server_error` ; le client n'a rien reçu jusqu'à son message suivant. On relit donc l'issue 20 s après,
 * et une panne passagère de Meta fait renvoyer l'événement UNE fois.
 *
 * 🔴 LE RENVOI NE DOIT JAMAIS FAIRE ÉCRIRE L'AGENT DEUX FOIS. Trois gardes, relues juste avant : le fil est toujours à
 * l'agent (`mba`), le client n'a rien écrit depuis l'envoi (sinon l'agent répond à ce message-là), l'agent n'a rien
 * écrit depuis (sinon il a répondu malgré le statut). Les deux dernières comparent des IDENTIFIANTS de message relevés
 * à l'envoi, jamais deux horloges. Un renvoi est lui-même relu, mais jamais renvoyé : son échec, comme une cause qui
 * ne passera pas mieux, fait passer la conversation à l'équipe (le filet, `CAUSE_FILET`).
 */

export const FILE_ISSUE_EVENEMENT = 'agent-evenement-issue';
/** Meta a traité l'événement mesuré en dix secondes : 20 s laissent la marge, sans faire attendre le client. */
export const DELAI_LECTURE_MS = 20_000;
/** Un événement encore en vol, ou une lecture en panne, se relit ; trois lectures en tout. */
export const LECTURES_MAX = 3;
/** Les seuls événements relancés : ceux qui portent un message du client auquel l'agent doit répondre. */
export const TYPES_RELANCABLES: ReadonlySet<string> = new Set([TYPE_MESSAGE_SANS_SUITE]);
/** Les causes d'échec passagères de la liste de Meta ; les autres (audience, fil, contenu, facturation) ne passent pas mieux au second essai. */
export const CAUSES_PASSAGERES: ReadonlySet<string> = new Set(['internal_server_error', 'agent_temporarily_unavailable']);

const schemaJob = z.object({
  tenantId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  waId: z.string().min(1),
  agentEventId: z.string().min(1),
  evenement: z.object({ type: z.string().min(1), description: z.string(), payload: z.string() }),
  /** Le dernier message du client et celui de l'agent à l'envoi (`null` : aucun). */
  dernierDuClient: z.string().nullable(),
  dernierDeLAgent: z.string().nullable(),
  lecture: z.number().int().min(1),
  /** Ce job relit un RENVOI : son échec ne se renvoie pas. */
  renvoi: z.boolean(),
});
export type JobIssue = z.infer<typeof schemaJob>;

/** La réponse du `GET`, validée : un statut inconnu reste lisible (la liste de Meta n'est pas fermée). */
const schemaStatut = z.object({
  status: z.string(),
  error_message: z.string().nullish(),
  skipped_reason: z.string().nullish(),
});

const schemaAccepte = z.object({ agent_event_id: z.string().min(1) });

export interface DepsIssueEvenement {
  /** Enfile la lecture à son heure (`queue.enqueue` avec `startAfter`, groupée par espace). */
  programmer(job: JobIssue, quand: Date): Promise<void>;
  /** Le `GET` de l'événement, brut ; lève sur un refus ou une panne de Meta. */
  lireStatut(tenantId: string, phoneNumberId: string, agentEventId: string): Promise<unknown>;
  /** Le `POST` de l'événement, brut. */
  envoyer(tenantId: string, phoneNumberId: string, waId: string, evenement: EvenementAgent): Promise<unknown>;
  /**
   * Le filet : passer la conversation à l'équipe, dans « À traiter » (`ControleDuFil.prendrePourLEquipe`). `false` :
   * Meta a refusé de retirer le contact de la liste de son agent.
   */
  passerALEquipe(tenantId: string, waId: string, cause: string): Promise<boolean>;
  inbox: {
    getControlOwner(tenantId: string, waId: string): Promise<string>;
    dernierMessageDuClient(tenantId: string, waId: string): Promise<string | null>;
    dernierMessageDeLAgent(tenantId: string, waId: string): Promise<string | null>;
  };
  maintenant?(): Date;
}

const plusTard = (deps: DepsIssueEvenement): Date => new Date((deps.maintenant?.() ?? new Date()).getTime() + DELAI_LECTURE_MS);

/**
 * Appelé juste après un `POST agent_event` réussi : programme la lecture de son issue, pour un événement relançable
 * qui porte un identifiant. Ne lève JAMAIS : l'événement est parti, une lecture perdue ne doit pas faire échouer la
 * remise de la conversation qui l'a envoyé.
 */
export async function programmerLecture(
  deps: DepsIssueEvenement,
  tenantId: string, phoneNumberId: string, waId: string, evenement: EvenementAgent, reponse: unknown,
  renvoi = false,
): Promise<void> {
  if (!TYPES_RELANCABLES.has(evenement.type)) return;
  const accepte = schemaAccepte.safeParse(reponse);
  if (!accepte.success) {
    journaliser('warn', 'agent_event_sans_identifiant', { tenantId, waId, type: evenement.type });
    return;
  }
  try {
    const [dernierDuClient, dernierDeLAgent] = await Promise.all([
      deps.inbox.dernierMessageDuClient(tenantId, waId),
      deps.inbox.dernierMessageDeLAgent(tenantId, waId),
    ]);
    await deps.programmer({
      tenantId, phoneNumberId, waId, agentEventId: accepte.data.agent_event_id,
      evenement: { type: evenement.type, description: evenement.description, payload: evenement.payload },
      dernierDuClient, dernierDeLAgent, lecture: 1, renvoi,
    }, plusTard(deps));
  } catch (err) {
    journaliser('error', 'agent_event_lecture_non_programmee', { err, tenantId, waId, agentEventId: accepte.data.agent_event_id });
  }
}

/**
 * Le job de la file `agent-evenement-issue`. Lève seulement si NOTRE base lève AVANT le renvoi (le job se rejoue
 * alors sans risque) ; tout ce qui suit le renvoi est rattrapé, pour qu'un rejeu ne renvoie jamais deux fois.
 */
export async function traiterIssueEvenement(deps: DepsIssueEvenement, data: unknown): Promise<void> {
  const lu = schemaJob.safeParse(data);
  if (!lu.success) {
    journaliser('error', 'agent_event_issue_job_illisible', { erreur: lu.error.issues[0]?.message ?? 'job invalide' });
    return;
  }
  const job = lu.data;
  const trace = { tenantId: job.tenantId, waId: job.waId, agentEventId: job.agentEventId, type: job.evenement.type, renvoi: job.renvoi };

  let brut: unknown;
  try {
    brut = await deps.lireStatut(job.tenantId, job.phoneNumberId, job.agentEventId);
  } catch (err) {
    // Un 404 juste après le POST peut n'être qu'une latence de Meta (doc) : relu comme un événement en vol.
    return relire(deps, job, trace, `lecture refusée : ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
  }
  const statut = schemaStatut.safeParse(brut);
  if (!statut.success) return relire(deps, job, trace, 'réponse illisible');
  const { status, error_message: cause, skipped_reason: raison } = statut.data;
  if (status === 'request_received' || status === 'processing') return relire(deps, job, trace, status);

  journaliser(status === 'failed' ? 'warn' : 'info', 'agent_event_issue', { ...trace, status, cause: cause ?? null, raison: raison ?? null, lecture: job.lecture });
  if (status !== 'failed') return;

  // Les gardes, relues maintenant : ni renvoi ni filet si quelqu'un a parlé depuis ou que le fil n'est plus à l'agent.
  const [detenteur, dernierDuClient, dernierDeLAgent] = await Promise.all([
    deps.inbox.getControlOwner(job.tenantId, job.waId),
    deps.inbox.dernierMessageDuClient(job.tenantId, job.waId),
    deps.inbox.dernierMessageDeLAgent(job.tenantId, job.waId),
  ]);
  const empechement = detenteur !== 'mba' ? `le fil est à ${detenteur}`
    : dernierDuClient !== job.dernierDuClient ? 'le client a écrit depuis'
      : dernierDeLAgent !== job.dernierDeLAgent ? 'l’agent a écrit depuis'
        : null;
  if (empechement !== null) {
    journaliser('info', 'agent_event_non_renvoye', { ...trace, empechement });
    return;
  }

  if (!job.renvoi && CAUSES_PASSAGERES.has(cause ?? '')) {
    try {
      const reponse = await deps.envoyer(job.tenantId, job.phoneNumberId, job.waId, job.evenement);
      journaliser('info', 'agent_event_renvoye', { ...trace });
      await programmerLecture(deps, job.tenantId, job.phoneNumberId, job.waId, job.evenement, reponse, true);
      return;
    } catch (err) {
      journaliser('error', 'agent_event_renvoi_refuse', { ...trace, err });
    }
  }
  await filet(deps, job, trace);
}

/**
 * L'échec est définitif (renvoi échoué ou refusé, cause qui ne passera pas mieux) : le client attend une réponse que
 * l'agent ne donnera pas. Mesuré le 2026-11-10 sur MUTAC : après des messages en texte libre de notre scénario, Meta
 * met en échec TOUT événement (`internal_server_error`), renvoi compris, jusqu'à ce que le client réécrive. La
 * conversation passe donc à l'équipe, dans « À traiter », pour qu'un humain réponde. Ne lève pas.
 */
export const CAUSE_FILET = 'automatique : l’agent de Meta n’a pas pu répondre (échec chez Meta)';

async function filet(deps: DepsIssueEvenement, job: JobIssue, trace: Record<string, unknown>): Promise<void> {
  try {
    const pris = await deps.passerALEquipe(job.tenantId, job.waId, CAUSE_FILET);
    journaliser(pris ? 'warn' : 'error', pris ? 'agent_event_filet_equipe' : 'agent_event_filet_refuse', { ...trace });
  } catch (err) {
    journaliser('error', 'agent_event_filet_refuse', { ...trace, err });
  }
}

/** Encore en vol, ou illisible pour l'instant : une lecture de plus, tant qu'il en reste. Ne lève pas. */
async function relire(deps: DepsIssueEvenement, job: JobIssue, trace: Record<string, unknown>, etat: string): Promise<void> {
  if (job.lecture >= LECTURES_MAX) {
    journaliser('warn', 'agent_event_sans_issue', { ...trace, etat, lecture: job.lecture });
    return;
  }
  try {
    await deps.programmer({ ...job, lecture: job.lecture + 1 }, plusTard(deps));
  } catch (err) {
    journaliser('error', 'agent_event_lecture_non_programmee', { ...trace, err });
  }
}
