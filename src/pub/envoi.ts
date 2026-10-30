import { z } from 'zod';
import { journaliser } from '../lib/journal';
import {
  AGE_MAX_MS, consentementCouvre, construireEvenement, jobConversionSchema,
  type ConversionAEnvoyer, type EvenementGraph, type JobConversion,
} from './conversions-meta';

/**
 * L'ENVOI À META ET LE TRAVAIL DE LA FILE `conversions-meta` (lot 2 du plan pixel) : un job = UNE tentative d'une
 * conversion du journal, sur le modèle des e-mails du produit (`src/emails-produit/envoi.ts`).
 *
 * Tout ce qui décide se relit AU MOMENT D'ENVOYER : la fonction allumée, l'accord de la personne (retiré entre-temps :
 * rien ne part), la preuve de son adresse, l'âge du fait. Un échec passager (429, 5xx, panne réseau) laisse la
 * conversion `a_envoyer` avec l'heure du prochain essai, que le balayage reprend ; au troisième échec, ou sur un refus
 * définitif de Meta (un 4xx qui n'est pas 429), elle passe `echec`. Aucune transaction n'est ouverte pendant l'appel.
 */

/** L'attente avant chaque nouvel essai : 5 min, puis 30 min. Au troisième échec, la conversion est un échec. */
export const DELAIS_REESSAI_MS: readonly number[] = [5 * 60_000, 30 * 60_000];

export class ErreurConversions extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ErreurConversions';
  }
}

const reponseErreur = z.object({ error: z.object({ message: z.string().optional() }).loose() }).loose();

/**
 * Le client de la Conversions API : `POST /{pixel}/events`. 🔴 Le jeton part dans le CORPS, jamais dans l'adresse (une
 * adresse se retrouve dans les journaux d'un proxy). Dix secondes au plus : Meta qui pend ne retient pas le worker.
 */
export function creerClientConversions(opts: {
  pixelId: string;
  jeton: string;
  /** `META_GRAPH_VERSION`, la même que les autres clients de Meta. */
  version: string;
  fetch?: typeof fetch;
}): (evenement: EvenementGraph) => Promise<void> {
  const appeler = opts.fetch ?? fetch;
  const adresse = `https://graph.facebook.com/${opts.version}/${encodeURIComponent(opts.pixelId)}/events`;
  return async (evenement) => {
    const res = await appeler(adresse, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: [evenement], access_token: opts.jeton }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return;
    const lu = reponseErreur.safeParse(await res.json().catch(() => null));
    throw new ErreurConversions(res.status, (lu.success ? lu.data.error.message : undefined) ?? `HTTP ${res.status}`);
  };
}

export interface DepsTravailConversion {
  pourEnvoi(id: string): Promise<ConversionAEnvoyer | null>;
  prendre(id: string, tentative: number): Promise<boolean>;
  noterEnvoye(id: string): Promise<void>;
  noterEchec(id: string, raison: string, reessayerLe: Date | null): Promise<void>;
  noterIgnore(id: string, raison: string): Promise<void>;
  /** La Conversions API, `null` = fonction éteinte (`META_PIXEL_ID` ou `META_CAPI_TOKEN` absent) : rien ne part. */
  envoyer: ((evenement: EvenementGraph) => Promise<void>) | null;
  /** La console (`APP_URL`), dont les pages sont la source déclarée des événements. */
  urlConsole: string;
  now?: () => Date;
}

/** Un refus qu'un nouvel essai ne changera pas : un 4xx de Meta autre que 429 (jeton, pixel ou données refusés). */
function estDefinitif(err: unknown): boolean {
  return err instanceof ErreurConversions && err.status >= 400 && err.status < 500 && err.status !== 429;
}

function raisonDe(err: unknown): string {
  if (err instanceof ErreurConversions) return `meta ${err.status} : ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export function creerTravailConversion(d: DepsTravailConversion): (data: unknown) => Promise<void> {
  const maintenant = d.now ?? (() => new Date());
  return async (data) => {
    const lu = jobConversionSchema.safeParse(data);
    if (!lu.success) {
      journaliser('error', 'conversion_meta_job_illisible', { issues: lu.error.issues.length });
      return;
    }
    const job: JobConversion = lu.data;
    const c = await d.pourEnvoi(job.conversionId);
    // Périmée : déjà partie, ignorée, en échec définitif, ou une autre tentative est passée avant ce job.
    if (c === null || c.statut !== 'a_envoyer' || c.tentatives !== job.tentative) return;

    if (d.envoyer === null) return d.noterIgnore(c.id, 'eteint');
    // 🔴 Relu ici, pas à la réservation : un retrait entre les deux est respecté, et un fait antérieur à l'accord ne
    // part jamais.
    if (!consentementCouvre(c)) return d.noterIgnore(c.id, 'sans_accord');
    if (maintenant().getTime() - c.creeLe.getTime() > AGE_MAX_MS) return d.noterIgnore(c.id, 'trop_ancien');
    if (!(await d.prendre(c.id, job.tentative))) return;

    // Tout ce qui suit la prise est dans le `try` : une exception hors de lui laisserait la conversion sous bail,
    // reprise toutes les dix minutes sans jamais finir.
    try {
      await d.envoyer(construireEvenement(c, { urlConsole: d.urlConsole }));
      await d.noterEnvoye(c.id);
    } catch (err) {
      const faites = job.tentative + 1;
      const delai = DELAIS_REESSAI_MS[faites - 1];
      const reessayerLe = estDefinitif(err) || delai === undefined ? null : new Date(maintenant().getTime() + delai);
      journaliser(reessayerLe === null ? 'error' : 'warn', 'conversion_meta_echec', {
        err: raisonDe(err), evenement: c.evenement, tentative: faites, definitif: reessayerLe === null,
      });
      await d.noterEchec(c.id, raisonDe(err), reessayerLe);
    }
  };
}

/** Le balayage : remet en file les conversions jamais enfilées et celles dont l'heure du prochain essai est passée. */
export async function reprendreLesConversions(d: {
  aReprendre(limite: number): Promise<Array<{ id: string; tentatives: number }>>;
  enfiler(job: JobConversion): Promise<void>;
}, limite = 200): Promise<number> {
  const lignes = await d.aReprendre(limite);
  for (const l of lignes) await d.enfiler({ conversionId: l.id, tentative: l.tentatives });
  return lignes.length;
}
