import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyRequest } from '../lib/signature';
import { waIdOf } from '../crm/identity';
import { normalizePhone } from '../crm/phone';
import { champsDeFiche, schemaChampsGroupes, type ChampDeclare } from '../hubspot-workflow/champs';
import { recopierDocumentRecu, type DepsRecopie } from '../documents/recopie';
import type { ResolutionFiche } from '../api/fiche';
import type { ChampsFiche } from '../campaign/build';
import type { Fonction } from '../offres/offres';
import type { LigneHubspot } from '../hubspot/lignes';
import { origineHubspot } from '../hubspot/origine';
import type { EvenementDeLigne, IssueLigneHubspot } from '../hubspot/circuit';
import { journaliser } from '../lib/journal';

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
   * pas vide. Écrits sur la fiche seulement si une ligne allumée correspond à l'étape (lot 3a, puis lot 6b).
   */
  champs: schemaChampsGroupes.optional(),
});

export interface HubspotEventRouteDeps {
  /** Secret partagé avec le connecteur (== SERVICE_SECRET de mm-hubspot). Vide -> route non montée. */
  secret: string;
  /** La ligne « Automations HubSpot » de l'espace (`lireChoixHubspot(t).automations`, migration 0270). */
  automationsBranchees(tenantId: string): Promise<boolean>;
  /** Les fonctions de l'offre de l'espace : `crm` relie HubSpot (la garde des actions de workflow, `gardesEspace`). */
  fonctions(tenantId: string): Promise<ReadonlySet<Fonction>>;
  /**
   * Les lignes d'étape ALLUMÉES de l'espace (rayon `hubspot`) qui correspondent : l'étape, et le pipeline quand les deux
   * côtés le portent (`PgLignesHubspot.etapesAllumees`).
   */
  etapesAllumees(tenantId: string, pipelineId: string, stageId: string): Promise<LigneHubspot[]>;
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
  /** Le circuit d'une ligne (`servirLigneHubspot`) : le premier bloc publié, le plafond par ligne, l'envoi et le pont. */
  servir(tenantId: string, e: EvenementDeLigne): Promise<IssueLigneHubspot>;
  now?: () => number;
  windowMs?: number;
}

/**
 * Canal entrant depuis le connecteur HubSpot : le changement d'étape d'un deal. Depuis le lot 6b du menu « Scénario », ce
 * sont les LIGNES d'Automation > HubSpot qui décident (rayon `hubspot`, une par étape réglée), servies chacune par leur
 * circuit (`servirLigneHubspot`) : plus aucun événement pour le runner du Builder, dont les automations « changement
 * d'étape » sont éteintes par la bascule. La route prépare : « Automations HubSpot » allumée, l'offre qui relie HubSpot, et
 * une ligne allumée qui correspond à l'étape ; alors seulement elle crée la fiche d'un lead inconnu et y écrit les champs
 * importés (lot 3a du 2026-11-02, décisions 5 et 7), que le premier bloc et la suite lisent (décision 38).
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
    const { tenantId, phone, stageId, pipelineId, dealId, champs } = parsed.data;

    // 🔴 La ligne « Automations HubSpot » (décision 5 du 2026-11-02) : éteinte, rien ne se fait, ni fiche, ni champ, ni
    // événement. Un 200 et pas une erreur : le connecteur ne rejoue pas. Un événement déjà en file part quand même.
    if (!(await deps.automationsBranchees(tenantId))) {
      return reply.code(200).send({ ok: true, triggered: false, reason: 'automations HubSpot éteintes' });
    }

    // Lot 6b : l'offre qui relie HubSpot, comme pour les actions de workflow (`gardesEspace`). Un 200, le connecteur ne rejoue pas.
    if (!(await deps.fonctions(tenantId)).has('crm')) return reply.code(200).send({ ok: true, triggered: false, reason: 'hors offre' });

    // Numéro normalisé avec la même fonction que l'import CSV et l'import de liste : un contact doit être
    // reconnu à l'identique quel que soit le chemin par lequel son numéro arrive.
    const e164 = normalizePhone(phone, 'FR').e164;
    if (!e164) return reply.code(200).send({ ok: true, triggered: false, reason: 'numéro inexploitable' });

    // `waIdOf` est la règle partagée (crm/identity.ts) : la redériver ici créerait un second contact pour la
    // même personne le jour où l'une des deux versions changerait.
    const waId = waIdOf(e164, null);
    if (!waId) return reply.code(200).send({ ok: true, triggered: false, reason: 'numéro inexploitable' });

    // 🔴 Aucune ligne allumée sur l'étape : on ne crée rien et on n'écrit rien (sinon chaque changement d'étape de chaque
    // deal du portail créerait une fiche et entamerait la limite de contacts).
    const lignes = await deps.etapesAllumees(tenantId, pipelineId, stageId);
    if (lignes.length === 0) return reply.code(200).send({ ok: true, triggered: false, reason: 'aucune ligne sur cette étape' });

    // Un contact bloqué ne déclenche rien : ni fiche touchée, ni champ écrit.
    if (await deps.estBloque(tenantId, waId)) return reply.code(200).send({ ok: true, triggered: false, reason: 'contact bloqué' });

    // 🔴 Un lead inconnu de l'espace devient une fiche (décision 7) : sous la limite de contacts de l'offre et la liste
    // de refus, comme les actions de workflow. Au-delà de la limite, rien ne part, et ce n'est pas une panne.
    const fiche = await deps.resoudreFiche(tenantId, e164);
    if (!fiche.ok) {
      return reply.code(200).send({
        ok: true, triggered: false, reason: fiche.code === 'plan_limit_reached' ? 'limite de contacts atteinte' : fiche.code,
      });
    }

    // Les champs importés s'écrivent AVANT l'envoi : le premier bloc et la suite les lisent sur la fiche (décision 38).
    // Seules les clés déclarées dans l'espace, une valeur vide retire le champ (règle du lot 2, `champsDeFiche`).
    if (champs) {
      const declares = await deps.champsDeclares(tenantId);
      // Le PDF propre au contact est recopié AVANT : la fiche ne reçoit que son code (`recopierDocumentRecu`).
      const ecrits = champsDeFiche(await recopierDocumentRecu(deps.documents, tenantId, waId, champs, declares), declares, tenantId);
      if (Object.keys(ecrits.poser).length > 0 || ecrits.retirer.length > 0) await deps.ecrireChamps(tenantId, fiche.contactId, ecrits);
    }

    // Chaque ligne allumée sous sa propre origine (une naissance par deal et par étape en 24 h, décision 37). Un deal sans
    // identifiant (un connecteur ancien) prend le contact à sa place. Une panne lève (500) : le connecteur rejoue, et
    // l'origine, clé d'idempotence de l'envoi, relit le rapport de ce qui est déjà parti.
    const le = new Date(now());
    const servies: Array<{ id: string; issue: IssueLigneHubspot | 'origine_illisible' }> = [];
    for (const ligne of lignes) {
      const deal = dealId === '' ? `contact-${waId}` : dealId;
      const origine = origineHubspot({ famille: 'etape', ligne: ligne.id, deal, etape: stageId, le });
      if (origine === null) {
        journaliser('warn', 'hubspot_etape_origine_illisible', { tenantId, ligne: ligne.id });
        servies.push({ id: ligne.id, issue: 'origine_illisible' });
        continue;
      }
      servies.push({ id: ligne.id, issue: await deps.servir(tenantId, { ligne, telephone: e164, waId, origine }) });
    }
    return reply.code(200).send({ ok: true, triggered: servies.some((l) => l.issue === 'envoye'), lignes: servies });
  });
}
