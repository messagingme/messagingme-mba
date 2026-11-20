---
description: Le bloc Aller à d'un scénario WhatsApp : envoyer le contact sur un bloc de ce scénario ou d'un autre, et les règles du saut.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 6ea74e
publique: oui
rubrique: construire-un-scenario
rang: 11
---
# Le bloc Aller à

Envoie le contact sur un autre bloc, de ce scénario ou d'un autre, par exemple pour revenir au menu.

**1. Choisir le scénario.** Cliquez sur le bloc, puis dans « Scénario » : « Ce scénario », ou un autre de l'espace.

- Dans un autre scénario, c'est sa version publiée qui joue : publiez-le d'abord.
- Les réponses déjà données suivent le contact : elles sont sur sa fiche.
- Un scénario visé par un « Aller à » ne se supprime pas tant que ce bloc le vise.

**2. Choisir le bloc.** « Bloc » liste ceux du scénario choisi ; vous pouvez aussi coller son code dans « Ou le code du
bloc ».

- Le code se copie avec le bouton à droite du bouton lecture, en haut à gauche de chaque bloc. Un bloc tout juste ajouté reçoit le sien à
  l'enregistrement, une seconde après.
- Sans bloc choisi, ou avec un code qui ne désigne aucun bloc, le scénario ne se publie pas.
- Dans un autre scénario, supprimer le bloc visé ne bloque pas la publication : le saut échoue au passage du
  contact, et la conversation passe à votre équipe. Dans ce scénario, la publication est refusée.

**3. Les règles du saut.** Le bloc n'a pas de sortie : le parcours continue là-bas.

- Revenir sur un bloc déjà traversé, sans réponse du contact entre les deux, arrête le parcours. Revenir au menu après
  une réponse fonctionne.
- Plus de 20 « Aller à » enchaînés sans pause sont arrêtés, et la conversation passe à votre équipe.
- Après une attente de 24 heures ou plus, un saut vers un autre scénario dont le premier envoi est un message rapide,
  une question, un formulaire ou un agent IA est refusé à la publication. Dans le même scénario, l'écran vous avertit
  seulement ; il vous avertit aussi d'un saut atteint avant toute réponse du client, derrière une sortie « Pas de
  réponse » par exemple.
- Placé avant le premier template, un saut vers un autre scénario empêche de lancer le scénario en campagne.
- Il ne peut pas suivre la sortie « Puis, sans attendre » d'un message rapide : le scénario ne se publie pas.
