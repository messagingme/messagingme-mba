import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { horodatageIso } from '../lib/horodatage-iso';
import { auteurOps, type PreHandler } from '../auth/middleware';
import { estUuid } from './scope';
import { journaliser } from '../lib/journal';
import type { AlertesOffreManuelle, EcritureEntreprise, ReglageEntreprise } from '../offres/offre.pg';
import { texteDe } from '../lib/erreur';
// Le même seuil que les autres écritures de `/ops` : importé, pas recopié.
import { MIN_NOTE } from './ops';
import { makeTraceOps, type AuditSink } from '../audit/journal';

/**
 * L'ENTREPRISE D'UN ESPACE, POSÉE PAR L'EXPLOITATION (lot 6, tâche 6, spec § 3). L'Entreprise est sur devis : elle ne
 * s'achète pas en ligne, elle se pose ici après signature, avec sa limite d'utilisateurs et sa conservation des
 * conversations. 🔴 Dans `/ops` et nulle part ailleurs, avec la même autorité (la session d'exploitation), la même note
 * obligatoire et la ligne de journal signée de son auteur que le plafond de l'API. Sert aussi à ramener un espace
 * d'essai en Base. Depuis le 2026-10-27, elle pose aussi le Business, vendu sur démo et facturé hors Stripe, avec sa
 * limite d'utilisateurs (spec `docs/superpowers/specs/2026-10-27-offre-business-design.md`).
 */
export interface OpsOffreDeps {
  store: {
    lireEntreprise(tenantId: string): Promise<ReglageEntreprise | null>;
    ecrireEntreprise(tenantId: string, r: EcritureEntreprise): Promise<boolean>;
    /** Ce que l'exploitant doit voir avant de poser ou de retirer (`PgOffresStore.alertes`). */
    alertes(tenantId: string): Promise<AlertesOffreManuelle>;
  };
  /** Le cache de l'offre de CE process : l'espace change d'offre tout de suite ici, en moins de 30 s ailleurs. */
  invalider(tenantId: string): void;
  /** Le journal des actions de l'espace (lot 5) : l'offre posée, avant et après, l'exploitant pour acteur. */
  audit: AuditSink;
  /**
   * Les gestes qui suivent la pose ou le retrait d'une offre à la main (spec Business), après l'écriture : aucun ne la
   * défait, un échec se journalise et la réponse le dit. Aucun n'écrit chez Stripe (aucun objet Stripe pour le Business),
   * sauf la fin de droit de l'option du Crédit WhatsApp, qui la résilie (lot 4a).
   */
  gestes: {
    /** L'entrée en Business : les avis du numéro oubliés, les campagnes `numero_suspendu` reprises (`surPassageEnPro`). */
    passageBusiness(tenantId: string): Promise<void>;
    /** Le complément du crédit offert jusqu'au montant du Business, plafond de la clé remonté ; rend le montant crédité. */
    completerCredit(tenantId: string): Promise<number>;
    /** La sortie de toute offre posée à la main : la fin du numéro fourni que plus rien ne couvre (`surFinDeLOffreManuelle`). */
    finOffreManuelle(tenantId: string, finiLe: Date): Promise<string>;
    /**
     * L'entrée en Entreprise (illimitée depuis le 2026-11-02) : les campagnes en pause faute de crédit repartent, rien ne
     * les refusera plus (`leverPausesCreditWhatsapp`, plan du Crédit WhatsApp, tâche 11). Rend le nombre de campagnes reprises.
     */
    reprendreCreditWhatsapp(tenantId: string): Promise<number>;
    /**
     * L'IA d'une Entreprise réglée (son entrée, ou son plafond de sécurité changé ; relecture du lot B) : les alertes du
     * mois réarmées sur le nouveau plafond, et sa clé de modèle remontée à un mois de plafond d'avance tout de suite,
     * sans attendre le balayage horaire (une clé prépayée épuisée ferait échouer ses tours jusque-là).
     */
    reglerIaEntreprise(tenantId: string): Promise<void>;
    /**
     * La sortie de toute offre posée à la main : l'option du Crédit WhatsApp que plus aucune offre ne permet se résilie,
     * ses lignes arrêtées (`finDeDroitOption`, lot 4a). Elle écrit chez Stripe, la seule. Rend ce qu'elle a fait.
     */
    finDeDroitOption(tenantId: string): Promise<string>;
  };
}

