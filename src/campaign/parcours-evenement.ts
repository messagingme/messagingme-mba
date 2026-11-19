import { z } from 'zod';
import { composantReponseRapide } from '../meta/template-components';
import { ORIGINE_MAX } from '../workflow/evenement';
import type { TypeDeLancementEvenement } from '../workflow/lancements';

/**
 * LE PONT DU PARCOURS D'ÉVÉNEMENT (menu « Scénario », lot 4, décision 28 ; migration 0297, `campaigns.parcours_evenement`).
 *
 * Une campagne d'envoi public peut porter le scénario et le bloc d'un parcours d'événement : son template part avec les
 * payloads `btn:<i>` de ses réponses rapides, et quand Meta l'a accepté, le moteur de campagne enregistre la mesure
 * « envoyé » du bloc puis demande le parcours (départ `deja_envoye`), du type que le pont porte. Posé par l'option INTERNE
 * de l'envoi public, jamais lu du corps HTTP. Le circuit Shopify le pose depuis le lot 5 ; les circuits HubSpot (lot 6b),
 * avec leur type.
 */

/**
 * Les types d'événement que le pont porte : ceux de la table des lancements (`TypeDeLancementEvenement`), tenus égaux par
 * `tests/campaign-engine.test.ts`. Un type ordinaire n'y entre jamais : il ne naît pas sur un bloc déjà envoyé.
 */
const TYPES_DU_PONT = ['evenement_shopify', 'evenement_hubspot'] as const satisfies readonly TypeDeLancementEvenement[];

export interface ParcoursEvenementDeCampagne {
  workflowId: string;
  noeudId: string;
  /** Le type du parcours qui naîtra, donc le rayon de son scénario (Shopify ou HubSpot). */
  type: TypeDeLancementEvenement;
  /** L'origine de l'événement (la boutique, l'événement, sa référence) ; les variables viennent de chaque destinataire. */
  origine: string;
  /** Les boutons du template du bloc, dans l'ordre du template : chaque réponse rapide part avec son payload `btn:<i>`. */
  boutons: Array<{ type: string; text: string }>;
}

const schema = z.object({
  workflowId: z.string().min(1),
  noeudId: z.string().min(1),
  type: z.enum(TYPES_DU_PONT),
  origine: z.string().min(1).max(ORIGINE_MAX),
  boutons: z.array(z.object({ type: z.string(), text: z.string() })).max(10),
});

/**
 * Relit le jsonb `campaigns.parcours_evenement`, une entrée non fiable : `safeParse`. Illisible, la campagne envoie comme
 * une campagne template ordinaire (aucun parcours ne naîtra), et le refus se journalise.
 */
export function lireParcoursEvenement(brut: unknown, campaignId: string): ParcoursEvenementDeCampagne | null {
  if (brut === null || brut === undefined) return null;
  const lu = schema.safeParse(brut);
  if (!lu.success) {
    // eslint-disable-next-line no-console
    console.error(`campagne ${campaignId}: parcours_evenement illisible, aucun parcours ne naîtra de ses envois`);
    return null;
  }
  return lu.data;
}

/**
 * Les composants « bouton » d'un template porteur de parcours : un payload `btn:<i>` par réponse rapide, à son index dans
 * le template. Sans eux, Meta rend le texte du bouton au clic, et aucune branche du parcours n'est choisie.
 */
export function payloadsDesReponsesRapides(boutons: ReadonlyArray<{ type: string }>): unknown[] {
  return boutons.flatMap((b, i) => (b.type === 'QUICK_REPLY'
    ? [composantReponseRapide(i, `btn:${i}`)]
    : []));
}
