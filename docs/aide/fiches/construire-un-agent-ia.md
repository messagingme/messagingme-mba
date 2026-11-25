---
description: Créer un agent IA WhatsApp, le régler en parlant à l'assistant ou onglet par onglet, l'activer, puis le faire répondre à vos clients.
ecran: agents
source_section: Agent IA (menu « AI Agent » > Other AI agent)
source_empreinte: f833b6
publique: oui
rubrique: parler-aux-clients
rang: 10
---
# Construire un agent IA

Un agent IA est un répondeur que vous construisez vous-même et que vous posez là où vous en avez besoin : dans le bloc
« Agent IA » d'un scénario, pour répondre au client comme le fait l'agent de Meta, ou sur l'étage WhatsApp d'une
campagne. Hors de ces trois places, il ne parle pas.

Cette page suit la construction pas à pas. Chaque sujet a ensuite sa page : « Remplir la base de connaissance d'un agent
IA », « Donner des outils à un agent IA », « Tester un agent IA et lire son historique », et « Le modèle, le crédit et
les garde-fous d'un agent IA ».

**1. Créer l'agent.** Dans AI Agent > Other AI agent, carte « Créer un agent » : tapez un nom interne, puis « Créer ».

- Le nom interne est celui que vous voyez dans la liste et dans le constructeur de scénario. Le contact ne le voit
  jamais.
- Chaque ligne de la liste porte le logo du modèle qui fait parler l'agent, puis sa pastille : Brouillon, Actif ou
  Désactivé.
- « Supprimer », sur la ligne, efface l'agent avec ses conversations, ses outils et sa base de connaissance, et les blocs
  de scénario qui l'utilisent cessent de répondre. La confirmation le dit avant le clic.
- Sans crédit IA, la création est refusée, avec un message qui dit de recharger.

**2. Choisir votre voie : l'assistant ou les onglets.** La fiche de l'agent s'ouvre toujours sur « Construire en
parlant ». Ses neuf onglets sont dans la colonne de gauche : les deux voies mènent au même agent.

- Prenez l'assistant quand vous partez de zéro : il pose toutes les questions qu'il faut, une à la fois, et ne laisse
  aucun réglage de côté. C'est le chemin le plus sûr pour un premier agent, inclus dès la formule Pro.
- Prenez les onglets quand vous savez déjà quoi écrire, ou pour retoucher un seul réglage : Identité et ton, Objectif et
  transferts.
- Tout ce que l'assistant écrit reste modifiable dans les onglets, champ par champ. Chaque champ s'enregistre quand
  vous le quittez, sans bouton.
- L'onglet ouvert fait partie de l'adresse : la fiche se partage par un lien, et un rafraîchissement retrouve où vous
  en étiez.

**3. Avec l'assistant : décrire votre métier.** Écrivez à quoi sert votre agent, ou cliquez sur un des deux exemples.
L'assistant fait ensuite le tour du sujet, une question à la fois.

- Il passe, dans l'ordre : ce que l'agent est là pour faire, ce dont il ne parle jamais, d'où viennent ses réponses de
  fond, s'il doit simplement s'arrêter dans certains cas (facultatif), les moments où il doit faire autre chose que répondre, quand
  il lâche un contact silencieux, quand un humain reprend, sous quel nom il se présente, s'il annonce être une IA, et
  comment il parle.
- Vous pouvez répondre par le numéro d'un choix (« 4 »). Si vous citez plusieurs moments d'un coup, il les reprend un
  par un.
- Si vous dites que l'agent agit seul (« il prend le rendez-vous »), il demande par quel moyen : un outil, un connecteur.
  Si rien de ce qui existe ne convient, il le dit au lieu d'inventer.
- Tant qu'un point n'est pas tranché, il ne montre rien et dit combien il en reste. Si vous y aviez déjà répondu en
  racontant votre métier, il vous demande seulement de confirmer.

**4. Avec l'assistant : lui donner votre site.** Donnez l'adresse de votre site quand il demande d'où viennent les
réponses de fond : ses pages sont lues et découpées en fiches pendant que vous continuez.

- Les fiches vous attendent dans l'onglet Base de connaissance, à relire et corriger. Un site déjà importé à la main
  n'est pas relu, pour ne pas écraser vos corrections.
