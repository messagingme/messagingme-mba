# La purge d'un contact efface aussi ses échecs de scénario (2026-11-06)

Relevé par la relecture indépendante du lot sur la raison d'un envoi refusé en cours de parcours (3ff58e33, jaune
n° 8), et antérieur à ce lot : `PgContactStore.purgeMany` (`src/crm/contact-store.pg.ts`) efface `echecs_messages` par
numéro, mais pas `workflow_advance_failures` (migration 0108). Le numéro d'un contact effacé reste lisible dans
Sécurité > Journal des erreurs jusqu'à 90 jours (`AVANCE_ECHECS_RETENTION_DAYS`), alors que `features.md` promet que ce
journal « disparaît avec le contact quand vous le supprimez ».

## La forme du numéro

La table porte le `waId` de l'exécuteur ou du message entrant : chiffres nus, ou BSUID. Son lecteur
(`listerEchecsAvance`, `src/ops/erreurs-livraison.pg.ts`) rattache la fiche par `matchWaIdPredicat` : E.164 exact,
chiffres nus, BSUID. `waIdsDeLaPersonne` (les numéros des fils, les chiffres de la fiche) couvre les deux premières
formes ; le BSUID de la fiche n'y entre que par un fil encore vivant, or la rétention efface les fils et garde la fiche.

## Tâches

1. Dans la transaction de `purgeMany`, à côté d'`echecs_messages` : `delete from workflow_advance_failures where
   tenant_id = $1 and wa_id = any($2::text[])`, par `waIdsDeLaPersonne` plus le BSUID des fiches visées.
2. `tests/integration/purge-rgpd.integration.test.ts` : la ligne de la personne part, celle d'un autre espace sur le
   même numéro reste ; une fiche au seul BSUID, sans fil, perd la sienne.
3. Doc : `documentation.md` (la table, dans la liste « Journal »), le journal technique, le todo.

Hors périmètre, noté au todo : les autres tables que la purge vise par `waIdsDeLaPersonne` (`echecs_messages`,
`widget_tirs`, `mba_liste`, `webhook_events`...) n'atteignent pas non plus le BSUID d'une fiche dont le fil est parti.

## Tests attendus

Le cas d'intégration ne tourne qu'en CI, sur un Postgres jetable. Dans les deux sens, par des commits mutés sur des
étiquettes jetables, avec l'accord de Julien : le `delete` retiré, les deux cas rougissent ; le BSUID retiré, seul le
cas de la fiche au BSUID rougit.

## Ordre de déploiement

Aucune migration, aucun écran. API et workers par `deploy-scaleway.yml` (`migration=aucune`, `commit=<sha>`), approuvé
par Julien.

## Méthode de livraison

En direct (moi), dans une copie à part du code d'origin, puis UNE relecture indépendante, parce que le changement tient
en une requête et se défait sans migration, mais que la production emprunte ce chemin à chaque suppression de contact et
que le filtre `tenant_id` y est le seul contrôle d'isolation. Les critères sont vérifiables par le test d'intégration.
Essai réel qui clôt le lot, sur SANDBOX : un contact dont le Journal des erreurs montre un échec de scénario est
supprimé depuis la console, et sa ligne disparaît du journal.
