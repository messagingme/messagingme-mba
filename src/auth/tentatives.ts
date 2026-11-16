import { createHash } from 'node:crypto';
import type { Comptage, CompteurDebit, VerdictDebit } from '../db/debit';
import { journaliser } from '../lib/journal';
import { MESSAGE_PLAFOND_INDISPONIBLE, type Consommation } from './plafond-partage';
import { MESSAGE_DEFI_ECHOUE, type VerificateurTurnstile } from './turnstile';

/**
 * Clé du compteur partagé : l'empreinte de `ip::discriminant`. L'adresse ou le jeton présenté n'entre donc jamais
 * en clair dans la base, son journal ou ses sauvegardes, et la taille reste bornée même pour un jeton Google.
 * `ip` peut être celle du proxy selon l'adaptateur ; le choix de l'adresse de référence reste sa responsabilité.
 */
export function empreinteTentative(source: { ip: string }, discriminant: string): string {
  return createHash('sha256').update(`${source.ip}::${discriminant}`).digest('hex');
}

export type DecisionTentative =
  | { acceptee: true }
  | { acceptee: false; attenteMs: number; message: string };

export interface CompteurTentatives {
  consommer(cle: string): Promise<Pick<Consommation, 'accepte' | 'indisponible' | 'attenteMs'>>;
}

/** Le refus d'un plafond de tentatives atteint. */
export const MESSAGE_TROP_DE_TENTATIVES = 'trop de tentatives, réessaie plus tard';

/** Consomme une tentative sans dépendre du transport HTTP. `message` : celui d'un plafond atteint qui a le sien. */
export async function verifierTentative(
  plafond: CompteurTentatives,
  cle: string,
  message: string = MESSAGE_TROP_DE_TENTATIVES,
): Promise<DecisionTentative> {
  const consommation = await plafond.consommer(cle);
  if (consommation.accepte) return { acceptee: true };
  return {
    acceptee: false,
    attenteMs: consommation.attenteMs,
    message: consommation.indisponible ? MESSAGE_PLAFOND_INDISPONIBLE : message,
  };
}

/**
 * LES ESSAIS DE MOT DE PASSE D'UNE ADRESSE (lot E de l'audit de sécurité, décision de Julien du 2026-11-16) : la
 * connexion (entrée `/ops` comprise) et l'inscription d'une adresse connue, avec les MÊMES clés, pour qu'alterner les
 * deux routes ne double rien. Deux fenêtres comptées en un appel, toutes ou aucune :
 * - le RÉSEAU du client et l'adresse (`reseauDuClient`, lu dans `CF-Connecting-IP`) : ce qu'une source peut tenter ;
 * - l'ADRESSE seule, tous réseaux confondus : le filet contre une force brute répartie.
 * Un refus du réseau ne consomme pas le filet ; mais à son rythme permis, UN seul réseau le remplit en trois minutes.
 * C'est voulu : n'importe qui peut imposer le défi à n'importe quelle adresse, `/ops` compris, jamais la fermer.
 *
 * 🔴 LE FILET PLEIN EXIGE LE DÉFI ANTI-ROBOT, IL NE REFUSE PAS. Avant ce lot, la clé était `req.ip::adresse`, et
 * `req.ip` est le frontal de Scaleway pour tout le monde : dix mauvais mots de passe par minute, de n'importe où,
 * fermaient la connexion du titulaire. Un filet qui refuserait se remplirait de même ; le défi (Turnstile) laisse passer
 * qui le résout, le titulaire, et arrête un robot. ⚠️ Sans vérificateur (clé secrète absente), il n'y a pas de défi à
 * proposer et le filet REFUSE, titulaire compris, jusqu'à la fin de sa fenêtre : un seul réseau peut alors renouveler
 * la fermeture à chaque fenêtre. La clé secrète est donc une condition de la connexion, pas seulement de l'inscription.
 *
 * 🔴 L'ORDRE, filet plein : sans jeton, rien n'est compté (la réponse ne coûte rien) ; avec un jeton, le réseau se
 * compte D'ABORD, puis Cloudflare vérifie le jeton. Une rafale de faux jetons reste ainsi bornée par le plafond du
 * réseau, et le jeton n'est jamais vérifié quand le filet a de la place (la console n'en joint qu'après un défi).
 */
export interface ReglageEssais {
  /** Par réseau du client et par adresse ; `max <= 0` le retire (la convention du dépôt). */
  readonly parReseau: { readonly max: number; readonly dureeMs: number };
  /** Par adresse, tous réseaux confondus ; `max <= 0` le retire. */
  readonly parAdresse: { readonly max: number; readonly dureeMs: number };
}

/** Le filet par adresse : trente essais par dix minutes, tous réseaux confondus. Au-delà, le défi. */
export const FILET_PAR_ADRESSE = { max: 30, dureeMs: 10 * 60_000 } as const;

