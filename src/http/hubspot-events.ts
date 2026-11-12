import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyRequest } from '../lib/signature';
import { waIdOf } from '../crm/identity';
import { normalizePhone } from '../crm/phone';
import { champsDeFiche, schemaChampsGroupes, type ChampDeclare } from '../hubspot-workflow/champs';
import { recopierDocumentRecu, type DepsRecopie } from '../documents/recopie';
import type { ResolutionFiche } from '../api/fiche';
import type { ChampsFiche } from '../campaign/build';

/** Corps brut, capturé par le parser du receiver Meta (un seul parser JSON pour toute l'app). */
type WithRawBody = FastifyRequest & { rawBody?: Buffer };

/**
 * Événement poussé par le connecteur HubSpot. Payload externe, validé au `safeParse` : le connecteur est
 * authentifié par signature, mais une version décalée des deux côtés reste possible.
 */
const dealStageSchema = z.object({
  tenantId: z.string().min(1),
  /** Téléphone tel que HubSpot le porte : format libre, normalisé ici. */
  phone: z.string().min(1),
  stageId: z.string().min(1),
  /** Vide = le connecteur n'a pas pu relire le pipeline. Une automation sans pipeline configuré s'en moque. */
  pipelineId: z.string().default(''),
  dealId: z.string().default(''),
  /**
   * Les champs HubSpot choisis par l'espace (lot 2 du 2026-11-02, forme groupée), envoyés seulement si sa liste n'est
   * pas vide. Écrits sur la fiche seulement si une automation allumée correspond à l'étape (lot 3a).
   */
  champs: schemaChampsGroupes.optional(),
});

type EvenementDeal = { kind: 'hubspot_deal_stage'; waId: string; pipelineId: string; stageId: string };

export interface HubspotEventRouteDeps {
  /** Secret partagé avec le connecteur (== SERVICE_SECRET de mm-hubspot). Vide -> route non montée. */
  secret: string;
  /** La ligne « Automations HubSpot » de l'espace (`lireChoixHubspot(t).automations`, migration 0270). */
  automationsBranchees(tenantId: string): Promise<boolean>;
  /**
   * Au moins une automation ALLUMÉE de l'espace, permise par l'offre, correspond-elle à l'événement ? La définition du
   * runner (`automationsCandidates`), pour ne jamais créer une fiche que le runner n'utiliserait pas.
   */
  automationCorrespond(tenantId: string, ev: EvenementDeal): Promise<boolean>;
  /** Le contact existe-t-il dans ce workspace ? Rend son wa_id, ou null. */
  findWaId(tenantId: string, waId: string): Promise<string | null>;
  /** Ce contact est-il bloqué ? Inconnu : non. */
  estBloque(tenantId: string, waId: string): Promise<boolean>;
  /**
   * La fiche du numéro, CRÉÉE au besoin (`resoudreFiche`, mode `creer: 'phone'`) : la limite de contacts de l'offre et la
   * liste de refus s'appliquent, et la création n'émet aucun événement d'automation.
   */
  resoudreFiche(tenantId: string, e164: string): Promise<ResolutionFiche>;
  /** Les champs de fiche déclarés dans l'espace, clé et type : seules les clés `hs_*` déclarées s'écrivent. */
  champsDeclares(tenantId: string): Promise<ReadonlyArray<ChampDeclare>>;
  /** La recopie du PDF propre au contact (calculé `document`) : son adresse à courte vie devient le code de la copie. */
  documents: DepsRecopie;
  /** Écrit les champs sur la fiche, hors transaction (`PgContactStore.ecrireChampsFiche`). */
  ecrireChamps(tenantId: string, contactId: string, champs: ChampsFiche): Promise<void>;
  /** Publie l'événement d'automation (file). C'est le worker qui décide ensuite quoi déclencher. */
  publish(tenantId: string, ev: EvenementDeal): Promise<void>;
  now?: () => number;
  windowMs?: number;
}

/**
 * Canal entrant depuis le connecteur HubSpot, seul endroit où un système extérieur peut provoquer un envoi
 * WhatsApp : une route, un type d'événement, aucune décision d'envoi ici. Ce sont les automations de l'espace qui
 * décident, avec leurs propres garde-fous. La route ne fait que préparer : la ligne « Automations HubSpot » allumée, et
 * une automation qui correspond à l'étape, elle crée la fiche d'un lead inconnu et y écrit les champs importés (lot 3a du
 * 2026-11-02, décisions 5 et 7).
 */
