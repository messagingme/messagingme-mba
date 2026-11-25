---
description: Tester un agent IA avant de l'activer : lui écrire comme un client, voir ses outils, reposer une question, puis lire son historique.
ecran: agents
source_section: Agent IA (menu « AI Agent » > Other AI agent)
source_empreinte: f833b6
publique: oui
rubrique: parler-aux-clients
rang: 16
prerequis: construire-un-agent-ia
---
# Tester un agent IA et lire son historique

L'onglet « Tester » vous fait parler au vrai agent, avec son objectif, son ton, ses outils et sa vraie base de
connaissance : ce qu'il répond là est ce qu'il répondra à un client. L'onglet « Historique » garde ce qui a changé sur
l'agent, et par qui.

**1. Lui écrire comme un client.** Onglet « Tester » : écrivez ce qu'un client vous écrirait, puis « Envoyer ».
Continuez l'échange sur plusieurs messages, comme sur WhatsApp.

- La mention d'IA apparaît en tête de sa réponse, telle que le contact la lira.
- Un essai appelle vraiment le modèle : il se paie sur votre crédit IA comme une conversation, et sans crédit l'onglet
  refuse.

**2. Lire ce que l'agent a fait.** Sous la conversation, « Ce que l'agent a fait » liste chaque outil appelé, avec ce
qu'il a demandé. « Voir ce qu'il a reçu » montre la réponse de l'outil.

- C'est la première chose à lire devant une mauvaise réponse : « il n'a pas trouvé » et « il n'a même pas cherché » ne
  sont pas le même défaut.
- Ce qui touche le monde réel est simulé, et marqué « simulé » : poser un tag, envoyer un bloc, passer la main, marquer
  urgent, déclencher une action. Il n'y a ni contact ni conversation dans un essai.
- Un appel de connecteur API qui ne fait que lire votre système (une requête GET, donnée à l'agent en « il récupère de
  l'information », sans donnée du contact) part pour de vrai : vous voyez un vrai devis, et votre système est
  interrogé à chaque fois. Les autres appels sont simulés, avec des valeurs d'exemple.

**3. Lire la sortie.** Quand l'agent sort, un bandeau dit par quelle sortie : dans un scénario, c'est cette branche du
bloc qui prendrait la suite.

- « Réponse refusée » veut dire que le modèle a imité un résultat d'outil au lieu d'en appeler un. Ce n'est pas un
  plafond à monter : vérifiez que ses outils sont actifs, sinon changez de modèle.
- Quand l'agent lance un scénario, l'essai s'arrête sans sortie, et un bandeau le dit : en conversation réelle, le
  scénario prend la main et l'agent se tait.

**4. Reposer la même question.** « Vos essais précédents », sous la conversation : « Reprendre » repose exactement la
même question à l'agent tel qu'il est réglé maintenant.

- C'est ainsi qu'on règle un agent : changer une consigne, puis reposer la même question pour voir si la réponse a
  bougé.
- Chaque essai est gardé quatorze jours, avec l'heure, son coût, ses jetons, la sortie prise et les outils appelés,
  visibles sans rien ouvrir. « Voir l'échange » le rejoue en entier.

**5. Retrouver ce qui a changé.** Onglet « Historique » : chaque modification de l'agent (sa fiche, son modèle, ses
réglages, son activation), avec qui l'a faite, quand, et d'où : depuis les onglets, ou par Claude.

- Une fiche de connaissance supprimée y laisse son contenu, même supprimée avec cinquante autres : « voir le contenu
  effacé ». Il n'y a pas de corbeille, cette ligne en est le seul exemplaire.
- Ce que l'assistant de construction enregistre passe par les onglets, et s'y affiche comme tel.
- Les fiches ajoutées ou importées et les outils n'y figurent pas, et l'écran le dit. Rien n'est purgé.
- Réservé aux administrateurs.
