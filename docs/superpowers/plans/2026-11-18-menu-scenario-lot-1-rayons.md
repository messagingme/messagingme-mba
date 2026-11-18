# Menu « Scénario », lot 1 : le rayon et le cloisonnement des scénarios

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** chaque scénario et chaque automation porte un rayon (`general`, `shopify`, `hubspot`), et tout chemin qui
liste, choisit ou lance un scénario ne voit que le rayon qui le concerne. Invisible à la livraison : tout l'existant est
`general`.

**Architecture:** une colonne `rayon` sur `workflows` et `automations`, un type fermé `Rayon`, un paramètre REQUIS sur
les méthodes de liste du magasin de scénarios (le compilateur énumère les appelants), une garde unique au lancement
(`POLITIQUE_DE_LANCEMENT`, colonne `rayons`), et un test d'inventaire du SQL qui lit `workflows` hors du magasin.

**Tech Stack:** TypeScript, Fastify, Postgres (`pg`), pg-boss, vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md` (§ 3 décision 1, § 5.3).

## Les lots du chantier (un plan chacun, écrit quand le précédent est livré)

1. **Rayon et cloisonnement** (ce plan).
2. **Builder** : sortie « Pas de réponse après X » du bloc template ; analyse de fenêtre fermée au départ (rayons
   Shopify et HubSpot, automations Autres qui ne naissent pas d'un message) ; premier bloc verrouillé.
3. **Édition d'un template sur place** dans le builder, partout.
4. **Moteur** : parcours démarré sur un premier bloc déjà envoyé, variables de parcours, priorité d'un parcours
   Shopify ou HubSpot, reprise d'un agent IA, seul un humain bloque la suite.
5. **Shopify** : le circuit envoie le premier bloc, Automation > Shopify, pause de la boutique, ROI, `set_shopify_message`,
   bascule.
6. **HubSpot** : changement d'étape, rendez-vous, scénarios lancés par un workflow (les deux actions), bascule.
7. **Menu « Scénario »** (barre, Builder déplacé, Automation > Shopify / HubSpot / Autres), aide, vitrine, `features.md`.

## Méthode de livraison

**Implémenteur par lot et revue humaine du diff**, parce que ce lot touche des chemins que la production emprunte à
chaque message (lancement d'un parcours, choix d'un scénario par une automation, résolution d'un « Aller à », API
publique) et qu'il porte un invariant invisible au compilateur : une lecture de `workflows` qui oublie le rayon ne
casse rien aujourd'hui (tout est `general`) et ouvrira une fuite entre rayons au lot 5. Feature-loop écarté : les
critères sont testables, mais le risque est dans ce qu'aucun test n'énumère, qui demande un œil.

**Essai réel qui clôt le lot :** sur la SANDBOX, après déploiement, la liste du Builder est identique à avant, un
scénario se lance par Claude Code (`send_scenario_to_contact`), une automation à mot-clé démarre son parcours, et un
« Aller à » vers un autre scénario est franchi. Numéro libre pris dans `docs/prive/ESSAIS-REELS.md`.

## Global Constraints

- Aucun tiret cadratin ni demi-cadratin dans le code, les commentaires, la doc et les messages.
- `tenant_id = $1` sur chaque requête ajoutée ou modifiée.
- Valeurs du rayon, au caractère près : `'general'`, `'shopify'`, `'hubspot'`. Défaut en base : `'general'`.
- Un scénario d'un autre rayon se refuse EXACTEMENT comme un scénario inconnu (même code, même message) : son
  existence ne fuit pas.
- Le numéro de migration se LIT par `npm run migrations` sur une copie à jour d'origin, au moment d'écrire (le dossier
  d'origin s'arrêtait à 0292 le 2026-11-18). Migration en `migration=avant`.
- L'arbre partagé est en retard sur origin : travailler dans une copie à part (worktree détaché à jour d'origin), commits
  construits par plomberie sur `origin/main` pour tout fichier de câblage partagé (`src/index.ts`, `src/worker.ts`,
  `src/server.ts`), annonce aux sessions voisines avant de les toucher.
- Avant tout push d'un `.ts` : `npm run typecheck`, `npm test`, `npm run lint`, `npx tsx scripts/auto-attaque.mts`.
  Après le push : verdict de la CI lu job par job (`gh run view <id> --json jobs`), intégration comprise.
- Tout test de non-régression se vérifie dans les deux sens (code fautif remis, échec ET symptôme vus, restauré).

## Review Focus

1. Le code ou le nom d'un scénario Shopify passé à `/v1/sends`, à `send_scenario_to_contact` ou à `GET /v1/scenarios`
   rend la réponse d'un scénario inconnu (testé tâche 2).
2. Deux scénarios de même nom dans deux rayons : autorisé (unicité PAR rayon), et la résolution par nom de `/v1` prend
   celui du rayon général (testé tâche 2).
3. Un « Aller à » d'un scénario général vers le code d'un bloc d'un scénario Shopify : traité comme une cible
   introuvable, à l'exécution comme à la publication (testé tâche 5).
4. Un parcours en cours au moment de la migration continue : la relecture du graphe d'un parcours (`getById`) ignore le
   rayon (testé tâche 2).
5. La duplication entre espaces (`/ops`) ne copie que des scénarios généraux, et la copie est `general` (testé tâche 2).

---

### Task 1: Le type `Rayon` et la migration

**Files:**
- Create: `src/workflow/rayon.ts`
- Create: `db/migrations/<NNNN>_rayons.sql`
- Test: `tests/migration-<NNNN>.test.ts` (modèle : `tests/migration-0209.test.ts`)

**Interfaces:**
- Produces: `export const RAYONS = ['general', 'shopify', 'hubspot'] as const;`
  `export type Rayon = (typeof RAYONS)[number];` `export function estRayon(x: unknown): x is Rayon`.

- [ ] **Step 1: Écrire le test miroir** : le fichier de migration pose sur `workflows` ET sur `automations` une colonne
  `rayon text not null default 'general'` et un CHECK nommé `workflows_rayon_chk` / `automations_rayon_chk` dont la
  liste de valeurs est exactement `RAYONS` (même ordre indifférent, même cardinal).
- [ ] **Step 2: Lancer** `npx vitest run tests/migration-<NNNN>.test.ts` : FAIL (fichier absent).
- [ ] **Step 3: Écrire `rayon.ts` et la migration.** Colonne à défaut constant (pas de réécriture de table), CHECK
  ajouté `not valid` puis `validate constraint` dans la même migration, `set lock_timeout = '5s'` en tête.
- [ ] **Step 4: Relancer le test** : PASS.
- [ ] **Step 5: Commit** (`feat(scenarios): le rayon d'un scénario et d'une automation, en base`).

### Task 2: Le magasin de scénarios filtre par rayon

**Files:**
- Modify: `src/workflow/store.pg.ts` (`PUBLIC`, `COLS`/`toRow`, `insererBrouillon`, `nomPrisSousVerrou`, `insert`,
  `listNoms`, `listResume`, `listPublies`, `list`, `creerPublieParApi`, `lireParApi`)
- Modify: chaque appelant que le compilateur signale (relevé d'origin : `src/http/workflows.ts`, `src/http/v1-catalogues.ts`,
  `src/workflow/scenarios-api.ts`, `src/mcp/outils.ts:1035`, `src/mcp/outils-scenarios.ts`, `src/repondeur/reglage.ts`,
  `src/ops/duplication/store.pg.ts`, `src/index.ts:2342`, `src/index.ts:2778`)
- Test: `tests/workflow-store-rayon.test.ts` (modèle : `tests/workflow-store-systeme.test.ts`),
  `tests/integration/workflow-rayon.integration.test.ts`

**Interfaces:**
- Consumes: `Rayon` (tâche 1).
- Produces:
  - `WorkflowRow.rayon: Rayon` (lu en base, jamais deviné).
  - Paramètre `rayon: Rayon` REQUIS, en dernière position, sur `listNoms`, `listResume`, `listPublies`, `list`,
    `lireParApi`, `creerPublieParApi`, `insert(tenantId, name, graph, rayon)` et
    `insererBrouillon(q, tenantId, name, graph, rayon, id?)`.
  - `getById(id, tenantId)` INCHANGÉ et sans filtre de rayon : il sert la relecture du graphe d'un parcours et l'éditeur
    par identifiant. Tout appelant qui s'en sert pour VALIDER un choix compare `row.rayon` lui-même (tâches 3 à 5).
  - Unicité du nom (`nomPrisSousVerrou(c, tenantId, nom, sauf, rayon)`) : PAR rayon.
  - Tous les appelants existants passent `'general'`, littéralement.

- [ ] **Step 1: Tests unitaires** (faux pool qui capture le SQL) : chaque méthode de liste envoie le rayon en paramètre
  et le filtre `rayon = $n` ; `getById` n'en porte pas ; `nomPrisSousVerrou` filtre par rayon.
- [ ] **Step 2: Test d'intégration** : un scénario `general` et un `shopify` de même nom dans le même espace ;
  `listResume(t, 'general')` ne rend que le premier ; `lireParApi(t, <code du shopify>, 'general')` rend `null` ;
  `lireParApi(t, <nom commun>, 'general')` rend le général ; `getById` rend les deux avec leur `rayon` ;
  `listNoms(t, 'general')` (duplication) n'a pas le Shopify.
- [ ] **Step 3: Lancer** `npx vitest run tests/workflow-store-rayon.test.ts` : FAIL.
- [ ] **Step 4: Implémenter**, puis corriger chaque appelant signalé par `npm run typecheck` avec `'general'`.
- [ ] **Step 5: Lancer** `npm run typecheck` (0 erreur, lu dans la sortie et non dans `$?`) et le test unitaire : PASS.
  L'intégration se lit dans la CI.
- [ ] **Step 6: Commit** (`feat(scenarios): le magasin ne liste que le rayon demandé`).

### Task 3: La garde du rayon au lancement

**Files:**
- Modify: `src/workflow/lancements.ts` (`POLITIQUE_DE_LANCEMENT`, `creerLancements.lancer`)
- Test: `tests/workflow-lancements.test.ts`

**Interfaces:**
- Consumes: `Rayon`, `RAYONS`, `WorkflowRow.rayon`.
- Produces: chaque entrée de `POLITIQUE_DE_LANCEMENT` gagne `rayons: readonly Rayon[]`. Valeurs de ce lot :
  `lien_de_test` → `RAYONS` (tester un scénario de n'importe quel rayon depuis son builder) ; tous les autres types →
  `['general']` (`workflow_hubspot` passera à `['hubspot']` au lot 6). Dans `lancer`, juste après `getById` : un
  scénario dont le rayon n'est pas dans `rayons` rend `null`, comme un scénario inconnu.

- [ ] **Step 1: Tests** : pour chaque type qui lit la ligne (tous sauf `agent_meta_bloc` et `repondeur`), un scénario
  `shopify` rend `null` et l'exécuteur n'est pas appelé ; un `general` démarre ; `lien_de_test` démarre un `shopify` ;
  le type de chaque entrée de la table est tenu par `satisfies` (une entrée sans `rayons` ne compile pas).
- [ ] **Step 2: Lancer** `npx vitest run tests/workflow-lancements.test.ts` : FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Relancer** : PASS. Vérifier dans les deux sens (retirer la comparaison, voir le cas `shopify` échouer).
- [ ] **Step 5: Commit** (`feat(scenarios): un lancement refuse un scénario d'un autre rayon`).

