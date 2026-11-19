import { z } from 'zod';
import type { LigneHubspot } from './lignes';
import { prefixeHubspot, type FamilleHubspot } from './origine';

/**
 * LA RÈGLE « LE PARCOURS EST-IL ENCORE VOULU ? » D'UN PARCOURS HUBSPOT (menu « Scénario », lot 6b, relecture de 6a). Le
 * pendant de `../shopify/parcours-voulu.ts` : l'exécuteur la lit à chaque reprise et à chaque réponse d'un parcours
 * d'événement (`parcoursEncoreVoulu`) ; faux, le parcours se clôt sans rien envoyer ni passer à l'équipe.
 *
 * Plus voulu : la ligne de l'origine (`hubspot:<famille>:<ligne>:...`, `./origine.ts`) absente de l'espace, éteinte, ou
 * d'une autre famille. Éteindre ou supprimer une ligne arrête déjà ses parcours par leur préfixe (`./lignes-gestion.ts`) ;
 * cette règle rattrape celui que l'arrêt a manqué (né pendant qu'on l'éteignait). 🔴 Une origine `hubspot:` illisible
 * (une famille que cette règle ne relit pas, une ligne qui n'est pas un identifiant) n'est PLUS voulue : elle ne peut pas
 * venir du circuit, et la laisser vivre à vie serait la panne muette. Toute autre source reste voulue, sans rien lire.
 */

/** Ce que la règle lit : le magasin des lignes, passé ENTIER (ses méthodes lisent `this`). */
export interface LecturesParcoursHubspot {
  lire(tenantId: string, id: string): Promise<LigneHubspot | null>;
}

/** Les familles dont l'origine porte une ligne : celles que produit `origineHubspot`. */
const FAMILLES_RELUES: readonly FamilleHubspot[] = ['etape', 'rdv'];
const IDENTIFIANT = z.string().uuid();

export async function parcoursHubspotEncoreVoulu(lignes: LecturesParcoursHubspot, tenantId: string, origine: string): Promise<boolean> {
  if (!origine.startsWith(prefixeHubspot())) return true;
  const [, famille, ligne] = origine.split(':');
  if (!FAMILLES_RELUES.includes(famille as FamilleHubspot) || !IDENTIFIANT.safeParse(ligne).success) return false;
  const l = await lignes.lire(tenantId, ligne!);
  return l !== null && l.actif && l.famille === famille;
}
