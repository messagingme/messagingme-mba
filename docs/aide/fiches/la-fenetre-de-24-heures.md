---
publique: oui
rubrique: parler-aux-clients
rang: 2
captures: non
offre: non
---
# Pourquoi mon message ne part pas : la fenêtre de 24 heures

C'est la règle de WhatsApp qui surprend le plus, et elle explique la plupart des messages refusés.

**WhatsApp ne vous laisse pas écrire librement à n'importe qui.** Vous ne pouvez envoyer un message libre
qu'à une personne qui vous a écrit dans les vingt-quatre dernières heures. Passé ce délai, la conversation
est considérée comme close, et seul un **modèle approuvé** peut la rouvrir.

Ce que ça change, concrètement :

- **Une campagne** s'adresse à des gens qui ne vous ont pas écrit. Son premier message doit donc toujours
  être un modèle approuvé, ou un scénario qui commence par un tel modèle.
- **Un scénario** qui commence par un message libre ne peut partir que si le contact vient d'écrire : un
  mot-clé, un premier message, un lien de test. C'est pour cette raison qu'un scénario n'apparaît pas dans
  le sélecteur d'une campagne s'il ouvre autrement.
- **Dans une conversation en cours**, tout est permis : le client vient d'écrire, la fenêtre est ouverte,
  vous répondez ce que vous voulez.
- **Un bloc Attente** ne garde pas la fenêtre ouverte : au réveil, c'est elle qui décide de ce qui peut partir. La
  fiche « Le bloc Attente » le détaille.
- **Un scénario lancé par un événement** (une automation de date, d'étiquette ou de webhook, une campagne) part
  conversation close : tant que le client n'a pas répondu, seul un modèle approuvé passe. Le constructeur signale en
  jaune chaque message libre placé là, et dit ce qui lance le scénario. Il ne refuse rien : remplacez ce bloc par un
  modèle, ou placez-le après une réponse du client.
- **La sortie « Pas de réponse »** d'un modèle ou d'une question part, elle aussi, sans réponse du client : la relance
  qui la suit doit être un modèle approuvé quand la conversation n'était pas ouverte.
- **Sur l'écran Automation**, une automation qui ne naît pas d'un message du client, et dont le scénario enverrait un
  message libre avant toute réponse, porte l'avertissement sous son nom.

**Bon à savoir.** Le réflexe à prendre : dès que le message s'adresse à quelqu'un qui ne vient pas de vous
écrire, pensez modèle approuvé. Dès qu'il répond à quelqu'un qui vient de parler, écrivez librement.
