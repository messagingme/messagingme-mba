import { z } from 'zod';
import { messageDe } from '../lib/erreur';
import { journaliser } from '../lib/journal';
import type { LigneDeLaListe, ListeDeLAgent } from '../mba/liste';

/**
 * LA FICHE NÉE D'UN ENVOI SHOPIFY, SUPPRIMÉE AU PREMIER 131026 (segments Shopify enrichis, lot 2a, plan
 * `docs/superpowers/plans/2026-11-23-segments-shopify-lot-2-numeros.md`).
 *
 * Un message de commande ou de panier crée la fiche de son destinataire AVANT de savoir s'il est sur WhatsApp ; un numéro
 * qui ne l'est pas laissait une fiche morte, comptée dans la limite de contacts de l'offre. Au premier accusé `failed` de
 * code 131026, l'accusé (`processStatuses`) enfile ce job, et le job supprime la fiche : la place revient.
 *
 * 🔴 DÉCISION DE JULIEN DU 2026-11-23 : seulement une fiche NÉE D'UN ENVOI SHOPIFY (`contacts.nee_de`) et qui n'a JAMAIS
 * ÉCRIT ; depuis le lot 5b (2026-11-24), aussi celle que le rattrapage des commandes a créée pour un acheteur, marquée de
 * même. Une fiche importée, saisie ou qui a écrit reste : le repli d'une campagne (RCS, e-mail) et la sortie « En cas
 * d'échec » d'un scénario se servent de ce même 131026 sur la même fiche. Les gardes vivent dans UNE requête
 * (`PgRecipientStore.ficheNeeDeShopifySansWhatsapp`), lue au moment du job, pas à celui de l'accusé.
 *
 * L'effacement est celui de la purge du mini-CRM (`purgeMany`, puis le retrait chez l'agent de Meta), HORS limite de
 * suppressions du jour, comme `customers/redact` : ce n'est pas un geste du marchand. Une panne de la purge lève, et
 * pg-boss rejoue le job ; la garde relue au rejeu ne supprime qu'une fiche encore vivante. Aucun numéro dans le job ni
 * dans le journal : seul l'identifiant du message (wamid) voyage.
 */

export const FILE_SANS_WHATSAPP = 'shopify-sans-whatsapp';

const schemaJob = z.object({ messageId: z.string().min(1).max(256) });
export type JobSansWhatsapp = z.infer<typeof schemaJob>;

export interface DepsSansWhatsapp {
  /** La fiche que ce message fait supprimer, si toutes les gardes tiennent (`ficheNeeDeShopifySansWhatsapp`). */
  ficheASupprimer(messageId: string): Promise<{ tenantId: string; contactId: string } | null>;
  /** Le magasin des contacts, passé ENTIER : `purgeMany` lit son `pool`. */
  contacts: { purgeMany(tenantId: string, ids: readonly string[]): Promise<{ listeAgent: LigneDeLaListe[] }> };
  listeDeLAgent: Pick<ListeDeLAgent, 'oublierChezMeta'>;
}

/** Le puits de l'accusé (`processStatuses`) : enfile le job d'un message en échec 131026, rien d'autre. */
export type EnfilerSansWhatsapp = (job: JobSansWhatsapp) => Promise<void>;

export async function traiterSansWhatsapp(deps: DepsSansWhatsapp, data: unknown): Promise<void> {
  const job = schemaJob.safeParse(data);
  // Un job illisible ne se rejoue pas mieux : il est jeté, et le dit.
  if (!job.success) {
    journaliser('warn', 'shopify_sans_whatsapp_job_illisible');
    return;
  }
  const fiche = await deps.ficheASupprimer(job.data.messageId);
  if (fiche === null) return;
  const { listeAgent } = await deps.contacts.purgeMany(fiche.tenantId, [fiche.contactId]);
  journaliser('info', 'shopify_fiche_supprimee_sans_whatsapp', { tenantId: fiche.tenantId, contactId: fiche.contactId });
  // Le retrait chez l'agent de Meta suit la purge, au mieux : la fiche est déjà effacée chez nous, et le job ne se
  // rejoue pas pour un appel à Meta (la garde, relue, ne trouverait plus rien à supprimer).
  try {
    await deps.listeDeLAgent.oublierChezMeta(fiche.tenantId, listeAgent);
  } catch (err) {
    journaliser('warn', 'shopify_sans_whatsapp_retrait_meta', { tenantId: fiche.tenantId, erreur: messageDe(err) });
  }
}
