---
description: Le modèle d'un agent IA et son tarif, les plafonds de chaque conversation, le crédit IA qui le paie et la mention qui annonce une IA.
ecran: agents
source_section: Agent IA (menu « AI Agent » > Other AI agent)
source_empreinte: d3f96d
publique: oui
rubrique: parler-aux-clients
rang: 17
prerequis: construire-un-agent-ia
---
# Le modèle, le crédit et les garde-fous d'un agent IA

Quelques réglages bornent ce que fait et ce que coûte votre agent : le modèle qui le fait parler, les plafonds de
chaque conversation, et le crédit IA de l'espace, qui paie chacun de ses tours. S'y ajoute la phrase qui annonce au
contact qu'il parle à une IA.

**1. Choisir le modèle.** Onglet « Modèle » : choisissez dans la liste. Entre parenthèses, le prix par million de jetons
envoyés, puis reçus.

- Le modèle est posé à la création : changez-le seulement si vous savez pourquoi. Le français et l'habileté à chercher
  dans votre base varient beaucoup d'un modèle à l'autre.
- Tous ceux de la liste savent appeler des outils et parlent correctement français : un modèle qui ne sait pas appeler
  d'outil ne cherche pas dans votre base, il invente.
- Le tarif affiché est celui que vous payez, commission de votre offre comprise. Un modèle retiré par le fournisseur
  disparaît de la liste.
- Si la liste est momentanément indisponible, le modèle en place continue de fonctionner ; réessayez plus tard pour en
  changer.

**2. Lire sa consommation.** Sous la liste, « Consommation sur N jours » : les conversations, les jetons en entrée et en
sortie, et le coût estimé, au tarif de la liste.

- Tant que la mesure n'est pas connue, rien ne s'affiche, plutôt qu'un zéro qui laisserait croire à un agent qui n'a
  rien consommé.

**3. Régler les plafonds d'une conversation.** Onglet « Périmètre et garde-fous » : le crédit par conversation, les
tours maximum et les appels d'outils maximum. Le premier atteint fait sortir l'agent par « Plafond atteint ».

- Par défaut : aucune limite de crédit (case « Sans limite », décochez-la pour donner un montant en euros), 20 réponses
  et 60 actions de l'agent, une recherche dans sa base ou un outil.
- Les tours vont de 1 à 20, les appels d'outils de 0 à 60. Chaque champ dit ses bornes et refuse une saisie hors
  limites.
- « Plafond atteint » est une sortie du bloc Agent IA : reliez-la à la suite du parcours.

**4. Régler l'inactivité et le contact inconnu.** Même onglet : « Inactivité, en minutes », puis ce que l'agent a le
droit de faire face à un « Contact inconnu du mini-CRM ».

- Sans réponse du contact pendant ce délai (30 minutes par défaut, de 1 à 1 440), le parcours sort par « Pas de
  réponse », et l'agent ne repart pas si le contact revient plus tard. L'assistant de construction pose la question.
- Face à un contact inconnu : « Aucun outil », « Outils de lecture seulement » (le défaut) ou « Tous les outils ».
  « Aucun outil » est le plus prudent.

**5. Surveiller le crédit IA.** En haut de la liste des agents, le crédit restant de l'espace, en euros. « Recharger le
crédit IA » mène à Paramètres > Offre.

- Le solde descend à chaque tour d'agent, au tarif de la liste des modèles, recherche dans la base comprise, et aussi
  à la préparation des fiches de connaissance et à chaque traduction ou transcription de l'Inbox.
- Un avertissement apparaît sous 0,50 €, un bandeau rouge à zéro.
- À zéro, vos agents ne répondent plus et sortent par « Plafond atteint », on ne peut plus créer d'agent, l'onglet
  Tester refuse et les nouvelles fiches attendent d'être préparées.
- L'agent qui répond au client laisse alors chaque message à votre équipe, sans réponse automatique, et les
  administrateurs reçoivent une alerte par e-mail, une par jour au plus.
- La recharge, le crédit offert et l'offre Entreprise, où le crédit IA est illimité : voir « Recharger le crédit IA ».

**6. Écrire la mention d'IA.** Onglet « Identité et ton », champ « Mention d'IA » : la phrase qui annonce au contact
qu'il parle à une IA. Elle est pré-remplie, modifiable, et ne peut jamais être vide.

- Quand elle est dite se règle pour tout l'espace dans Sécurité > IA : jamais, une fois par session (le défaut), ou à
  chaque message. L'écran montre aussi la phrase de chaque agent.
- C'est la plateforme qui la place en tête du message de l'agent, pas le modèle : elle part même quand l'agent consulte
  sa base avant de répondre. « Une fois par session » veut dire : tant qu'aucun message de l'agent n'est parti avec
  elle.
- « Jamais » est un choix, pas un oubli : la loi n'impose de l'annoncer que lorsque ce n'est pas évident du contexte,
  et cette responsabilité est celle de votre marque.
- L'assistant de construction n'a pas le droit d'y toucher. L'agent de Meta n'est pas concerné : il appose déjà la
  sienne.

**Bon à savoir.** À chaque tour, l'agent relit les 30 derniers messages échangés avec le contact, sur 30 jours, quelle
que soit la conversation, et son premier tour lit le message qui l'a déclenché. Ce qu'il écrit arrive lisible sur
WhatsApp : le gras est converti, les titres et les liens mis en forme sont réécrits en texte simple, et une réponse plus
longue que ce que WhatsApp accepte est coupée plutôt que perdue.
