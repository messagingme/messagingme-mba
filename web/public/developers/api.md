<!-- Version Markdown de https://console.messagingme.app/developers/api, générée depuis la page (npm run doc:md). English: https://console.messagingme.app/developers/api.en.md -->

# API Messaging Me

API REST : contacts, messages WhatsApp et RCS, envois, et chaque événement poussé vers votre serveur par un webhook signé.

<a id="api-ou-mcp"></a>

## API ou MCP ?

| En bref | API | MCP |
| --- | --- | --- |
| Qui agit | Votre code, à chaque événement de votre application | Un assistant (Claude, ChatGPT…), quand vous le lui demandez |
| Ce qu’on branche | Une clé d’API, dans votre serveur | Le plugin Claude Code, ou l’adresse du serveur MCP |
| Pour | Envoyer à chaque commande, inscription ou rendez-vous, et recevoir chaque message par un webhook signé | Mettre l’espace en service, régler l’agent IA, répondre, préparer une campagne, lire vos chiffres, en conversation |
| Commencer | [Démarrer avec l’API](https://console.messagingme.app/developers/api/quickstart.md) | [Serveur MCP](https://console.messagingme.app/developers/mcp.md) |

Les deux se complètent : Claude met l’espace en service et crée la clé de votre application, votre code envoie et reçoit.

<a id="authentification"></a>

## Votre clé

Chaque appel porte une clé d’API dans l’en-tête Authorization :

_En-tête_

```
Authorization: Bearer mba_xxxxxxxxxxxxxxxx
```

- Un administrateur de l’espace la crée dans la console, Developers > Clés d’API, quelle que soit l’offre, ou la demande à Claude (`create_api_key`) ; une clé créée par Claude a des droits limités (ni le MCP, ni les webhooks, ni la suppression de contacts), qui se donnent dans la console.
- Cochez seulement les droits dont votre code a besoin. La clé (mba_…) n’est montrée qu’une fois : gardez-la côté serveur, dans une variable d’environnement.

> **Attention**
>
> Les appels sont réels : il n’y a pas d’espace de test. Un envoi part vraiment sur WhatsApp, et Meta peut le facturer à votre entreprise. Pour essayer, écrivez d’abord à votre propre téléphone.

<a id="adresse"></a>

### Adresse de base

_Adresse de base_

```
https://api.messagingme.app/v1
```

Droits, débit et erreurs : [Authentification, limites et erreurs](https://console.messagingme.app/developers/api/reference.md).

<a id="premier-appel"></a>

## Premier appel

Créer une fiche, ou la mettre à jour si elle existe. Rien ne part sur WhatsApp :

_Commande_

```
curl -X POST https://api.messagingme.app/v1/contacts \
  -H "Authorization: Bearer mba_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
  "phone": "+33612345678",
  "externalId": "crm-7781",
  "name": "Camille Roy",
  "fields": {
    "ville": "Lyon"
  },
  "tags": [
    "prospect"
  ],
  "consent": "opted_in",
  "consentSource": "formulaire-site"
}'
```

_Réponse 200_

```
{
  "contactId": "5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01",
  "status": "created"
}
```

Détail : [POST /v1/contacts](https://console.messagingme.app/developers/api/contacts.md#creer).

<a id="ensuite"></a>

## Ensuite

- [Démarrer](https://console.messagingme.app/developers/api/quickstart.md) : du numéro au premier message envoyé, étape par étape.
- [Le SDK TypeScript](https://console.messagingme.app/developers/api/sdk.md) : des appels et des erreurs typés, la vérification des webhooks.
- [Les concepts](https://console.messagingme.app/developers/api/concepts.md) : désigner une personne, le consentement et STOP, la fenêtre de 24 h, l’idempotence.
- [Les erreurs](https://console.messagingme.app/developers/api/errors.md) : chaque code, et quoi faire.

<a id="openapi"></a>

## Utiliser le contrat dans votre outil

Le contrat OpenAPI 3.1 de l’API, servi par l’API elle-même et donc toujours égal au code en production : chaque route, son droit, son corps, sa réponse, ses erreurs, et les événements des webhooks sortants.

_Contrat_

```
https://api.messagingme.app/openapi.json
```

Importez cette adresse, ou le fichier, dans Postman, Bruno ou Insomnia : chacun en fait une collection de requêtes, prête à essayer. Ajoutez-y l’en-tête Authorization avec votre clé.

[Ouvrir le contrat](https://api.messagingme.app/openapi.json)

En TypeScript, le client généré depuis ce contrat : [SDK TypeScript](https://console.messagingme.app/developers/api/sdk.md).

<a id="endpoints"></a>

## Tous les endpoints

### Contacts

|   |   |   |
| --- | --- | --- |
| POST | [/v1/contacts](https://console.messagingme.app/developers/api/contacts.md#creer) : Crée ou met à jour une fiche. | `contacts:write` |
| POST | [/v1/contacts/batch](https://console.messagingme.app/developers/api/contacts.md#lot) : Crée ou met à jour jusqu’à 50 fiches en un appel. | `contacts:write` |
| GET | [/v1/contacts/{contactId}](https://console.messagingme.app/developers/api/contacts.md#lire) : Lit une fiche. | `contacts:read` |
| POST | [/v1/contacts/search](https://console.messagingme.app/developers/api/contacts.md#rechercher) : Cherche une fiche par téléphone, BSUID ou identifiant externe. | `contacts:read` |
| DELETE | [/v1/contacts/{contactId}](https://console.messagingme.app/developers/api/contacts.md#effacer) : Efface une fiche pour de vrai (RGPD), dans la limite du jour de l’offre. | `contacts:admin` |
| GET | [/v1/fields](https://console.messagingme.app/developers/api/contacts.md#champs) : Liste les champs personnalisés : les clés à utiliser dans fields. | `contacts:read` |
| POST | [/v1/fields](https://console.messagingme.app/developers/api/contacts.md#creer-champ) : Crée un champ personnalisé ; sa clé vient du libellé. | `contacts:admin` |
| PATCH | [/v1/contacts/{contactId}](https://console.messagingme.app/developers/api/contacts.md#modifier) : Modifie les champs, les tags, le consentement ou l’identifiant externe d’une fiche. | `contacts:write` |

### Messages

|   |   |   |
| --- | --- | --- |
| POST | [/v1/messages](https://console.messagingme.app/developers/api/messages.md#message-meta) : Envoie un message au format de Meta : image, document, lieu, boutons, liste, bouton lien. | `sends:create` |
| POST | [/v1/messages/whatsapp](https://console.messagingme.app/developers/api/messages.md#message-whatsapp) : Envoie tout de suite un texte WhatsApp à une fiche existante. | `sends:create` |
| POST | [/v1/messages/rcs](https://console.messagingme.app/developers/api/messages.md#message-rcs) : Envoie tout de suite un texte RCS à une fiche existante. | `sends:create` |

### Conversations

|   |   |   |
| --- | --- | --- |
| GET | [/v1/conversations](https://console.messagingme.app/developers/api/conversations.md#lister) : Liste les conversations, la plus récente d’abord, par pages. | `conversations:read` |
| GET | [/v1/conversations/{conversationId}](https://console.messagingme.app/developers/api/conversations.md#lire) : Lit une conversation : le contact, qui la tient, la fenêtre de 24 h. | `conversations:read` |
| GET | [/v1/conversations/{conversationId}/messages](https://console.messagingme.app/developers/api/conversations.md#messages) : Les messages d’une conversation, le plus récent d’abord, par pages. | `conversations:read` |
| GET | [/v1/messages/{messageId}](https://console.messagingme.app/developers/api/conversations.md#message) : Lit un message par son identifiant. | `conversations:read` |
| GET | [/v1/messages/{messageId}/media](https://console.messagingme.app/developers/api/conversations.md#media) : Télécharge le fichier d’un message reçu. | `conversations:read` |

### Envois

|   |   |   |
| --- | --- | --- |
| POST | [/v1/sends](https://console.messagingme.app/developers/api/sends.md#envoi) : Lance un envoi asynchrone et idempotent, vers 1 à 50 destinataires. | `sends:create` |
| GET | [/v1/sends/{sendId}](https://console.messagingme.app/developers/api/sends.md#suivi) : Lit l’état et les résultats d’un envoi. | `sends:create` |

### Modèles

|   |   |   |
| --- | --- | --- |
| POST | [/v1/templates](https://console.messagingme.app/developers/api/templates.md#creer) : Crée un modèle au format de Meta et le soumet à sa validation. | `templates:write` |
| GET | [/v1/templates/{name}](https://console.messagingme.app/developers/api/templates.md#statut) : Lit le statut d’un modèle chez Meta, langue par langue. | `templates:write` |

### Webhooks sortants

|   |   |   |
| --- | --- | --- |
| GET | [/v1/webhooks](https://console.messagingme.app/developers/api/webhook-endpoints.md#lister) : Liste les adresses, la limite de l’offre et les types disponibles. | `webhooks:write` |
| POST | [/v1/webhooks](https://console.messagingme.app/developers/api/webhook-endpoints.md#creer) : Inscrit une adresse et rend son secret, une seule fois. | `webhooks:write` |
| GET | [/v1/webhooks/{webhookId}](https://console.messagingme.app/developers/api/webhook-endpoints.md#lire) : Lit une adresse et l’état de ses envois. | `webhooks:write` |
| PATCH | [/v1/webhooks/{webhookId}](https://console.messagingme.app/developers/api/webhook-endpoints.md#modifier) : Change les types, la description, ou met l’adresse en pause. | `webhooks:write` |
| POST | [/v1/webhooks/{webhookId}/rotate-secret](https://console.messagingme.app/developers/api/webhook-endpoints.md#rotation) : Renouvelle le secret ; l’ancien signe encore 24 h. | `webhooks:write` |
| DELETE | [/v1/webhooks/{webhookId}](https://console.messagingme.app/developers/api/webhook-endpoints.md#supprimer) : Supprime une adresse. | `webhooks:write` |
| POST | [/v1/webhooks/{webhookId}/test](https://console.messagingme.app/developers/api/webhook-endpoints.md#essai) : Envoie un événement d’essai signé et rend la réponse de l’application. | `webhooks:write` |
| GET | [/v1/webhooks/{webhookId}/deliveries](https://console.messagingme.app/developers/api/webhook-endpoints.md#journal) : Lit le journal d’une adresse, le plus récent d’abord. | `webhooks:write` |
| POST | [/v1/webhooks/deliveries/{deliveryId}/replay](https://console.messagingme.app/developers/api/webhook-endpoints.md#rejeu) : Rejoue un envoi terminé, avec le même corps. | `webhooks:write` |
| POST | [/v1/webhooks/{webhookId}/replay-failures](https://console.messagingme.app/developers/api/webhook-endpoints.md#rejeu-echecs) : Rejoue les envois en échec depuis une date. | `webhooks:write` |

### Catalogues

|   |   |   |
| --- | --- | --- |
| GET | [/v1/templates](https://console.messagingme.app/developers/api/catalogs.md#templates) : Liste les templates WhatsApp approuvés et envoyables. | `sends:create` |
| GET | [/v1/scenarios](https://console.messagingme.app/developers/api/catalogs.md#scenarios) : Liste les scénarios publiés et leur message d’ouverture. | `sends:create` |
| GET | [/v1/rcs-messages](https://console.messagingme.app/developers/api/catalogs.md#messages-rcs) : Liste les messages RCS de la bibliothèque. | `sends:create` |
