import { MAX_FICHES_PAR_SUPPRESSION } from '../../web/lib/partage/catalogue-mcp';
import type { ResultatAction } from '../../web/lib/partage/mise-en-ligne';
import { makeJournal, type AuditSink } from '../audit/journal';
import { canonique, type EtatConfirme } from '../campaign/confirmation';
import { lancerCampagne, type DepsLancement } from '../campaign/lancement';
import { PAUSES_SANS_REPRISE, messageDePause, type MotifDePause } from '../campaign/pause';
import { messageManqueCredit } from '../credit-whatsapp/estimation';
import type { BulkTarget, FicheASupprimer } from '../crm/contact-store.pg';
import { effacerContacts, type DepsEffacement } from '../crm/effacement';
import { estUuid } from '../http/scope';
import { refus, type Issue } from '../lib/issue';
import type { Fonction } from '../offres/offres';
import { LimiteOffreError, corpsRefusLimite, refusFonction } from '../offres/refus';

/**
 * LES ENVOIS AU OUI (lot 1 du CSM virtuel, B8, plan `docs/superpowers/plans/2026-11-26-csm-lot1-h-envois-au-oui.md`,
 * décisions de Julien du 2026-11-26). Une campagne ne part, et des contacts ne s'effacent, que sur le clic d'un admin dans
 * la console : le code de confirmation que Claude recopiait a disparu. Ces actions vivent dans le oui de mise en ligne
 * (`mise-en-ligne.ts`), qui garde ce qui a été montré, relit l'état au clic et reprend une exécution coupée ; ce module en
 * porte le métier :
 *  - `campagne` : lancer (ou programmer à sa date) un brouillon, ou reprendre une campagne en pause, par `lancerCampagne`,
 *    le chemin du bouton « Lancer » de la console ;
 *  - `suppression` : effacer des contacts, par `effacerContacts`, l'effacement de la purge de la console et de
 *    `DELETE /v1/contacts/{id}`.
 * 🔴 Rien de ce qui est gardé ne porte une donnée de contact (0316) : des identifiants, l'état d'une campagne, des
 * compteurs. Le nom et le numéro masqué de l'aperçu restent dans la réponse de l'outil, jamais en base.
 */
export interface DepsEnvoisAuOui {
  /** Le câblage de la route des campagnes : les MÊMES objets que la console et `prepare_campaign`. */
  campagnes: DepsLancement & {
    repo: DepsLancement['repo'] & {
      /** L'état que montre le récapitulatif, relu en base ; `null` hors de l'espace. */
      etatPourConfirmation(tenantId: string, campaignId: string): Promise<EtatConfirme | null>;
      /** Le motif et l'échéance d'une pause ; `null` hors de l'espace. */
      pauseDe(tenantId: string, campaignId: string): Promise<{ motif: MotifDePause | null; jusqua: Date | null } | null>;
    };
  };
  suppression: {
    /** Les fiches vivantes d'une sélection, DANS l'espace (`PgContactStore.selectionAEffacer`). */
    selection(tenantId: string, cible: BulkTarget, limite: number): Promise<FicheASupprimer[]>;
    /** L'effacement de la purge de la console : les MÊMES objets (`effacerContacts`). */
    effacement: DepsEffacement;
  };
}

/** Ce que l'outil demande. */
export type DemandeEnvoi =
  | { type: 'campagne'; campagne: string }
  | { type: 'suppression'; contacts: string[] };

/** Ce qui est gardé, montré, et ce qui partira tel quel. */
export type EnvoiGarde =
  /** `motif` : celui de la pause d'une reprise (`null` pour un brouillon) ; il est montré, gardé, et relu à l'exécution. */
  | { type: 'campagne'; campagne: string; nom: string; reprise: boolean; etat: EtatConfirme; motif: MotifDePause | null }
  | { type: 'suppression'; contacts: string[]; nom: string };

export const estDemandeEnvoi = (d: { type: string }): d is DemandeEnvoi => d.type === 'campagne' || d.type === 'suppression';
export const estEnvoiGarde = (g: { type: string }): g is EnvoiGarde => g.type === 'campagne' || g.type === 'suppression';

