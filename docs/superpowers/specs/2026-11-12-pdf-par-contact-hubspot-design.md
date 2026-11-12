# Cadrage : envoyer sur WhatsApp un PDF propre à chaque contact, venu de HubSpot

Date : 2026-11-12. Statut : cadré, NON commencé (on attend de savoir si MUTAC en a besoin tout de suite).

## Le besoin

MUTAC fait passer une transaction de l'étape 1 à l'étape 2 ; le passage lance un scénario WhatsApp. Juste avant, le
conseiller a envoyé au client, depuis HubSpot, un e-mail avec deux PDF : le **devis personnel** (« Madame CORNU
SOPHIE-MUTAC », une nouvelle version possible sous le même nom) et les **documents contractuels** (identiques pour
tous les clients d'un produit). HubSpot range ces fichiers dans la carte « Pièces jointes » de la fiche, source
« E-mail ». Le scénario doit envoyer le devis personnel comme DOCUMENT WhatsApp.

## Ce qui existe, mesuré le 2026-11-12

- Les calculés « Lien du devis » et « PDF du devis » ne lisent que les **devis HubSpot** (objet Devis), le plus récent
  valable (`devisRetenu`, `~/mm-hubspot/src/workflow/transaction.ts`). Une pièce jointe n'est jamais lue.
- L'en-tête DOCUMENT d'un modèle est **fixe** : c'est le fichier déposé à la création, relu chez Meta puis redéposé à
  chaque envoi (`headerMediaUrlOf`, `prepareHeaderMedia` dans `src/workflow/envois-bloc.ts`, `src/campaign/engine.ts`).
  Aucun champ de fiche n'alimente un en-tête ; seul le corps a des variables.
- Un bloc « message » d'un scénario sait envoyer un PDF FIXE (`sendQuickMessage`), en fenêtre de 24 h seulement.
- Les médias partent chez Meta par identifiant après dépôt, avec une mémoire de 7 jours (`medias_meta`, 0288,
  `TemplateMediaPreparer`). Le stockage d'objets (`src/lib/magasin-objets.ts`, bucket privé à Amsterdam) ne sert que
  la médiathèque de l'espace.

**Sans ce lot, aujourd'hui** : les documents contractuels partent en en-tête fixe du modèle (ou dans un bloc après la
réponse du client) ; un devis HubSpot part en LIEN dans le texte ; une pièce jointe ne part pas.

## Décisions de Julien (2026-11-12)

1. **Deux sources** : la pièce jointe d'e-mail de la transaction ET le PDF d'un devis HubSpot, par le même mécanisme.
2. **Le choix de la pièce jointe** : la plus récente, en PDF, dont le nom COMMENCE par un des débuts réglés par espace
   dans Intégrations > HubSpot (pour MUTAC : « Madame », « Monsieur »). Comparaison sans casse ni accents.
3. **Aucun PDF qui correspond** : rien ne part, la raison est écrite dans l'historique du workflow HubSpot (comme une
   variable manquante). Jamais « voici votre devis » sans devis.
4. **Conservation** : le PDF est recopié chez nous (stockage Scaleway, Amsterdam) **30 jours**, puis effacé seul ; effacé
   tout de suite avec la fiche du contact (purge RGPD).

## Conception

**Connecteur (`~/mm-hubspot`)**
- Un calculé de plus, `document`, à côté de `lien_devis` et `pdf_devis`, proposé dans « Champs HubSpot à importer » avec
  son réglage « le nom commence par » (une liste courte).
- Lecture : les e-mails (et notes) associés à la transaction, leurs `hs_attachment_ids`, la fiche de chaque fichier
  (nom, extension, date), le filtre de nom, le plus récent ; sinon le PDF du devis HubSpot retenu par `devisRetenu`.
- Il ne transporte JAMAIS le fichier : il rend une adresse signée à courte vie (fichier privé) ou l'adresse publique du
  PDF du devis. Une nouvelle portée facultative (lecture des fichiers), demandée comme celle des devis, avec son bouton
  de réautorisation ; sans elle, le calculé est grisé avec sa raison.

**mba**
- À la réception (action de workflow, action transaction, étape de transaction), mba **télécharge tout de suite** le PDF
  par `fetchPublic` (adresse vérifiée, corps lu en flux et borné par `lireCorpsBorne`, PDF vérifié par sa signature),
  le dépose dans le stockage d'objets sous un code opaque, et pose sur la fiche le champ `hs_calc_document` : une
  RÉFÉRENCE interne, jamais une adresse publique. L'adresse signée de HubSpot ne sort pas de la requête.
