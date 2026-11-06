# La reprise d'un numéro fourni mis dans l'application (2026-11-06)

Vécu par Johan le 2026-11-06 : un numéro fourni, mis dans l'application WhatsApp Business (`fourni_application`), son
compte créé, puis « mon numéro est non relié » en boucle. Il en est sorti quand Julien lui a dit de demander à Claude de
« connecter en coexistence ». Julien : « je serai pas tout le temps là ».

## La cause

Le serveur ne retient nulle part que le numéro fourni va DANS l'application. Cette intention ne vit que dans le jeton du
lien (une heure), le `localStorage` de la console et le `mode` que Claude repasse à `watch_whatsapp_connection`
(facultatif). Dès que l'un manque, les consignes rendues à Claude repartent de travers :

1. Le code capté n'est lisible que 15 minutes (`codeDeLEspace`). Passé ce délai, la suite de `fourni_application`
   redonne les étapes de CRÉATION du compte (« le code arrivera aussi ici ») à quelqu'un qui l'a déjà créé.
2. Sans `mode`, la suite commune donne les étapes de la fenêtre de Meta pour un numéro neuf (GB +44), que Meta refuse
   pour un numéro déjà dans l'application.
3. `get_setup_state` ne dit pas comment reprendre : la skill fait choisir Claude entre trois modes, ou poser la question
   au client avec des mots qu'il ne connaît pas.

Aucune trace des appels d'outils côté serveur : on ne sait pas lequel des trois Johan a rencontré. Les trois mènent au
même cul-de-sac, d'où un correctif à la source plutôt que trois rustines de texte.

## Tâches

1. Migration 0280 : `tenants.numero_fourni_destination` (`api` ou `application`, nulle = inconnue) et son heure
   (`numero_fourni_destination_le`, ajoutée après la relecture : un code ne compte que depuis elle). Écrites par le code
   neuf, donc `migration=avant`.
2. `src/otp/store.pg.ts` : `destinationDeLEspace`, `retenirDestination` (filtrées sur l'espace).
3. `src/otp/etat-connexion.ts` : l'état porte `destination` et `codeDejaCapte` (un code depuis l'attribution, sans
   borne de temps, `codeCapteDepuisLAttribution` existe déjà) ; une fonction pure `modeDeReprise` : `application` sans
   code = `fourni_application`, `application` avec un code = `coexistence`, `api` = `fourni`, inconnue = `null`.
   L'empreinte ne bouge pas (le code y est déjà).
4. `src/mcp/outils-numero.ts` :
   - `start_whatsapp_connection` retient la destination (`fourni`, `fourni_application`, et `coexistence` quand un
     numéro fourni est attribué) et REFUSE `fourni` quand la reprise est `coexistence`, en nommant le bon mode ;
   - la suite de `watch_whatsapp_connection` suit la destination retenue, à défaut le `mode` passé ; un code déjà capté
     et expiré dit « le compte est créé, il reste à garder l'application » avec le lien neuf en `coexistence`, jamais les
     étapes de création ; destination inconnue et code déjà capté : UNE question concrète (« ce numéro est-il dans
     l'application de votre téléphone ? »).
5. `src/mcp/mise-en-service.ts` : `numero.reprise` dans `get_setup_state`. Sa description ne change pas : elle est
   recopiée dans trois fichiers générés, dont une page de la vitrine.
6. Plugin : la skill `mise-en-service` reprend avec `numero.reprise` sans rien demander ; `plugin.json` 0.3.25.
7. Tests : `modeDeReprise` (table), la suite après les 15 minutes (avec et sans `mode`), le refus de `fourni`, la
   destination retenue par `start_whatsapp_connection`, `get_setup_state` ; le store en intégration. Dans les deux sens :
   la destination ignorée par la suite, le test des 15 minutes doit échouer.
8. Doc : `documentation.md` (le numéro fourni), le journal (la migration), `todo.md` (les jaunes).

Hors périmètre, noté au todo : la console garde sa variante dans le `localStorage` et ne lit pas la destination retenue.

## Ordre de déploiement

API avec `migration=avant`, migration relue en base ; puis la skill (`gh workflow run plugin.yml --ref main`) : publiée
avant l'API, elle lirait un champ absent.

## Méthode de livraison

En direct (moi), puis UNE relecture indépendante en fin de lot, parce que le changement est petit (quatre fichiers
serveur, une colonne, la skill) mais que la production l'emprunte à chaque mise en service d'un client sans numéro, et
qu'il touche un invariant invisible : l'état que lisent ensemble la page `/brancher` et Claude. Les critères sont
mécaniquement testables (des suites de texte selon un état), donc pas de relecture du diff par Julien en plus.

Essai réel qui clôt le lot : sur un espace de test, un numéro fourni mis dans l'application, le compte créé avec son code,
attendre plus de 15 minutes, puis reprendre dans une NOUVELLE session de Claude Code sans jamais dire « coexistence » :
Claude doit donner le lien de la fenêtre de Meta en gardant l'application, et le numéro doit finir relié.
