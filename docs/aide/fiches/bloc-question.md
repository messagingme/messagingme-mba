---
description: Le bloc Question d'un scénario WhatsApp : la question, le menu de réponses, la réponse rangée, le fichier attendu, le délai et les sorties.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 02c6e1
publique: oui
rubrique: construire-un-scenario
rang: 4
---
# Le bloc Question

Pose une question au contact et attend sa réponse : écrite librement, choisie dans un menu, ou un fichier.

**1. Écrire la question.** Cliquez sur le bloc : son panneau s'ouvre à droite, la case « La question » en haut.

- 4 096 caractères au plus. « Variable » insère un champ du contact.
- Le scénario attend toujours une réponse, avec ou sans menu.
- Sans texte, le bloc n'envoie rien et le parcours passe par « Toute autre réponse ».
- Elle ne part que dans une conversation ouverte : le contact vous a écrit il y a moins de 24 heures. Un scénario qui
  commence par elle ne peut donc pas partir en campagne.

**2. Proposer un menu, si besoin.** « Réponse » ajoute une ligne au menu ; « Bouton qui ouvre le menu » est le
libellé que le contact touche pour l'ouvrir.

- 10 réponses au plus. Titre : 24 caractères ; précision, facultative : 72 ; bouton : 20, « Choisir » s'il est vide.
- Sans réponse titrée, la question part en texte simple et le contact répond en écrivant.
- Supprimer une réponse retire sa flèche.

**3. Ranger la réponse.** « Ranger la réponse dans le champ » l'écrit sur la fiche du contact.

- Un message écrit y entre tel quel. Une réponse du menu, seulement si « Ranger aussi la ligne choisie dans le menu »
  est cochée.
- Prénom, Nom, Email ou l'un de vos champs, sauf les champs JSON.
- Rien n'est contrôlé : un texte peut entrer dans un champ nombre.
- Une Condition placée ensuite lit déjà la réponse rangée.

**4. Attendre un fichier, si besoin.** Cochez « Attendre un fichier », puis ses types : photo, PDF, autre document,
vidéo, vocal.

- Le fichier part par la sortie « Fichier reçu » : le scénario ne se publie pas tant qu'elle n'est reliée à aucun
  bloc.
- Le champ choisi reçoit une mention (« Pièce reçue le … »), jamais le fichier. Un bloc Appel API placé ensuite
  l'envoie à votre stockage par un lien valable 15 minutes ; sans champ choisi, il ne le peut pas.
- Un fichier d'un type non coché part par « Toute autre réponse ».

**5. Prévoir l'absence de réponse.** « Si le contact ne répond pas » : un délai en minutes, en heures ou en jours.

- 0 attend sans limite. Au-delà de 0, la sortie « Pas de réponse » apparaît sur le bloc.
- 30 jours au plus.
- « Pas de réponse » reliée à rien : le parcours s'arrête et la conversation revient à celui qui répond d'habitude à
  vos clients.

**6. Relier les sorties.** Une sortie par réponse du menu, puis « Toute autre réponse », et selon vos réglages
« Fichier reçu » et « Pas de réponse ».

- Une réponse du menu reliée à rien passe par « Toute autre réponse » si elle est reliée ; sinon, la conversation
  passe à votre équipe, dans « À traiter ».
- Un message écrit sans « Toute autre réponse » reliée : le parcours s'arrête et la conversation revient à celui qui
  répond d'habitude à vos clients. Un emoji en réaction compte comme un message écrit.
- Si votre équipe ou l'agent de Meta a repris la conversation, la réponse du contact ne fait plus avancer le parcours.
- Une Question ne peut pas suivre la sortie « Puis, sans attendre » d'un message rapide : le scénario ne se publie pas.
