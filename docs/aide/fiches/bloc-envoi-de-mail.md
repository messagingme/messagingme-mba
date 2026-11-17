---
description: Le bloc Envoi de mail d'un scénario : la boîte d'envoi, le modèle, les destinataires de la fiche ou fixes, et ce qui se passe en cas d'échec.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 02c6e1
publique: oui
rubrique: construire-un-scenario
rang: 14
---
# Le bloc Envoi de mail

Envoie un e-mail depuis votre boîte, à partir d'un modèle, à une adresse de la fiche du contact ou à une adresse fixe.

**1. Choisir la boîte et le modèle.** Cliquez sur le bloc, puis « Boîte d'envoi » et « Modèle ».

- Le bloc est grisé dans la palette tant qu'aucune boîte n'est connectée (Tools > SMTP email). La fiche « Envoyer un
  e-mail depuis un scénario » explique comment la connecter et écrire les modèles.
- Les variables du modèle sont remplacées par la fiche du contact, dans le sujet comme dans le corps.
- Boîte, modèle ou destinataire manquant : le bloc ne fait rien et le parcours continue.

**2. Choisir les destinataires.** Chaque ligne : « Adresse fixe », ou « Variable » pour un champ de la fiche.

- 3 destinataires au plus : le premier en « À », les suivants en copie cachée.
- À côté de chaque champ, le nombre de fiches qui le remplissent : un champ vide partout n'enverra rien.
- Une adresse qui ne donne rien est ignorée ; les autres partent quand même.

**3. Relier la suite.** Le bloc n'a qu'un point, en bas : la suite part tout de suite, sans attendre l'e-mail.

- Un échec (boîte injoignable, adresse invalide) est journalisé et n'arrête pas le parcours. Les envois se comptent
  dans le Performance Lab, sous Mes tableaux.
- Exception : un contact qui a dit STOP ne reçoit pas l'e-mail ; si rien d'autre n'est parti, la conversation passe
  à votre équipe.
- Pas de fenêtre de 24 heures : l'e-mail part à tout moment.
- Il peut suivre la sortie « Puis, sans attendre » d'un message rapide.
