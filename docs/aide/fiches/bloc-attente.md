---
description: Le bloc Attente d'un scénario WhatsApp : un délai, une date précise ou les heures ouvrées, et ce qui peut encore partir au réveil.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: a3025d
publique: oui
rubrique: construire-un-scenario
rang: 8
---
# Le bloc Attente

Met le parcours en pause : pour une durée, jusqu'à une date, ou jusqu'aux prochaines heures d'ouverture.

**1. Choisir quand reprendre.** Cliquez sur le bloc, puis dans « Reprendre le parcours… » : après un délai, à une date
précise, ou aux prochaines heures ouvrées.

- 30 jours d'attente au plus, quel que soit le mode.
- Pendant l'attente, une réponse du contact ne fait pas avancer le parcours.
- Si un membre de votre équipe ou l'agent de Meta a repris la conversation entre-temps, le parcours s'arrête au réveil.
- Une attente avant le premier envoi empêche de lancer le scénario en campagne : pour la différer, choisissez « Plus
  tard » au lancement.

**2. Attendre un délai.** Un nombre et son unité : secondes, minutes, heures ou jours.

- En secondes, de 1 à 59 : la pause entre deux messages. Quand le scénario répond au contact sur WhatsApp, celui-ci
  voit « en train d'écrire… » et son message passe en lu.
- Un délai vide ou nul ne retient personne.

**3. Attendre une date précise.** Une date et une heure, dans le fuseau de votre espace.

- La même pour tous les contacts qui passent par ce bloc.
- Une date déjà passée ne retient personne.

**4. Attendre les heures ouvrées.** Le parcours reprend à la prochaine ouverture, telle qu'elle est réglée dans
Paramètres.

- Déjà dans les heures d'ouverture, il continue sans attendre.
- Si aucun jour n'est ouvert, le bloc ne retient personne.

**5. Relier ce qui part au réveil.** Le bloc n'a qu'un point, en bas : la suite part au réveil.

- Si le contact ne vous a pas écrit depuis 24 heures, seul un template part : un message rapide, une question ou un
  formulaire ne part pas, et la conversation passe à votre équipe.
- Une attente à une date ou aux heures ouvrées compte pour 24 heures : l'éditeur vous avertit dès qu'un message hors
  template la suit.
- Relié à rien, le parcours s'arrête au réveil.
