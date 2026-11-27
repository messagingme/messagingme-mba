---
description: Brancher Make, n8n ou Zapier dans les deux sens : recevoir leurs données, et leur envoyer les vôtres, en continu ou à un moment précis d’un scénario.
ecran: integrations
source_section: Webhooks entrants (menu Tools) | API publique `/v1` (intégrateurs externes) | Brancher vos systèmes : les connecteurs API (menu « Tools » > Connecteurs API)
source_empreinte: de4822 | 3a828a | 3c13fd
publique: oui
captures: non
rubrique: parler-aux-clients
rang: 18
---
# Brancher Make, n8n ou Zapier

Make, n8n et Zapier se branchent sans code, dans les deux sens. Choisissez d'abord le sens, puis la voie : chacune a sa
fiche pas à pas.

**1. Recevoir : votre outil nous envoie des données.** Un formulaire rempli, un devis signé, une commande : votre outil
crée ou met à jour le contact, et peut lancer un scénario.

- **Le plus simple, un webhook entrant** : Tools > Webhooks vous donne une adresse, à coller dans le module HTTP de
  Make, le nœud HTTP Request de n8n ou l'action « Webhooks by Zapier » (POST, corps JSON). Voir « Recevoir des données
  par webhook ».
- **Pour aller plus loin, notre API** : avec une clé (Developers > Clés d'API), le module HTTP de votre outil peut aussi
  envoyer un modèle WhatsApp ou lire un contact. La clé se pose dans l'en-tête Authorization (Bearer) ; les appels sont
  décrits dans Developers > Documentation API.

**2. Envoyer, en continu : tous les événements partent vers votre outil.** Message reçu, lien cliqué, désabonnement,
conversation analysée : chaque événement coché part, pour tout l'espace, sans scénario à construire.

- Votre outil vous donne une adresse de réception (Make « Custom webhook », n8n le nœud Webhook, Zapier « Catch Hook ») :
  collez-la dans Developers > Webhooks sortants. Voir « Envoyer les événements à votre outil ».

**3. Envoyer, à un moment précis : un scénario pousse vers votre outil.** Seulement quand un parcours passe à cet
endroit, avec les seules données que vous choisissez, par exemple les réponses d'un client à vos questions.

- Déclarez l'adresse de réception de votre outil comme un système dans Tools > Connecteurs API (voir « Brancher un
  connecteur API ») : l'adresse de base est le début de l'adresse (https://hook.eu1.make.com), l'authentification
  « aucune », et l'appel un POST dont le chemin est la fin de l'adresse (/abc123…), avec dans son corps les champs du
  contact à envoyer.
- Puis placez un bloc Appel API dans le scénario, à l'endroit voulu (voir « Le bloc Appel API »). Pour que votre outil
  renvoie une réponse au bloc, terminez son scénario par une réponse (chez Make, le module « Webhook response »).
