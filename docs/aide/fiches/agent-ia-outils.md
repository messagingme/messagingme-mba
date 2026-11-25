---
description: Donner des outils à un agent IA : les gestes toujours là, puis un tag, une information, un bloc, un scénario, une action ou des étapes.
ecran: agents
source_section: Agent IA (menu « AI Agent » > Other AI agent)
source_empreinte: bc1602
publique: oui
rubrique: parler-aux-clients
rang: 15
prerequis: construire-un-agent-ia
---
# Donner des outils à un agent IA

Par défaut, votre agent IA parle. Un outil lui donne le droit de faire quelque chose : terminer, passer la main,
chercher dans sa base, poser un tag, envoyer un bloc, lancer un scénario, appeler votre système. Tout se règle dans
l'onglet « Outils » de l'agent, et l'agent ne voit que les outils actifs.

Attention au vocabulaire : le menu Tools de la barre de gauche déclare vos systèmes, communs à tout l'espace ; l'onglet
Outils d'un agent dit ce que CET agent a le droit de faire.

**1. Activer les gestes « Toujours là ».** En tête de l'onglet, « Toujours là » liste les cinq gestes propres à l'agent
IA : cliquez sur « Activer » pour chacun de ceux dont il a besoin.

- « Terminer par une règle d'arrêt » : l'agent rend la main au scénario par la sortie choisie, après un dernier message
  au contact. Sans règle d'arrêt déclarée, il reste actif mais le modèle n'en voit rien, et la ligne le dit.
- « Passer la main à un humain » : la conversation remonte tout de suite dans « À traiter » et y reste tant que personne
  n'a répondu ; le parcours sort par « Transfert à un humain ». L'agent ne reprend jamais la parole tout seul. Son
  « Quand l'appeler » dit quand passer la main, comme vous le diriez : « dès qu'on parle d'un remboursement, ou si le
  contact s'énerve ». L'assistant « Construire en parlant » le remplit et l'active quand vous lui répondez.
- « Chercher dans la base de connaissance » : à appeler avant toute question de fond.
- « Lire la fiche du contact » : son nom, ses champs et sa dernière analyse (sentiment, satisfaction, urgence, sujet).
  Ses champs comprennent ceux que HubSpot importe et le lien de suivi de son dernier colis Shopify. Si une boutique
  Shopify est branchée, ses commandes récentes aussi : paiement, montant, produits, expédition. Jamais la fiche de
  quelqu'un d'autre.
- « Marquer la conversation urgente » : elle passe dans le dossier « Urgent » de l'Inbox, et l'agent continue de répondre.
- Sans aucun outil actif, l'agent peut parler, mais ne peut rien faire, pas même terminer.

**2. Régler les mots d'un outil.** « Modifier », sur la ligne d'un geste : le nom vu par le modèle, « Quand l'appeler »
et « Quand ne pas l'appeler ». Chaque champ s'enregistre quand vous le quittez.

- Sur un outil ajouté par la grille, « Modifier » rouvre son formulaire, à enregistrer par « Enregistrer ».
- Ces deux phrases sont ce que le modèle lit pour décider : les soigner change beaucoup ce que fait l'agent.
- « Et en plus, faire ceci » ajoute un geste au moment de l'appel : poser un tag, ou écrire une valeur dans un champ.
- « Voir ce que le modèle voit » montre l'outil exactement tel qu'il est proposé au modèle.
- Un agent ne porte jamais deux outils du même nom : le second est refusé, parce que le modèle refuserait toute la
  liste et que l'agent ne répondrait plus.

**3. Ajouter un outil.** Sous « Ses outils », « Ajouter un outil » ouvre la grille « Quel outil ajouter ? » : choisissez
la carte de ce que l'agent doit faire.

- Neuf cartes : Poser un tag, Enregistrer une information, Envoyer un bloc, Lancer un scénario, Appeler un connecteur
  API, Appeler un outil MCP, et trois propres à l'agent IA : Déclencher une action, Enchaîner des étapes, Qualifier et
  transférer.
- Une carte qui n'a rien à proposer est grisée, avec le lien vers l'écran où le créer.
- Pour le tag, l'information, le bloc et le scénario, c'est vous qui fixez la cible, une par outil : l'agent ne décide
  que du moment. Il ne peut donc ni inventer un tag, ni choisir un autre champ.
- Chaque outil se pose avec un titre, un nom technique (vu par le modèle) et ses deux consignes, pré-remplies : un trou
  entre crochets reste à compléter avant « Enregistrer ».

**4. Poser un tag.** Carte « Poser un tag » : l'étiquette à poser, les mots de l'outil, puis « Enregistrer ».

- Pour retrouver le contact dans le mini-CRM, ou faire partir une automation sur ce tag.

**5. Enregistrer une information.** Carte « Enregistrer une information » : le champ de la fiche, et si vous voulez la
borner, la liste des valeurs permises, une par ligne.

- L'agent fournit la valeur, tirée de la conversation ; avec une liste, toute autre valeur est refusée.
- La liste des champs commence par les champs de base (Prénom, Nom, Email), puis vos champs par ordre alphabétique.
- Le champ est nommé dans ce que lit l'agent, et le titre proposé le cite (« Enregistrer : Campus ») tant que vous ne
  l'avez pas réécrit.
- Une information de plus, à poser ailleurs dans un scénario : un bloc plus loin réutilise ce champ.

**6. Envoyer un bloc.** Carte « Envoyer un bloc » : le scénario, puis le bloc à envoyer. Cochez « Autoriser l'agent à
faire ça seul », puis « Enregistrer ».

