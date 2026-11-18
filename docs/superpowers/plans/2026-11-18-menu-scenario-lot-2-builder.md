# Menu « Scénario », lot 2 : la sortie « Pas de réponse » du template, la fenêtre au départ, les jaunes du lot 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un bloc template peut sortir par « Pas de réponse après X » (comme la Question), le builder et l'écran
Automation PRÉVIENNENT d'un message de session qui partirait fenêtre fermée, et les jaunes de la relecture du lot 1 sont
fermés.

**Architecture:** le moteur réutilise l'échéance de la Question (`resume_at` sur un parcours `waiting`, réclamée par le
balayage, reprise par la poignée `timeout`) ; un drapeau figé à la naissance du parcours (`workflow_runs.ne_en_masse`)
empêche une relance de masse d'émettre ; une analyse de fenêtre partagée (`web/lib/partage/fenetre-scenario.ts`) juge un
graphe depuis ses départs ouverts ou fermés, le serveur fournit les départs (rayon, lanceurs) et la console affiche.

**Tech Stack:** TypeScript, Fastify, Postgres (`pg`), pg-boss, vitest, Next.js (web/), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md` (décisions 5, 11, 12, 16, 17, 24, 25,
26 ; § 5.2). Carte du code : run `wf_22150a37-515` de la session, `journal.jsonl` (lot 2).

## Méthode de livraison

**Implémenteur par lot et revue humaine du diff**, en trois livraisons, parce que 2a change le chemin que chaque
template emprunte en production (`walk` sert `runFrom`, `advance`, `resume`, `blocSeul`) et le réveil des parcours, avec
une migration sur `workflow_runs`, table du chemin chaud ; 2b est de l'écran et de l'aide (pas pour feature-loop, règle
du dépôt). Une relecture indépendante unique par livraison de code (2a, puis 2b).

1. **2a-0, la migration seule** (tâche 2, étape migration) : poussée seule, déployée `migration=avant`, AVANT que son code
   n'arrive sur `main` (règle 0163, 0201, 0218 : une colonne nommée par un chemin chaud).
2. **2a, le serveur** (tâches 1 à 5) : déployé `migration=aucune`.
3. **2b, la console et l'aide** (tâches 6 à 8) : poussée APRÈS le déploiement de 2a (un délai posé dans la console avant
   serait ignoré par l'ancien moteur, et en mode agent de Meta l'ancien `walk` suivrait la flèche « Pas de réponse »).

**Essai réel qui clôt le lot :** sur la SANDBOX, par le lien de test : un template à bouton, « Pas de réponse après
2 min », puis un second template ; trois passages (aucune réponse : le second part ; un clic : la branche du bouton ;
une réponse écrite sans « Toute autre réponse » : le parcours s'arrête). Puis une campagne vers deux numéros de test sur
le même scénario, une étiquette posée sur la branche « Pas de réponse » et une automation « étiquette posée » qui
l'écoute : elle ne doit PAS partir. Le builder montre l'avertissement d'un message rapide placé après « Pas de
réponse », et l'écran Automation celui d'une automation de date sur ce scénario. Numéro libre dans
`docs/prive/ESSAIS-REELS.md`.

## Global Constraints

- Aucun tiret cadratin ni demi-cadratin (code, commentaires, doc, textes de la console) ; la console vouvoie.
- `tenant_id = $1` sur chaque requête neuve ; aucun `from workflows` neuf sans `rayon =` ni lecture par identifiant qui
  valide un choix sans `.rayon` (`tests/inventaire-rayon-scenarios.test.ts`).
- Délai « pas de réponse » : unités `minutes`, `hours`, `days` (celles de la Question, `QUESTION_UNITS`), plafond
  30 jours, 0 ou absent = aucune échéance.
- Un template SANS délai, ou sans nom de template (`actionOf` nul), garde EXACTEMENT son comportement d'aujourd'hui,
  mode agent de Meta compris.
- Prévenir, jamais refuser (décisions 16 et 17) : aucune route ne refuse une publication, une automation ou une campagne
  pour une raison de fenêtre.
- Toute dépendance ajoutée est REQUISE (règle des dépendances non optionnelles) ; les fixtures qui cassent se mettent à
  jour.
- Le numéro de migration se lit par `npm run migrations` sur une copie à jour d'origin (0294 est pris par une autre
  session le 2026-11-18).
- Travail dans une copie à part ; câblage partagé (`src/index.ts`, `src/worker.ts`) annoncé aux sessions voisines, commit
  sur `origin/main` ; avant tout push d'un `.ts` : `npm run typecheck`, `npm test`, `npm run lint`,
  `npx tsx scripts/auto-attaque.mts` ; CI lue job par job ; tout test de non-régression vérifié dans les deux sens.
- Toute retouche de `features.md` ré-empreinte les fiches qui citent la section, dans le même commit, et
  `tests/aide-proposer.test.ts` vert avant le push (`&&`).

## Review Focus

1. Un template sans délai, à délai nul, à unité inconnue ou sans nom de template : même repos qu'avant, avec et sans
   agent de Meta (testé tâche 1).
2. Une arête `timeout` résiduelle sur un template SANS délai (posée par `PATCH /workflows/:id`, que `parseGraph` accepte)
   n'est jamais suivie comme « suite » en mode agent de Meta (testé tâche 1).
3. Un parcours de campagne réveillé par « Pas de réponse » sans réponse du contact n'émet aucune étiquette et saute en
   `aller_a_masse` ; après une réponse, il émet comme avant ; une automation unitaire (date) émet comme avant (tâche 2).
4. Un parcours en cours au déploiement (colonne au défaut `false`) garde son comportement (tâche 2).
5. Un scénario de l'API retouché dans la console avec un délai ne se laisse plus remplacer par l'API sans le délai
   (`scenario_not_describable`, tâche 3).

---

### Task 1: La sortie « Pas de réponse » du template, dans le moteur

**Files:**
- Modify: `src/workflow/engine.ts` (`questionTimeoutMs` 597-609 renommée, `walk` cas template 1074-1095, doc de
  `WalkRest.waiting` 456-461)
- Modify (commentaires et nom seulement) : `src/workflow/executor.ts` (`parQuestion` 1130, commentaires 1108-1146),
  `src/workflow/run-store.pg.ts` (303-317), `src/workflow/wake-sweep.ts` (5-46)
- Modify: les appelants de `questionTimeoutMs` (le compilateur les donne)
- Test: `tests/workflow-template-sans-reponse.test.ts` (modèles : `tests/workflow-question-node.test.ts:80-131`,
  `tests/workflow-question-exec.test.ts:89-200`)

**Interfaces:**
- Produces:
  - `export function delaiSansReponseMs(node: WorkflowNode): number` (renomme `questionTimeoutMs`, même lecture de
    `data.timeoutValue` / `data.timeoutUnit`, même plafond, 0 = aucune échéance) ; plus aucun `questionTimeoutMs`.
  - `export function nextNodeHorsTimeout(graph: WorkflowGraph, id: string): string | null` : la première arête dont la
    poignée n'est pas `timeout`.
  - Dans `walk`, cas template : action non nulle ET délai > 0 → l'action est poussée et le repos est
    `{ status: 'waiting', nodeId, timeoutInMs }`, AVANT le calcul de `continuer` (mode agent de Meta compris, décision
    25). Sinon, le comportement actuel, à une différence près : le chemin `continuer` prend `nextNodeHorsTimeout` au lieu
    de `nextNode`.

- [ ] **Step 1: Tests**, chacun vérifié dans les deux sens : délai absent, 0 ou unité inconnue = repos identique à
  aujourd'hui, avec et sans agent de Meta ; délai > 0 = `waiting` + `timeoutInMs` (aussi en mode agent de Meta) ;
  template sans nom = aucune échéance ; arête `timeout` résiduelle sur un template sans délai jamais prise en mode agent
  de Meta ; exécuteur : `resume_at` posé, une réponse l'efface, l'échéance sort par `timeout`, une sortie non câblée clôt
  le parcours et rend la main, une fenêtre fermée au réveil retient un message rapide ; `blocSeul` refuse un template à
  délai (`tests/mba-outils-maison.test.ts`).
- [ ] **Step 2:** `npx vitest run tests/workflow-template-sans-reponse.test.ts` : FAIL.
- [ ] **Step 3: Implémenter**, puis `npm run typecheck` (0, lu dans la sortie).
- [ ] **Step 4:** le test neuf et `tests/workflow-question-node.test.ts`, `tests/workflow-question-exec.test.ts`,
  `tests/workflow-engine.test.ts`, `tests/workflow-release-mba.test.ts` : PASS.
- [ ] **Step 5: Commit** (`feat(scenarios): le bloc template sort par « Pas de réponse après X »`).

### Task 2: Une relance de masse n'émet rien tant que le contact n'a pas répondu

**Files:**
- Create: `db/migrations/<NNNN>_run_ne_en_masse.sql` (modèle `db/migrations/0272_run_accord_marketing_exige.sql`)
- Test: `tests/migration-<NNNN>.test.ts` (modèle `tests/migration-0293.test.ts`)
- Modify: `src/workflow/run-store.pg.ts` (`start` 116-128, les trois réclamations 336-379, `WorkflowRunRow`)
- Modify: `src/workflow/wake-sweep.ts` (`DueRun`)
- Modify: `src/workflow/executor.ts` (`runFrom` 1797-1799, `resume` 1090-1112, 1192, 1277)
- Test: `tests/run-store-claims.test.ts` (SQL exact, à mettre à jour), `tests/workflow-template-sans-reponse.test.ts`

**Interfaces:**
- Produces:
  - Colonne `workflow_runs.ne_en_masse boolean not null default false` ; `set local lock_timeout = '5s'` en tête.
  - `RunState` / `WorkflowRunRow` / `DueRun` portent `neEnMasse: boolean`, REQUIS sur `DueRun` (comme
    `exigeAccordMarketing`).
  - `runFrom` écrit `neEnMasse = !POLITIQUE_DE_LANCEMENT[type].publieLesEtiquettes` à la naissance du parcours.
  - `resume` : si `run.neEnMasse && run.lastMessageId === null`, les étiquettes posées n'émettent pas (`emitEvents`
    faux) et un « Aller à » saute en `aller_a_masse` ; sinon, comportement actuel.

- [ ] **Step 1: Livraison 2a-0.** Écrire la migration et son test miroir (colonne, défaut, nullabilité, `lock_timeout`
  en tête, aucune autre instruction) ; test FAIL puis PASS ; commit seul ; push ; CI lue ; déploiement
  `gh workflow run deploy-scaleway.yml --ref main -f migration=avant -f commit=<sha>` (approbation de Julien) ; relecture
  en base par la sonde (`scratchpad/relecture-0293.mjs` en modèle : colonne, type, défaut, nullabilité).
- [ ] **Step 2: Tests** du code : réclamation qui rend `neEnMasse` ; campagne réveillée sans réponse : ni
  `tag_added` ni saut unitaire ; la même après une réponse : émet ; automation de date + Attente + étiquette : émet ;
  parcours au défaut `false` : comportement actuel. Vérifiés dans les deux sens.
- [ ] **Step 3:** FAIL ; implémenter ; typecheck 0 ; PASS (`tests/run-store-claims.test.ts` réécrit au SQL neuf).
- [ ] **Step 4: Commit** (`feat(scenarios): une relance de masse n'émet rien sans réponse du contact`).

