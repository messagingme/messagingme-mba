---
description: Le bloc Message rapide d'un scénario WhatsApp : le texte, le fichier, les réponses rapides ou le bouton de lien, et les sorties à relier.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 6ea74e
publique: oui
rubrique: construire-un-scenario
rang: 3
---
# Le bloc Message rapide

Un message que le scénario envoie au contact : un texte, avec si besoin un fichier, des réponses rapides ou un bouton
qui ouvre une page.

**1. Écrire le message.** Cliquez sur le bloc : son panneau s'ouvre à droite, la case « Message » en haut.

- 4 096 caractères au plus, ou 1 024 dès que le message porte un bouton ou un fichier.
- « Variable » insère un champ du contact, par exemple sa ville.
- Il ne part que dans une conversation ouverte : le contact vous a écrit il y a moins de 24 heures. Un scénario qui
  commence par lui ne peut donc pas partir en campagne ; pour écrire en premier, c'est le bloc Envoi template.
- Placé après une attente de 24 heures ou plus, ou là où le client n'a pas encore répondu dans un scénario lancé par
  un événement (une boutique, une date, une campagne), il ne partira pas : l'écran vous en avertit en jaune.

**2. Joindre un fichier, si besoin.** Une image, une vidéo ou un PDF, depuis votre ordinateur ou la médiathèque.

- Image JPEG ou PNG : 2 Mo au plus. Vidéo MP4 en H.264 ou PDF : 16 Mo au plus.
- Une vidéo d'iPhone (MOV, HEVC) est refusée : convertissez-la en MP4 H.264.
- La vidéo et le PDF ne partent qu'en WhatsApp, pas en RCS.
- Le texte du message devient la légende du fichier.
- La médiathèque ne propose que ce que le bloc peut envoyer. Vos fichiers et le quota de votre offre se gèrent
  dans Paramètres > Médiathèque.

**3. Proposer des réponses rapides.** « Réponse rapide » ajoute un bouton que le contact tape pour vous répondre.

- Trois boutons au plus, 20 caractères chacun.
- Avec des boutons, le scénario attend la réponse du contact avant de continuer.
- Sans bouton, il n'attend rien : le bloc suivant part tout de suite.

**4. Ou mettre un bouton de lien.** Cochez « Ce message porte un bouton de lien », puis écrivez son libellé et
l'adresse de la page.

- Libellé : 20 caractères au plus. L'adresse commence par https:// (ou http://).
- Cocher la case retire les réponses rapides : WhatsApp n'envoie jamais les deux dans le même message.
- « Variable » met un champ du contact dans l'adresse, par exemple le lien de son devis. Si ce champ est vide sur sa
  fiche, le message ne part pas : en cours de parcours, la conversation passe à votre équipe, et le Journal des
  erreurs dit pourquoi.
- Une adresse avec une variable ne part qu'en WhatsApp.
- Rien ne revient du clic : le bloc n'attend pas, le parcours continue juste après.

**5. Relier chaque réponse.** Sur la toile, tirez une flèche depuis le point d'une réponse vers le bloc qui suit.

- Un point rouge est une réponse reliée à rien. Si le contact la tape, il passe par « Toute autre réponse » si elle
  est reliée ; sinon, il ne reçoit rien et la conversation passe à votre équipe, dans « À traiter ».

**6. Prévoir le contact qui écrit.** Avec des réponses rapides, le point « Toute autre réponse » sert quand le
contact écrit au lieu de taper un bouton.

- Relié à rien, le parcours s'arrête et la conversation revient à celui qui répond d'habitude à vos clients.

**7. Enchaîner sans attendre.** Avec des réponses rapides, le point « Puis, sans attendre » envoie la suite juste
après le message ; ses boutons restent proposés au contact.

- Seuls des blocs qui n'attendent rien peuvent le suivre : message sans bouton, action, condition, envoi de mail,
  appel API, fonction JS, extraction JSON.
- Un bloc qui attend une réponse à cet endroit empêche de publier le scénario.
