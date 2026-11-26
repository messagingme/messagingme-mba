# Campagnes : les scénarios et les modèles des automations Shopify et HubSpot, rangés par catégorie

Demande de Julien (2026-11-26), arbitrée le même jour : « Oui, en catégories ». Seconde exception à la décision 1 du
menu « Scénario » (cloisonnement), après celle de l'Inbox (654870623) le même matin.

## Ce qui change

1. **Une campagne peut lancer un scénario Shopify ou HubSpot.** `POLITIQUE_DE_LANCEMENT.campagne_scenario` admet les
   trois rayons ; la garde de création (`getWorkflowGraph`, `src/index.ts`) n'écarte plus les rayons d'automation.
   `campagne_bloc` (un bloc visé par `/v1/sends`) reste au Builder : rien ne le demande.
2. **Aucune commande derrière une campagne.** Une source « variable du parcours » (numéro de commande, lien du panier)
   reste REFUSÉE par la création (`validateParamMapping` sans `accepterVariables`, inchangé). Dans la console, la ligne
   reste posée et visible (« Données Shopify ») et le récapitulatif la nomme et bloque (`problemeDAssociation`) : la
   remplacer par le défaut enverrait le nom du contact à la place du numéro. Plus loin dans le graphe, une donnée lue
   (texte `{{shopify.…}}`, source `variable` d'un autre template) fait REFUSER la création (`donneesDEvenementLues`,
   `preparerCampagne`) : un texte partirait vide à cet endroit (`renderText`), relevé par la relecture.
3. **Le résumé d'un scénario dit les modèles qu'il envoie** (`modeles`, lus dans son graphe en ligne, déjà chargé par
   `listResume`). La console en déduit l'origine d'un modèle : utilisé par un scénario Shopify, HubSpot, ou autre.
4. **Console, étape Contenu** : la liste des scénarios (`?rayons=tous`) et celle des modèles se rangent en groupes
   (« Scénarios » / « Automations Shopify » / « Automations HubSpot » ; « Automations Shopify » / « Automations
   HubSpot » / « Autres modèles »). Un seul groupe présent : pas de groupe affiché.

## Rayon de souffle

- `campagne_scenario` sert aussi les campagnes d'une ligne HubSpot ? Non : celles-ci portent `workflow_hubspot`
  (`src/hubspot-workflow/ligne.ts`). Elle sert les campagnes de l'assistant, de l'API (`/v1/campaigns`) et du MCP
  (`prepare_campaign`) : ces deux-là acceptent donc aussi un scénario d'automation donné par son identifiant, alors que
  leurs listes (`list_scenarios`, `/v1`) restent au Builder. Assumé : la garde reste l'espace, et l'ouverture.
- `getWorkflowGraph` n'a qu'un module consommateur, `preparerCampagne` (deux appels : la campagne, chaque étage), qui
  sert la console, `/v1/campaigns` et le MCP (`prepare_campaign`) : le refus des données d'événement y vaut pour les trois.
- `listResume` alimente toutes les listes de scénarios : un champ AJOUTÉ, aucun lecteur ne casse.
- Ordre : l'API d'abord (la console d'avant ignore `modeles`, celle d'après sans l'API retombe sur « un seul groupe »
  pour les modèles, et sur une création refusée pour un scénario d'automation : la console part APRÈS l'API).

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que le lot ouvre un chemin d'ENVOI de masse (une campagne)
à des scénarios qui en étaient tenus à l'écart, et que l'invariant invisible est l'absence d'événement derrière une
campagne. Une relecture indépendante en fin de lot. Essai réel qui clôt la feature : sur l'espace SANDBOX, une
campagne vers le numéro d'essai qui lance le scénario « Commande expédiée » du rayon Shopify, ses variables remappées
sur des champs de la fiche, et le clic sur un bouton qui fait avancer le parcours.