### Task 3: La recette refuse de décrire un template à délai

**Files:**
- Modify: `src/workflow/recette-graphe.ts` (`lireGraphe`, cas template, 272-305)
- Test: `tests/workflow-recette-graphe.test.ts`

**Interfaces:**
- Produces: un template dont `delaiSansReponseMs > 0` (avec ou sans arête `timeout`) rend la décompilation
  `indescriptible` (donc `scenario_not_describable` côté API et MCP), décision 26.

- [ ] **Step 1: Test** : décompiler un template à délai rend `scenario_not_describable` ; un template sans délai se
  décompile comme avant. FAIL, implémenter, PASS, vérifié dans les deux sens.
- [ ] **Step 2: Commit** (`feat(scenarios): la recette ne décrit pas un template à délai`).

### Task 4: Les jaunes de la relecture du lot 1

**Files:**
- Modify: `src/index.ts` (`mbaOutils.workflow` et `mbaOutils.blocs` 2861-2868, `graphePublie` 3773, `pubs` 3167),
  `src/worker.ts` (`graphePublie` 2279) : par plomberie, annoncés aux sessions voisines
- Modify: `src/agent/catalog.pg.ts` (`ajouterMaisonPourMba`, `patchMaisonPourMba` 404-451 : la cible `bloc_fixe` ou
  `scenario_fixe` passe par `SCENARIOS_DE_L_ESPACE`)