- Le trombone « Joindre un fichier » ajoute un document ou une photo à la base : voir « Remplir la base de connaissance
  d'un agent IA ».
- Si Shopify ou HubSpot est branché, il demande ensuite si l'agent doit se servir de ce que vos fiches clients
  reçoivent : les commandes et le lien de suivi pour Shopify, les champs importés pour HubSpot. Répondez oui, et la
  proposition active « Lire la fiche du contact » : l'agent pourra répondre à « où en est ma commande ? ».

**5. Avec l'assistant : garder, corriger ou jeter chaque ligne.** Le tour du sujet fait, il affiche « Ce que ça
changerait » : chaque réglage proposé, la valeur d'avant barrée. Relisez, puis « Enregistrer et activer » : l'agent
est réglé et activé d'un seul clic. « Enregistrer », à côté, règle sans activer, pour le tester d'abord.

- Rien n'est écrit dans les onglets avant ce clic : l'assistant propose, il ne change rien tout seul.
- Tout est gardé au départ. Chaque ligne a deux boutons, « Garder » et « Jeter », et son texte se corrige sur place.
  Une ligne jetée, le bouton dit combien de lignes partiront (« Enregistrer les 4 gardées et activer »). « Tout jeter »
  abandonne la proposition.
- Un encadré dit ensuite la suite : « Votre agent est actif » ; « Votre agent est prêt », avec « Activer l'agent » et
  « Le tester », si vous avez seulement enregistré ; ou, s'il manque encore quelque chose, la liste de ce qui manque,
  chaque ligne menant à son onglet. Ce que vous avez gardé est enregistré même quand l'activation est refusée.
- Un agent déjà actif n'a que « Enregistrer » : ce que vous enregistrez s'applique à ses prochaines réponses.
- Les règles d'arrêt se gardent ou se jettent en bloc : elles se corrigent ensuite dans l'outil « Terminer par une règle d'arrêt », onglet Outils.
- Un moment où l'agent doit lancer un scénario : nommez un de vos scénarios en ligne quand il vous les liste. La
  proposition porte alors une ligne « Outil « Lancer un scénario » », et l'enregistrement pose l'outil, « Inactif »,
  dans l'onglet Outils.
- Il peut aussi brancher ou débrancher un outil de votre bibliothèque si vous le demandez, jamais en créer un.
  Brancher n'active pas.
- Il n'a pas le droit d'écrire la mention d'IA, les plafonds, le modèle, ni d'activer un outil.

**6. Avec l'assistant : suivre la liste « Pour finir ».** Son dernier message dit, dans l'ordre, ce qu'il reste à
faire : enregistrer la proposition, importer le site, brancher le connecteur qu'un moment demande, activer l'outil
d'un scénario, vérifier le modèle, tester, activer.

- La liste se calcule sur l'état réel de l'agent : une étape déjà faite n'y figure pas.
- La conversation est gardée, et partagée entre les administrateurs : chacun de vos messages porte l'adresse de son
  auteur.
- Rouverte plus tard, l'assistant rappelle l'état de l'agent et attend votre demande. Si un champ réglé pendant
  l'entretien a été vidé depuis, il vous demande si c'est voulu.
- « Recommencer » efface la conversation et repart de zéro, sans toucher à ce qui est enregistré dans les onglets.

**7. À la main : Identité et ton.** Onglet « Identité et ton » : le nom interne, le nom donné au contact, le ton, la
personnalité et la mention d'IA.

- Laissé vide, le nom donné au contact fait un agent qui ne se donne aucun nom.
- Écrivez le ton comme vous le diriez à une nouvelle recrue : « vouvoiement, phrases courtes, pas d'emoji ».
- La mention d'IA ne peut jamais être vide : voir « Le modèle, le crédit et les garde-fous d'un agent IA ».

**8. À la main : l'objectif.** Onglet « Objectif » : l'objectif de l'agent en une ou deux phrases.

- L'objectif est le champ qui pèse le plus sur ce que l'agent répondra.
- Quand passer la main à un humain se règle dans l'onglet Outils, sur l'outil « Passer la main à un humain » :
  voir « Donner des outils à un agent IA ».

