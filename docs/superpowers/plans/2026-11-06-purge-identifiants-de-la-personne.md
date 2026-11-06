# La purge vise chaque table par tous les identifiants de la personne (2026-11-06)

Suite du lot `1a9e6e73` (plan `2026-11-06-purge-echecs-de-scenario.md`), demandée par Julien le jour même. Deux trous de
`PgContactStore.purgeMany` (`src/crm/contact-store.pg.ts`), de la même famille :

- `workflow_runs` et `automation_fires` ne sont visés que par les numéros des FILS de la personne (todo du 2026-10-03,
  revue finale du widget) ;
- `waIdsDeLaPersonne` (les numéros des fils, les chiffres de la fiche) ne contient le BSUID de la fiche que par un fil
  encore vivant.

La rétention efface les fils et garde la fiche : une demande d'effacement tardive laisse le numéro, ou le BSUID, dans
ces tables.

## Les tables, une par une

- `workflow_runs`, `automation_fires` : le `waId` de l'exécuteur (chiffres nus ou BSUID). Ils passent au jeu commun.
  Effacer un parcours emporte en cascade ses sessions d'agent IA et leurs appels d'outils (0086), comme aujourd'hui pour
  une personne qui a encore un fil.
- `widget_tirs`, `workflow_node_events` (anonymisées, pas effacées), `webhook_events`, `echecs_messages`,
  `workflow_advance_failures` : déjà au jeu commun ; ils gagnent le BSUID, et `workflow_advance_failures` perd son jeu à
  lui.
- `application_premiers_messages` (un CHECK n'y admet que des chiffres) et `mba_liste` (un BSUID n'y entre jamais, et le
  retrait chez Meta passe par l'identifiant de l'entrée) : le BSUID n'y change rien.
- `agent_actions` : part avec sa conversation (cascade), rien à faire.

## Tâches

1. `waIdsDeLaPersonne` = les numéros des fils, les chiffres de la fiche et le BSUID des fiches visées, calculé juste
   après les fils ; `workflow_runs` et `automation_fires` passent dessus ; l'alias `waIdsAAnonymiser` et le jeu
   `waIdsDesEchecs` disparaissent.
2. `tests/integration/purge-rgpd.integration.test.ts` : une personne au seul BSUID, sans fil, avec une ligne sous son
   BSUID dans chaque table qui peut en porter, et la même chez un autre espace, qui reste ; une personne au numéro, sans
   fil, pour `workflow_runs` et `automation_fires`. Le cas BSUID de `workflow_advance_failures` y entre.
3. Doc : `documentation.md` (la règle, à côté de celle des colonnes de `contacts` ; `widget_tirs` ;
   `workflow_advance_failures`), le journal technique (et le déploiement du lot précédent), le todo.

## Tests attendus

Dans les deux sens, par deux commits mutés sur des étiquettes jetables, avec l'accord de Julien : le BSUID retiré du jeu
commun, seuls les cas BSUID rougissent ; `workflow_runs` et `automation_fires` remis aux seuls fils, seuls leurs cas
rougissent.

## Ordre de déploiement

Aucune migration, aucun écran. API et workers par `deploy-scaleway.yml` (`migration=aucune`, `commit=<sha>`), approuvé
par Julien.

## Méthode de livraison

En direct (moi), dans la copie à part du lot précédent, puis UNE relecture indépendante, parce que le changement tient
dans une fonction et se défait sans migration, mais que la production emprunte la purge à chaque suppression de contact
et qu'elle efface pour de bon, sessions d'agent comprises. Les critères sont vérifiables par le test d'intégration.
Essai réel qui clôt le lot, sur SANDBOX : un contact qui a un parcours en attente, supprimé depuis la console ; Claude
relit en base, en lecture seule, que ses parcours, déclenchements et lignes de journal sont partis. Le cas « sans fil »
ne se fabrique pas à la demande (il faut la rétention) : seul le test d'intégration le couvre.
