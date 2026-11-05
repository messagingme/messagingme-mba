import type { CompteurDebit, Comptage } from '../db/debit';
import { journaliser } from '../lib/journal';
import { sha256Hex } from '../lib/signature';
import { reseauDuClient } from '../ops/tentatives';
import { identifiantMeta } from '../pub/inscription';
import type { DemandeInscription } from '../user/inscriptions';
import { MESSAGE_PLAFOND_INDISPONIBLE } from './plafond-partage';

/**
 * LA DEMANDE DU LIEN D'INSCRIPTION (lot identité B) : ce que la route lit du formulaire, et les plafonds qui bornent
 * les e-mails qu'un anonyme fait partir de notre domaine vers une adresse de son choix (décision de Julien du
 * 2026-11-05 : Turnstile et plafonds).
 *
 * 🔴 LES TROIS FENÊTRES SE COMPTENT EN UN SEUL APPEL, toutes ou aucune (`CompteurDebit.compter`), après toutes les
 * validations et juste avant d'écrire la demande. Trois appels séparés laisseraient une demande refusée par l'une
 * consommer l'autre : un tiers qui a épuisé sa fenêtre réseau brûlerait quand même les trois liens du jour de
 * l'adresse visée, et le titulaire recevrait un 429 sans aucun lien dans sa boîte.
 * Les fenêtres sont fixes : « par jour » veut dire par jour UTC.
 */
export const LIENS_PAR_ADRESSE_ET_PAR_JOUR = 3;
export const DEMANDES_PAR_RESEAU_ET_PAR_HEURE = 10;
/** Le total horaire qui prévient sur Telegram, une fois par heure, bien avant de refuser. */
export const SEUIL_ALERTE_INSCRIPTIONS_PAR_HEURE = 30;
/** Le total horaire au-delà duquel toute demande est refusée (défaut ; `INSCRIPTION_PLAFOND_HEURE`, 0 = aucun refus). */
export const PLAFOND_INSCRIPTIONS_PAR_HEURE = 200;

const HEURE_MS = 60 * 60 * 1000;
const JOUR_MS = 24 * HEURE_MS;

export const MESSAGE_LIENS_DE_L_ADRESSE = 'Plusieurs liens sont déjà partis vers cette adresse aujourd’hui : ouvrez le dernier reçu (pensez aux indésirables), ou réessayez demain.';
export const MESSAGE_TROP_D_INSCRIPTIONS = 'Trop d’inscriptions en ce moment : réessayez dans quelques minutes, ou continuez avec Google.';

/** Ce que le formulaire envoie avec l'adresse, lu sur un corps non fiable : tout ce qui n'est pas attendu est ignoré. */
export function lireDemande(email: string, corps: Record<string, unknown>): DemandeInscription {
  const pub = corps.pub !== null && typeof corps.pub === 'object' ? (corps.pub as Record<string, unknown>) : {};
  return {
    email,
    langue: corps.langue === 'en' ? 'en' : 'fr',
    offrePro: corps.offre === 'pro',
    application: corps.application === true,
    // L'étape de l'adresse les envoie à plat ; une console d'avant le lot, dans le champ `pub` de la case cochée.
    pubFbc: identifiantMeta(corps.fbc) ?? identifiantMeta(pub.fbc),
    pubFbp: identifiantMeta(corps.fbp) ?? identifiantMeta(pub.fbp),
  };
}

export type VerdictPlafondsInscription =
  | { accepte: true; totalDeLHeure: number | null }
  | { accepte: false; attenteMs: number; message: string };

/** Les clés ne portent jamais l'adresse ni l'IP en clair : leur empreinte. */
export function comptagesDemande(
  email: string,
  req: { ip: string; headers: Record<string, unknown> },
  plafondHeure: number,
): Comptage[] {
  return [
    { cle: `inscription.adresse|${sha256Hex(email.toLowerCase())}`, dureeMs: JOUR_MS, max: LIENS_PAR_ADRESSE_ET_PAR_JOUR },
    { cle: `inscription.reseau|${sha256Hex(reseauDuClient(req))}`, dureeMs: HEURE_MS, max: DEMANDES_PAR_RESEAU_ET_PAR_HEURE },
    { cle: 'inscription.total', dureeMs: HEURE_MS, max: plafondHeure > 0 ? plafondHeure : null },
  ];
}

let dernierAvertissement = Number.NEGATIVE_INFINITY;

/** Compte une demande dans ses trois fenêtres. 🔴 Fermé sur panne : une base qui ne répond pas refuse, sans e-mail. */
export async function compterDemande(
  compteur: CompteurDebit,
  email: string,
  req: { ip: string; headers: Record<string, unknown> },
  plafondHeure: number,
): Promise<VerdictPlafondsInscription> {
  let v;
  try {
    v = await compteur.compter(comptagesDemande(email, req, plafondHeure));
  } catch (err) {
    const t = Date.now();
    if (t - dernierAvertissement >= 60_000) {
      dernierAvertissement = t;
      journaliser('error', 'plafond_partage_indisponible', { plafond: 'inscription', siLaBaseEchoue: 'refuser', err });
    }
    return { accepte: false, attenteMs: 5_000, message: MESSAGE_PLAFOND_INDISPONIBLE };
  }
  if (v.accepte) return { accepte: true, totalDeLHeure: v.fenetres[2]?.compte ?? null };
  const pleines = v.fenetres.filter((f) => f.pleine);
  const attenteMs = Math.max(0, ...pleines.map((f) => f.finMs - v.maintenantMs));
  return { accepte: false, attenteMs, message: v.fenetres[0]?.pleine ? MESSAGE_LIENS_DE_L_ADRESSE : MESSAGE_TROP_D_INSCRIPTIONS };
}
