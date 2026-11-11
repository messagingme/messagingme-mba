# Bloc « Action » : plusieurs actions dans un bloc, retrait et vidage multiples (2026-11-11)

Demande de Julien : mettre à jour trois champs oblige aujourd'hui à poser trois blocs. Un « + » dans le panneau de
droite ajoute une action au même bloc, jouée à la suite. « Vider un champ » et « Retirer une étiquette » prennent une
LISTE. Décidé avec lui : liste seulement (pas d'option « toutes »), « Ajouter une étiquette » reste à une seule.

## Forme des données

- La première action reste À PLAT dans `data` (`actionKind`, `tag`, `fieldKey`...), les suivantes vont dans
  `data.suite` (liste d'objets de même forme). Un bloc d'avant n'a pas de `suite` et se lit à l'identique : aucune
  migration, et chaque lecteur actuel de la première action reste juste.
- `remove_tag` lit `tags: string[]`, sinon `tag`. `clear_field` lit `champs: [{ key, label }]`, sinon `fieldKey`.
- Un seul point de lecture, partagé console et serveur : `web/lib/partage/actions-bloc.ts` (`sousActions`,
  `etiquettesARetirer`, `champsAVider`).

## Tâches

1. Moteur (`src/workflow/engine.ts`) : `walk` joue chaque sous-action dans l'ordre, chacune répercutée sur la copie de
   travail avant la suivante (une condition plus loin voit tout). `actionOf` garde sa réponse (première action).
2. Lecteurs du bloc : `tagsInGraph` (`src/http/workflows.ts`), valeur dynamique de `buildCtx` (`executor.ts`), marqueur
   de fin de `recette-graphe.ts`, résumé `node-list.ts` (MCP).
3. Console : panneau (`WorkflowConfigPanel.tsx`) une carte par action, « + Ajouter une action », retrait d'une action,
   listes multiples ; résumé du canevas (`WorkflowNode.tsx`).
4. Tests : moteur (ordre, copie de travail, listes, bloc d'avant inchangé), lecteurs, e2e `workflow-action.spec.ts`.
5. `features.md` § bloc « Action ».

## Ordre de déploiement

L'écran publie à chaque push, l'API attend son déploiement. Un graphe enregistré avec une `suite` par la console neuve
et joué par l'ancien moteur ne ferait que la PREMIÈRE action, en silence ; pire, un retrait d'étiquettes (`tags` seul) ou
un vidage de champs (`champs` seul) n'y ferait RIEN, même sans `suite`. Donc serveur d'abord (push, CI, déploiement
`migration=aucune`), console ensuite. Aucune migration.

## Méthode de livraison

**En direct, puis UNE relecture indépendante du diff**, parce que le moteur de scénarios est un chemin que la production
emprunte à chaque message, mais que le changement est réversible, sans migration, et que ses critères se vérifient par
des tests du moteur. Essai réel qui clôt : un scénario de test sur un espace de test, un bloc Action à trois actions
(poser deux champs, retirer deux étiquettes), déclenché depuis un vrai téléphone, fiche du contact relue ensuite.