/** Ce que les gestes ont fait, rendu à l'écran de /ops : `null` = le geste n'était pas dû. */
interface BilanGestes {
  creditOffert: number | null;
  finDuNumero: string | null;
  /** La fin de droit de l'option du Crédit WhatsApp (lot 4a) : `resiliee`, `garde_son_droit` (un Pro vivant), etc. */
  finDeLOption: string | null;
  echecs: Array<'passage' | 'credit' | 'fin' | 'reprise_credit_whatsapp' | 'ia_entreprise' | 'option'>;
}

/** 10 utilisateurs proposés à l'écran ; la route accepte toute limite positive, ou `null` (sans limite). */
export const UTILISATEURS_ENTREPRISE_PROPOSES = 10;

/**
 * L'offre et les utilisateurs sont requis, `null` compris, comme pour le plafond de l'API. 🔴 La conservation, elle, est
 * FACULTATIVE et ABSENTE = INCHANGÉE (relecture finale du lot 6) : requise, elle était réécrite à chaque changement
 * d'offre, et ramener un espace en Base avec une valeur basse lançait la purge irréversible de ses conversations. Elle va
 * de 0 (jamais purgée) à 3650 jours, les bornes de `conversation_retention_days` ; `null` = le défaut de l'instance.
 */
const corpsSchema = z.object({
  entreprise: z.boolean(),
  utilisateurs: z.number().int().min(1).max(10_000).nullable(),
  conservationJours: z.number().int().min(0).max(3650).nullable().optional(),
  // Spec offres v2 : les contacts créés et la commission d'une Entreprise, réglés sur devis. Facultatifs, absents =
  // inchangés, `null` = le défaut (sans limite, 10 %). La commission est un ENTIER : la vue de la console refuse une
  // décimale, et une vue illisible ouvre tout.
  contacts: z.number().int().min(1).max(100_000_000).nullable().optional(),
  commissionPct: z.number().int().min(0).max(100).nullable().optional(),
  // Le Business (spec du 2026-10-27) : absent = inchangé ; sa limite d'utilisateurs, absente = inchangée, `null` = les 5.
  business: z.boolean().optional(),
  utilisateursBusiness: z.number().int().min(1).max(10_000).nullable().optional(),
  // L'essai du Business (révision du Crédit WhatsApp, 2026-11-04) : une date ISO = en essai jusqu'à elle, `null` =
  // confirmé, absente = inchangée. Tant qu'il n'est pas confirmé, l'option Crédit WhatsApp ne s'ouvre pas.
  businessEssaiFinLe: horodatageIso().nullable().optional(),
  // Le Crédit WhatsApp de l'Entreprise (plan du 2026-10-30, tâche 8) : la commission des messages négociée. Absente =
  // inchangée ; `null` = la globale, un ENTIER comme l'autre. L'illimité ne se règle pas : toute Entreprise l'est
  // (décision du 2026-11-02), et le schéma strict refuse l'ancien `openBarWhatsapp`.
  commissionMessagesPct: z.number().int().min(0).max(100).nullable().optional(),
  // Le plafond de sécurité de l'IA d'une Entreprise, en euros ENTIERS par mois (Entreprise illimitée, lot B) : absent =
  // inchangé, `null` = le défaut de l'instance. Jamais 0 : la clé Vercel garde ce plafond d'avance, il lui faut un nombre.
  plafondIaMoisEuros: z.number().int().min(1).max(1_000_000).nullable().optional(),
  note: z.string(),
}).strict();

