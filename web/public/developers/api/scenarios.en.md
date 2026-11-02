<!-- Markdown version of https://console.messagingme.app/developers/api/scenarios, generated from the page (npm run doc:md). Français : https://console.messagingme.app/developers/api/scenarios.md -->

# Scenarios

Create a simple scenario without opening the console, with the scenarios:write right: a template and its buttons, quick-reply messages with a file, an AI agent, the team. Every write publishes it at once; it then goes out through [Sends](https://console.messagingme.app/developers/api/sends.en.md).

On this page

|   |   |
| --- | --- |
| POST | [/v1/scenarios](https://console.messagingme.app/developers/api/scenarios.en.md#creer) : Creates a scenario from a recipe and publishes it at once. |
| GET | [/v1/scenarios/{scenarioId}](https://console.messagingme.app/developers/api/scenarios.en.md#lire) : Reads a scenario as a recipe, with the fingerprint that guards its replacement. |
| PUT | [/v1/scenarios/{scenarioId}](https://console.messagingme.app/developers/api/scenarios.en.md#remplacer) : Replaces a scenario created through the API and publishes it at once. |
| DELETE | [/v1/scenarios/{scenarioId}](https://console.messagingme.app/developers/api/scenarios.en.md#supprimer) : Deletes a scenario created through the API, if nothing uses it any more. |

<a id="recette"></a>

## The recipe

A scenario is described as a tree of steps, with no id or position. Each step is exactly one of these four forms:

| Step | Meaning |
| --- | --- |
| `template` | Sends an APPROVED template (name, language, variables). boutons: one next step per quick reply, named by its exact text; each one needs one. autre_reponse: the contact writes instead of tapping. Without quick replies, the template ends the scenario. |
| `message` | A free message within the 24-hour window, with an optional file (JPEG, PNG or GIF image, MP4 video, PDF). reponses: 3 quick replies at most, 20 characters each. Without quick replies, it does not wait: suite is the next step. |
| `agent` | Hands the conversation to an active AI agent of the workspace. It ends the scenario. |
| `humain` | Hands the conversation to the team (To handle). It ends the scenario. |

- variables: for each template position ({{1}} is written 1), a record field (champ), a fixed text (texte), or the contact’s name or number (attribut: name or phone). Absent: the associations set in the console.
- The file is read at each send from its https address: it is checked once at write time, never copied. If it changes on the site, later sends change.
- A template must be approved by Meta before it goes into a recipe: create it first with [POST /v1/templates](https://console.messagingme.app/developers/api/templates.en.md#creer).

<a id="creer"></a>

## POST /v1/scenarios

Creates a scenario from a recipe and publishes it at once.

Scope: `scenarios:write`

Compiles the recipe, publishes the scenario and returns the recipe read back, its fingerprint and its opening.

_Command_

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

### 201 response

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

### Errors

| Status | Code | Cause |
| --- | --- | --- |
| 400 | `invalid_body` | Recipe outside the shape: chemin says where. |
| 402 | `plan_feature_unavailable` | Scenarios are not in the workspace plan. |
| 404 | `template_not_found` | No template with this name in this language. |
| 422 | `template_not_approved` | The template is not approved yet: nothing is saved. |
| 422 | `template_button_unknown` | A button text is not a quick reply of the template. |
| 422 | `quick_reply_unwired` | A quick reply of the template has no next step. |
| 422 | `agent_unavailable` | The agent does not exist in the workspace, or it is inactive. |
| 422 | `field_unknown` | A quoted field does not exist. |
| 422 | `file_refused` | The file could not be read, or WhatsApp does not accept it. |
| 422 | `unsendable_target` | The scenario could not go out (for example, it opens on the team). |
| 409 | `scenario_name_taken` | The name is taken: id gives the existing scenario. |

> **Caution**
>
> No draft: the scenario is live as soon as the response arrives. It writes to nobody until a send or a trigger starts it.

<a id="lire"></a>

## GET /v1/scenarios/{scenarioId}

Reads a scenario as a recipe, with the fingerprint that guards its replacement.

Scope: `scenarios:write`

Returns the scenario as a recipe, by its id or its scn_ code, with the fingerprint to send back to replace it.

_Command_

```
curl https://api.messagingme.app/v1/scenarios/7d2e4c1a-3b5f-4e6d-8a9b-0c1d2e3f4a5b \
  -H "Authorization: Bearer mba_xxxxxxxxxxxxxxxx"
```

### Errors

| Status | Code | Cause |
| --- | --- | --- |
| 404 | `scenario_not_found` | No such scenario in the workspace. |
| 409 | `scenario_not_describable` | Edited in the console beyond what a recipe can describe. |

<a id="remplacer"></a>

## PUT /v1/scenarios/{scenarioId}

Replaces a scenario created through the API and publishes it at once.

Scope: `scenarios:write`

Replaces the whole scenario and publishes it. The fingerprint read goes in If-Match (or in empreinte, in the body): if the scenario changed in the meantime, the call is refused instead of overwriting.

_Command_

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

- Only scenarios created through the API can be replaced. A step left in the same place keeps its id: a contact in the middle of the scenario resumes where they were.

### Errors

| Status | Code | Cause |
| --- | --- | --- |
| 428 | `precondition_required` | The fingerprint is missing. |
| 409 | `scenario_managed_in_console` | The scenario was created in the console. |
| 409 | `scenario_changed` | It changed since you read it, or a console change is waiting to be published. |
| 409 | `scenario_not_describable` | Edited in the console beyond what a recipe can describe. |

And the errors of creation.

<a id="supprimer"></a>

## DELETE /v1/scenarios/{scenarioId}

Deletes a scenario created through the API, if nothing uses it any more.

Scope: `scenarios:write`

Deletes a scenario created through the API, if nothing uses it any more.

_Command_

```
curl -X DELETE https://api.messagingme.app/v1/scenarios/7d2e4c1a-3b5f-4e6d-8a9b-0c1d2e3f4a5b \
  -H "Authorization: Bearer mba_xxxxxxxxxxxxxxxx"
```

### Errors

| Status | Code | Cause |
| --- | --- | --- |
| 409 | `scenario_managed_in_console` | The scenario was created in the console. |
| 409 | `scenario_in_use` | An automation, the responder, a campaign, an ad, a widget or a “Go to” uses it: the message says which. |
