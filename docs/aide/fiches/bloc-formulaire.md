---
description: Le bloc Formulaire d'un scénario WhatsApp : choisir le formulaire, son accroche, où ranger les réponses, et les sorties à relier.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 02c6e1
publique: oui
rubrique: construire-un-scenario
rang: 5
---
# Le bloc Formulaire

Envoie un formulaire WhatsApp au contact et attend qu'il le renvoie : ses réponses peuvent remplir sa fiche.

**1. Choisir le formulaire.** Cliquez sur le bloc, puis choisissez dans « Formulaire (publié) ».

- Seuls les formulaires publiés sont proposés. Ils se construisent dans Contenu > WhatsApp > Formulaires.
- Il ne part que dans une conversation ouverte : le contact vous a écrit il y a moins de 24 heures. Un scénario qui
  commence par lui ne peut donc pas partir en campagne.
- Il part toujours par WhatsApp, même dans un parcours RCS.
- Sans formulaire choisi, rien ne part et le parcours reste sur ce bloc ; si l'agent de Meta répond à vos clients, il
  passe par « Toute autre réponse ».

**2. Écrire l'accroche et le bouton.** « Texte d'accroche » accompagne le formulaire ; « Libellé du bouton » est ce que
le contact touche pour l'ouvrir.

- Accroche vide : « Formulaire : » suivi de son nom part à sa place, en français.
- Bouton : 30 caractères au plus, « Envoyer » s'il est vide. Il reprend d'abord le bouton final du formulaire.

**3. Choisir où ranger les réponses.** Sous « Enregistrer les réponses dans », un champ de la fiche par élément du
formulaire.

- Chaque élément suit d'abord le champ choisi dans le formulaire ; un autre choix ne vaut que pour ce scénario.
- « Ne pas enregistrer » ne range rien, même si le formulaire rangeait cet élément ailleurs.
- Ni champ JSON, ni nom WhatsApp, ni téléphone.
- Un choix multiple s'écrit « a, b », une case à cocher true ou false ; une réponse vide n'écrit rien.
- Une case de consentement cochée inscrit le contact à vos campagnes, même sur « Ne pas enregistrer ».
- Formulaire créé dans le Business Manager : rien n'est rangé tant qu'aucun champ n'est choisi ici, et sa case de
  consentement n'inscrit personne.

**4. Relier « Formulaire rempli ».** La sortie que prend le contact qui renvoie le formulaire.

- N'importe quel formulaire renvoyé pendant l'attente la prend, même un autre ; mais le bloc ne range que les
  réponses au formulaire qu'il a envoyé, un autre suit son propre réglage.
- Reliée à rien, le formulaire renvoyé passe par « Toute autre réponse ».
- Sans réponse, le parcours attend, sans limite de temps.

**5. Prévoir les autres réponses.** « Toute autre réponse » sert quand le contact écrit au lieu de remplir le
formulaire.

- Un emoji en réaction compte comme une autre réponse.
- Reliée à rien, le parcours s'arrête et la conversation revient à celui qui répond d'habitude à vos clients.
- Si votre équipe ou l'agent de Meta a repris la conversation, la réponse du contact ne fait plus avancer le parcours.
- Un Formulaire ne peut pas suivre la sortie « Puis, sans attendre » d'un message rapide : le scénario ne se publie pas.
