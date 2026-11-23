# L'agent IA lit les données Shopify et HubSpot de la fiche (2026-11-23)

Demande de Julien du 2026-11-23 : un agent IA créé après le branchement de Shopify ou de HubSpot doit pouvoir s'appuyer
sur ce que ces intégrations écrivent sur la fiche client (exemple : « quand arrive ma commande ? » → le lien de suivi),
et l'entretien « Construire en parlant » doit le proposer. Décisions de Julien (questions fermées) : une question
dédiée, posée seulement si une intégration est branchée, qui ne nomme que celle(s) qui le sont ; le lien de suivi
seul est gardé, sur la fiche, sans rattrapage des commandes passées.

## Méthode de livraison

**En direct**, dans une copie à jour d'origin, avec une relecture indépendante en fin de lot : trois changements
isolés et réversibles (une écriture de champ au mieux, une lecture ajoutée à un outil, un point d'ordre du jour
conditionnel), tous vérifiables par des tests unitaires dans les deux sens, sans migration. La production emprunte le
webhook d'expédition : l'écriture ne doit jamais freiner ni faire échouer son traitement (au mieux, comme la
joignabilité). Les tests ne voient pas le vrai modèle d'entretien ni un vrai colis : l'essai réel décrit en fin de plan
clôt le lot.

## Tâches

1. **Lien de suivi sur la fiche** (`src/shopify/traitement.ts`, câblage `src/index.ts`) : à chaque `fulfillments/create`,
   avant `servir` et quel que soit l'état de la ligne, le `tracking_url` (http ou https) s'écrit dans le champ déclaré
   `shopify_lien_suivi` (« Lien de suivi (Shopify) », type `url`) de la fiche trouvée par le téléphone de l'expédition.
   Aucune fiche : rien. N'émet aucun événement d'automation (`ecrireChampsFiche`). Une panne se journalise et ne lève pas.
2. **Les commandes dans « Lire la fiche du contact »** (`src/agent/resolvers/mba.ts`, câblage `src/worker.ts`) : quand
   l'espace a une boutique, l'outil rend aussi les commandes récentes du contact (paiement, montant, produits,
   expédition) depuis `achatsDuContact`, qui gagne la date d'expédition (`shopify_joignabilite.expediee_le`). Ni
   attribution ni chiffre rapporté. Une lecture ratée ne fait pas perdre le reste de la fiche.
3. **La question de l'entretien** (`src/agent/setup/`, câblage `src/index.ts`) : le contexte de construction porte les
   intégrations branchées (boutique Shopify non coupée ; champs HubSpot importés, par leur libellé). Un point
   `donnees_client`, juste après `connaissance`, n'existe dans l'ordre du jour effectif que si l'une d'elles l'est ; sa
   question ne nomme que celles qui le sont. Sur un oui, l'assistant propose l'outil `lire_contact` avec ses mots.

## Tests

Pour chaque tâche, un test qui échoue sans le code (vérifié par mutation scriptée) : le champ écrit, le champ non écrit
(sans fiche, sans lien, lien non http), la panne qui ne lève pas ; la lecture de fiche avec et sans boutique, et en
panne ; le point absent sans intégration, présent avec, et sa question qui ne nomme que l'intégration branchée.

## Essai réel qui clôt le lot

Sur la boutique de test : expédier une commande avec un lien de suivi, vérifier le champ sur la fiche ; dans la
SANDBOX, mener l'entretien d'un agent (la question Shopify apparaît, pas HubSpot si seul Shopify est branché), garder
la proposition, puis demander à l'agent « où en est ma commande ? » depuis le numéro de la commande.