### Task 4: Les automations ont un rayon

**Files:**
- Modify: `src/automation/store.pg.ts` (`AutomationRow`, `AutomationInput`, `create`, `list`, `toutesPourLaDuplication`)
- Modify: `src/automation/match.ts` (`AutomationRow.rayon`)
- Modify: `src/http/automations.ts:31,311,331` (`workflowBelongsToTenant` remplacé)
- Modify: `src/index.ts:3373` (câblage, par plomberie)
- Test: `tests/automations-rayon.test.ts`, `tests/integration/automations-rayon.integration.test.ts`

**Interfaces:**
- Produces:
  - `AutomationRow.rayon: Rayon` ; `AutomationInput.rayon: Rayon` REQUIS (chaque fabrique d'automation, chaîne, widget,
    publicité, formulaire, dit `'general'`).
  - `list(tenantId, rayon: Rayon)` : rayon REQUIS ; l'écran Automation actuel passe `'general'`.
  - Dans `src/http/automations.ts`, la dépendance devient
    `scenarioDuRayon(workflowId: string, tenantId: string, rayon: Rayon): Promise<boolean>` (vrai si le scénario existe
    dans l'espace ET porte ce rayon) ; création et modification la passent avec le rayon de l'automation ; un refus
    garde le message et le code actuels du scénario inconnu.
  - Le rayon d'une automation ne change jamais après création (un `rayon` dans le corps d'une modification est ignoré
    par le schéma Zod, jamais écrit).