- Une table `documents_contact` (espace, contact, code, nom du fichier, taille, empreinte, date) : la même empreinte
  reçue deux fois n'est pas redéposée.
- **L'en-tête DOCUMENT d'un modèle gagne une SOURCE**, comme ses variables : « le fichier du modèle » (aujourd'hui) ou
  « un champ document de la fiche ». À l'envoi, la référence est relue (espace vérifié), le fichier déposé chez Meta par
  `TemplateMediaPreparer` (usage `fichier`), envoyé par identifiant avec son NOM d'origine. Référence absente ou effacée :
  le refus de la décision 3.
- Purge : un balayage quotidien efface ce qui a plus de 30 jours (objet et ligne, et le champ de la fiche) ; la purge
  RGPD d'un contact efface ses documents. 🔴 La table que la purge NOMME part en migration SEULE, appliquée avant son
  code (règle du dépôt).

## Lot 0 : la mesure (2026-11-12)

- **Mesuré sur le portail de Messaging Me** (par l'outil HubSpot de Claude) : un e-mail CRM porte ses pièces jointes dans
  `hs_attachment_ids` (identifiants de fichiers séparés par « ; », 3 161 e-mails en ont), et les e-mails sont associés
  aux transactions (trois transactions retrouvées depuis cinq e-mails). La chaîne transaction, e-mails, fichiers existe.
- **Documenté** ([guide Files](https://developers.hubspot.com/docs/api-reference/latest/files/guide)) : `GET
  /files/v3/files/{fileId}` rend `name`, `extension`, `type`, `size`, `createdAt`, `access` ; `GET
  /files/v3/files/{fileId}/signed-url?expirationSeconds=` rend `url`, `expiresAt`, `name`, `extension`, `size`. Un
  fichier PRIVÉ rend 404 sur son adresse nue : l'adresse signée est obligatoire. Un fichier « sensible » se lit par
  `/download` avec une portée à part (hors du lot : refusé, il compte comme « aucun PDF »).
- **Non tranché par la documentation** (ses encadrés de portées ne s'affichent pas) : les DEUX portées à ajouter aux
  `optionalScopes` de l'app (`hubspot-app/src/app/app-hsmeta.json`), lecture des e-mails CRM et lecture des fichiers
  (candidates : `sales-email-read`, `files`, `files.ui_hidden.read`). Première étape du lot C : les poser sur l'app, la
  réautoriser sur un portail de test, et lire un vrai fichier de bout en bout ; le défaut et le maximum de
  `expirationSeconds` se mesurent au même appel.

## Les lots

| Lot | Où | Contenu |
|---|---|---|
| 0 | mesure | Sur un portail de test : lire les pièces jointes d'un e-mail associé à une transaction, la portée exacte demandée par HubSpot, la durée de vie d'une adresse signée. Rien ne se code avant. |
| A | mba | Migration `documents_contact` (seule, `avant`), purge RGPD et balayage des 30 jours |
| B | mba | Réception et recopie du PDF, champ `hs_calc_document`, source d'en-tête d'un modèle (API et console), envoi |
| C | connecteur | Calculé `document`, réglage des débuts de nom, portée facultative, lecture des pièces jointes et du devis |

Ordre de mise en production : A, puis B (mba accepte le calculé avant que le connecteur l'envoie), puis C.

## Méthode de livraison

Implémenteur par lot et revue humaine du diff : le lot touche l'envoi de messages, une migration nommée par la purge RGPD,
une nouvelle portée HubSpot et un fichier personnel recopié chez nous ; chaque lot a sa relecture indépendante avant son
déploiement. L'essai réel qui clôt la feature : sur le portail de MUTAC, un e-mail avec le devis et les documents
contractuels, le passage de la transaction à l'étape 2, et le devis reçu en document sur le WhatsApp de Julien, au bon
nom ; puis le même passage sans e-mail, qui ne fait rien partir et le dit dans l'historique du workflow.

## Risques et questions ouvertes

- Un e-mail envoyé APRÈS le changement d'étape : le scénario ne part pas (décision 3). Le conseiller doit tenir l'ordre ;
  à dire à MUTAC.
- Les noms de fichiers sont saisis par des humains : un devis nommé « Devis Cornu » échapperait au filtre « Madame ».
- Le document reste visible dans la conversation WhatsApp du client après nos 30 jours : seule notre copie s'efface.
- Si Pierre-Marie confirme que le devis est AUSSI un devis HubSpot, la première version se fait sans ce lot (le lien du
  devis dans le texte) ; ce cadrage reste pour le fichier PDF.
