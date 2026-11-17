---
description: Créer un scénario WhatsApp : poser et relier les blocs, l'essayer sur son téléphone, le mettre en ligne, le ranger, puis la fiche de chaque bloc.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 02c6e1
publique: oui
rubrique: construire-un-scenario
rang: 1
comment_faire: oui
---
# Créer un scénario

Un scénario enchaîne des blocs sur une toile : le contact avance de bloc en bloc. Vous le construisez en brouillon,
vous l'essayez sur votre téléphone, puis vous le mettez en ligne.

**1. Créer le scénario.** Dans le menu Scénario, donnez-lui un nom, puis « Créer un scénario ».

**2. Poser un bloc.** « Créer un bloc : » propose chaque type de bloc : cliquez sur celui que vous voulez.

- Un bloc grisé attend un branchement : un agent RCS, une boîte d'envoi, un agent IA actif ou un appel déclaré.
- Une flèche tirée depuis le point d'un bloc et lâchée dans le vide crée aussi un bloc.
- La nature d'un bloc se choisit à sa création et ne se change plus. Le ✕ en coin d'un bloc le supprime.
- Le bouton à droite du bouton lecture, en haut à gauche d'un bloc, copie son code, pour un « Aller à » ou pour l'API. Il reste grisé une seconde,
  le temps de l'enregistrement.

**3. Relier les blocs.** Tirez une flèche depuis le point d'un bloc et lâchez-la sur le suivant.

- Une sortie ne porte qu'une flèche : en tirer une nouvelle remplace l'ancienne.
- « Auto-arranger » range la toile.

**4. L'essayer.** Le bouton lecture en haut à gauche d'un bloc ouvre le lien de test à partir de ce bloc ; « Tester le
scénario », dans le menu ⋯ de la liste, le lance depuis le début.

- Le lien ouvre une conversation avec votre numéro, sur votre téléphone : c'est votre brouillon qui joue, avant toute
  publication.
- À partir d'un bloc, ce qui précède n'est pas rejoué : ses étiquettes et ses champs ne sont pas posés.
- Si l'agent de Meta tenait la conversation, il répond d'abord « Je lance le test. », et le scénario part quelques
  secondes après.

**5. Le mettre en ligne.** « Publier » met votre brouillon en ligne.

- Le brouillon s'enregistre tout seul, environ une seconde après chaque modification ; l'indicateur dit quand.
- Un contact réel ne joue que la version en ligne. Les parcours en cours basculent sur la nouvelle, sans retour
  arrière possible.
- Une campagne programmée part avec la version en ligne au moment de l'envoi.
- Un refus de publication dit quel bloc corriger.

**6. Ranger dans des dossiers.** « Dossier » en crée un ; « Déplacer vers… », dans le menu ⋯ d'un scénario ou après
en avoir coché plusieurs, les y range.

- Les onglets « Tous », « Sans dossier » et vos dossiers filtrent la liste.
- Supprimer un dossier ne supprime pas ses scénarios : ils repassent dans « Sans dossier ».

## Les blocs

Chacun a sa fiche, dans l'ordre de la palette.

- **Envoi template** : un template approuvé, le seul message qui ouvre une conversation. « Le bloc Envoi template ».
- **Message rapide** : un texte, avec un fichier, des réponses rapides ou un bouton de lien. « Le bloc Message
  rapide ».
- **Question** : une question, avec ou sans menu, qui attend la réponse ou un fichier. « Le bloc Question ».
- **Formulaire** : un formulaire WhatsApp dont les réponses remplissent la fiche. « Le bloc Formulaire ».
- **Action** : des étiquettes, des champs, le consentement. « Le bloc Action ».
- **Condition** : aiguiller le contact selon son état. « Le bloc Condition ».
- **Attente** : une pause, jusqu'à une date ou aux heures d'ouverture. « Le bloc Attente ».
- **Assigner à un agent** : passer la conversation à votre équipe. « Le bloc Assigner à un agent ».
- **Envoyer au MBA** : confier la conversation à l'agent de Meta. « Le bloc Envoyer au MBA ».
- **Aller à** : continuer sur un autre bloc, d'ici ou d'ailleurs. « Le bloc Aller à ».
- **Fonction JS** : transformer un champ par du JavaScript. « Le bloc Fonction JS ».
- **Message RCS** : un message RCS, avec son repli. « Le bloc Message RCS ».
- **Envoi de mail** : un e-mail depuis votre boîte. « Le bloc Envoi de mail ».
- **Agent IA** : plusieurs échanges confiés à un agent. « Le bloc Agent IA ».
- **Appel API** : interroger votre système. « Le bloc Appel API ».
- **Extraire du JSON** : ranger des valeurs d'une réponse. « Le bloc Extraire du JSON ».

**Bon à savoir.** Quand un message ne peut pas partir en cours de parcours (un champ vide, la fenêtre de 24 heures
fermée au réveil d'une attente…), la raison et le bloc en cause s'écrivent dans Sécurité > Journal des erreurs, sous
« échec de scénario ». Au lancement d'une campagne, la campagne compte le contact en échec, avec la raison.
