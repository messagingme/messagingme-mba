import { z } from 'zod';
import { journaliser } from '../lib/journal';
import { ipIndicative } from '../ops/tentatives';
import type { ChampPub } from './conversions-meta.pg';
import type { Fait } from './conversions-meta';

/**
 * L'ACCORD DONNÉ À LA CRÉATION D'UN COMPTE, ET L'INSCRIPTION QUI EN DÉCOULE (lot 2 du plan pixel). Les trois routes de
 * création (`/auth/signup`, `/auth/google`, `/oauth/consentement/google`) appellent `apresEntree` une fois l'entrée
 * réussie. La console envoie `pub: { accord: true, fbc?, fbp? }` quand la case est cochée, rien sinon.
 *
 * 🔴 PAS DE CASE COCHÉE, PAS D'ACCORD : sans `pub.accord === true`, rien ne s'écrit et rien ne part. Une entrée Google
 * marque seulement l'adresse comme prouvée (Google l'a vérifiée), ce qui ne fait rien partir à lui seul.
 */

/** Le format des identifiants de Meta (`fb.<version>.<horodatage>.<valeur>`), borné : tout le reste est ignoré. */
const IDENTIFIANT_META = /^fb\.[0-9]+\.[0-9]+\.[A-Za-z0-9_.-]+$/;
const identifiant = z.string().max(500).regex(IDENTIFIANT_META);
const corpsPub = z.object({
  pub: z.object({ accord: z.literal(true), fbc: z.unknown().optional(), fbp: z.unknown().optional() }),
}).loose();

/**
 * Lit le champ `pub` d'un corps non fiable. `null` sans accord explicite. `fbc` et `fbp` se valident un par un : une
 * valeur invalide est omise, elle ne fait pas perdre l'accord.
 */
export function lireChampPub(corps: unknown): ChampPub | null {
  const lu = corpsPub.safeParse(corps);
  if (!lu.success) return null;
  const champ: ChampPub = {};
  const fbc = identifiant.safeParse(lu.data.pub.fbc);
  const fbp = identifiant.safeParse(lu.data.pub.fbp);
  if (fbc.success) champ.fbc = fbc.data;
  if (fbp.success) champ.fbp = fbp.data;
  return champ;
}

/** Le navigateur d'une requête (`User-Agent`), `null` s'il est absent ou vide. */
export function navigateurDe(requete: { headers: Record<string, unknown> }): string | null {
  const ua = requete.headers['user-agent'];
  return typeof ua === 'string' && ua !== '' ? ua : null;
}

export interface DepsPubInscription {
  enregistrerConsentement(adresse: string, pub: ChampPub, navigateur: string | null): Promise<void>;
  marquerAdresseProuvee(adresse: string): Promise<void>;
  signaler(f: Fait): Promise<void>;
}

/**
 * Après une entrée réussie. `nouvelle` : l'identité vient de naître (seule une identité neuve fait une inscription) ;
 * `prouvee` : Google a vérifié l'adresse ; `requete` : celle de l'entrée, dont l'IP (`CF-Connecting-IP`, comme les
 * plafonds) et le navigateur sont ceux de la personne. 🔴 Ne lève jamais : l'entrée a réussi, une panne ici ne la
 * défait pas.
 */
export async function apresEntree(d: DepsPubInscription, e: {
  adresse: string;
  corps: unknown;
  nouvelle: boolean;
  prouvee: boolean;
  requete: { ip: string; headers: Record<string, unknown> };
}): Promise<void> {
  try {
    // D'abord la preuve, qui efface un accord donné avant elle ; puis l'accord de CETTE entrée, s'il est donné.
    if (e.prouvee) await d.marquerAdresseProuvee(e.adresse);
    const pub = lireChampPub(e.corps);
    if (pub === null) return;
    const navigateur = navigateurDe(e.requete);
    await d.enregistrerConsentement(e.adresse, pub, navigateur);
    if (e.nouvelle) {
      await d.signaler({
        evenement: 'CompleteRegistration', adresse: e.adresse, ip: ipIndicative(e.requete),
        ...(navigateur === null ? {} : { navigateur }),
      });
    }
  } catch (err) {
    journaliser('warn', 'pub_entree_echec', { err });
  }
}
