---
description: Brancher votre CRM ou votre boutique : déclarer le système, mettre au point un appel, l'essayer, puis le donner à un agent IA ou à un scénario.
ecran: connecteurs
source_section: Brancher vos systèmes : les connecteurs API (menu « Tools » > Connecteurs API)
source_empreinte: 24e307
publique: oui
rubrique: parler-aux-clients
rang: 13
---
# Brancher un connecteur API

Un connecteur API relie Messaging Me à l'un de vos systèmes (CRM, boutique, outil de réservation, back-office).
Vous le déclarez une fois dans Tools > Connecteurs API, vous y mettez au point des appels, puis vos agents IA, l'agent
de Meta et vos scénarios s'en servent pour lire une information ou en envoyer une.

**1. Brancher le système.** Dans Tools > Connecteurs API, « Brancher un système » : un nom pour vous, l'adresse de base
de votre API, son authentification, puis « Brancher ».

- L'adresse est en HTTPS et publique : vos agents n'appelleront jamais ailleurs que sous elle.
- L'authentification est un jeton (Bearer), un en-tête nommé, ou aucune. Le secret est chiffré chez nous et ne se
  réaffiche jamais, pas même pour nous : pour en changer, tapez le nouveau puis « Remplacer ».
- Un système est commun à tout l'espace : sa ligne dit combien d'agents, d'appels et de scénarios s'en servent.

**2. L'éprouver, puis l'activer.** Dépliez le système, donnez un chemin de votre API, puis « Éprouver ». Le verdict
s'affiche avec sa date. « Activer », sur la ligne, ouvre ensuite le système à vos agents.

- L'épreuve fait un vrai appel avec votre authentification : c'est le seul endroit où un jeton expiré se voit avant
  qu'un client ne tombe dessus.
- Un système qui ne répond pas en dix secondes, qui coupe sa réponse ou qui répond trop gros est refusé, avec la
  raison.
- « Désactiver » garde le système et ses outils, mais chaque appel échoue en disant pourquoi. « Supprimer » l'efface,
  ce qui est refusé tant qu'il porte des appels.

**3. Ajouter un appel.** Sous le système, « Ajouter un appel » : son nom, la méthode (GET, POST, PUT, PATCH, DELETE)
et le chemin, relatif à l'adresse du système, par exemple /commandes/{{ref}}.

- Les parties variables s'insèrent par les pastilles de la ligne « Insérer : » ; une pastille qui ne désigne
  aucune donnée est signalée, avec un bouton pour la déclarer.
- Un appel en DELETE rend ses outils irréversibles : l'agent devra être autorisé à agir seul pour s'en servir.

**4. Dire ce qui part.** L'onglet « Données envoyées » déclare chaque donnée et « D'où vient sa valeur » : décidée par
l'agent, la fiche du contact (numéro, nom, identifiant externe), sa dernière analyse et son risque, un champ
personnalisé, une valeur système (la date, le dernier message du contact) ou une valeur fixe.

- Marquez « Obligatoire » une donnée sans laquelle l'appel ne doit pas partir.
- Un identifiant de client se prend sur la fiche, jamais « décidé par l'agent » : c'est ce qui empêche un contact
  d'obtenir la commande d'un autre.
- Les onglets « Paramètres d'URL », « Corps » et « En-têtes » placent ces données. Le corps s'écrit en liste de
  champs ou en JSON brut (le passage au JSON est sans retour) ; dans le JSON, une pastille se met entre guillemets, et
  « Corriger » le fait pour vous.
- L'authentification ne se met pas dans les en-têtes d'un appel : elle vit sur le système.

**5. Essayer, cocher, enregistrer.** « Essayer » joue l'appel avec vos valeurs d'essai et montre ce qui est parti, le
statut, la durée et la réponse. Dans l'onglet « Réponse (défaut) », cochez les champs utiles, puis « Enregistrer ».

- Ce que vous cochez n'est qu'un défaut : chaque agent choisit ce qu'il a le droit de lire au moment où vous lui
  donnez l'appel.
- Un appel inachevé s'enregistre quand même, comme brouillon, pour y revenir plus tard.
- Modifier un appel vaut tout de suite pour les agents et les scénarios qui s'en servent, et un appel utilisé ne se
  supprime pas : sa ligne dit par qui.

**6. Le donner à un agent IA.** Dans l'agent, onglet Outils, « Ajouter un outil », puis « Appeler un connecteur API » :
choisissez l'appel, « Ajouter à cet agent », et répondez à « Que fait cet appel ? ».

- « Il pousse de l'information » (poser une étiquette, créer une fiche) : l'agent saura seulement si c'est passé.
- « Il récupère de l'information » : « Essayer pour voir la réponse », puis cochez ce que l'agent a le droit de lire.
  Seuls ces champs partent chez le fournisseur du modèle.
- Donnez-lui ses mots : le nom vu par l'agent, à quoi ça sert, et quand ne pas l'appeler. L'outil naît
  « Inactif » ; activez-le une fois relu.

Le même appel sert aussi l'agent de Meta (voir « Donner des outils à l'agent de Meta »), le bloc Appel API d'un
scénario (voir « Le bloc Appel API ») et l'avis de désabonnement envoyé à votre système (voir « Suivre les
désabonnements »).