- Le bloc part seul, sans ce qui le suit, et l'agent garde la main.
- Un bloc qui attend une réponse, ouvre un agent ou part en RCS est grisé, avec sa raison.
- Ce qui part chez le client demande votre accord : sans la case, chaque appel est refusé, et la ligne de l'outil le dit.
  Un message parti ne se rappelle pas, et il est facturé.

**7. Lancer un scénario.** Carte « Lancer un scénario » : un de vos scénarios en ligne, lancé depuis son début. Cochez
aussi « Autoriser l'agent à faire ça seul ».

- Le scénario prend la conversation et l'agent se retire : il n'écrit plus rien, et aucune sortie de son bloc n'est
  empruntée.
- Un scénario dépublié ou supprimé, ou un contact désabonné, est refusé, et l'agent continue la conversation. L'agent ne
  peut pas relancer le scénario où il parle.

**8. Appeler un connecteur API.** Carte « Appeler un connecteur API » : choisissez un appel déclaré dans Tools >
Connecteurs API, « Ajouter à cet agent », et donnez-lui ses mots. Le geste complet est dans « Brancher un connecteur
API ».

- L'outil appartient à l'espace, l'autorisation à l'agent : le même appel sert plusieurs agents, et changer ses mots les
  change pour tous. L'onglet Outils de l'agent de Meta nomme les agents IA qui le partagent.
- « Modifier », sur sa ligne, rouvre le formulaire pré-rempli, sans perdre l'activation.
- Un appel en DELETE est irréversible : il demande lui aussi « Autoriser l'agent à faire ça seul ».

**9. Appeler un outil MCP.** Carte « Appeler un outil MCP » : la liste des outils importés dans Tools > Connecteurs MCP
que l'agent n'a pas encore. « Ajouter » le lui donne.

- Ses paramètres se règlent dans Connecteurs MCP, pas ici.
- Si son serveur change la forme d'un outil, l'autorisation s'éteint : un bandeau « Ce qui a changé sans vous » le dit
  en haut de la fiche, avec le lien vers l'onglet.

**10. Déclencher une action.** Carte « Déclencher une action » : son nom (« Résiliation »), sa consigne (quand la
déclencher, et ce que l'agent dit ensuite au client), puis les informations à recueillir, avec « + Ajouter un champ ».

- Jusqu'à dix champs, tous facultatifs : texte, nombre, date, e-mail ou liste de valeurs. L'agent part avec ce qu'il a ;
  une date ou un e-mail mal formés lui sont renvoyés, et il redemande.
- Quand le client fait la demande, l'agent répond ce que prévoit la consigne et continue. Votre application reçoit
  l'événement « Action de l'agent IA », une fois par jour au plus par contact et par action.
- Cet événement est décoché par défaut : cochez-le sur une adresse dans Developers > Webhooks sortants, sinon rien ne
  part, et la carte vous le rappelle. Une automation peut aussi partir de l'action (Scénario > Automation > Autres).
- Le code d'un champ est la clé que lit votre application : il suit le libellé tant que le champ est neuf, ne le
  changez plus ensuite. Au plus dix actions par agent.

**11. Enchaîner des étapes.** Carte « Enchaîner des étapes » : le titre et « Quand l'appeler », puis « Première étape »,
« + Ajouter une étape », et « Monter » ou « Descendre » pour ranger.

- Sept sortes d'étapes : demander une information, enregistrer une valeur fixe, poser un tag, marquer la conversation
  urgente, envoyer un bloc, lancer un scénario, transférer en « À traiter ».
- Exemple : demander le prénom, le nom, le campus et la formation, puis lancer le scénario qui passe le contact à votre
  équipe.
- S'il manque une réponse, l'agent pose toutes les questions en un message, une seule fois, puis exécute tout avec ce
  qu'il a, même si le contact refuse.
- Deux règles, que l'écran rappelle : un scénario ou un transfert se place en dernier, un seul des deux ; aucun bloc ni
  scénario avant une question. Dès qu'un bloc ou un scénario en fait partie, cochez « Autoriser l'agent à faire ça
  seul ».

**12. Qualifier et transférer.** Carte « Qualifier et transférer » : « Quand l'appeler » est déjà rempli (le contact veut
parler à quelqu'un de l'équipe). Ajoutez vos questions avec « + Ajouter une question », chacune avec son champ.

- L'agent pose vos questions en un message, une seule fois, puis passe la conversation dans « À traiter », même si le
  contact n'a rien répondu.
- Comme avec « Passer la main à un humain », sa dernière phrase ne part que s'il répond seul au numéro ou que l'équipe
  est fermée ; sinon, c'est la suite de la sortie « Transfert à un humain » de votre scénario qui parle.
- Il faut choisir : qualifier d'abord, ou passer la main tout de suite. Cet outil ne cohabite ni avec « Passer la main
  à un humain », ni avec une règle d'arrêt cochée « passe à un humain » : activer l'un quand l'autre est là est refusé,
  et le message dit quoi désactiver d'abord.

**13. Activer l'outil.** Un outil ajouté naît « Inactif » : relisez sa ligne, puis « Activer ». Tant qu'il ne l'est pas,
l'agent ne sait même pas qu'il existe.

- La ligne dit ce qui empêche un outil de servir : un système éteint, une action qui part chez le client sans
  autorisation, une cible qui ne se lit plus.
- « Désactiver » le garde avec ses réglages. La croix le supprime ; un appel de connecteur ou un outil MCP n'est alors
  retiré qu'à cet agent.
- L'activation garde le nom de la personne qui l'a donnée.
