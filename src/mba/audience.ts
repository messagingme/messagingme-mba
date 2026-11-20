import { journaliser } from '../lib/journal';
import { leMbaRepond, sousLOffre, type ReglageDuRepondeur } from '../repondeur/mode';
import type { Fonction } from '../offres/offres';
import { ecrireAudience, type AudienceDeLAgent, type ClientReglages } from './client';

/**
 * 🔴 L'AUDIENCE VOULUE DE L'AGENT DE META (décision de Julien du 2026-11-20).
 *
 * Quand l'agent de Meta EST le répondeur de l'espace (« Qui répond au client » vaut « L'agent de Meta », agent allumé),
 * il répond à TOUT LE MONDE (\`EVERYONE\`) : un inconnu qui écrit au numéro lui arrive directement, sans dépendre de la
 * liste que la plateforme tient. Sinon (l'équipe, un agent IA, un scénario, votre application), la LISTE
 * (\`ALLOWLISTED_ONLY\`) : il ne parle qu'aux contacts qu'un bloc « Envoyer au MBA » lui confie, et un message libre ne lui
 * arrive pas par-dessus le répondeur choisi.
 *
 * ⚠️ En \`EVERYONE\`, un agent répond aussi aux réponses à nos modèles, par-dessus nos scénarios (mesuré le 2026-09-29),
 * sauf si le routage des conversations de Meta Business Suite adresse les réponses aux modèles à Messaging Me (réglé à
 * la main par l'entreprise, sans API ; la fiche d'aide du répondeur de Meta le décrit).
 */
export function audienceVoulue(r: ReglageDuRepondeur): AudienceDeLAgent {
  return leMbaRepond(r) ? 'EVERYONE' : 'ALLOWLISTED_ONLY';
}

export interface DepsAlignementAudience {
  /** Les réglages du répondeur de l'espace, tels qu'ils sont APRÈS le geste qui vient d'avoir lieu. */
  reglages: { get(tenantId: string): Promise<ReglageDuRepondeur> };
  /** Le numéro de l'espace ; \`null\` = aucun numéro, donc aucun agent à régler. */
  numero(tenantId: string): Promise<string | null>;
  client(tenantId: string): Promise<ClientReglages>;
}

/**
 * Aligne l'audience de l'agent chez Meta sur le répondeur de l'espace. Appelée APRÈS chaque geste qui change le
 * répondeur ou l'allumage (le choix de « Qui répond au client », l'interrupteur de l'Accueil, l'onglet Aperçu, l'assistant
 * de configuration) : le geste est déjà écrit chez nous et chez Meta, donc 🔴 au mieux, sans jamais lever (un échec
 * ferait réessayer un geste passé) ; l'échec se journalise. Aucune écriture si Meta porte déjà l'audience voulue.
 */
export function creerAlignerAudience(d: DepsAlignementAudience): (tenantId: string) => Promise<void> {
  return async (tenantId) => {
    try {
      const pn = await d.numero(tenantId);
      if (pn === null) return;
      const audience = audienceVoulue(await d.reglages.get(tenantId));
      if (await ecrireAudience(await d.client(tenantId), pn, audience)) {
        journaliser('info', 'mba_audience_alignee', { tenantId, audience });
      }
    } catch (err) {
      journaliser('error', 'mba_audience_non_alignee', { err, tenantId });
    }
  };
}

export interface DepsRealignement extends DepsAlignementAudience {
  reglages: DepsAlignementAudience['reglages'] & { tenantsAvecNumeroRelie(): Promise<string[]> };
  /** L'offre de l'espace : en Base, l'agent de Meta est gelé (`sousLOffre`), donc il n'est plus le répondeur. */
  offres: { offreDe(tenantId: string): Promise<{ droits: { fonctions: ReadonlySet<Fonction> } }> };
}

/**
 * 🔴 LE FILET : réaligne l'audience de chaque espace qui a un numéro, à intervalle régulier (`src/worker.ts`) et au
 * démarrage (relecture du 2026-11-20). L'alignement au geste peut échouer (Meta en panne, la liste qui lève avant), et
 * des chemins changent le répondeur sans geste (une offre retirée, `PUT /settings` qui éteint le drapeau, une course
 * avec le passage de main) : sans ce filet, un agent resté ouvert à TOUT LE MONDE répondrait par-dessus le répondeur
 * choisi, sans fin. Avant la décision du 2026-11-20, c'était chaque écriture qui ramenait la liste. Sous l'offre de
 * l'espace (`sousLOffre`) : les gestes, eux, ne sont ouverts qu'aux offres qui ont l'agent de Meta. Un échec reste
 * local à l'espace et se journalise ; rend le nombre d'audiences écrites.
 */
export async function realignerLesAudiences(d: DepsRealignement): Promise<number> {
  let ecrites = 0;
  for (const tenantId of await d.reglages.tenantsAvecNumeroRelie()) {
    try {
      const pn = await d.numero(tenantId);
      if (pn === null) continue;
      const [r, o] = await Promise.all([d.reglages.get(tenantId), d.offres.offreDe(tenantId)]);
      const audience = audienceVoulue(sousLOffre(r, o.droits.fonctions));
      if (await ecrireAudience(await d.client(tenantId), pn, audience)) {
        ecrites += 1;
        journaliser('info', 'mba_audience_realignee', { tenantId, audience });
      }
    } catch (err) {
      journaliser('error', 'mba_audience_non_realignee', { err, tenantId });
    }
  }
  return ecrites;
}
