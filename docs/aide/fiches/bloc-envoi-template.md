---
description: Le bloc Envoi template d'un scénario WhatsApp : choisir le template approuvé, relier ses variables, ses boutons et ce qui suit.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 02c6e1
publique: oui
rubrique: construire-un-scenario
rang: 1
---
# Le bloc Envoi template

Envoie un template WhatsApp approuvé : le seul message qui part chez un contact qui ne vous a pas écrit depuis 24 heures,
donc celui qui ouvre une campagne.

**1. Choisir le template.** Cliquez sur le bloc : son panneau s'ouvre à droite, la liste « Template à envoyer » en haut.

- Seuls les templates approuvés par WhatsApp sont proposés. Sur la toile, le bloc en montre une miniature.
- Il part même dans une conversation fermée depuis plus de 24 heures, y compris au réveil d'une attente.
- En premier bloc d'un scénario lancé en campagne, c'est lui que la campagne envoie : tant qu'il est vide, le scénario
  ne peut pas partir en campagne.
- Deux templates du même nom en deux langues ne se départagent pas : un seul des deux part.

**2. Relier chaque variable.** Sous « Variables du template », chaque {{1}}, {{2}}… a sa liste : un champ du
contact, la date du jour ou un texte fixe.

- Chaque variable suit d'abord le champ choisi quand le template a été écrit. Votre choix ne vaut que pour ce bloc ; le
  template et sa validation chez WhatsApp ne bougent pas.
- « Reprendre les champs du template » annule vos choix.
- Une variable reliée à rien est bordée de rouge : le bloc ne partira pas.
- Un contact dont le champ est vide ne reçoit pas le template : en cours de parcours, la conversation passe à votre
  équipe et le Journal des erreurs dit pourquoi ; au lancement d'une campagne, il est compté en échec.
- « Date du jour » s'écrit JJ/MM/AAAA, à l'heure de Paris.
- Premier template d'un scénario lancé en campagne : ses variables se choisissent à l'étape Contenu de la campagne,
  qui reprend vos choix.

**3. Relier chaque bouton de réponse.** Chaque réponse rapide du template devient un point à droite du bloc : tirez
une flèche vers le bloc qui suit.

- Les boutons de lien ou de formulaire n'ont pas de point : ils ouvrent une page et ne renvoient rien.
- Carousel : chaque réponse rapide de chaque carte a son point, marqué C1, C2…
- Un point rouge est un bouton relié à rien. S'il est tapé, le contact passe par « Toute autre réponse » si elle est
  reliée ; sinon, il ne reçoit rien et la conversation passe à votre équipe, dans « À traiter ».

**4. Prévoir les autres réponses.** Le point « Toute autre réponse » sert quand le contact écrit au lieu de taper un
bouton.

- Un emoji en réaction au template compte comme une autre réponse.
- Relié à rien, le parcours s'arrête et la conversation revient à celui qui répond d'habitude à vos clients.

**5. Enchaîner après un template sans bouton.** Le bloc n'a qu'un point, en bas : reliez-le au bloc qui suit.

- La suite part quand le contact répond, quoi qu'il réponde. Sans réponse, le parcours attend, sans limite de temps.
- Exception : si l'agent de Meta répond à vos clients, la suite part tout de suite.
- Si votre équipe ou l'agent de Meta a repris la conversation, la réponse du contact ne fait plus avancer le parcours.
