# Champ JSON, lot 2 : le bloc « Extraire du JSON » (2026-11-11)

Spec : [2026-11-11-champ-json-appel-api-design.md](../specs/2026-11-11-champ-json-appel-api-design.md), décisions 10 à
14. Le lot 1 (type `json`, rangement de la réponse entière) et le correctif du moteur (une Condition après un appel lit
la valeur rangée) sont en production.

## Forme

- Bloc `extraire` : `{ champSource, lignes: [{ chemin, mesure: 'valeur' | 'nombre', champCible }] }`, 20 lignes au plus.
  `champSource` est un champ `json` ; `champCible`, n'importe quel champ écrivable (un `json` reçoit une sous-partie).
- **Chemins** : ceux de `web/lib/partage/chemin-json.ts` (`a.b`, `a[0]`), élargis à l'index depuis la fin (`a[-1]`).
  Chemin vide = la racine (une réponse qui est une liste). Élargissement pur pour le webhook entrant, qui le reçoit aussi.
- **Valeurs** : un scalaire en texte ; un objet ou une liste en JSON compact (pour une cible `json`) ; `nombre` = la
  longueur d'une liste, vide sur autre chose. Chemin absent, source illisible, ou valeur refusée par le type de la cible
  (`validateFieldValue`) : champ cible VIDÉ (décision 13).

## Tâches

1. **Module pur** `src/workflow/extraire-json.ts` : `extraire(source: string, lignes) -> Array<{ champCible, valeur }>`,
   sur `litChemin`. `[-n]` et la racine dans `chemin-json.ts`.
2. **Moteur** (`engine.ts`) : action `extraireJson` ; `walk` calcule les valeurs depuis la copie de travail et les
   répercute (`applyToWork`), donc une Condition qui suit les voit SANS arrêt du parcours, campagnes comprises. Bloc
   sans source ni ligne : passe-plat. Bloc « sans attente » (`passeSansAttente`), absent des recettes MCP (comme `http`).
3. **Exécuteur** (`executor.ts`) : relit la source au moment d'écrire (comme la Fonction JS), recalcule, valide et
   canonicalise chaque valeur contre le type de la cible (`typeDuChamp`, déjà câblé), écrit par `setField` (garde JSON
   comprise). Une seule lecture du référentiel des champs pour toutes les lignes.
4. **Console** : le bloc dans la palette (`WORKFLOW_NODE_TYPES`, `nodeMeta`, résumé du canevas `WorkflowNode`), son
   panneau (`WorkflowConfigPanel`) : source parmi les champs `json`, lignes chemin / mesure / cible. **« Voir un
   exemple »** : le bloc Appel API du graphe qui range dans cette source, rejoué par `POST .../requetes/:id/test` avec
   ses valeurs d'essai, la réponse dans `ArbreJson` ; un clic écrit le chemin de la ligne active. Sans appel amont :
   saisie libre. Le résumé MCP des blocs (`node-list.ts`) le nomme.
5. **Annonce** (décision 14) : `features.md` (champ JSON et extraction), la fiche d'aide qui cite la section et son
   empreinte dans le même commit. La vitrine n'est PAS touchée sans le oui de Julien (nouveauté publique).
6. **Tests** : module (clé, index, `[-1]`, racine, `nombre`, absent, objet vers `json`, type refusé), moteur (Condition
   qui suit voit la valeur, campagne comprise), exécuteur (source relue, validation, une lecture des champs),
   `chemin-json` (`[-n]` accepté, webhook inchangé sinon), e2e du panneau (exemple, clic, lignes) et TOUS les
   `web/e2e/workflow-*` (un bloc ajouté au canevas).

## Ordre de déploiement

Serveur d'abord (tâches 1 à 3, `migration=aucune`), console ensuite (tâches 4 et 5) : la console publie la palette au
push, et un ancien moteur traverserait un bloc `extraire` sans rien écrire. Aucune migration.

## Méthode de livraison

**Implémenteur par lot, puis UNE relecture indépendante du diff**, parce que le moteur et l'exécuteur sont des chemins
que la production emprunte à chaque passage, et que l'élargissement de `chemin-json` touche aussi le webhook entrant.
Essai réel qui clôt : dans « testJSON » sur la SANDBOX, après l'Appel API, un bloc Extraire range `products[0].title`
dans un champ texte et le `nombre` de `products` dans un champ nombre ; un message cite le premier, une Condition
« au moins 4 articles » choisit la branche ; Julien envoie « blue » depuis son téléphone et reçoit le bon message.