- [ ] **Step 1: Tests** : créer une automation `general` qui pointe vers un scénario `shopify` est refusé avec la
  réponse d'un scénario inconnu ; `list(t, 'general')` n'a pas une automation `shopify` ; `listEnabled` (le moteur)
  continue de rendre toutes les automations allumées, tous rayons (le moteur les sert toutes).
- [ ] **Step 2: Lancer** : FAIL.
- [ ] **Step 3: Implémenter**, câblage de `src/index.ts` compris (annonce aux sessions voisines, commit par plomberie).
- [ ] **Step 4: Relancer** typecheck et tests : PASS.
- [ ] **Step 5: Commit** (`feat(automations): le rayon d'une automation et de son scénario concordent`).

### Task 5: Les autres choix de scénario, et l'inventaire qui les tient

**Files:**
- Modify: `src/workflow/executor.ts:456` (`resoudreBloc`) et `src/workflow/wiring.ts:547` (son implémentation)
- Modify: `src/http/workflows.ts` (liste des cibles d'un « Aller à » dans l'éditeur, refus de publication)
- Modify: `src/webhook-entrant/store.pg.ts:152,214`
- Modify: le choix du scénario d'une campagne et de ses étapes : `getWorkflowGraph` (`src/http/campaigns.ts:115`,
  câblé `src/index.ts:1831` sur `getById`) rend `null` pour un scénario non `general`, donc la réponse actuelle du
  scénario inconnu (vaut pour la console, `/v1` et `prepare_campaign`)