const CAMPAGNE_INCONNUE = 'campagne introuvable dans cet espace';
const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`;
const dateDeParis = (iso: string): string => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short',
}).format(new Date(iso));

/**
 * Relit ce qu'un envoi ferait, sans rien écrire. La préparation et le clic passent par elle : le clic refuse ce que la
 * préparation aurait refusé, et l'empreinte de ce qui est gardé dit si l'état a bougé depuis.
 */
export async function releverEnvoi(
  deps: DepsEnvoisAuOui, tenant: string, fonctions: ReadonlySet<Fonction>, d: DemandeEnvoi, maintenant: number,
): Promise<Issue<EnvoiGarde>> {
  if (d.type === 'campagne') {
    // Les campagnes sont une fonction de la console (Pro et au-delà), comme le bouton « Lancer » : relue au clic aussi.
    if (!fonctions.has('console')) return refusFonction('console');
    if (!estUuid(d.campagne)) return refus(404, CAMPAGNE_INCONNUE);
    const etat = await deps.campagnes.repo.etatPourConfirmation(tenant, d.campagne);
    if (!etat) return refus(404, CAMPAGNE_INCONNUE);
    let motif: MotifDePause | null = null;
    if (etat.status === 'paused') {
      // Une pause que seul un autre geste lève (le numéro délié, l'abonnement impayé) : reprendre la remettrait en pause.
      const pause = await deps.campagnes.repo.pauseDe(tenant, d.campagne);
      motif = pause?.motif ?? null;
      if (pause?.motif && PAUSES_SANS_REPRISE.has(pause.motif)) {
        return refus(409, `${messageDePause(pause.motif, null, undefined)} Elle ne se reprend pas par ce geste.`);
      }
    } else if (etat.status !== 'draft') {
      // Lancée, programmée, terminée : elle a écrit, écrit ou écrira à ses destinataires ; rien n'est à envoyer de plus.
      return refus(409, `la campagne n’est plus en brouillon ni en pause (statut ${etat.status}) : il n’y a rien à envoyer`);
    } else if (etat.prevueLe !== null && Date.parse(etat.prevueLe) <= maintenant) {
      return refus(409, 'la date prévue de la campagne est passée : préparez-la à nouveau, avec une nouvelle date');
    }
    if (etat.recipientCount === 0) return refus(409, 'la campagne n’a aucun destinataire en attente : rien à envoyer');
    return {
      ok: true,
      valeur: { type: 'campagne', campagne: d.campagne, nom: `la campagne du modèle « ${etat.templateName} »`, reprise: etat.status === 'paused', etat, motif },
    };
  }
  if (d.contacts.length === 0 || d.contacts.length > MAX_FICHES_PAR_SUPPRESSION || !d.contacts.every(estUuid)) {
    return refus(400, `une suppression porte de 1 à ${MAX_FICHES_PAR_SUPPRESSION} contacts, par leur identifiant`);
  }
  const fiches = await deps.suppression.selection(tenant, { ids: [...new Set(d.contacts)] }, d.contacts.length);
  if (fiches.length === 0) return refus(409, 'aucun de ces contacts n’existe plus dans cet espace : rien à supprimer');
  // Triés : la même liste de fiches donne la même empreinte, quel que soit l'ordre de la base.
  const contacts = fiches.map((f) => f.id).sort();
  return { ok: true, valeur: { type: 'suppression', contacts, nom: pluriel(contacts.length, 'contact') } };
}

/** Le bouton nomme l'effet (décision du 24 novembre) : ce qui part, et à combien. */
export function libelleEnvoi(g: EnvoiGarde): string {
  if (g.type === 'suppression') return `Supprimer ${pluriel(g.contacts.length, 'contact')}`;
  const n = pluriel(g.etat.recipientCount, 'contact');
  if (g.reprise) return `Reprendre l’envoi à ${n}`;
  return g.etat.prevueLe === null ? `Envoyer à ${n}` : `Programmer l’envoi à ${n}`;
}

/** Ce que la page montre au-dessus du bouton, écrit ici (le CSM ne choisit pas les mots de ce qui vaut accord). */
export function recapitulatifEnvoi(g: EnvoiGarde): string[] {
  if (g.type === 'suppression') {
    return [
      `${pluriel(g.contacts.length, 'contact')} ${g.contacts.length > 1 ? 'sont effacés' : 'est effacé'} pour de bon, avec `
        + 'leurs conversations, leurs messages et leur analyse. Un contact qui avait répondu STOP reste désabonné s’il revient.',
      'Claude vous a montré lesquels dans la conversation, avant de vous envoyer ici. La suppression ne se rattrape pas.',
    ];
  }
  const e = g.etat;
  const modele = `le modèle « ${e.templateName} » (${e.templateLanguage}, ${e.category})`;
  const n = pluriel(e.recipientCount, 'contact');
  if (g.reprise) {
    // Pourquoi elle s'est arrêtée : une pause pour la qualité du numéro demande de le vérifier avant de reprendre.
    return [
      `La campagne du modèle « ${e.templateName} » (${e.templateLanguage}, ${e.category}), en pause, reprend : ${n} en attente le reçoivent maintenant.`,
      ...(g.motif === null ? [] : [`Elle s’était arrêtée : ${messageDePause(g.motif, null, undefined)}`]),
    ];
  }
  if (e.prevueLe !== null) return [`La campagne envoie ${modele} à ${n}, le ${dateDeParis(e.prevueLe)}.`];
  return [`La campagne envoie ${modele} à ${n}, dès votre clic. Un message parti ne se rattrape pas.`];
}

/**
 * Exécute un envoi accepté. 🔴 Rejouable sans double effet, pour la reprise d'une exécution coupée : une campagne qui
 * n'est plus en brouillon ni en pause est déjà partie (par l'exécution interrompue, ou depuis la console) et n'est pas
 * relancée ; un brouillon en pause est parti puis a été arrêté ; et rien n'est lancé sur un état qui n'est plus celui du
 * clic. Une suppression ne retrouve que les fiches qui restent.
 */
export async function executerEnvoi(
  deps: DepsEnvoisAuOui, tenant: string, g: EnvoiGarde, auteur: { auth: { userId: string } }, audit: AuditSink,
): Promise<ResultatAction> {
  if (g.type === 'campagne') {
    const destinataires = g.etat.recipientCount;
    const etat = await deps.campagnes.repo.etatPourConfirmation(tenant, g.campagne);
    if (!etat) return { ok: false, code: 'not_found', message: CAMPAGNE_INCONNUE };
    if (etat.status !== 'draft' && etat.status !== 'paused') return { ok: true, etat: 'deja_partie', destinataires };
    // Un brouillon lancé ne redevient jamais brouillon : en pause, il est parti, puis a été arrêté.
    if (!g.reprise && etat.status === 'paused') return { ok: true, etat: 'deja_partie', destinataires };
    // 🔴 Rien n'est lancé sur un état qui n'est plus celui du clic. Une exécution coupée APRÈS le lancement, avant d'avoir
    // noté son résultat, se rejoue : elle trouverait sinon une pause posée depuis (par l'admin, ou pour la qualité du
    // numéro) et la lèverait sans clic. Les destinataires en attente et le motif de la pause le disent.
    const pause = etat.status === 'paused' ? await deps.campagnes.repo.pauseDe(tenant, g.campagne) : null;
    if (canonique(etat) !== canonique(g.etat) || (pause?.motif ?? null) !== g.motif) {
      return {
        ok: false, code: 'modifiee',
        message: 'la campagne a changé depuis votre clic (un envoi, une pause) : ce bouton n’a rien relancé. Demandez à Claude un nouveau bouton.',
      };
    }
    const quand = g.reprise || g.etat.prevueLe === null ? null : new Date(g.etat.prevueLe);
    const issue = await lancerCampagne(deps.campagnes, tenant, g.campagne, quand);
    if (issue.ok) return { ok: true, etat: 'programmee' in issue ? 'programmee' : g.reprise ? 'reprise' : 'envoyee', destinataires };
    switch (issue.raison) {
      case 'limite': {
        const l = corpsRefusLimite(new LimiteOffreError(tenant, 'envoisModelesMois', issue.max));
        return { ok: false, code: l.code, message: l.error };
      }
      // La cause du vocabulaire de l'API publique pour un Crédit WhatsApp qui manque.
      case 'credit_whatsapp': return { ok: false, code: 'whatsapp_credit_exhausted', message: messageManqueCredit(issue.manqueMicroEur) };
      case 'inconnue': return { ok: false, code: 'not_found', message: CAMPAGNE_INCONNUE };
      case 'date_passee': return { ok: false, code: 'date_passee', message: 'la date prévue de la campagne est passée : préparez-la à nouveau, avec une nouvelle date' };
      // Déjà en cours ou terminée entre la relecture et le lancement : elle est partie, rien n'est relancé.
      case 'non_programmable': return { ok: true, etat: 'deja_partie', destinataires };
    }
  }
  const fiches = await deps.suppression.selection(tenant, { ids: g.contacts }, g.contacts.length);
  if (fiches.length === 0) return { ok: true, etat: 'supprimes', contacts: 0, conversations: 0, messages: 0 };
  const ids = fiches.map((f) => f.id);
  // L'effacement partagé : la limite du jour d'abord, tout ou rien (levée au-delà de la limite de contacts), puis la purge.
  const e = await effacerContacts(deps.suppression.effacement, tenant, ids);
  if (!e.ok) {
    const l = corpsRefusLimite(new LimiteOffreError(tenant, 'suppressionsJour', e.max));
    return { ok: false, code: l.code, message: l.error };
  }
  // L'audit de la purge de la console, signé de l'admin qui a cliqué, au mieux : un journal en panne ne défait rien.
  const journal = makeJournal(audit);
  for (const id of ids) await journal(tenant, auteur, 'contact.purged', { kind: 'contact', id }, { lot: ids.length, via: 'mise_en_ligne' });
  // Le retrait chez l'agent de Meta part en fond, suivi (`effacerContacts`) : il ne retient pas le clic.
  e.retirerChezMeta();
  return { ok: true, etat: 'supprimes', contacts: e.bilan.purges, conversations: e.bilan.conversations, messages: e.bilan.messages };
}
