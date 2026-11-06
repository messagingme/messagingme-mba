# La raison d'un envoi refusé en cours de parcours, lisible à l'écran (2026-11-06)

Né de la relecture du lot 60b4812b (une variable de la fiche dans l'adresse du bouton de lien du message rapide) : un
champ vide fait refuser l'envoi, le parcours s'arrête et la conversation passe à l'équipe, mais la raison ne part que
dans le journal du serveur. L'écart vaut pour tous les refus, pas seulement celui-là.

## Ce qui se passe aujourd'hui

`WorkflowExecutor.advance` (réponse d'un contact) et `resume` (réveil d'un parcours endormi) écrivent la raison d'un
refus dans un `console.error`, puis closent le parcours et le passent à l'équipe, avec pour seule cause le nom du
scénario. Au réveil fenêtre de 24 h fermée, le message de session n'est pas envoyé, et c'est la même fin. Quand un
autre message de l'étape est parti, le parcours continue et la raison du refus se perd.

Mesuré en production le 2026-11-06 (lecture seule, 30 jours) : 26 envois refusés en tout, tous sur SANDBOX, dont 4 en
cours de parcours ; une seule ligne dans `workflow_advance_failures` ; la plus grosse campagne à scénario comptait 4
destinataires. Le seul volume à craindre est structurel : une campagne « modèle, attendre 2 jours, message rapide »
réveille chaque destinataire resté muet fenêtre fermée, une ligne par contact, chacun passant déjà à l'équipe.

## Décisions de Julien (2026-11-06)

- Tous les refus d'une réponse ou d'un réveil, que le parcours s'arrête ou continue, fenêtre fermée comprise ; le STOP
  et l'absence d'accord marketing restent hors du journal (des règles, pas des pannes).
- Une ligne par contact (et par bloc refusé), sans plafond ni regroupement.
- Le journal des erreurs seulement : la frise de l'Inbox ne change pas.
- L'origine `scenario` s'affiche « échec de scénario » au lieu de « scénario bloqué sur une réponse ».

## Tâches

1. `apply` rend aussi `refusDesBlocs` (bloc et raison de chaque envoi refusé), hors STOP (WhatsApp ou RCS), accord
   marketing et tour perdu ; `refus` (la première raison) ne change pas.
2. La dépendance `journaliserEchecSaut` devient `journaliserEchec` (même signature, même table) ; un helper de
   l'exécuteur écrit au mieux une ligne par bloc refusé, préfixée « envoi refusé au bloc « X » : », suivie de l'issue
   (parcours arrêté et passé à l'équipe, ou autres messages de l'étape partis).
3. `advance` et `resume` l'appellent sur leurs refus ; `resume` aussi au réveil fenêtre fermée (le premier bloc non
   envoyé, ou le bloc agent).
4. Console : `libelleOrigine` (`web/lib/erreurs-livraison.ts`) et son test ; le commentaire du composant.
5. Doc : `features.md` (Automatisations, et le Journal des erreurs), la fiche `retrouver-qui-a-fait-quoi` et son
   empreinte, `documentation.md` si la table y est décrite, le journal technique.

Hors périmètre, noté au todo : un refus au DÉMARRAGE quand un autre message de l'étape est parti (`runFrom`), et un
bloc envoyé par un outil d'agent (`envoyerBlocDepuisAgent`, la raison va au modèle).

## Tests attendus

Dans `tests/` : réponse refusée (une ligne, bloc et raison, parcours passé à l'équipe), refus après un envoi parti (une
ligne, parcours qui continue), réveil refusé, réveil fenêtre fermée, STOP et accord marketing (aucune ligne), journal
en panne (le parcours s'arrête quand même). Dans les deux sens : l'appel retiré, ces cas doivent rougir.

## Ordre de déploiement

Aucune migration. API et workers par `deploy-scaleway.yml` avec `migration=aucune`, approuvé par Julien ; la console
part au push (un libellé, aucune route neuve). Puis `aide:charger` sur la machine des workers, avec l'image déployée :
trois fiches ont bougé (`DEPLOY.md`, après un déploiement).

## Méthode de livraison

En direct (moi), dans une copie à part du code d'origin, puis UNE relecture indépendante en fin de lot, parce que le
changement est petit (l'exécuteur, son câblage, un libellé de la console) et réversible (aucune migration), mais que la
production emprunte ce chemin à chaque réponse et à chaque réveil d'un parcours. Les critères sont mécaniquement
testables sur l'exécuteur. Essai réel qui clôt le lot, sur SANDBOX : un scénario « question, puis message rapide à
bouton de lien sur un champ vide », une réponse depuis le téléphone de Julien, et la ligne lue dans Sécurité > Journal
des erreurs.