/** `garde` : la garde d'exploitation, la même instance que celle de `/ops` (`buildServer`). */
export function registerOpsOffre(app: FastifyInstance, deps: OpsOffreDeps, garde: PreHandler): void {
  const opts = { preHandler: garde };
  const tracer = makeTraceOps(deps.audit);

  app.get('/ops/offre/:tenantId', opts, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    if (!estUuid(tenantId)) return reply.code(404).send({ error: 'espace inconnu' });
    const r = await deps.store.lireEntreprise(tenantId);
    if (r === null) return reply.code(404).send({ error: 'espace inconnu' });
    const alertes = await deps.store.alertes(tenantId);
    return reply.code(200).send({ tenantId, ...r, alertes, utilisateursProposes: UTILISATEURS_ENTREPRISE_PROPOSES });
  });

  app.put('/ops/offre/:tenantId', opts, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    if (!estUuid(tenantId)) return reply.code(404).send({ error: 'espace inconnu' });
    const lu = corpsSchema.safeParse(req.body ?? {});
    if (!lu.success) {
      return reply.code(400).send({
        error: 'entreprise (booléen) et utilisateurs (entier positif ou null) requis, avec une note ; facultatifs, absents = inchangés : conservationJours (0 à 3650, ou null), contacts (entier positif, ou null), commissionPct (entier de 0 à 100, ou null), commissionMessagesPct (entier de 0 à 100, ou null), plafondIaMoisEuros (entier de 1 à 1 000 000, ou null)',
      });
    }
    if (lu.data.entreprise && lu.data.business === true) {
      return reply.code(400).send({ error: 'une seule offre posée à la main : l’Entreprise ou le Business, pas les deux' });
    }
    const note = lu.data.note.trim().slice(0, 500);
    if (note.length < MIN_NOTE) return reply.code(400).send({ error: 'note requise : pourquoi cette offre' });

    const avant = await deps.store.lireEntreprise(tenantId);
    if (avant === null) return reply.code(404).send({ error: 'espace inconnu' });
    // 🟡 Une date d'essai du Business ne s'écrit que sur un Business, jugé sur l'état EFFECTIF après l'écriture (le Business
    // demandé, ou celui d'avant quand il n'est pas dit) : sinon elle dormirait, et rendrait « en essai » un Business posé
    // plus tard (jaune 5 de la relecture du lot A). La confirmation (`null`) passe partout.
    const businessApres = !lu.data.entreprise && (lu.data.business ?? avant.business);
    if (lu.data.businessEssaiFinLe != null && !businessApres) {
      return reply.code(400).send({ error: 'une date d’essai du Business demande un espace en Business' });
    }
    const ecriture: EcritureEntreprise = {
      entreprise: lu.data.entreprise, utilisateurs: lu.data.utilisateurs,
      ...(lu.data.conservationJours !== undefined ? { conservationJours: lu.data.conservationJours } : {}),
      ...(lu.data.contacts !== undefined ? { contacts: lu.data.contacts } : {}),
      ...(lu.data.commissionPct !== undefined ? { commissionPct: lu.data.commissionPct } : {}),
      ...(lu.data.business !== undefined ? { business: lu.data.business } : {}),
      ...(lu.data.utilisateursBusiness !== undefined ? { utilisateursBusiness: lu.data.utilisateursBusiness } : {}),
      ...(lu.data.businessEssaiFinLe !== undefined
        ? { businessEssaiFinLe: lu.data.businessEssaiFinLe === null ? null : new Date(lu.data.businessEssaiFinLe) } : {}),
      ...(lu.data.commissionMessagesPct !== undefined ? { commissionMessagesPct: lu.data.commissionMessagesPct } : {}),
      ...(lu.data.plafondIaMoisEuros !== undefined ? { plafondIaMoisEuros: lu.data.plafondIaMoisEuros } : {}),
    };
    if (!(await deps.store.ecrireEntreprise(tenantId, ecriture))) return reply.code(404).send({ error: 'espace inconnu' });
    // L'état RELU, pour la réponse et la trace : un réglage absent n'a pas été écrit.
    const apres: ReglageEntreprise = (await deps.store.lireEntreprise(tenantId)) ?? { ...avant, ...ecriture };
    deps.invalider(tenantId);
    journaliser('warn', 'ops_offre', { tenantId, avant, apres, par: auteurOps(req), note, at: new Date().toISOString() });
    await tracer(tenantId, auteurOps(req), 'ops.offre_posee', {
      entreprise: apres.entreprise, utilisateurs: apres.utilisateurs, conservationJours: apres.conservationJours,
      contacts: apres.contacts, commissionPct: apres.commissionPct,
      entrepriseAvant: avant.entreprise, utilisateursAvant: avant.utilisateurs, conservationJoursAvant: avant.conservationJours,
      contactsAvant: avant.contacts, commissionPctAvant: avant.commissionPct,
      business: apres.business, utilisateursBusiness: apres.utilisateursBusiness,
      businessAvant: avant.business, utilisateursBusinessAvant: avant.utilisateursBusiness,
      businessEssaiFinLe: apres.businessEssaiFinLe, businessEssaiFinLeAvant: avant.businessEssaiFinLe,
      commissionMessagesPct: apres.commissionMessagesPct, commissionMessagesPctAvant: avant.commissionMessagesPct,
      plafondIaMoisEuros: apres.plafondIaMoisEuros, plafondIaMoisEurosAvant: avant.plafondIaMoisEuros,
    });
    const gestes = await jouerLesGestes(deps, tenantId, avant, apres);
    const alertes = await deps.store.alertes(tenantId);
    return reply.code(200).send({ tenantId, ...apres, alertes, gestes, utilisateursProposes: UTILISATEURS_ENTREPRISE_PROPOSES });
  });
}

