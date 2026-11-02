<!-- Version Markdown de https://console.messagingme.app/developers/api/scenarios, générée depuis la page (npm run doc:md). English: https://console.messagingme.app/developers/api/scenarios.en.md -->

# Scénarios

Créer un scénario simple sans ouvrir la console, avec le droit scenarios:write : un template et ses boutons, des messages à réponses rapides avec un fichier, un agent IA, l’équipe. Toute écriture le publie aussitôt ; il part ensuite par [Envois](https://console.messagingme.app/developers/api/sends.md).

Sur cette page

|   |   |
| --- | --- |
| POST | [/v1/scenarios](https://console.messagingme.app/developers/api/scenarios.md#creer) : Crée un scénario depuis une recette et le publie aussitôt. |
| GET | [/v1/scenarios/{scenarioId}](https://console.messagingme.app/developers/api/scenarios.md#lire) : Lit un scénario sous forme de recette, avec l’empreinte qui garde son remplacement. |
| PUT | [/v1/scenarios/{scenarioId}](https://console.messagingme.app/developers/api/scenarios.md#remplacer) : Remplace un scénario créé par l’API et le publie aussitôt. |
| DELETE | [/v1/scenarios/{scenarioId}](https://console.messagingme.app/developers/api/scenarios.md#supprimer) : Supprime un scénario créé par l’API, si plus rien ne l’utilise. |

<a id="recette"></a>

## La recette

Un scénario se décrit par une arborescence d’étapes, sans identifiant ni position. Chaque étape est exactement une de ces quatre formes :

| Étape | Sens |
| --- | --- |
| `template` | Envoie un template APPROUVÉ (nom, langue, variables). boutons : une suite par réponse rapide, nommée par son texte exact ; chacune en demande une. autre_reponse : le contact écrit au lieu de cliquer. Sans réponse rapide, le template termine le parcours. |
| `message` | Un message libre dans la fenêtre de 24 h, avec un fichier facultatif (image JPEG, PNG ou GIF, vidéo MP4, PDF). reponses : 3 réponses rapides au plus, 20 caractères chacune. Sans réponse rapide, il n’attend pas : suite est l’étape d’après. |
| `agent` | Confie la conversation à un agent IA actif de l’espace. Il termine le parcours. |
| `humain` | Passe la conversation à l’équipe (À traiter). Il termine le parcours. |

- variables : pour chaque position du template ({{1}} s’écrit 1), un champ de la fiche (champ), un texte fixe (texte), ou le nom ou le numéro du contact (attribut : name ou phone). Absent : les associations posées dans la console.
- Le fichier se lit à chaque envoi par son adresse https : il est vérifié une fois à l’écriture, jamais copié. S’il change sur le site, les envois suivants changent.
- Un template doit être approuvé par Meta avant d’entrer dans une recette : créez-le d’abord par [POST /v1/templates](https://console.messagingme.app/developers/api/templates.md#creer).

<a id="creer"></a>

## POST /v1/scenarios

Crée un scénario depuis une recette et le publie aussitôt.

Droit : `scenarios:write`

Compile la recette, publie le scénario et rend la recette relue, son empreinte et son ouverture.

_Commande_

```
curl -X POST https://api.messagingme.app/v1/scenarios \
  -H "Authorization: Bearer mba_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
  "nom": "Relance devis",
  "entree": {
    "template": {
      "nom": "relance_devis",
      "langue": "fr",
      "variables": {
        "1": {
          "champ": "prenom"
        }
      }
    },
    "boutons": [
      {
        "texte": "Oui, intéressé",
        "suite": {
          "agent": {
            "agent_id": "5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01"
          }
        }
      },
      {
        "texte": "Plus tard",
        "suite": {
          "message": {
            "texte": "Voici notre brochure. On en reparle ?",
            "fichier": {
              "url": "https://www.exemple.fr/brochure.pdf"
            }
          },
          "reponses": [
            {
              "texte": "Oui",
              "suite": {
                "humain": {}
              }
            },
            {
              "texte": "Non merci",
              "suite": {
                "message": {
                  "texte": "Entendu, à bientôt."
                }
              }
            }
          ]
        }
      }
    ],
    "autre_reponse": {
      "humain": {}
    }
  }
}'
```

### Réponse 201

_JSON_

```
{
  "id": "7d2e4c1a-3b5f-4e6d-8a9b-0c1d2e3f4a5b",
  "code": "scn_k7m2p3_01JCZ5Q8V9X3B2N4M6P7R8S9T0",
  "nom": "Relance devis",
  "origine": "api",
  "entreeCode": "nod_k7m2p3_01JCZ5Q8VA1B2C3D4E5F6G7H8J",
  "recette": {
    "nom": "Relance devis",
    "entree": {
      "template": {
        "nom": "relance_devis",
        "langue": "fr",
        "variables": {
          "1": {
            "champ": "prenom"
          }
        }
      },
      "boutons": [
        {
          "texte": "Oui, intéressé",
          "suite": {
            "agent": {
              "agent_id": "5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01"
            }
          }
        },
        {
          "texte": "Plus tard",
          "suite": {
            "message": {
              "texte": "Voici notre brochure. On en reparle ?",
              "fichier": {
                "url": "https://www.exemple.fr/brochure.pdf"
              }
            },
            "reponses": [
              {
                "texte": "Oui",
                "suite": {
                  "humain": {}
                }
              },
              {
                "texte": "Non merci",
                "suite": {
                  "message": {
                    "texte": "Entendu, à bientôt."
                  }
                }
              }
            ]
          }
        }
      ],
      "autre_reponse": {
        "humain": {}
      }
    }
  },
  "empreinte": "9b1c4e7f2a0d5c8e3b6f1a4d7c0e9b2f",
  "ouverture": "whatsapp_template"
}
```

### Erreurs

| Statut | Code | Cause |
| --- | --- | --- |
| 400 | `invalid_body` | Recette hors de la forme : chemin dit où. |
| 402 | `plan_feature_unavailable` | Les scénarios ne sont pas dans l’offre de l’espace. |
| 404 | `template_not_found` | Aucun template de ce nom dans cette langue. |
| 422 | `template_not_approved` | Le template n’est pas encore approuvé : rien n’est enregistré. |
| 422 | `template_button_unknown` | Un texte de bouton n’est pas une réponse rapide du template. |
| 422 | `quick_reply_unwired` | Une réponse rapide du template n’a pas de suite. |
| 422 | `agent_unavailable` | L’agent n’existe pas dans l’espace, ou il est inactif. |
| 422 | `field_unknown` | Un champ cité n’existe pas. |
| 422 | `file_refused` | Le fichier n’a pas pu être lu, ou WhatsApp ne l’accepte pas. |
| 422 | `unsendable_target` | Le scénario ne pourrait pas partir (par exemple, il ouvre sur l’équipe). |
| 409 | `scenario_name_taken` | Le nom est pris : id donne le scénario existant. |

> **Attention**
>
> Pas de brouillon : le scénario est en ligne dès la réponse. Il n’écrit à personne tant qu’aucun envoi ni déclencheur ne le lance.

<a id="lire"></a>

## GET /v1/scenarios/{scenarioId}

Lit un scénario sous forme de recette, avec l’empreinte qui garde son remplacement.

Droit : `scenarios:write`

Rend le scénario sous forme de recette, par son id ou son code scn_, avec l’empreinte à renvoyer pour le remplacer.

_Commande_

```
curl https://api.messagingme.app/v1/scenarios/7d2e4c1a-3b5f-4e6d-8a9b-0c1d2e3f4a5b \
  -H "Authorization: Bearer mba_xxxxxxxxxxxxxxxx"
```

### Erreurs

| Statut | Code | Cause |
| --- | --- | --- |
| 404 | `scenario_not_found` | Aucun scénario de ce nom dans l’espace. |
| 409 | `scenario_not_describable` | Modifié dans la console au-delà de ce qu’une recette sait dire. |

<a id="remplacer"></a>

## PUT /v1/scenarios/{scenarioId}

Remplace un scénario créé par l’API et le publie aussitôt.

Droit : `scenarios:write`

Remplace tout le scénario et le publie. L’empreinte lue passe dans If-Match (ou dans empreinte, dans le corps) : si le scénario a changé entre-temps, l’appel est refusé au lieu d’écraser.

_Commande_

```
curl -X PUT https://api.messagingme.app/v1/scenarios/7d2e4c1a-3b5f-4e6d-8a9b-0c1d2e3f4a5b \
  -H "Authorization: Bearer mba_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
  "nom": "Relance devis",
  "entree": {
    "template": {
      "nom": "relance_devis",
      "langue": "fr",
      "variables": {
        "1": {
          "champ": "prenom"
        }
      }
    },
    "boutons": [
      {
        "texte": "Oui, intéressé",
        "suite": {
          "agent": {
            "agent_id": "5f0c1e2a-8b7d-4c3e-9a1f-2d6b7e8c9f01"
          }
        }
      },
      {
        "texte": "Plus tard",
        "suite": {
          "message": {
            "texte": "Voici notre brochure. On en reparle ?",
            "fichier": {
              "url": "https://www.exemple.fr/brochure.pdf"
            }
          },
          "reponses": [
            {
              "texte": "Oui",
              "suite": {
                "humain": {}
              }
            },
            {
              "texte": "Non merci",
              "suite": {
                "message": {
                  "texte": "Entendu, à bientôt."
                }
              }
            }
          ]
        }
      }
    ],
    "autre_reponse": {
      "humain": {}
    }
  },
  "empreinte": "9b1c4e7f2a0d5c8e3b6f1a4d7c0e9b2f"
}'
```

- Seuls les scénarios créés par l’API se remplacent. Un bloc resté au même endroit garde son identifiant : un contact en cours de parcours reprend où il était.

### Erreurs

| Statut | Code | Cause |
| --- | --- | --- |
| 428 | `precondition_required` | L’empreinte manque. |
| 409 | `scenario_managed_in_console` | Le scénario a été créé dans la console. |
| 409 | `scenario_changed` | Il a changé depuis votre lecture, ou une modification de la console attend d’être publiée. |
| 409 | `scenario_not_describable` | Modifié dans la console au-delà de ce qu’une recette sait dire. |

Et les erreurs de la création.

<a id="supprimer"></a>

## DELETE /v1/scenarios/{scenarioId}

Supprime un scénario créé par l’API, si plus rien ne l’utilise.

Droit : `scenarios:write`

Supprime un scénario créé par l’API, si plus rien ne l’utilise.

_Commande_

```
curl -X DELETE https://api.messagingme.app/v1/scenarios/7d2e4c1a-3b5f-4e6d-8a9b-0c1d2e3f4a5b \
  -H "Authorization: Bearer mba_xxxxxxxxxxxxxxxx"
```

### Erreurs

| Statut | Code | Cause |
| --- | --- | --- |
| 409 | `scenario_managed_in_console` | Le scénario a été créé dans la console. |
| 409 | `scenario_in_use` | Une automation, le répondeur, une campagne, une publicité, un widget ou un « Aller à » l’utilise : le message dit lequel. |
