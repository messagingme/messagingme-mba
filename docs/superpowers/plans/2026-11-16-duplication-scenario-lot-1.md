# Duplication de scénario entre espaces, lot 1 : plan d'implémentation

> **Pour l'exécutant** : un implémenteur exécute les tâches dans l'ordre, une relecture indépendante passe en fin de
> lot, puis Julien relit le diff. Les cases `- [ ]` suivent l'avancement.

**But** : un onglet « Dupliquer » de `/ops` copie un scénario d'un espace vers un autre. La copie arrive inactive,
sans rien qui reste branché sur l'espace source, avec les champs et déclencheurs qui peuvent suivre.

**Architecture** : trois fonctions PURES décident de tout :
- `copierGraphe` : ce que devient chaque bloc ;
- `copierDeclencheurs` : ce que devient chaque automation ;
- `planifierDuplication` : les champs, les templates, les blocages, l'empreinte.

Un store lit l'état des deux espaces et écrit le plan en UNE transaction. Un module `session-ops` expose
l'aperçu et l'exécution, et la console ajoute l'onglet. Ce lot n'écrit rien chez Meta : il LIT les templates de la
WABA de destination.

**Stack** : Fastify, Postgres (`pg`), Zod, vitest, Next.js (console), Playwright (e2e).

**Spec** : [docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md](../specs/2026-11-16-duplication-scenario-entre-espaces-design.md),
section « Lots », lot 1. Code lu sur `origin/main` le 2026-11-16.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que la duplication ÉCRIT dans les espaces de vrais clients. Le
code touché porte aussi des invariants invisibles : codes de blocs refaits au code client, nom de scénario unique sous
verrou consultatif, limite d'automations comptée sur les seules automations allumées, `tenant_id` sur chaque requête.
Une relecture indépendante passe en fin de lot (`/revue`, avec sa section « Rayon de souffle »), puis Julien relit le
diff.

**Essai réel qui clôt le lot**, de la SANDBOX vers un autre espace de test qui a une WABA. Le scénario dupliqué
contient :
- un « aller vers » et un « assigner à » ;
- un bloc agent IA et un appel API ;
- un champ absent de la destination ;
- un template déjà approuvé dans la destination ;
- un déclencheur mot-clé, dont un mot est déjà pris dans la destination, et un déclencheur « tag ajouté ».

On vérifie :
- le récapitulatif ;
- la copie inactive ;
- les blocs débranchés là où la spec le dit ;
- le champ créé ;
- le mot en conflit retiré.

Puis on publie, on rallume le déclencheur, et on joue la branche du template depuis le téléphone d'essai. L'essai entre
dans `docs/prive/ESSAIS-REELS.md`.

## Où on travaille

**Dans une copie à part du code**, à demander à Julien avant de commencer, parce que l'arbre partagé a 259 commits de
retard et porte le travail en cours d'autres sessions :
- `git worktree add --detach <scratchpad>/mm-duplication origin/main`, `node_modules` relié par jonction ;
- commits locaux dans la copie (`git commit --only <ses chemins>`) ;
- publication par rebase sur `origin/main` juste avant chaque push (tâche 7). Un conflit sur `src/index.ts` ou
  `src/server.ts` ARRÊTE la publication : on relit le diff d'origin avant de résoudre.

Avant de supprimer la copie, retirer la jonction seule.

## Contraintes globales

- **Aucune migration** : tout ce qui s'écrit a déjà sa table.
- **Côté réseau** : aucun envoi WhatsApp, aucun événement d'automation, aucune écriture chez Meta.
- **Réponses de l'API** : jamais de 5xx, car Cloudflare en mange le corps. Une panne rend 422 avec un message lisible,
  comme `src/http/ops-suppression.ts`.
- **Entrées** : corps lu par Zod `safeParse` ; identifiants contrôlés par `estUuid`, sinon 404.
- **Isolation** : chaque lecture de la source filtre sur `tenant_id` = source, chaque écriture sur `tenant_id` =
  destination.
- **Textes de la console** : `t('fr', 'en')`, vouvoiement (`tests/web-vouvoiement.test.ts`), les formes et icônes
  existantes (`tests/web-formes.test.ts`, `tests/web-icones.test.ts`).
- **Rédaction** : pas de tiret cadratin ni demi-cadratin, dans le code commenté comme dans les textes.
- **Nom de la copie** : « X (copie) », puis « X (copie 2) », etc., sous le verrou de nom de la destination.

