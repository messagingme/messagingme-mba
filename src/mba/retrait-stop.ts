import { z } from 'zod';
import type { InboundOptOut } from '../webhooks/inbound';
import type { ListeDeLAgent } from './liste';
import { journaliser } from '../lib/journal';

/**
 * Un STOP fait sortir le contact de la liste de l'agent de Meta, 2 minutes après (2026-11-26, plan
 * `docs/superpowers/plans/2026-11-26-stop-agent-de-meta.md`).
 *
 * Avant, la fiche passait `opted_out` et rien d'autre : un contact confié à l'agent en audience « liste » y restait, et
 * l'agent continuait de lui répondre et de le relancer. Le retrait attend `DELAI_RETRAIT_STOP_MS` : Meta fait taire
 * l'agent dès que le contact sort de sa liste (mesuré le 2026-09-29), et l'agent répond au « Stop » une vingtaine de
 * secondes après (sa consigne STOP, `./consigne-stop.ts`). Retiré à l'instant, le contact perdrait la confirmation ;
 * décision de Julien du même jour. Sans effet en audience « tout le monde », où la liste ne décide pas de qui l'agent
 * entend : là, seule la consigne joue.
 *
 * ⚠️ Limite connue : une conversation confiée de nouveau à l'agent par un opérateur dans ces 2 minutes (« Rendre la
 * main ») en ressortirait. Un geste humain sur un contact qui vient de dire STOP, dans la même minute : accepté.
 */

export const FILE_RETRAIT_STOP = 'mba-retrait-stop';
/** Le temps laissé à l'agent pour confirmer le STOP avant que le retrait ne le fasse taire. */
export const DELAI_RETRAIT_STOP_MS = 2 * 60_000;

const schemaJob = z.object({ tenantId: z.string().min(1), waId: z.string().min(1) });
export type JobRetraitStop = z.infer<typeof schemaJob>;

export interface DepsOptOutEntrant {
  /** L'écriture du refus sur la fiche (`setOptInByWaId`) ; rend le contact touché, `null` sans fiche. */
  desabonner: InboundOptOut;
  /** La liste de l'agent : seule sa lecture `presents` sert ici, le retrait passe par le job. */
  liste: Pick<ListeDeLAgent, 'presents'>;
  /** Enfile le retrait à son heure (`queue.enqueue` avec `startAfter`, groupé par espace). */
  programmer(job: JobRetraitStop, quand: Date): Promise<void>;
  now(): number;
}

/**
 * Le STOP entrant des deux files de réception (`webhook`, `application-entrant`). La fiche d'abord : c'est elle qui
 * arrête nos envois, et une panne de la suite ne doit jamais la faire passer pour ratée (`processInbound` dirait
 * « opt-out ignoré »). Puis, seulement si le contact est sur la liste de l'agent, le retrait programmé ; une lecture ou
 * un enfilement en panne est journalisé, et le contact reste sur la liste, comme avant ce lot.
 */
export function creerOptOutEntrant(deps: DepsOptOutEntrant): InboundOptOut {
  return async (tenantId, waId, messageId) => {
    const touche = await deps.desabonner(tenantId, waId, messageId);
    try {
      if ((await deps.liste.presents(tenantId, [waId])).has(waId)) {
        await deps.programmer({ tenantId, waId }, new Date(deps.now() + DELAI_RETRAIT_STOP_MS));
      }
    } catch (err) {
      journaliser('error', 'retrait_stop_non_programme', { tenantId, waId, err });
    }
    return touche;
  };
}

/**
 * Le job de la file `mba-retrait-stop`. `retirer` journalise un refus de Meta (le contact reste sur la liste) et lève
 * sur une panne de NOTRE table : le job se rejoue alors, sans risque (retirer deux fois ne fait rien de plus).
 */
export async function traiterRetraitStop(liste: Pick<ListeDeLAgent, 'retirer'>, data: unknown): Promise<void> {
  const lu = schemaJob.safeParse(data);
  if (!lu.success) {
    journaliser('error', 'retrait_stop_job_illisible', { erreur: lu.error.issues[0]?.message ?? 'job invalide' });
    return;
  }
  const { tenantId, waId } = lu.data;
  const retire = await liste.retirer(tenantId, waId);
  journaliser(retire ? 'info' : 'warn', 'retrait_stop', { tenantId, waId, retire });
}
