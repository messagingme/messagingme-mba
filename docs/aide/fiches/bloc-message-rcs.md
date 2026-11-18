---
description: Le bloc Message RCS d'un scénario : le contenu, l'image, les boutons, et les sorties Envoyé, Non joignable et par bouton.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: a3025d
publique: oui
rubrique: construire-un-scenario
rang: 13
---
# Le bloc Message RCS

Envoie un message RCS, avec une image et des boutons si besoin, et prévoit la suite quand le contact n'est pas
joignable en RCS.

**1. Choisir d'où vient le message.** Cliquez sur le bloc : « Message enregistré » copie un message de votre
bibliothèque, « Composer ici » l'écrit dans le bloc.

- Le bloc est grisé dans la palette tant que votre agent RCS n'est pas déposé et validé.
- L'envoi demande aussi l'offre Entreprise : sans elle, le bloc part tout de suite sur « Non joignable ».
- Copié, le message ne suit plus la bibliothèque : la modifier ne change pas ce bloc.
- Les carrousels ne sont pas encore proposés dans un scénario.

**2. Écrire le texte et l'image.** « Message RCS », puis « Image d'en-tête », facultative.

- 3 072 caractères, ou 2 000 avec une image.
- Image JPEG, PNG ou GIF, 2 Mo au plus.
- « Variable » insère un champ du contact ; vide sur sa fiche, il est remplacé par rien.
- Sans texte, rien ne part et le parcours prend « Non joignable ».

**3. Ajouter des boutons.** « + bouton » : réponse, lien, appel, agenda, lieu ou demande de position.

- 11 boutons au plus, ou 4 avec une image.
- Libellé : 25 caractères au plus.
- Seul un bouton Réponse ouvre une sortie à relier.
- Un bouton Agenda dont la date ne se lit pas est retiré ; le message part quand même.

**4. Relier les sorties.** « Envoyé », « Non joignable en RCS », et une sortie par bouton Réponse.

- « Non joignable » se prend tout de suite sans texte, sans l'offre Entreprise ou pour un contact qui a dit STOP au
  RCS, sinon sur l'échec rapporté par l'opérateur, quelques instants à quelques minutes après l'envoi : reliez-y un
  envoi de template WhatsApp, pour toucher en WhatsApp ceux que le RCS n'atteint pas.
- « Envoyé » se prend à la remise du message. Avec des boutons Réponse, le parcours attend plutôt un clic ; un message
  écrit par le contact prend « Envoyé ».
- Un bouton relié à rien : le contact qui le tape ne reçoit rien et la conversation passe à votre équipe.

**5. Enchaîner en RCS.** Après ce bloc, la conversation continue en RCS.

- Les messages rapides suivants partent en RCS. Pour revenir à WhatsApp, branchez un envoi de template : le parcours
  y passe et y reste. Un formulaire ou une question l'y ramènent aussi.
- Un formulaire, une question ou un agent IA ne partent qu'en WhatsApp, si le contact y a écrit dans les 24 heures :
  l'écran vous avertit.
- Le RCS n'a pas de fenêtre de 24 heures. En tête d'un scénario, ce bloc ouvre une campagne RCS.
- Il ne peut pas suivre la sortie « Puis, sans attendre » d'un message rapide : le scénario ne se publie pas.