/**
 * LES GESTES APRÈS LA POSE OU LE RETRAIT (spec Business), sur l'état RELU. Entrer en Business : les avis du numéro, puis le
 * complément du crédit. Quitter toute offre posée à la main (ni Entreprise ni Business après) : la fin du numéro fourni.
 * Passer de l'une à l'autre ne quitte rien : l'offre d'arrivée couvre le numéro. Chaque geste joue même si le précédent a
 * échoué : un échec se journalise, l'offre posée reste posée.
 */
async function jouerLesGestes(deps: OpsOffreDeps, tenantId: string, avant: ReglageEntreprise, apres: ReglageEntreprise): Promise<BilanGestes> {
  const bilan: BilanGestes = { creditOffert: null, finDuNumero: null, finDeLOption: null, echecs: [] };
  const tenter = async <T>(geste: BilanGestes['echecs'][number], f: () => Promise<T>): Promise<T | null> => {
    try {
      return await f();
    } catch (err) {
      journaliser('error', 'ops_offre_geste_echoue', { tenantId, geste, err: texteDe(err) });
      bilan.echecs.push(geste);
      return null;
    }
  };
  const entreEnBusiness = !avant.business && apres.business && !apres.entreprise;
  const quitteLaMain = (avant.entreprise || avant.business) && !apres.entreprise && !apres.business;
  if (entreEnBusiness) {
    await tenter('passage', () => deps.gestes.passageBusiness(tenantId));
    bilan.creditOffert = await tenter('credit', () => deps.gestes.completerCredit(tenantId));
  }
  if (quitteLaMain) {
    bilan.finDuNumero = await tenter('fin', () => deps.gestes.finOffreManuelle(tenantId, new Date()));
    // Plus de Business ni d'Entreprise : l'option du Crédit WhatsApp n'y a plus droit, sauf un Pro vivant (elle le lit).
    bilan.finDeLOption = await tenter('option', () => deps.gestes.finDeDroitOption(tenantId));
  }
  // L'Entreprise posée (lue sur l'état relu) : son Crédit WhatsApp devient illimité (décision du 2026-11-02), les campagnes
  // arrêtées faute de crédit repartent. Le retrait ne relance rien : la garde juge le solde au prochain envoi.
  if (!avant.entreprise && apres.entreprise) {
    await tenter('reprise_credit_whatsapp', () => deps.gestes.reprendreCreditWhatsapp(tenantId));
  }
  // Son Crédit IA aussi : illimité sous un plafond, que l'entrée pose et qu'un plafond changé déplace.
  if (apres.entreprise && (!avant.entreprise || avant.plafondIaMoisEuros !== apres.plafondIaMoisEuros)) {
    await tenter('ia_entreprise', () => deps.gestes.reglerIaEntreprise(tenantId));
  }
  return bilan;
}