- Modify: `src/workflow/lancements.ts` (`PolitiqueDeLancement.rayons` : `readonly Rayon[] | 'sans_objet'` ;
  `sans_objet` pour `repondeur`, `aller_a`, `aller_a_masse` ; `agent_meta_bloc` lit la ligne et applique `rayonAdmis`
  dans `lancer`)
- Modify: `src/http/pubs.ts` (dépendance REQUISE `scenarioEtat` ; `inconnu` refusé en 400, `vide` en 409, comme le
  widget, `src/widgets/gestion.ts:254-262`) ; `src/ops/duplication/declencheurs.ts` (`rayon: 'general'`)
- Modify: `tests/inventaire-rayon-scenarios.test.ts` (retirer les deux entrées d'`INDEX_TOUS_RAYONS`, raison de
  `src/worker.ts` corrigée, `RE_SQL` insensible à la casse, `graphePublie:` et `deps.workflow(` reconnus)
- Cosmétique : JSDoc fusionnés sur `resoudreBloc` (`src/workflow/executor.ts:450-459`) ; le verrou du webhook entrant
  verrouille sans filtre puis vérifie le rayon du seul `workflowVise` (`src/webhook-entrant/store.pg.ts:211-219`)
- Test: `tests/http-mba-outils.test.ts`, `tests/workflow-lancements.test.ts` (445-447 réécrit), `tests/pubs-creation-routes.test.ts`,
  `tests/ops-duplication-declencheurs.test.ts`, `tests/integration/ops-duplication.integration.test.ts`