- Modify: `src/agent/catalog.pg.ts` (le scénario d'un outil « Lancer un scénario » d'un agent IA)
- Modify: le choix du scénario d'un widget (`src/widgets/gestion.ts:187`), d'une publicité et d'un lien de chaîne, et
  du répondeur (`src/repondeur/reglage.ts:253`, `src/repondeur/scenario.ts:52`) : chacun compare `row.rayon === 'general'`
- Create: `tests/inventaire-rayon-scenarios.test.ts`

**Interfaces:**
- Produces:
  - `resoudreBloc(tenantId: string, code: string, depuisWorkflowId: string)` : ne résout qu'un bloc d'un scénario du
    MÊME rayon que `depuisWorkflowId` ; sinon `null`, donc le chemin actuel de cible introuvable (`echouer`, passage à
    l'équipe). La liste des cibles de l'éditeur et le refus de publication (`refusDePublication`) suivent la même règle.
  - Le test d'inventaire relit chaque `from workflows` / `join workflows` de `src/` hors `src/workflow/store.pg.ts` et
    exige, pour chacun, soit un filtre `rayon`, soit une entrée d'une liste nommée `VOIT_TOUS_LES_RAYONS` avec sa raison
    en une phrase (relevé d'origin : noms affichés de campagnes, `src/campaign/store.pg.ts`, `src/crm/contact-history.pg.ts`,
    `src/ops/erreurs-livraison.pg.ts` ; comptes de `src/ops/suppression-espace.pg.ts` ; usages qui bloquent une
    suppression, `src/agent/requetes.pg.ts`, `src/rcs/media-store.pg.ts`, `src/dossiers/store.pg.ts`). Une entrée morte
    (fichier qui ne lit plus `workflows`) fait échouer le test.

- [ ] **Step 1: Tests** : un « Aller à » d'un scénario général vers un code de bloc d'un scénario `shopify` est non
  franchi à l'exécution (`tests/workflow-aller-a.test.ts`) et refusé à la publication ; un webhook entrant qui vise un
  scénario `shopify` rend `scenario_inconnu` ; une campagne qui nomme un scénario `shopify` est refusée comme si le
  scénario n'existait pas ; l'inventaire échoue sur un `from workflows` ajouté sans filtre ni entrée.
- [ ] **Step 2: Lancer** : FAIL.
- [ ] **Step 3: Implémenter.**
- [ ] **Step 4: Relancer** la suite complète (`npm test`, le compte « Test Files » lu dans la sortie) : PASS.
  L'inventaire vérifié dans les deux sens (une ligne de filtre retirée le fait échouer).
- [ ] **Step 5: Commit** (`feat(scenarios): aucun choix de scénario ne traverse un rayon`).

### Task 6: Déploiement et essai

- [ ] **Step 1:** `npm run lint`, `npx tsx scripts/auto-attaque.mts`, push, verdict de la CI job par job (intégration
  comprise ; un `toomanyrequests` se relance).
- [ ] **Step 2:** relecture indépendante unique du lot (`/revue`, section « Rayon de souffle » : qui supposait qu'une
  liste de scénarios rendait tout ?).
- [ ] **Step 3:** `gh workflow run deploy-scaleway.yml --ref main -f migration=avant`, approbation de Julien.
- [ ] **Step 4:** relecture en base, sur la machine des workers : colonnes, défauts, `pg_get_constraintdef` des deux
  CHECK, et toutes les lignes existantes à `general`.
- [ ] **Step 5:** essai réel (section Méthode de livraison), noté dans `docs/prive/ESSAIS-REELS.md` ; journal technique
  (§ migrations) et `documentation.md` (le rayon, l'inventaire) dans le commit de clôture.
