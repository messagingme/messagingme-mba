---
description: Recevoir les données de Make, n8n, Zapier ou d’un formulaire par un webhook entrant : l’adresse, l’essai, où va chaque valeur, le contact.
ecran: webhooks
source_section: Webhooks entrants (menu Tools)
source_empreinte: de4822
publique: oui
comment_faire: oui
rubrique: parler-aux-clients
rang: 19
---
# Recevoir des données par webhook

Un webhook entrant donne une adresse à votre outil (Make, n8n, Zapier, le formulaire de votre site, un CRM). L'outil y
poste ses données quand il se passe quelque chose chez lui, et vous choisissez, en cliquant, où va chaque valeur dans la
fiche du contact.

**1. Créer le webhook.** Dans Tools > Webhooks, donnez-lui un nom (« formulaire du site »), puis « Créer ».

- Un webhook est réservé aux administrateurs : son adresse peut écrire dans vos contacts, et envoyer quand un scénario
  y est attaché.

**2. Donner l'adresse à votre outil.** Ouvrez le webhook : « Copier » l'adresse de la rubrique « 1. L'adresse à donner
à votre outil », et collez-la dans votre outil, en POST avec un corps JSON.

- L'adresse fait office de clé. Un secret, à poser dans un en-tête, est facultatif : « Générer un secret », puis
  copiez-le tout de suite, il ne se réaffiche jamais.

**3. Envoyer un essai.** Déclenchez un envoi depuis votre outil, puis « Vérifier maintenant » : la rubrique « 2. Ce que
votre outil a envoyé » montre le contenu reçu, en arbre.

- Seul le dernier contenu reçu est gardé, 7 jours au plus ; « oublier ce contenu » l'efface tout de suite.

**4. Dire où va chaque valeur.** Sur chaque valeur, « Attacher… » : le téléphone (c'est lui qui désigne le contact), le
nom, ou un champ du contact. « Créer un champ… » en crée un sans quitter l'écran, son type deviné d'après la valeur.

- Dans une liste, une valeur se pointe élément par élément (le premier article, pas la liste entière).
- Une date s'envoie au format international (2026-08-23T15:40:00Z) : 03/04/2026 est refusé, il peut être le 3 avril ou
  le 4 mars.
- Une valeur refusée n'empêche pas le reste : le contact et ses autres champs sont écrits, et la réponse renvoyée à
  votre outil nomme ce qui a été laissé de côté.

**5. Régler le contact.** Dans « 4. Le contact », « Créer les contacts inconnus » décide si une personne absente de vos
contacts est créée, et « Si vous créez des contacts via webhook, sont-ils opt-in ? » si elle part avec son consentement.

- Le consentement, c'est vous qui l'affirmez : décoché, les contacts créés restent « inconnus » et sont écartés des
  campagnes marketing. Un contact qui a dit STOP reste désabonné, même case cochée.

**6. Lancer un scénario, si vous voulez.** « 5. Déclencher un scénario (facultatif) » : choisissez-le, puis
« Enregistrer ».

- Le contact n'a pas forcément écrit récemment : le scénario doit commencer par un modèle approuvé.
- Votre outil ne reçoit jamais d'erreur pour un refus : la réponse dit ce qui s'est passé (contact créé ou retrouvé,
  champs écrits, scénario lancé ou non).