- [ ] **Step 1: Tests**, vérifiés dans les deux sens : une cible de l'agent de Meta sur un scénario `shopify` refusée
  (422) et `GET /mba-outils/blocs` vide ; l'envoi d'un bloc (agent de Meta et agent IA) n'envoie rien sur un `shopify` ;
  une publicité vers un scénario `shopify`, inconnu ou d'un autre espace refusée sans appel à Meta ; la copie `/ops`
  d'une automation est `general` et `lireEtat` rend `null` pour un `shopify` ; `agent_meta_bloc` refuse un `shopify`.
- [ ] **Step 2:** FAIL ; implémenter ; typecheck 0 ; PASS ; inventaire vérifié dans les deux sens.
- [ ] **Step 3: Commit** (`fix(scenarios): l'agent de Meta, l'agent IA et la publicité restent dans le Builder`), puis
  retirer la section correspondante de `todo.md` (les notes des lots 5 et 6 y restent).

### Task 5: Les départs d'un scénario et l'analyse de fenêtre partagée (données des avertissements)

**Files:**
- Create: `web/lib/partage/fenetre-scenario.ts`
- Modify: `web/lib/partage/automations.ts` (table `FENETRE_AU_DEPART`)
- Modify: `src/workflow/engine.ts` (`explorerLesAttentes` 365-454 remplacé par le module ; `waitBeforeSessionMessage` et
  `sautsApresAttenteLongue` gardés comme enveloppes « départ ouvert »), `web/lib/campaign-eligibility.ts` (174-274 :
  enveloppe du module, commentaire faux 190-195 corrigé)