## Décidé par ce plan (à contester avant le code)

1. **Déclencheurs liés à un objet de la source** : non copiés, signalés au récapitulatif. Sont concernés le webhook
   entrant, l'étape HubSpot, la publicité CTWA, l'action d'agent, et toute automation à `possede_par` non nul (lien
   de chaîne, publicité, widget). Les autres types (`keyword`, `new_contact`, `tag_added`, `conversation_analyzed`,
   `analyse_devient`, `risque_eleve`, `avant_date`) sont copiés éteints.
2. **Accord marketing** : l'attestation (`accord_marketing_par`, `_email`, `_le`) n'est jamais copiée. Elle engage une
   personne de la source ; la destination la redonnera en rallumant.
3. **Tags** : déclarés au référentiel APRÈS la transaction, au mieux, par le `declareTags` existant, comme la
   duplication dans un même espace. Un tag se pose par son nom ; absent du référentiel, il ne casse rien.
4. **Template présent mais pas approuvé** dans la destination : signalé, sans blocage.
5. **Les `{clé}` écrites dans un texte ou une adresse** ne créent pas de champ dans ce lot. Le récapitulatif ne les
   voit pas ; l'essai réel dira s'il faut les ajouter au lot 2.
6. **Pas encore de cases dans ce lot** : agent, appel API, e-mail et Flow arrivent débranchés, et le récapitulatif
   l'écrit (« à dupliquer : lot 2 » ou « lot 3 »).

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/ops/duplication/graphe.ts` (neuf) | `copierGraphe` : le sort de chaque bloc, les références collectées |
| `src/ops/duplication/declencheurs.ts` (neuf) | `copierDeclencheurs` : le sort de chaque automation |
| `src/ops/duplication/plan.ts` (neuf) | `planifierDuplication` : champs, templates, blocages, signaux, empreinte |
| `src/ops/duplication/store.pg.ts` (neuf) | `PgDuplicationStore` : lecture des deux espaces, écriture en une transaction |
| `src/http/ops-duplication.ts` (neuf) | Les quatre routes `session-ops` |
| `src/workflow/store.pg.ts` | Exporter `nomPrisSousVerrou` ; extraire `insererBrouillon(q, …)`, que `insert` appelle |
| `src/automation/store.pg.ts` | Constructeur en `Pick<Pool, 'query'>` (aucun `pool.connect()` dans la classe, mesuré) |
| `src/server.ts`, `src/index.ts` | Le module au registre (`entree('opsDuplication', 'session-ops', …)`) et son câblage |
| `scripts/auto-attaque.mts` | `opsDuplication: inconnu('opsDuplication')` dans `FAUSSES_AUTORITES` |
| `web/lib/api/compte.ts` | Les quatre appels, par `appelOps` |
| `web/components/OpsDuplication.tsx` (neuf), `web/app/ops/page.tsx` | L'onglet `dupliquer`, après `reglages` |
| `tests/ops-duplication-*.test.ts`, `tests/integration/ops-duplication.test.ts`, `web/e2e/ops-duplication.spec.ts` | Les tests des tâches |

## À surveiller en revue (non couvert d'office)

1. **Brouillon et version publiée** : un scénario dont le brouillon diffère du publié se copie depuis le brouillon
   (`grapheEditable`), et la copie ne publie rien. Test en tâche 4.
2. **WABA illisible** : une destination dont le jeton Meta ne lit plus ses templates bloque l'aperçu par un 422
   lisible, jamais un 5xx ni une liste vide prise pour « aucun template ». Test en tâche 5.
3. **Id forgé** : un scénario système (répondeur) ou d'un troisième espace, demandé par id, rend 404. Test en tâches 4
   et 5.
4. **Clés système** : `isSystemFieldKey` n'est jamais créée comme champ. Test en tâche 1.
5. **Plafonds du graphe** : le graphe copié repasse `parseGraph` (200 blocs, 400 arêtes, types connus). Test en tâche 1.

---

### Tâche 1 : le graphe copié (pur)

**Fichiers** : créer `src/ops/duplication/graphe.ts` ; test `tests/ops-duplication-graphe.test.ts`.

**Interfaces** :
- Consomme :
  - `mintNodeCodes(graph, tenantCode)` (`src/workflow/node-codes.ts`) ;
  - `WORKFLOW_NODE_TYPES`, `WorkflowNodeType` (`web/lib/partage/blocs.ts`) ;
  - `sousActions` (`web/lib/partage/actions-bloc.ts`) ;
  - `coerceConditionGroup`, `famillesDeCondition` (`src/workflow/conditions.ts`) ;
  - `parseParamHints` (`src/crm/template.ts`) ;
  - `normaliserEtiquette` (`src/crm/poser-etiquette.ts`) ;
  - `isSystemFieldKey` (`src/crm/fields.ts`).
- Produit :
  - `type RaisonDebranche = 'aller_a' | 'assignation' | 'agent' | 'appel_api' | 'email' | 'flow'` ;
  - `interface BlocDebranche { nodeId: string; nom: string; type: WorkflowNodeType; raison: RaisonDebranche }` ;
  - `interface GrapheCopie { graphe: WorkflowGraph; debranches: BlocDebranche[]; clesDeChamp: string[]; tags: string[]; templates: Array<{ nom: string; langue: string }> }` ;
  - `copierGraphe(source: WorkflowGraph, codeClientDestination: string): GrapheCopie`.

- [ ] **Écrire les tests**, un cas par ligne de la table de la spec :
  - **`aller_a`** : `cible` et `cibleLibelle` vides, MÊME vers un bloc du même scénario ; listé `aller_a`.
  - **`inbox`** : `assigneA` et `assigneNom` vides ; listé `assignation`.
  - **Références vidées** : `agent` (`agentId`, `agentLabel`), `http` (`requestId`, `requeteLabel`), `email`
    (`emailAccountId`, `templateId`) et `flow` (`flowId`, `flowName`) sont vidés et listés, chacun sous sa raison.
  - **Ce qui reste intact** : `sorties` de l'agent, arêtes, `node.id` et positions.
  - **`template`** : inchangé ; `{ nom, langue }` collecté une fois même s'il sert à deux blocs.
  - **Clés collectées depuis** :
    - `question.champReponse` ;
    - les `set_field` et `clear_field` d'un `action` ;
    - `field.fieldKey` ;
    - les clauses `field` et `datetime` d'une `condition` ;
    - `js.champSource` et `js.champCible` ;
    - `extraire.champSource` et `lignes[].champCible` ;
    - `http.champCible` ;
    - les destinataires `{ kind: 'field' }` d'un `email` ;
    - les sources `field` des variables d'un `template`.
  - **Clés exclues** : une clé système (`isSystemFieldKey`) n'est jamais collectée ; une clé vide ou en double est
    ignorée.
  - **Tags collectés** depuis `tag`, les `add_tag` d'un `action` et les clauses `tag` d'une `condition`, normalisés par
    `normaliserEtiquette`.
  - **Codes** : aucun `data.code` de la source ne survit, chaque code commence par `nod_<codeClientDestination>_`.
  - **Forme du graphe** : le graphe rendu passe `parseGraph`, y compris à 200 blocs et 400 arêtes.
- [ ] **Lancer** `npx vitest run tests/ops-duplication-graphe.test.ts` : rouge, module absent.
- [ ] **Implémenter `copierGraphe`** : un `switch` EXHAUSTIF sur `WorkflowNodeType`, avec une branche `default` qui
  affecte à `never`. Un type ajouté plus tard ne compile pas tant qu'on n'a pas décidé de son sort. Les blocs qui ne
  portent rien de propre à l'espace sont recopiés.
- [ ] **Relancer** : vert. Puis `npm run typecheck` : 0 erreur.
- [ ] **Commit** dans la copie : `git commit --only src/ops/duplication/graphe.ts tests/ops-duplication-graphe.test.ts`.

### Tâche 2 : les déclencheurs copiés (pur)

**Fichiers** : créer `src/ops/duplication/declencheurs.ts` ; test `tests/ops-duplication-declencheurs.test.ts`.

**Interfaces** :
- Consomme :
  - `AutomationRow`, `normalizeText`, `keywordsOf`, `keywordModeOf` (`src/automation/match.ts`) ;
  - `AutomationInput` (`src/automation/store.pg.ts`) ;
  - `coerceConditionGroup`.
- Produit :
  - `type RaisonRetrait = 'mot_cle_pris' | 'nouveau_contact_existe' | 'lie_a_la_source'` ;
  - `interface DeclencheursCopies { copies: Array<Omit<AutomationInput, 'workflowId'>>; retires: Array<{ nom: string; raison: RaisonRetrait; detail?: string }>; clesDeChamp: string[]; tags: string[] }` ;
  - `copierDeclencheurs(duScenario: AutomationRow[], deLaDestination: AutomationRow[]): DeclencheursCopies`.

- [ ] **Écrire les tests** :
  - **Mots-clés** :
    - un mot-clé de la destination, comparé après `normalizeText`, est retiré de la copie ;
    - les autres mots restent ;
    - tous retirés : le déclencheur ne suit pas, raison `mot_cle_pris`.
  - **Nouveau contact** : la destination en a déjà un, allumé ou non ; raison `nouveau_contact_existe`.
  - **Liés à la source** : `webhook`, `hubspot_deal_stage`, `ctwa_ad`, `agent_action` et tout `possedePar` non nul sont
    retirés, raison `lie_a_la_source`.
  - **Copiés tels quels** : `tag_added`, `conversation_analyzed`, `analyse_devient`, `risque_eleve` et `avant_date`.
  - **Pour toute copie** :
    - `enabled` vaut `false` ;
    - aucune attestation d'accord marketing ;
    - `startNodeId`, `cooldownSeconds`, `maxFiresPerHour` et `conditionGroup` sont gardés ;
    - `possedePar` est nul.
  - **Clés et tags collectés** : clés des clauses du `conditionGroup`, clé de date d'un `avant_date`, clé d'un
    `analyse_devient` ; tag d'un `tag_added`.
- [ ] **Lancer** : rouge.
- [ ] **Implémenter `copierDeclencheurs`** : un `switch` exhaustif sur `AutomationTriggerKind` (`web/lib/partage/automations.ts`).
- [ ] **Relancer** : vert ; `npm run typecheck`.
- [ ] **Commit** de ces deux fichiers seulement.

### Tâche 3 : le plan de duplication et son empreinte (pur)

**Fichiers** : créer `src/ops/duplication/plan.ts` ; test `tests/ops-duplication-plan.test.ts`.

**Interfaces** :
- Consomme : `copierGraphe`, `copierDeclencheurs`, `UserFieldDef` (`src/crm/types.ts`), `createHash` de `node:crypto`.
- Produit :
  - **`EtatDuplication`**, assemblé par la route de la tâche 5 :
    - `source: { id; nom }` et `destination: { id; nom; codeClient }` ;
    - `scenario: { id; nom; graphe }` ;
    - `automationsDuScenario` et `automationsDeLaDestination` ;
    - `champsSource: UserFieldDef[]` et `champsDestination: UserFieldDef[]` ;
    - `nomsPrisDestination: string[]` ;
    - `templatesDestination: Array<{ nom; langue; statut }> | null`, où `null` = pas de WABA ;
    - `offreOuvreScenarios: boolean`.
  - **`PlanDuplication`** :
    - `nomCopie` ;
    - `graphe: GrapheCopie` ;
    - `declencheurs: DeclencheursCopies` ;
    - `champsACreer: UserFieldDef[]` ;
    - `champsEnConflit: Array<{ cle; typeSource; typeDestination }>` ;
    - `templatesAbsents` et `templatesNonApprouves` ;
    - `signaux: string[]` ;
    - `blocages: string[]` ;
    - `empreinte: string`.
  - **`planifierDuplication(etat: EtatDuplication): PlanDuplication`**. Le nom qu'il propose est indicatif :
    `ecrire` refait la boucle sous le verrou, et le nom qu'elle rend fait foi.

- [ ] **Écrire les tests** :
  - **Champs** :
    - une clé absente de la destination entre dans `champsACreer`, avec la définition de la SOURCE (libellé, type) ;
    - même type des deux côtés : ni créé ni signalé ;
    - autre type : `champsEnConflit`, sans blocage.
  - **Clé sans définition dans la source** : elle n'est pas créée, et elle est signalée (« champ inconnu de la source »).
  - **Blocages** :
    - `templatesDestination === null` : blocage « l'espace de destination n'a pas de WABA » ;
    - template absent : blocage, qui nomme le template et sa langue ;
    - source = destination : blocage.
  - **Signaux** :
    - template présent mais pas approuvé ;
    - offre de la destination qui n'ouvre pas `scenarios`.
  - **Nom de la copie** : « Accueil » donne « Accueil (copie) » ; « Accueil (copie) » déjà pris donne
    « Accueil (copie 2) ». La comparaison se fait sans la casse ni les espaces aux bords, comme `nomPrisSousVerrou`.
  - **Empreinte** : identique pour deux états identiques ; différente dès que le graphe, un champ, un déclencheur ou
    un template change.
- [ ] **Lancer** : rouge.
- [ ] **Implémenter `planifierDuplication`**. L'empreinte est le SHA-256 du JSON du plan sans l'empreinte, clés
  triées pour ne pas dépendre de l'ordre de lecture.
- [ ] **Relancer** : vert ; **commit**.

### Tâche 4 : les écritures en une transaction

**Fichiers** :
- créer `src/ops/duplication/store.pg.ts` ;
- modifier `src/workflow/store.pg.ts` et `src/automation/store.pg.ts` ;
- tests `tests/integration/ops-duplication.test.ts` et `tests/ops-duplication-store.test.ts`.

**Interfaces** :
- Consomme : `PgUserFieldStore` (accepte déjà `Pick<Pool, 'query'>`), `PgAutomationStore`, `grapheEditable`,
  `resolveTenantCode`, `makeCode`.
- Produit :
  - **`insererBrouillon(q: Pick<Pool, 'query'>, tenantId: string, name: string, graph: WorkflowGraph): Promise<{ id: string }>`**,
    exporté par `src/workflow/store.pg.ts` ; `PgWorkflowStore.insert` l'appelle avec `this.pool`, pour qu'il n'existe
    qu'un seul SQL.
  - **`nomPrisSousVerrou`**, exporté.
  - **`PgAutomationStore`**, désormais construit sur `Pick<Pool, 'query'>`.
  - **`class PgDuplicationStore`**, construit sur un `Pool` :
    - `espaces(): Promise<Array<{ id; nom; waba: boolean }>>` ;
    - `scenarios(tenantId): Promise<Array<{ id; nom }>>` : publics seulement, `systeme is null` ;
    - `lireEtat(source, scenarioId, destination): Promise<Omit<EtatDuplication, 'templatesDestination' | 'offreOuvreScenarios'> | null>`.
      Il lit la base seulement ; `null` veut dire espace ou scénario inconnu, ou scénario hors de la source. La
      présence d'une WABA (`espaces`) se lit à la même source que `getTenantWabaId` (`src/campaign/store.pg.ts`) ;
    - `ecrire(destination: string, plan: PlanDuplication): Promise<{ scenarioId: string; nom: string }>`.

- [ ] **Écrire les tests d'intégration** (Postgres de la CI, JAMAIS en local, car le `.env` vise l'ancienne base de
  production) :
  - **`ecrire`** :
    - crée le scénario en brouillon seulement (`graph` reste nul) ;
    - crée les champs et les automations éteintes ;
    - n'écrit RIEN dans la source (comptes de lignes avant et après).
  - **Transaction** : un échec provoqué à l'insertion de la dernière automation ne laisse ni champ ni scénario.
  - **Nom** : deux copies successives rendent « X (copie) » puis « X (copie 2) ».
  - **`lireEtat`** :
    - rend `null` pour le scénario d'un troisième espace et pour le scénario système ;
    - lit le BROUILLON quand il diffère du publié.
  - Enfin, le test existant de `PgWorkflowStore.insert` reste vert (même SQL).
- [ ] **Écrire le test unitaire du store** (`tests/ops-duplication-store.test.ts`), avec un faux client dont la
  méthode lit `this` : `ecrire` ouvre UNE transaction (`begin`, puis `commit`, ou `rollback` sur erreur), et toutes ses
  requêtes passent par le client qui la tient, jamais par le pool.
- [ ] **Implémenter `PgDuplicationStore`**. Ordre d'écriture dans `ecrire` :
  1. `begin` ;
  2. `nomPrisSousVerrou` (la boucle « (copie N) » sous le verrou) ;
  3. `PgUserFieldStore(client).create` pour chaque champ à créer ;
  4. `insererBrouillon(client, …)` ;
  5. `PgAutomationStore(client).create` pour chaque déclencheur, `workflowId` = le nouveau scénario ;
  6. `commit`.
- [ ] **Vérifier** : `npm test` (unitaires) vert, `npm run typecheck`, `npm run lint`. Le test existant de
  `tests/automation-possession.test.ts` compile toujours (il passe un `Pool`). L'intégration se lit en CI (tâche 7).
- [ ] **Rayon de souffle** :
  - lister les appelants de `PgWorkflowStore.insert` et de `new PgAutomationStore(` ;
  - noter que `PgWorkflowStore` garde son `Pool`, parce que `creerPublieParApi` appelle `pool.connect()`.
- [ ] **Commit** de ces fichiers seulement.

### Tâche 5 : les routes `/ops`

**Fichiers** :
- créer `src/http/ops-duplication.ts` ;
- modifier `src/server.ts`, `src/index.ts` (câblage partagé) et `scripts/auto-attaque.mts` ;
- test `tests/ops-duplication.test.ts`.

**Interfaces** :
- Consomme : `PgDuplicationStore`, `planifierDuplication`, `auteurOps`, `estUuid`, `journaliser`, `VerrousCourts`.
- Produit `interface OpsDuplicationDeps` :
  - `store: Pick<PgDuplicationStore, 'espaces' | 'scenarios' | 'lireEtat' | 'ecrire'>` ;
  - `templatesDe(tenantId): Promise<Array<{ nom; langue; statut }> | null>`, par `templateClientForTenant`
    (`src/meta/factory.ts`) et `getTenantWabaId`, `null` sans WABA ;
  - `offreOuvreScenarios(tenantId): Promise<boolean>`, par `(await offres.offreDe(tenantId)).droits.fonctions.has('scenarios')` ;
  - `declareTags(tenantId, tags): Promise<void>` ;
  - `verrous: Pick<VerrousCourts, 'prendre' | 'relacher'>`.
- Produit `registerOpsDuplication(app, deps: OpsDuplicationDeps, garde: PreHandler): void`, avec quatre routes :
  - **`GET /ops/duplication/espaces`** : `{ espaces }`.
  - **`GET /ops/duplication/espaces/:tenantId/scenarios`** : `{ scenarios }`.
  - **`POST /ops/duplication/apercu`** :
    - corps `{ source, scenarioId, destination }` ;
    - rend 200 `{ apercu: PlanDuplication }`, sans le graphe (seulement les blocs débranchés, par nom).
  - **`POST /ops/duplication`** :
    - corps `{ source, scenarioId, destination, empreinte }` ;
    - succès : 201 `{ scenarioId, nom, debranches, champsCrees, declencheursCopies, declencheursRetires }`, puis tags
      déclarés au mieux, puis `journaliser('info', 'scenario duplique', { par, source, destination, scenarioId, copie })`.

- [ ] **Écrire les tests** (faux store, fausse lecture Meta, garde de `tests/gardes.ts`) :
  - **Garde** : sans la garde d'exploitation, chaque route refuse.
  - **Validation** : un id non UUID rend 404 ; un corps invalide rend 400.
  - **Scénario hors de la source** : `lireEtat` rend `null`, la route rend 404.
  - **WABA illisible** : la lecture Meta qui lève rend un 422 lisible, jamais un 5xx ni « aucun template ».
  - **Blocage** : l'exécution rend 422 avec la liste ; rien n'est écrit.
  - **Empreinte périmée** : 409, « le scénario a changé : relancez l'aperçu » ; rien n'est écrit.
  - **Double clic** : la prise du verrou rend `null`, la route rend 409.
  - **Panne** : `ecrire` qui lève rend 422, et le verrou est relâché.
  - **Succès** : 201 ; le journal porte `par`.
  - **Tags** : un échec de `declareTags` ne change pas le 201.
- [ ] **Lancer** : rouge. **Implémenter** sur le modèle de `src/http/ops-suppression.ts` :
  - la route assemble `EtatDuplication` à partir de `store.lireEtat`, `templatesDe` et `offreOuvreScenarios`, puis
    appelle `planifierDuplication` ;
  - l'exécution refait cet assemblage et compare l'empreinte avant toute écriture ;
  - le verrou porte la clé `duplication-scenario:<destination>`, avec un bail de 2 minutes.
- [ ] **Câbler**. Dans `src/server.ts` :
  - ajouter `opsDuplication?: OpsDuplicationDeps` ;
  - et `entree('opsDuplication', 'session-ops', deps.opsDuplication, (app, d, g) => registerOpsDuplication(app, d, g.ops))`.

  Dans `src/index.ts`, construire les deps à côté de `suppressionEspace`. Dans `scripts/auto-attaque.mts`, ajouter
  `opsDuplication: inconnu('opsDuplication')`.
- [ ] **Vérifier** :
  - `npx vitest run tests/ops-duplication.test.ts tests/scope-tenant.test.ts` : vert ;
  - `npm run auto-attaque` : vert ;
  - `npm run typecheck` et `npm run lint` : propres.
- [ ] **Commit** de ces fichiers seulement, après `git diff` relu dans la même commande.

### Tâche 6 : l'onglet « Dupliquer »

**Fichiers** :
- créer `web/components/OpsDuplication.tsx` ;
- modifier `web/app/ops/page.tsx` et `web/lib/api/compte.ts` ;
- test `web/e2e/ops-duplication.spec.ts`, sur le modèle de `web/e2e/ops-credits.spec.ts`.

**Interfaces** :
- Consomme les quatre routes de la tâche 5.
- Produit :
  - dans `compte.ts` : `lireEspacesDuplicationOps`, `lireScenariosOps`, `apercuDuplicationOps` et
    `dupliquerScenarioOps`, chacun `(sessionOps, …)` par `appelOps` ;
  - `OpsDuplication({ jeton, onPerdue })`, rendu quand `onglet === 'dupliquer'`.

- [ ] **Écrire l'e2e** (faux serveur) :
  - **Parcours** : trois listes déroulantes, l'aperçu qui s'affiche.
  - **L'aperçu montre** :
    - les blocs débranchés par nom ;
    - le champ à créer et le conflit de type ;
    - le mot-clé retiré ;
    - le template signalé.
  - **Bouton « Dupliquer »** : grisé quand l'aperçu porte un blocage.
  - **Résultat** : affiché après la duplication.
  - **Empreinte périmée** : un 409 affiche « relancez l'aperçu ».
  - **Session perdue** : un 401 ramène à la connexion (`onPerdue`).
- [ ] **Implémenter l'onglet** :
  - `ONGLETS` gagne `'dupliquer'`, et `MbaTabs` reçoit `{ key: 'dupliquer', label: t('Dupliquer', 'Duplicate') }` ;
  - l'espace source vide la liste des scénarios et l'aperçu ;
  - changer un choix efface l'aperçu.
- [ ] **Vérifier** :
  - l'e2e, sur un build de production servi à la main (`documentation.md`, l'e2e) ;
  - puis la suite RACINE entière, car des tests de la racine lisent `web/` ;
  - `cd web && npm run lint`.
- [ ] **Commit** des fichiers web seulement, séparé des commits serveur (la console se pousse après le déploiement de
  l'API).

### Tâche 7 : relecture, livraison, essai

- [ ] **Relecture** : une relecture indépendante du lot (`/revue`). Un rouge se corrige, son test est vérifié dans les
  deux sens, sans nouvelle relecture. Les jaunes vont dans `todo.md`.
- [ ] **Test d'isolation dans les deux sens** : retirer `tenant_id` de la lecture du scénario dans `lireEtat` doit
  rendre rouge le test « scénario d'un troisième espace ». Cette mesure ne tourne qu'en CI : elle demande l'accord de
  Julien pour un commit jetable. Sans cet accord, le compte rendu dit que le sens rouge n'est pas mesuré.
- [ ] **Docs** :
  - `documentation.md`, § `/ops` : l'onglet, ses routes, la règle « Meta en lecture seule au lot 1 » ;
  - `docs/JOURNAL-TECHNIQUE.md` : la livraison.

  Pas de `features.md`, car `/ops` n'est pas une fonction client.
- [ ] **Publier le serveur** : rebase de la copie sur `origin/main`, la suite racine, puis `git push origin
  <dernier commit serveur>:refs/heads/main`. Ensuite, `gh run view <id> --json jobs`, job par job : `unit`,
  `integration` et `securite` verts. Un rouge `toomanyrequests` se relance.
- [ ] **Déployer l'API** : `gh workflow run deploy-scaleway.yml --ref main -f migration=aucune -f commit=<sha>`, puis
  l'approbation de Julien.
- [ ] **Publier la console** : pousser le commit web APRÈS le déploiement, puis lire la CI `ci-web`. Vercel publie seul.
- [ ] **Essai réel** de la section « Méthode de livraison », inscrit dans `docs/prive/ESSAIS-REELS.md`.