export const MESSAGE_DEFI_REQUIS = 'Beaucoup d’essais de connexion sur ce compte : confirmez que vous n’êtes pas un robot, puis réessayez.';

export type VerdictEssai =
  | { readonly verdict: 'accepte' }
  /** 429 : le plafond du réseau, le filet quand aucun défi n'est possible, ou la base muette. */
  | { readonly verdict: 'refuse'; readonly attenteMs: number; readonly message: string }
  /** 403 `code: 'defi'` : le filet est plein, et le jeton du défi manque ou n'est pas valable. */
  | { readonly verdict: 'defi'; readonly message: string };

export interface EssaiDeMotDePasse {
  /** Le réseau du client (`reseauDuClient`). */
  readonly reseau: string;
  /** L'adresse e-mail, normalisée par l'appelant. */
  readonly adresse: string;
  /** Le jeton du défi joint à la requête, `''` sans. */
  readonly jeton: string;
  /** L'adresse du client transmise à Cloudflare (`ipIndicative`). */
  readonly ip: string;
}

const ATTENTE_SI_INDISPONIBLE_MS = 5_000;
let dernierAvertissement = Number.NEGATIVE_INFINITY;

/** 🔴 Échec fermé : une base qui ne répond pas refuse l'essai, comme les autres plafonds de la connexion. */
function baseMuette(err: unknown): VerdictEssai {
  const t = Date.now();
  if (t - dernierAvertissement >= 60_000) {
    dernierAvertissement = t;
    journaliser('error', 'plafond_partage_indisponible', { plafond: 'connexion.essai', siLaBaseEchoue: 'refuser', err });
  }
  return { verdict: 'refuse', attenteMs: ATTENTE_SI_INDISPONIBLE_MS, message: MESSAGE_PLAFOND_INDISPONIBLE };
}

/** L'attente avant la fin de la fenêtre `cle` d'un verdict, en millisecondes (horloge du compteur). */
function attente(v: VerdictDebit, cle: string): number {
  const f = v.fenetres.find((x) => x.cle === cle);
  return f ? Math.max(0, f.finMs - v.maintenantMs) : 0;
}

/** Compte un essai de mot de passe, puis exige le défi si le filet est plein. Ne lève jamais. */
export async function compterEssai(
  compteur: CompteurDebit,
  reglage: ReglageEssais,
  essai: EssaiDeMotDePasse,
  turnstile: VerificateurTurnstile | undefined,
): Promise<VerdictEssai> {
  const parReseau: Comptage | null = reglage.parReseau.max > 0
    ? { cle: `connexion.login|${empreinteTentative({ ip: essai.reseau }, essai.adresse)}`, dureeMs: reglage.parReseau.dureeMs, max: reglage.parReseau.max }
    : null;
  const parAdresse: Comptage | null = reglage.parAdresse.max > 0
    ? { cle: `connexion.adresse|${empreinteTentative({ ip: '*' }, essai.adresse)}`, dureeMs: reglage.parAdresse.dureeMs, max: reglage.parAdresse.max }
    : null;
  const fenetres = [parReseau, parAdresse].filter((c): c is Comptage => c !== null);
  if (fenetres.length === 0) return { verdict: 'accepte' };

  let v: VerdictDebit;
  try {
    v = await compteur.compter(fenetres);
  } catch (err) {
    return baseMuette(err);
  }
  if (v.accepte) return { verdict: 'accepte' };
  const pleine = (c: Comptage | null): boolean => c !== null && v.fenetres.some((f) => f.cle === c.cle && f.pleine);
  if (parAdresse === null || !pleine(parAdresse) || pleine(parReseau)) {
    // Le réseau a atteint son plafond : le refus d'avant ce lot, sur la bonne clé.
    return { verdict: 'refuse', attenteMs: attente(v, (parReseau ?? fenetres[0]!).cle), message: MESSAGE_TROP_DE_TENTATIVES };
  }

  // Le filet seul est plein.
  if (!turnstile) return { verdict: 'refuse', attenteMs: attente(v, parAdresse.cle), message: MESSAGE_TROP_DE_TENTATIVES };
  if (essai.jeton === '') return { verdict: 'defi', message: MESSAGE_DEFI_REQUIS };
  if (parReseau !== null) {
    let w: VerdictDebit;
    try {
      w = await compteur.compter([parReseau]);
    } catch (err) {
      return baseMuette(err);
    }
    if (!w.accepte) return { verdict: 'refuse', attenteMs: attente(w, parReseau.cle), message: MESSAGE_TROP_DE_TENTATIVES };
  }
  return (await turnstile.verifier(essai.jeton, essai.ip)) ? { verdict: 'accepte' } : { verdict: 'defi', message: MESSAGE_DEFI_ECHOUE };
}
