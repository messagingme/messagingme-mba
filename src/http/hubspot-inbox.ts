import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Guard } from '../auth/middleware';
import type { Fonction } from '../offres/offres';
import { corpsRefusFonction } from '../offres/refus';
import { journaliser } from '../lib/journal';
import { HubspotServiceError, ReconsentRequiredError, type BoiteInbox } from '../crm/hubspot-service';
import type { InboxHubspotStore } from '../hubspot/inbox';
import { ligneE164 } from '../hubspot/inbox';
import { espaceVerifie } from './scope';

/**
 * LES CONVERSATIONS DANS L'INBOX HUBSPOT, LE RÉGLAGE DE LA CONSOLE (lot 1 de l'Inbox, tâche 6 du plan
 * `~/mm-hubspot/docs/2026-11-06-inbox-hubspot-lot1-plan.md`). Une route à part du choix des fonctions : il s'agit de
 * choisir une BOÎTE, pas d'allumer un interrupteur, et le branchement crée un objet chez HubSpot (le compte de canal).
 *
 * - `GET /tenants/:tenantId/hubspot/inbox` : la boîte branchée, et les boîtes du portail pour le menu (ou la raison
 *   pour laquelle on ne peut pas les lire : portées à accorder, portail non relié, connecteur muet).
 * - `PUT /tenants/:tenantId/hubspot/inbox` `{ inboxId: string | null }` : branche la ligne WhatsApp sur la boîte, ou la
 *   débranche. L'état local ne change qu'APRÈS la réponse du connecteur : la console ne dit jamais « branché » sur un
 *   compte de canal qui n'existe pas.
 */

/** Pourquoi les boîtes ne se lisent pas : la console en tire son message et son bouton. */
export type RaisonInbox = 'portees_inbox_manquantes' | 'hubspot_non_relie' | 'connecteur_indisponible' | 'sans_numero';

export interface HubspotInboxRouteDeps {
  store: Pick<InboxHubspotStore, 'lireBoite' | 'brancher' | 'debrancher' | 'ligne'>;
  fonctions(tenantId: string): Promise<ReadonlySet<Fonction>>;
  /** Les quatre appels du connecteur (`src/crm/hubspot-service.ts`), déjà liés à ses dépendances. */
  connecteur: {
    boites(tenantId: string): Promise<{ boites: BoiteInbox[]; affectation: boolean | null }>;
    brancher(corps: { tenantId: string; ligne: string; inboxId: string; nom: string }): Promise<void>;
    debrancher(corps: { tenantId: string; ligne: string }): Promise<void>;
  };
}

/** L'offre : l'Inbox HubSpot sert à lire et répondre aux conversations, comme « Répondre depuis HubSpot ». */
export const FONCTION_INBOX_HUBSPOT: Fonction = 'inbox';

const corpsInbox = z.object({ inboxId: z.string().regex(/^\d{1,20}$/).nullable() }).strict();

/** Traduit un échec du connecteur en raison lisible ; null pour une panne qui doit rester une 5xx. */
function raison(err: unknown): RaisonInbox | null {
  if (err instanceof ReconsentRequiredError) return 'portees_inbox_manquantes';
  if (err instanceof HubspotServiceError) {
    if (err.status === 409 && (err.code === 'portees_inbox_manquantes' || err.code === 'portal_disconnected')) return 'portees_inbox_manquantes';
    if (err.status === 404 && err.code === 'tenant_not_connected') return 'hubspot_non_relie';
    return 'connecteur_indisponible';
  }
  // Le connecteur endormi met ~16 s à se réveiller (`ConnecteurEnReveil`) : l'échéance d'un appel (`TimeoutError`) ou
  // une panne réseau (`fetch failed`, un TypeError) disent « réessayez dans un instant », pas une 500.
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError' || err instanceof TypeError)) return 'connecteur_indisponible';
  return null;
}

export function registerHubspotInbox(app: FastifyInstance, deps: HubspotInboxRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde };

  app.get('/tenants/:tenantId/hubspot/inbox', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const [boite, l] = await Promise.all([deps.store.lireBoite(tenant), deps.store.ligne(tenant)]);
    const ligne = ligneE164(l);
    if (!ligne) return reply.code(200).send({ boite, ligne: null, boites: null, affectation: null, raison: 'sans_numero' satisfies RaisonInbox });
    try {
      // `affectation` (lot 3) : faux tant que le portail n'a pas autorisé l'affectation des fils, la console le propose.
      const { boites, affectation } = await deps.connecteur.boites(tenant);
      return reply.code(200).send({ boite, ligne, boites, affectation, raison: null });
    } catch (err) {
      const r = raison(err);
      if (r === null) throw err;
      if (r === 'connecteur_indisponible') journaliser('error', 'hubspot_inbox_boites_illisibles', { err, tenantId: tenant });
      return reply.code(200).send({ boite, ligne, boites: null, affectation: null, raison: r });
    }
  });

  app.put('/tenants/:tenantId/hubspot/inbox', opts, async (req, reply: FastifyReply) => {
    const tenant = espaceVerifie(req);
    const parsed = corpsInbox.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'corps invalide : inboxId (identifiant numérique de la boîte, ou null) est requis' });
    const { inboxId } = parsed.data;

    const [actuelle, l] = await Promise.all([deps.store.lireBoite(tenant), deps.store.ligne(tenant)]);
    const ligne = ligneE164(l);
    if (!ligne) return reply.code(409).send({ error: 'sans_numero' });

    try {
      if (inboxId === null) {
        if (actuelle !== null) await deps.connecteur.debrancher({ tenantId: tenant, ligne });
        await deps.store.debrancher(tenant);
        return reply.code(200).send({ boite: null });
      }
      if (actuelle === inboxId) return reply.code(200).send({ boite: inboxId });
      // L'offre ne se juge qu'au branchement : un espace descendu d'offre doit pouvoir débrancher.
      if (!(await deps.fonctions(tenant)).has(FONCTION_INBOX_HUBSPOT)) return reply.code(402).send(corpsRefusFonction(FONCTION_INBOX_HUBSPOT));
      // Changer de boîte : le connecteur refuse un second compte de canal pour la même ligne, on débranche d'abord.
      if (actuelle !== null) await deps.connecteur.debrancher({ tenantId: tenant, ligne });
      await deps.connecteur.brancher({ tenantId: tenant, ligne, inboxId, nom: `WhatsApp ${ligne}` });
      await deps.store.brancher(tenant, inboxId);
      return reply.code(200).send({ boite: inboxId });
    } catch (err) {
      const r = raison(err);
      if (r === null) throw err;
      journaliser(r === 'connecteur_indisponible' ? 'error' : 'warn', 'hubspot_inbox_branchement_impossible', { err, tenantId: tenant, raison: r });
      return reply.code(r === 'connecteur_indisponible' ? 502 : 409).send({ error: r });
    }
  });
}
