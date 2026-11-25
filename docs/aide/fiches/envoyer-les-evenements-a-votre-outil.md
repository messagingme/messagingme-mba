---
description: Envoyer les événements de la console (message reçu, lien cliqué, désabonnement…) à votre outil par un webhook sortant : l’adresse, l’essai, le journal.
ecran: webhooks-sortants
source_section: API publique `/v1` (intégrateurs externes)
source_empreinte: aaa15c
publique: oui
comment_faire: oui
rubrique: parler-aux-clients
rang: 20
---
# Envoyer les événements à votre outil

Un webhook sortant envoie à une adresse de votre choix (Make, n8n, Zapier, votre application) chaque événement que vous
cochez, pour tout l'espace, sans scénario à construire : chaque envoi porte la fiche du contact.

**1. Créer l'adresse.** Dans Developers > Webhooks sortants, collez l'adresse que votre outil vous donne pour recevoir
(chez Make « Custom webhook », chez n8n le nœud Webhook, chez Zapier « Catch Hook »), une description si vous voulez,
cochez les événements, puis « Créer l'adresse ».

- Les événements : message reçu, livré, lu ou en échec, lien cliqué, désabonnement, conversation analysée, risque de
  désengagement, validation d'un modèle, action d'un agent IA.
- Les accusés de livraison sont décochés par défaut : une campagne en produit jusqu'à trois par destinataire.
- L'offre limite le nombre d'adresses actives : 5 avec la formule Pro, sans limite avec l'offre Entreprise.

**2. Garder le secret.** Le secret de signature s'affiche une seule fois : copiez-le, puis « J'ai copié le secret ».

- Il sert à votre application à vérifier que l'envoi vient bien de nous (format Standard Webhooks, décrit dans
  Developers > Documentation API). Make, n8n et Zapier n'en ont pas besoin pour recevoir.
- « Renouveler le secret » en donne un nouveau ; l'ancien signe encore 24 heures, le temps de mettre à jour.

**3. Envoyer un essai.** « Envoyer un essai » part tout de suite et dit ce que votre outil a répondu.

- Chez Make, n8n ou Zapier, l'essai sert aussi à leur montrer la forme des données, pour les relier dans la suite de
  votre scénario.

**4. Suivre les envois.** « Journal » liste chaque envoi : l'événement, son statut, ses tentatives, le corps envoyé et
la dernière réponse. « Rejouer » relance un envoi, « Rejouer les échecs depuis » un lot.

- Une adresse qui ne répond pas en 10 secondes est réessayée pendant 24 heures ; un même événement garde son
  identifiant, pour que votre outil puisse ignorer un doublon.
- « Mettre en pause » arrête les envois sans rien supprimer ; « Supprimer l'adresse » efface aussi son journal.
