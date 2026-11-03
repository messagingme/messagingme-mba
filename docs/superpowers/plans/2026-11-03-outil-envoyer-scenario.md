# Plan : l'outil MCP « envoyer un scénario à un contact » (2026-11-03)

Suite de `2026-11-02-scenarios-api.md`. L'essai réel du 2026-11-02 a montré le trou : Claude crée un scénario
(`create_scenario`) mais ne peut pas le faire partir vers une personne ; il a fallu `POST /v1/sends` depuis PowerShell.
Et la description de `create_scenario` et `update_scenario` cite `send_template_to_contact` comme moyen de démarrer un
scénario, ce qui est faux : cet outil n'envoie qu'un modèle.

## Décisions de Julien (2026-11-03)

- **Les variables du template d'ouverture sont des valeurs données par Claude** (`values`, une par variable, comme
  `send_template_to_contact`) : Claude lit la fiche du contact. Aucun changement de `POST /v1/sends`.
- **La vitrine part avec le lot** : la liste repliée des outils de la page Boutiques Shopify est régénérée.
- L'accord de la personne suit la décision du 2026-10-25 pour `send_template_to_contact` : envoyer par Claude le
  déclare au nom du client (`consent: opted_in`, signé de la personne connectée), un STOP n'est jamais levé.

## Tâches

1. `send_scenario_to_contact` (`src/mcp/outils-scenarios.ts`), sous la fonction d'offre `scenarios`, réservé à une
   personne : `scenario` (id, code `scn_` ou nom), `phone` ou `contact_id`, `values`, `idempotency_key`. Il construit un
   corps de `POST /v1/sends` (cible `scenario`, `category: utility`, que la catégorie lue chez Meta durcit) et passe par
   `envoyerModele`, la même dépendance que `send_template_to_contact`. La fin commune des deux outils (compteur
   coûteux, quota du jour, refus lisibles, personne écartée) sort dans une fonction partagée de `outils-modeles.ts`.
2. La description des écritures de scénario cite `send_scenario_to_contact` au lieu de `send_template_to_contact`.
3. Catalogue (`catalogue-mcp.ts`, `mcp-outils.ts`, `familles-outils.ts`), textes de la vitrine (`boutique-textes.ts`),
   puis les générations : `doc:md` dans `web/`, `vitrine:cas`, `plugin:generer`. `features.md` et `documentation.md`
   nomment l'outil.

## Tests attendus

- Le corps construit est un corps de `POST /v1/sends` que ses propres règles acceptent, pour UNE personne, cible
  `scenario`, consentement déclaré et signé.
- Réservé à une personne (une clé d'API ne le voit pas), refusé hors de l'offre `scenarios`.
- Les refus du chemin public remontent lisibles (scénario introuvable, ouverture par un message de session).
- `send_template_to_contact` inchangé (ses tests existants, sans retouche).
- Annotations, familles, catalogue, doc générée, vitrine, README du plugin : leurs tests d'inventaire.

## Méthode de livraison

**En direct, avec une relecture du lot** : le changement est isolé (un outil de plus, une fonction extraite) et
réversible, parce qu'il réutilise tel quel le chemin d'envoi public, déjà gardé (consentement, STOP, quota, offre). La
relecture porte sur la fonction extraite, que `send_template_to_contact` emprunte en production. Ordre : l'API d'abord
(déploiement `migration=aucune`), puis la publication du plugin par Julien. L'essai réel qui clôt : depuis Claude
Code, sur l'espace Entreprise, `send_scenario_to_contact` vers le +33633921577 avec le scénario de l'essai du
2026-11-02, le template reçu sur le téléphone et une branche cliquée.