export function registerHubspotEvents(app: FastifyInstance, deps: HubspotEventRouteDeps): void {
  const now = deps.now ?? (() => Date.now());
  const windowMs = deps.windowMs ?? 5 * 60 * 1000;

  app.post('/hubspot/deal-stage', async (req, reply) => {
    const raw = (req as WithRawBody).rawBody;
    const sig = req.headers['x-mm-service-signature'];
    const header = Array.isArray(sig) ? sig[0] : sig;
    const path = req.url.split('?')[0] ?? req.url;
    if (!raw || !verifyRequest(raw, header, deps.secret, { method: req.method, path, now: now(), windowMs })) {
      return reply.code(401).send({ error: 'invalid signature' });
    }

    const parsed = dealStageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'payload invalide' });
    const { tenantId, phone, stageId, pipelineId, champs } = parsed.data;

    // 🔴 La ligne « Automations HubSpot » (décision 5 du 2026-11-02) : éteinte, rien ne se fait, ni fiche, ni champ, ni
    // événement. Un 200 et pas une erreur : le connecteur ne rejoue pas. Un événement déjà en file part quand même.
    if (!(await deps.automationsBranchees(tenantId))) {
      return reply.code(200).send({ ok: true, triggered: false, reason: 'automations HubSpot éteintes' });
    }

    // Numéro normalisé avec la même fonction que l'import CSV et l'import de liste : un contact doit être
    // reconnu à l'identique quel que soit le chemin par lequel son numéro arrive.
    const e164 = normalizePhone(phone, 'FR').e164;
    if (!e164) return reply.code(200).send({ ok: true, triggered: false, reason: 'numéro inexploitable' });

    // `waIdOf` est la règle partagée (crm/identity.ts) : la redériver ici créerait un second contact pour la
    // même personne le jour où l'une des deux versions changerait.
    const waId = waIdOf(e164, null);
    if (!waId) return reply.code(200).send({ ok: true, triggered: false, reason: 'numéro inexploitable' });

    const ev: EvenementDeal = { kind: 'hubspot_deal_stage', waId, pipelineId, stageId };

    // 🔴 Aucune automation allumée et permise ne correspond à l'étape : on ne crée rien et on n'écrit rien (sinon chaque
    // changement d'étape de chaque deal du portail créerait une fiche et entamerait la limite de contacts). Le
    // comportement d'avant le lot 3a : un contact connu est publié, un inconnu ne l'est pas.
    if (!(await deps.automationCorrespond(tenantId, ev))) {
      if (!(await deps.findWaId(tenantId, waId))) {
        // eslint-disable-next-line no-console
        console.log(`hubspot deal-stage: contact inconnu du workspace ${tenantId} et aucune automation sur l'étape, aucun déclenchement`);
        return reply.code(200).send({ ok: true, triggered: false, reason: 'contact inconnu' });
      }
      await deps.publish(tenantId, ev);
      return reply.code(200).send({ ok: true, triggered: true });
    }

    // Un contact bloqué ne déclenche rien (le runner l'écarterait) : ni fiche touchée, ni champ écrit.
    if (await deps.estBloque(tenantId, waId)) return reply.code(200).send({ ok: true, triggered: false, reason: 'contact bloqué' });

    // 🔴 Un lead inconnu de l'espace devient une fiche (décision 7) : sous la limite de contacts de l'offre et la liste
    // de refus, comme les actions de workflow. Au-delà de la limite, rien ne part, et ce n'est pas une panne.
    const fiche = await deps.resoudreFiche(tenantId, e164);
    if (!fiche.ok) {
      return reply.code(200).send({
        ok: true, triggered: false, reason: fiche.code === 'plan_limit_reached' ? 'limite de contacts atteinte' : fiche.code,
      });
    }

    // Les champs importés s'écrivent AVANT l'enfilement : le scénario les lit sur la fiche. Seules les clés déclarées
    // dans l'espace, une valeur vide retire le champ (règle du lot 2, `champsDeFiche`).
    if (champs) {
      const declares = await deps.champsDeclares(tenantId);
      // Le PDF propre au contact est recopié AVANT : la fiche ne reçoit que son code (`recopierDocumentRecu`).
      const ecrits = champsDeFiche(await recopierDocumentRecu(deps.documents, tenantId, waId, champs, declares), declares, tenantId);
      if (Object.keys(ecrits.poser).length > 0 || ecrits.retirer.length > 0) await deps.ecrireChamps(tenantId, fiche.contactId, ecrits);
    }

    await deps.publish(tenantId, ev);
    return reply.code(200).send({ ok: true, triggered: true });
  });
}
