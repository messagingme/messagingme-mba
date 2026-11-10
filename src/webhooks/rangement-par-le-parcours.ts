/**
 * LE RANGEMENT D'UN FORMULAIRE PAR LE BLOC QUI L'A ENVOYÉ (Julien, 2026-11-10 ; la règle :
 * `web/lib/partage/rangement-formulaire.ts`).
 *
 * Quand un formulaire rempli arrive et que le contact attend sur un bloc Formulaire, les éléments que CE bloc range
 * s'écrivent ici, sur la fiche, et leurs clés reviennent à `processFlowCompletions`, qui ne les range pas une seconde
 * fois selon le réglage du formulaire. Les autres éléments suivent le réglage du formulaire, comme avant.
 *
 * 🔴 ICI, ET PAS DANS L'AVANCE DU PARCOURS. L'avance peut ne pas avoir lieu (fil tenu par un opérateur, tour pris par
 * un autre traitement) : si l'écriture en dépendait, un élément retiré au réglage du formulaire ne s'écrirait nulle
 * part. Décider et écrire au même endroit tient l'invariant « jamais deux fois, jamais nulle part ».
 *
 * 🔴 Le bloc ne range que la réponse AU FORMULAIRE QU'IL A ENVOYÉ, reconnu à son `flow_token`
 * (`formulaireDuJeton`) : n'importe quel formulaire renvoyé fait avancer le bloc (décision de Julien du 2026-10-15),
 * mais les clés de nos formulaires sont des mots courants, et un autre formulaire rempli pendant l'attente aurait été
 * rangé selon ce bloc (relecture du 2026-11-10). Sans jeton qui nomme le formulaire du bloc, il ne range rien. Une clé
 * que la réponse ne porte pas n'écrit rien.
 *
 * ⚠️ Limite acceptée : une redélivrance par Meta APRÈS que le parcours a quitté le bloc retombe sur le seul réglage du
 * formulaire (le bloc n'est plus là pour dire ce qu'il range).
 */
import { messageDe } from '../lib/erreur';
import type { EntrantRattache } from './rattachement';
import type { WorkflowGraph } from '../workflow/graph';
import { grapheDuRun } from '../workflow/executor';
import { formulaireDuJeton, rangementDuBloc, valeurEnTexte } from '../../web/lib/partage/rangement-formulaire';

export interface RangementParLesParcours {
  /** Écrit les éléments de `reponse` que le bloc Formulaire en attente range, et rend leurs clés (vide sinon). */
  ranger(tenantId: string, waId: string, reponse: Record<string, unknown>): Promise<ReadonlySet<string>>;
}

const AUCUNE: ReadonlySet<string> = new Set();

export function creerRangementParLesParcours(deps: {
  trouverEnAttente(tenantId: string, waId: string): Promise<{ workflowId: string; currentNode: string | null; grapheFige: WorkflowGraph | null } | null>;
  /** Le graphe d'un scénario, pour un parcours lancé sans graphe figé (comme l'exécuteur, `grapheDuRun`). */
  graphe(tenantId: string, workflowId: string): Promise<WorkflowGraph | null>;
  /** L'écriture de fiche du parcours (`ecrituresDeFiche.setField`), qui remonte un champ HubSpot comme l'exécuteur. */
  ecrire(tenantId: string, waId: string, cle: string, valeur: string): Promise<void>;
}): RangementParLesParcours {
  return {
    async ranger(tenantId, waId, reponse) {
      const run = await deps.trouverEnAttente(tenantId, waId);
      if (!run?.currentNode) return AUCUNE;
      const graph = await grapheDuRun(run, () => deps.graphe(tenantId, run.workflowId));
      const bloc = graph?.nodes.find((n) => n.id === run.currentNode);
      if (!bloc || bloc.type !== 'flow') return AUCUNE;
      if (formulaireDuJeton(reponse.flow_token) !== String(bloc.data.flowId ?? '')) return AUCUNE;
      const cles = new Set<string>();
      for (const [cle, champ] of Object.entries(rangementDuBloc(bloc.data))) {
        if (!Object.prototype.hasOwnProperty.call(reponse, cle)) continue;
        // La clé appartient au bloc dès qu'il la cite, même « ne pas enregistrer » ou en échec d'écriture : le réglage du
        // formulaire ne doit pas l'écrire ailleurs.
        cles.add(cle);
        const valeur = valeurEnTexte(reponse[cle]);
        if (champ === '' || valeur === null) continue;
        try {
          await deps.ecrire(tenantId, waId, champ, valeur);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`formulaire : élément « ${cle} » NON rangé dans « ${champ} » pour ${waId} (bloc ${bloc.id}):`, messageDe(err));
        }
      }
      return cles;
    },
  };
}

/**
 * Le rangement par le bloc de chaque formulaire rempli du lot, par wamid. Mêmes entrants que l'avance des parcours : un
 * `standby` n'avance aucun parcours, il ne range rien non plus. Une panne sur un message laisse ce message au seul
 * réglage du formulaire (aucune entrée), sans priver les autres.
 */
export async function rangerParLesParcours(
  entrants: readonly EntrantRattache[], parcours: RangementParLesParcours,
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const out = new Map<string, ReadonlySet<string>>();
  for (const { message: m, tenantId } of entrants) {
    if (!tenantId || m.reponseFormulaire === undefined) continue;
    if (m.field && m.field !== 'messages') continue;
    try {
      const cles = await parcours.ranger(tenantId, m.waId, m.reponseFormulaire);
      if (cles.size > 0) out.set(m.messageId, cles);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`formulaire : rangement par le parcours ignoré pour ${m.waId} (message ${m.messageId}):`, messageDe(err));
    }
  }
  return out;
}