**9. Facultatif : les règles d'arrêt.** Onglet Outils, outil « Terminer par une règle d'arrêt », « Modifier », puis
« Règles d'arrêt » : un code, ce qu'il veut dire, puis « Ajouter ». Une règle d'arrêt, c'est un cas où l'agent
s'arrête simplement, par exemple si le client l'insulte.

- Chaque règle devient une sortie du bloc Agent IA, à relier à la suite du parcours : voir « Le bloc Agent IA ». Douze au
  maximum.
- Le code se met en forme pendant la saisie, et un code déjà pris est signalé.
- La case « passe à un humain » ne change rien à ce que fait la règle (c'est votre scénario qui route) : elle dit
  qu'elle mène à l'équipe.
- Sans aucune règle, l'agent ne sort que par les cinq sorties automatiques du bloc. Passer la main ou lancer un
  scénario ont leurs propres outils.

**10. Lire l'en-tête et finir les étapes.** En haut de la fiche : le logo du modèle, le nom de l'agent, son modèle, sa
pastille, et « n étapes à finir ». Chaque étape mène à l'onglet où elle se règle.

- Une étape, c'est un champ vide qui empêche l'activation : l'objectif, la base de connaissance, et l'outil de
  recherche quand la base est remplie. Jamais un jugement sur ce que vous avez écrit. « Tout est réglé » quand il n'en
  reste aucune. Règles de transfert et d'arrêt sont facultatives.
- Sur l'onglet « Construire en parlant », l'en-tête ne montre pas les étapes : elles décrivent l'agent enregistré, et
  l'encadré qui suit « Enregistrer » dit ce qui manque.
- Le nombre de messages échangés sur 30 jours compte tout le fil des conversations que l'agent a tenues, campagnes et
  messages de votre équipe compris : ce n'est pas ce que l'agent a écrit lui-même, ni le même compte que l'Accueil. Vos
  essais n'y entrent pas, et tant qu'il n'est pas connu, rien ne s'affiche.
- Sur un téléphone, la colonne des onglets redevient une barre en haut.

**11. Activer l'agent.** « Activer », à côté de la pastille. L'agent devient proposable dans le bloc Agent IA d'un
scénario, dans « Qui répond au client » et dans le choix du répondeur d'une campagne.

- Activé veut dire proposable, pas « il répond à tout » : répondre à tout se choisit sur l'Accueil, à l'étape suivante.
- Un agent incomplet est refusé, et l'en-tête liste ce qui manque.
- Essayez-le avant : voir « Tester un agent IA et lire son historique ».
- « Désactiver » le fait taire : un bloc qui l'utilise le signale, et ne répond plus tant qu'il n'est pas réactivé.
  « Supprimer », en haut de la fiche, l'efface.

**12. Le faire répondre au client.** Sur l'Accueil, carte « Qui répond au client » : cochez « Un agent IA », choisissez
l'agent parmi vos agents actifs, puis « Enregistrer ». La page des agents y mène par un lien.

- Il répond alors à tout message WhatsApp que ni un scénario, ni un mot-clé, ni un membre de votre équipe ne tient, en
  tenant compte de ce que le contact vient d'écrire. Réservé aux administrateurs.
- L'agent de Meta reste allumé, en veille : il ne prend plus que les contacts qu'un bloc « Envoyer au MBA » ou une
  campagne lui confie. Si c'était lui qui répondait, l'Accueil vous demande confirmation, parce qu'il cesse de répondre
  aux conversations qu'il tient.
- Sans scénario derrière, une règle d'arrêt ou « Pas de réponse » termine sa conversation ; « Transfert à un humain »,
  « Aucune source », « Plafond atteint » et « Échec technique » la passent à votre équipe, dans « À traiter ».
- Le panneau Détail de l'Inbox note chaque sortie (« L'agent IA a terminé », avec la règle), et le prochain message du
  contact relance l'agent (après un transfert, une fois que votre équipe a rendu la main). Une réaction, un pouce levé
  par exemple, ne le fait pas répondre.
- Désactiver ou supprimer l'agent qui répond le retire de ce rôle : les messages vont alors à votre équipe. L'écran
  vous le dit avant, et l'Accueil le signale.
- Ailleurs, il répond dans un scénario par le bloc Agent IA (voir « Le bloc Agent IA »), ou à la première réponse des
  contacts d'une campagne, si vous le choisissez à l'étape Contenu, dans « Quel répondeur ? ».
