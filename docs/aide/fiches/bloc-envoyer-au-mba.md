---
description: Le bloc Envoyer au MBA d'un scénario WhatsApp : confier la conversation à l'agent de Meta en fin de parcours, et ce qui se passe s'il est éteint.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: a3025d
publique: oui
rubrique: construire-un-scenario
rang: 10
---
# Le bloc Envoyer au MBA

Arrête le parcours et confie la conversation à l'agent de Meta, quel que soit celui qui répond d'habitude à vos
clients.

**1. Le poser en fin de parcours.** Rien à remplir : le bloc n'a pas de sortie, le parcours s'arrête là.

- L'agent répond au dernier message du contact s'il est encore sans réponse. Si le scénario a écrit après lui, l'agent
  attend le message suivant.
- Pour qu'il réponde à une question, faites dire au scénario « posez-nous votre question » juste avant ce bloc : la
  question du contact lui arrive directement.
- Placé en tête d'un scénario, il clôt le parcours en cours du contact.

**2. Prévoir l'agent éteint.** Si l'agent de Meta est éteint, le panneau du bloc vous prévient.

- Éteint, ou un contact qu'il ne peut pas prendre (désabonné, refus de Meta) : la conversation passe à votre équipe,
  dans « À traiter », et le Journal des erreurs dit pourquoi.
- Seul en tête d'un scénario, il empêche de le lancer en campagne ; après un template, c'est permis.
- Il ne peut pas suivre la sortie « Puis, sans attendre » d'un message rapide : le scénario ne se publie pas.
