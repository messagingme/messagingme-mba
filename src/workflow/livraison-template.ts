import type { LivraisonTemplatesSink } from '../webhooks/delivery';

/**
 * L'accusé de Meta d'un template envoyé par un bloc de scénario, rendu au parcours qui l'attend (Julien, 2026-11-20) :
 * `failed` le fait partir par la sortie « En cas d'échec », `delivered` ou `read` par sa suite. Seul un template dont
 * cette sortie est branchée attend un accusé (`walk`) ; pour tous les autres, l'exécuteur ne fait rien.
 *
 * 🔴 « Jamais deux rattrapages pour un même échec » (décision 3) : quand le scénario prend la sortie, le destinataire de
 * campagne qui porte ce même message (un parcours d'événement né sur le template de la campagne) sort des relances.
 */
export interface DepsLivraisonTemplate {
  /** L'envoi de bloc qui porte ce message (sa mesure `sent`), ou `null` pour un message hors scénario. */
  envoiDuMessage(wamid: string): Promise<{ tenantId: string; waId: string; workflowId: string; nodeId: string } | null>;
  parcours: {
    templateLivre(tenantId: string, waId: string, wamid: string, bloc: { workflowId: string; nodeId: string }): Promise<boolean>;
    templateNonLivre(
      tenantId: string, waId: string, wamid: string, bloc: { workflowId: string; nodeId: string }, avantDAvancer: () => Promise<unknown>,
    ): Promise<boolean>;
  };
  /** Retire des relances de campagne le destinataire dont ce message est l'envoi. */
  cederAuScenario(wamid: string): Promise<unknown>;
}

export function creerLivraisonTemplates(deps: DepsLivraisonTemplate): LivraisonTemplatesSink {
  return {
    async surAccuse(wamid, status) {
      const envoi = await deps.envoiDuMessage(wamid);
      if (!envoi) return;
      const bloc = { workflowId: envoi.workflowId, nodeId: envoi.nodeId };
      if (status !== 'failed') {
        await deps.parcours.templateLivre(envoi.tenantId, envoi.waId, wamid, bloc);
        return;
      }
      // La cession AVANT l'avance : une relance de campagne ne doit pas partir pendant que la branche d'échec envoie. Un
      // parcours qui n'attend pas (sortie non branchée, déjà reparti) ne cède rien, et la campagne relance comme avant.
      await deps.parcours.templateNonLivre(envoi.tenantId, envoi.waId, wamid, bloc, () => deps.cederAuScenario(wamid));
    },
  };
}