- Modify: `src/workflow/store.pg.ts` (`lanceursDuScenario`, modèle `UTILISATIONS` 169-192)
- Modify: `src/http/workflows.ts` (`GET /workflows/:id` rend `departs`), `src/http/automations.ts` (`GET /automations`
  rend `avertissementFenetre` par ligne) et leur câblage
- Test: `tests/fenetre-scenario.test.ts`, `tests/integration/lanceurs-scenario.integration.test.ts`, `tests/workflows.test.ts`,
  `tests/http-automations.test.ts` ; restent verts : `tests/workflow-wait.test.ts`, `tests/web-campaign-eligibility.test.ts`,
  `tests/condition-familles.test.ts`, `tests/workflow-agent-main-rendue.test.ts`, `tests/workflow-attente-datee.test.ts`

**Interfaces:**
- Produces:
  - `export const FENETRE_AU_DEPART: Record<AutomationTriggerKind, 'ouverte' | 'fermee'>` : ouverte pour `keyword`,
    `new_contact`, `ctwa_ad` ; fermée pour tous les autres ; un test l'aligne sur `windowOpen` du runner
    (`src/automation/runner.ts:230`).
  - `export interface Depart { noeudId: string | null; fenetre: 'ouverte' | 'fermee'; raison: string }` (`null` =
    l'entrée du scénario) et `export interface Constat { noeudId: string; raison: 'session_fenetre_fermee' |
    'saut_fenetre_fermee'; depart: Depart }`.
  - `export function analyserFenetre(graph: WorkflowGraph, departs: readonly Depart[]): Constat[]` : une réponse ou un
    clic (boutons, cartes, lignes de menu, sortie libre, formulaire rempli, fichier) rouvre et remet le cumul à 0 ; la
    sortie `timeout` d'un template ou d'une Question garde l'état et ajoute son délai ; une Attente ajoute son estimation ;
    24 h cumulées ferment ; un message de session configuré (message rapide, formulaire, Question, agent) atteint fermé
    est un constat ; un « Aller à » interne est suivi, externe relevé avec son état. Sans départ fourni : un départ
    ouvert à l'entrée (comportement d'aujourd'hui).
  - `PgWorkflowStore.lanceursDuScenario(tenantId: string, id: string): Promise<Lanceur[]>`,
    `Lanceur = { type: 'automation' | 'campagne'; nom: string; declencheur: AutomationTriggerKind | null;
    blocDeDepart: string | null }` : automations allumées et campagnes `scheduled | running | paused` (et leurs étages),
    `tenant_id = $1` dans chaque sous-requête.
  - `GET /workflows/:id` ajoute `departs: Depart[]` : fermée à l'entrée si le rayon n'est pas `general`, un départ par
    lanceur fermé (son bloc ou l'entrée), toujours un départ ouvert à l'entrée pour le Builder.
  - `GET /automations` ajoute à chaque ligne `avertissementFenetre: string | null`, la phrase de la décision 17, calculée
    sur le graphe PUBLIÉ du scénario depuis son bloc de départ, avec la fenêtre de `FENETRE_AU_DEPART`.

- [ ] **Step 1: Tests** de l'analyse (départ fermé puis message rapide ; clic qui rouvre ; « Pas de réponse » puis message
  rapide ; 24 h cumulées sur la sortie d'une Question ; plusieurs départs ; saut externe fermé ; sans départ = résultat
  d'aujourd'hui), de l'alignement de la table, des deux routes (champ présent, phrase exacte, `null` quand rien), et
  l'intégration de `lanceursDuScenario` (espace, campagnes actives seulement).
- [ ] **Step 2:** FAIL ; implémenter ; typecheck 0 ; PASS, et les cinq fichiers d'analyse existants verts.
- [ ] **Step 3: Commit** (`feat(scenarios): les départs d'un scénario et l'analyse de fenêtre partagée`).
- [ ] **Step 4: Livraison 2a** : suite complète, lint, auto-attaque, push, CI job par job, relecture indépendante unique
  (rayon de souffle : qui supposait qu'un template attend sans limite ?), déploiement `migration=aucune`.

### Task 6: La console du bloc template (livraison 2b)

**Files:**
- Modify: `web/components/WorkflowConfigPanel.tsx` (« Si le contact ne répond pas » 854-874 extrait en composant commun,
  posé sous le template ; à 0, l'événement qui retire l'arête `timeout`)
- Modify: `web/components/WorkflowNode.tsx` (rangée « Pas de réponse », poignée `timeout`, couleur d'alerte, dans les deux
  branches du template), `web/lib/workflow-sorties.ts` (`sansSortiePasDeReponse(edges, nodeId)`, appliquée au template ET
  à la Question), `web/components/WorkflowBuilder.tsx` (écouteur du délai remis à 0, modèle `wf-fichier-off`)
- Test: `tests/web-workflow-sorties.test.ts`, `web/e2e/workflow-template-sans-reponse.spec.ts` (modèle
  `web/e2e/workflow-question-node.spec.ts:85-94`)

- [ ] **Step 1:** tests (la rangée n'apparaît qu'avec un délai ; repasser à 0 retire la flèche, template et Question) ;
  FAIL ; implémenter ; PASS ; suite racine entière (règle des lots `web/`).
- [ ] **Step 2: Commit** (`feat(console): le bloc template se règle « Si le contact ne répond pas »`).

### Task 7: Les avertissements de fenêtre dans le builder et l'écran Automation (livraison 2b)

**Files:**
- Modify: `web/lib/api/scenarios.ts` (`departs` facultatif : absent = un départ ouvert à l'entrée, tolérance d'une API
  plus ancienne), `web/components/WorkflowBuilder.tsx` (494-526, 695-706 : un bandeau par constat, avec la phrase qui
  dit quoi faire), `web/components/WorkflowConfigPanel.tsx` (533-540), `web/app/workflows/page.tsx`,
  `web/components/campagne/CreationScenarioEnLigne.tsx` (l'éditeur ouvert depuis une campagne part fermé),
  l'écran Automation (`web/app/automations/page.tsx`, la phrase `avertissementFenetre` sous la ligne et dans le
  formulaire)
- Test: `web/e2e/workflow-type-chooser-wait.spec.ts` (textes réécrits), `web/e2e/captures/bloc-attente.capture.ts`,
  `tests/web-vouvoiement.test.ts`

- [ ] **Step 1:** tests ; FAIL ; implémenter ; PASS ; suite racine entière ; e2e par le serveur démarré à la main
  (`documentation.md`, pièges de l'e2e).
- [ ] **Step 2: Commit** (`feat(console): le builder et l'écran Automation préviennent d'un message hors fenêtre`).

### Task 8: Aide, vitrine, manuel (livraison 2b)

**Files:**
- Modify: `docs/aide/fiches/bloc-envoi-template.md` (étape « Prévoir l'absence de réponse »), `bloc-question.md`,
  `bloc-attente.md`, `bloc-message-rapide.md`, `bloc-aller-a.md`, `bloc-formulaire.md`, `la-fenetre-de-24-heures.md` (la
  règle y vit, les fiches de bloc y renvoient), `declencher-un-scenario-automatiquement.md`, et leurs `en/` ;
  `features.md` (section « Automatisations », dont la phrase fausse 1144-1145) ; `documentation.md` (§ 4.3, invariant 8,
  § rayon) ; `docs/JOURNAL-TECHNIQUE.md` (§ migrations)
- Generate: `npm run vitrine:aide`, `npm run vitrine:anglais` si une phrase française change, `npm run aide:captures`
  (capture du bloc template) ; `aide:charger` en production après le push

- [ ] **Step 1:** réécrire, régénérer, ré-empreinter ; `tests/aide-proposer.test.ts`, `tests/vitrine-aide.test.ts`,
  `tests/vitrine-anglais.test.ts` : PASS.
- [ ] **Step 2: Commit** (`docs(aide): la sortie « Pas de réponse » du template et la fenêtre au départ`).
- [ ] **Step 3: Livraison 2b** : relecture indépendante unique, push APRÈS le déploiement de 2a, CI front et racine lues,
  `aide:charger`, essai réel (section Méthode de livraison), journal et `todo.md` à jour.
