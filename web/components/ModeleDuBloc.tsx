'use client';

import { Modale } from '@/components/Modale';
import { TemplateForm } from '@/components/TemplateForm';
import { creerModeleDuBloc, type ModeleCreeDepuisUnBloc, type TemplateParamHint, type TemplateSummary } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Écrire ou modifier le template d'un bloc sans quitter le scénario (menu « Scénario », lot 3). Le formulaire est celui
 * de l'écran Templates, en mode bloc (`pourUnBloc`) : il crée TOUJOURS un nouveau template, sous un nom que le serveur
 * donne. 🔴 L'enregistrement automatique se vide AVANT l'appel : le serveur cherche le bloc dans le brouillon qu'il
 * connaît, et un bloc posé à l'instant n'y est pas encore (l'enregistrement attend 1,2 s).
 */
export function ModeleDuBloc({ tenantId, workflowId, nodeId, initial, sourcesDuBloc, enregistrerMaintenant, onCree, onClose }: {
  tenantId: string;
  workflowId: string;
  nodeId: string;
  /** « Modifier ce template » : le template que le bloc envoie, qui pré-remplit le formulaire. Absent : un template neuf. */
  initial?: TemplateSummary;
  /** Les choix de variables du bloc, qui recouvrent ceux du template. */
  sourcesDuBloc?: TemplateParamHint[];
  /** Vide l'enregistrement automatique ; false : le bloc n'est pas encore enregistré, rien n'est envoyé à Meta. */
  enregistrerMaintenant: () => Promise<boolean>;
  /** Le template créé : l'hôte le pose dans le bloc et réaligne ses flèches. */
  onCree: (cree: ModeleCreeDepuisUnBloc) => void;
  onClose: () => void;
}) {
  const t = useT();
  const soumettre = async (input: Parameters<typeof creerModeleDuBloc>[3]): Promise<void> => {
    if (!(await enregistrerMaintenant())) {
      throw new Error(t('Modifications pas encore enregistrées : rien n’a été envoyé à Meta. Réessayez dans un instant.', 'Changes not saved yet: nothing was sent to Meta. Try again in a moment.'));
    }
    onCree(await creerModeleDuBloc(tenantId, workflowId, nodeId, input));
  };
  return (
    <Modale
      titre={initial ? t('Modifier ce template', 'Edit this template') : t('Écrire un nouveau template', 'Write a new template')}
      taille="large"
      testId="modele-du-bloc"
      fermeture="boutons"
      onClose={onClose}
    >
      <TemplateForm tenantId={tenantId} initial={initial} onCreated={() => {}} pourUnBloc={{ soumettre, ...(sourcesDuBloc ? { sourcesDuBloc } : {}) }} />
    </Modale>
  );
}
