# Champ JSON, lot 1 : le type `json` et le rangement brut d'un appel API (2026-11-11)

Spec : [2026-11-11-champ-json-appel-api-design.md](../specs/2026-11-11-champ-json-appel-api-design.md), décisions 1 à 9.
Le bloc d'extraction est le lot 2, plan à part.

## Tâches

1. **Migration** (numéro lu par `npm run migrations`) : `user_fields_type_check` élargie à `json`. Élargissement pur,
   aucune ligne à reprendre (modèle : 0076). Le nom de la contrainte se relit en base avant le `drop`.
2. **Le type et sa validation** : `json` dans `USER_FIELD_KINDS` (`web/lib/partage/champs.ts`), avec
   `MAX_OCTETS_CHAMP_JSON = 16384`. `validateFieldValue` : pour `json`, `JSON.parse` réussi et taille en octets UTF-8
   sous le plafond, À LA PLACE de la borne de 1 000 caractères. `canonicalizeFieldValue` : forme compacte
   (`JSON.stringify(JSON.parse(v))`). La modification d'un champ (`src/http/fields.ts`, et le MCP s'il la permet)
   refuse un changement de type vers ou depuis `json`.
3. **Les chemins d'écriture, un par un** (décision 9). Acceptent : API publique (`src/api/contacts-upsert.ts`), MCP
   (`src/mcp/outils-champs.ts`), par `validateFieldValue`. Refusent un champ `json` comme cible, avec un message qui le
   dit : saisie de la fiche (`src/http/contacts.ts`, `src/crm/editer-fiche-operateur.ts`), import CSV
   (`src/crm/import.ts`), webhook entrant (`src/webhook-entrant/`), WhatsApp Flow (`src/webhooks/flow-mapping.ts`),
   HubSpot (`src/hubspot-workflow/champs.ts`), bloc « Action » et bloc « Question » du scénario.
4. **Bloc « Appel API »** (`src/workflow/appel-http.ts`) : le câblage reçoit le champ cible et décide seul de la
   lecture, par une dépendance requise `typeDuChamp(tenantId, cle)` : vide -> `pousse`, `json` -> `entier`, autre ->
   `integre` (inchangé). En `entier`, la valeur est `JSON.stringify(contenu.reponse)` ; au-delà de 16 Ko, échec (champ
   vidé, ligne au journal des appels, raison « réponse trop grosse pour le champ »). L'exécuteur passe `champCible` au
   lieu de `'pousse' | 'integre'` (`src/workflow/executor.ts`), sa règle « pas de `setField` sans champ » reste.
5. **Bloc « Fonction JS »** (`executor.ts`) : cible `json` -> la sortie passe `validateFieldValue('json', ...)` et sa
   forme canonique, sinon champ vidé.
6. **Conditions** (`src/workflow/conditions.ts`) : opérateurs d'un champ `json` = `empty`, `not_empty`, `contains`.
   Tout autre opérateur lu sur un `json` est faux (un graphe écrit à la main ne doit pas comparer du JSON en nombre).
7. **Inventaire des lecteurs du type** : chaque `switch`/`if` sur le type d'un champ (filtres du mini-CRM, export CSV,
   segments, variables, `champsEcrivables`, résolution des variables d'un connecteur où `champDuContact` rend déjà
   `null` pour un objet mais une CHAÎNE JSON passerait) relu, la liste écrite dans le commit.
8. **Console, commit à part, poussé APRÈS le déploiement de l'API** : `json` proposé à la création d'un champ
   (« JSON (réponse d'un appel API) »), type verrouillé ensuite ; fiche contact en lecture seule, JSON mis en forme
   et replié au-delà de quelques lignes ; panneau du bloc « Appel API » : aide « la réponse entière est rangée » quand
   la cible est `json` ; opérateurs de condition par type ; `json` absent des cibles des chemins refusés (tâche 3).
   Le menu de création lit une liste des types PROPOSÉS distincte de `USER_FIELD_KINDS`, pour que le commit serveur,
   qui publie la console au push, ne propose pas un type que l'API en production refuse encore.
9. **MCP** : description de `create_field` et `set_contact_field` (le type `json`, son plafond, sa validité). Catalogue
   et documentation générés relancés (`web/public`, vitrine) dans le même commit.
10. **Tests** : validation (JSON valide, invalide, 16 384 octets pile et un de plus, idéogrammes comptés en octets) ;
    changement de type refusé dans les deux sens ; chaque chemin refusé de la tâche 3 ; bloc « Appel API » (objet,
    texte non JSON rangé en chaîne, corps vide en `null`, trop gros = vidé et journalisé, champ texte inchangé,
    `typeDuChamp` câblé dans `tests/campagne-cablage.test.ts` ou son voisin) ; Fonction JS vers `json` ; conditions ;
    intégration `user-fields-types` étendue à `json` ; e2e de la création d'un champ JSON et de la fiche.
11. **Docs** : `documentation.md` (le type du champ décide de la lecture du bloc ; qui écrit un `json`), journal
    § migrations. `features.md` attend le lot 2 (spec, décision 14).

## Ordre de déploiement

1. Push serveur (migration, tâches 2 à 7, 9, 10), CI lue job par job.
2. Déploiement `migration=avant` : la contrainte élargie ne gêne pas l'ancien code, et le nouveau écrit `json`.
3. Push console (tâche 8) une fois l'API en service.

Rayon de souffle à relire au commit : tout lecteur de `USER_FIELD_KINDS` et de `validateFieldValue` (la borne de 1 000
caractères est recopiée dans `src/webhook-entrant/chemin.ts` et `src/hubspot-workflow/champs.ts`), et la signature de
`appelHttp` dans `WorkflowExecutorDeps` (câblages et faux des tests).

## Méthode de livraison

**Implémenteur par lot, puis UNE relecture humaine du diff**, parce que le bloc « Appel API » et l'exécuteur sont des
chemins que la production emprunte à chaque passage de scénario, que la migration touche une contrainte de
`user_fields`, et que le code porte des invariants qu'aucun test ne voit seul : la borne de 1 000 caractères recopiée
ailleurs, `contacts.fields` relu à chaque étape, l'ordre console après API. Essai réel qui clôt : un connecteur vers
une API publique de démonstration sans clé, sur un espace de test ; un scénario déclenché depuis un vrai téléphone
range la réponse dans un champ JSON, relu dans la fiche du contact, puis une condition « contient » choisit la branche.
