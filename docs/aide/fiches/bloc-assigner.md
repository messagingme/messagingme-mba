---
description: Le bloc Assigner à un agent d'un scénario WhatsApp : arrêter le parcours et passer la conversation à un membre de l'équipe ou au pot commun.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 02c6e1
publique: oui
rubrique: construire-un-scenario
rang: 9
---
# Le bloc Assigner à un agent

Arrête le parcours et passe la conversation à votre équipe, dans « À traiter » : à un membre choisi, ou au pot commun.

**1. Choisir à qui.** Cliquez sur le bloc, puis choisissez dans « Affecter à » : un membre de l'équipe, ou « personne en
particulier (pot commun) ».

- Seuls les membres actifs sont proposés. Un membre retiré depuis ne reçoit rien : l'écran vous en avertit.
- « Pot commun » ne retire pas un membre déjà affecté à la conversation.
- Les administrateurs sont prévenus par e-mail quand la conversation leur arrive sur une réponse du contact, jamais
  pour une campagne, au réveil d'une attente ou après un « Aller à ».

**2. Ne rien relier après.** Le bloc termine le parcours : rien de ce que vous reliez après lui ne joue.

- Le point du bas, dessiné sur la toile, ne sert à rien.
- Les blocs placés avant lui jouent d'abord, puis la conversation passe à l'équipe.
- Seul en tête d'un scénario, il empêche de le lancer en campagne.
- Il ne peut pas suivre la sortie « Puis, sans attendre » d'un message rapide : le scénario ne se publie pas.
