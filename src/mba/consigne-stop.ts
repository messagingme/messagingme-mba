import { z } from 'zod';
import type { Skill } from './client';
import { journaliser } from '../lib/journal';

/** La réponse de Meta, relue : une liste ; une entrée sans titre lisible ne compte pour aucun titre. */
const listeLue = z.array(z.unknown());
const titreDe = z.object({ title: z.string() });

/**
 * La consigne STOP de l'agent de Meta (2026-11-26, plan `docs/superpowers/plans/2026-11-26-stop-agent-de-meta.md`).
 *
 * 🔴 NOTRE DÉSABONNEMENT NE FAIT PAS TAIRE L'AGENT. Quand Meta lui envoie les messages libres (routage de Business Suite,
 * audience « tout le monde »), l'agent reçoit le « Stop » en même temps que nous et y répond seul. Vécu chez MUTAC : un
 * contact désabonné chez nous s'est vu proposer un conseiller, parce qu'une consigne de l'espace en exigeait un à chaque
 * réponse. La consigne est le seul levier qui joue AVANT sa réponse ; le retrait de la liste (`./retrait-stop.ts`) ne
 * vient qu'après, et seulement en audience « liste ».
 *
 * La plateforme la pose à chaque allumage (`ecrireRollout`), si l'agent n'a aucune consigne de ce titre. Elle reste une
 * consigne de l'espace : modifiable et supprimable dans l'onglet « Consignes », reposée seulement au prochain allumage.
 */
export const CONSIGNE_STOP: Skill = {
  title: 'arret-des-messages',
  description: 'Quand la personne demande à ne plus recevoir de messages : STOP, stop, arrêt, désabonnement, « ne me contactez plus ». '
    + 'Cette consigne passe avant toutes les autres.',
  skill: 'La personne demande à ne plus recevoir de messages (STOP, arrêt, désabonnement, « ne me contactez plus »).\n'
    + '1. Réponds uniquement, mot pour mot : « Votre demande de ne plus recevoir de messages sur WhatsApp est bien prise en compte. '
    + 'Vous ne recevrez plus de communications de notre part. »\n'
    + '2. N’ajoute rien d’autre : pas de proposition de conseiller ni de rendez-vous, pas de question, pas de lien, pas de message '
    + 'à boutons, et ne passe pas la main.\n'
    + '3. Cette consigne passe avant toutes les autres.',
};

/** Ce que la pose demande au client MBA (`MbaClient`, ou le sous-ensemble de l'assistant). */
export interface ClientConsigneStop {
  listSkills(phoneNumberId: string, agentId: string): Promise<Skill[]>;
  createSkill(phoneNumberId: string, agentId: string, skill: Skill): Promise<unknown>;
}

/** `deja_la` : une consigne porte déjà ce titre, celle du client comprise, qui n'est jamais réécrite. */
export type IssueConsigneStop = 'posee' | 'deja_la' | 'sans_agent' | 'echec';

/**
 * Pose la consigne si l'agent n'en a aucune de ce titre. `agentId` : la configuration que l'allumage vient d'écrire
 * (sans lui, Meta écrirait sous « les réglages les plus récents », peut-être pas les bons). Ne lève JAMAIS : l'agent est
 * déjà allumé chez Meta quand on l'appelle, et un échec ici ne doit pas faire passer l'allumage pour raté ; il est
 * journalisé. Une liste illisible ne crée rien : on ne pose pas une seconde consigne sur une lecture ratée.
 */
export async function poserConsigneStop(
  client: ClientConsigneStop,
  phoneNumberId: string,
  agentId: string | undefined,
): Promise<IssueConsigneStop> {
  if (!agentId) {
    journaliser('warn', 'consigne_stop_sans_agent', { phoneNumberId });
    return 'sans_agent';
  }
  try {
    const lu = listeLue.safeParse(await client.listSkills(phoneNumberId, agentId));
    if (!lu.success) throw new Error('liste des consignes illisible');
    if (lu.data.some((c) => titreDe.safeParse(c).data?.title.trim().toLowerCase() === CONSIGNE_STOP.title)) return 'deja_la';
    await client.createSkill(phoneNumberId, agentId, CONSIGNE_STOP);
    journaliser('info', 'consigne_stop_posee', { phoneNumberId, agentId });
    return 'posee';
  } catch (err) {
    journaliser('error', 'consigne_stop_non_posee', { phoneNumberId, agentId, err });
    return 'echec';
  }
}
