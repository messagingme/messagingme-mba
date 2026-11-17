# Duplication de scénario entre espaces, lot 2 : plan d'implémentation

> **Pour l'exécutant** : un implémenteur exécute les tâches dans l'ordre, une relecture indépendante passe en fin de
> lot, puis Julien relit le diff. Les cases `- [ ]` suivent l'avancement.

**But** : dans l'onglet « Dupliquer » de `/ops`, des cases cochent ce qui part AVEC le scénario dans la destination,
au lieu d'y arriver débranché :
- l'agent IA d'un bloc `agent`, avec sa fiche, sa connaissance et ses outils, désactivés ;
- l'appel API d'un bloc `http`, avec sa requête et sa source, secret compris ;
- le modèle d'e-mail d'un bloc `email`.

Le lot emporte aussi les onze jaunes de la relecture du lot 1.

**Architecture** : le lot 1 reste la colonne vertébrale (`copierGraphe`, `planifierDuplication`, `PgDuplicationStore`,
`/ops/duplication`).
- **Ce qui est pur** : le graphe dit quelles dépendances il référence ; le plan calcule, pour les cases cochées, ce
  qui sera créé et sous quel nom ; une fonction pure rebranche le graphe sur les nouveaux identifiants.
- **Ce qui écrit** : la base copie chaque dépendance par un `INSERT … SELECT` filtré sur l'espace source, dans la MÊME
  transaction que le scénario. Le secret d'une source est recopié chiffré, jamais déchiffré.
- **Meta** : toujours en lecture seule (les templates et Flows sont le lot 3).

**Stack** : Fastify, Postgres (`pg`, pgvector), Zod, vitest, Next.js (console), Playwright (e2e).

**Spec** : [docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md](../specs/2026-11-16-duplication-scenario-entre-espaces-design.md),
section « Lots », lot 2. Plan du lot 1 : [2026-11-16-duplication-scenario-lot-1.md](2026-11-16-duplication-scenario-lot-1.md).
Code lu sur `origin/main` le 2026-11-17 (`c27c6bc0`).

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que ce lot recopie d'un espace client à un autre des
SECRETS (clé d'une source d'API, en-têtes en clair) et des agents qui répondent à de vrais contacts une fois activés.
Le code touché porte des invariants invisibles :
- le consentement d'un outil, tenu en base (`actif = false or active_par is not null`) ;
- des unicités par espace, insensibles à la casse sauf pour les modèles d'e-mail ;
- le motif des noms d'outils (`^[a-z0-9_]{1,64}$`) ;
- l'isolation entre espaces sur chaque `INSERT … SELECT`.

Une relecture indépendante passe en fin de lot (`/revue`, avec sa section « Rayon de souffle »), puis Julien relit le
diff.

**Essai réel qui clôt le lot (essai 267)** : de la SANDBOX vers un autre espace de test qui a une WABA, un scénario
qui contient un bloc agent IA, un bloc Appel API et un bloc e-mail.
- **L'agent** a deux fiches de connaissance, une action et un outil d'appel API.
- **L'appel API** passe par une source à secret.
- **Toutes les cases sont cochées** à la duplication.

Dans la destination, on vérifie :
- l'agent en brouillon, ses fiches trouvées par la recherche du bac à sable ;
- ses outils désactivés, que Julien active à la main ;
- la requête qui passe « Tester » avec le secret recopié ;
- le modèle d'e-mail présent, la boîte d'envoi à choisir ;
- la ligne « Scénario dupliqué par Messaging Me » du journal d'activité.

Puis on publie, on active l'agent, et on le fait répondre depuis le téléphone d'essai.

## Où on travaille

Dans la copie à part déjà créée, `<scratchpad>/mm-lot2` (worktree détaché d'`origin/main`, accord de Julien du lot 1),
avec ses propres `node_modules` installés par `npm ci` (le `node_modules` partagé manque des paquets du verrou). On fait
des commits locaux par `git commit --only`, puis on publie par rebase sur `origin/main` juste avant chaque push.

## Contraintes globales

- **Aucune migration** : toutes les tables existent.
- **Côté réseau** : aucun envoi WhatsApp, aucun événement d'automation, aucune écriture chez Meta.
- **Réponses de l'API** : jamais de 5xx. Corps lu par Zod `safeParse` ; identifiants contrôlés par `estUuid`.
- **Isolation** : chaque lecture de la source filtre sur l'espace source, chaque écriture sur la destination.
- 🔴 **Un `INSERT … SELECT` porte les DEUX filtres** : `where id = $x and tenant_id = $source`, et l'espace de
  destination en valeur écrite. Ne rien insérer (0 ligne) lève, et la transaction est annulée.
- **Secrets** : jamais déchiffrés, jamais rendus par l'aperçu (seulement « secret copié » par source), jamais
  journalisés.
- **Nommage** : le même nom s'il est libre dans la destination, sinon « X (copie) », puis « X (copie 2) ».
  - La comparaison suit l'unicité de la table : insensible à la casse pour les agents, requêtes et sources, sensible
    pour les modèles d'e-mail.
  - Un outil prend `nom_copie`, puis `nom_copie_2`, tronqué pour rester sous 64 caractères.
- **Console** : textes `t('fr', 'en')`, vouvoiement, les formes et icônes existantes.
- **Rédaction** : pas de tiret cadratin ni demi-cadratin.

## Décidé par ce plan (à contester avant le code)

1. **Ce qui suit l'agent** :
   - sa fiche, ses réglages et sa connaissance avec ses vecteurs et leur modèle : aucune revectorisation, donc rien
     débité ;
   - ses outils maison et ses actions, avec `agent_id` = la copie ;
   - ses outils d'appel API, avec leur requête et leur source.

   **Ne suivent pas** : sa clé Gateway, ses sessions, son historique, sa conversation de construction, ses essais.
   L'agent arrive en `draft`, et chaque outil a sa liaison `agent:<copie>` avec `actif = false` et `autonome = false`.
2. **Les outils MCP ne suivent pas** : ils sont déclarés par un serveur MCP et resynchronisés. Ils sont signalés au
   récapitulatif, à reconnecter dans la destination.
3. **Un outil maison qui vise un scénario** (envoyer un bloc, lancer, enchaîner) :
   - s'il vise le scénario COPIÉ, il est rebranché sur la copie : son `workflowId` et ses codes de bloc passent par la
     table des codes que rend `copierGraphe` ;
   - s'il vise un autre scénario, il ne suit pas et il est signalé.
4. **Le déclencheur « action d'agent »** ne suit toujours pas, même quand l'agent est copié (règle du lot 1 gardée) :
   rebrancher une automation sur une action copiée est laissé à une demande explicite.
5. **Une requête recopiée** garde ses en-têtes (le secret compris, choix de Julien), mais PAS ses `valeurs_test` : des
   valeurs d'essai peuvent être celles d'un vrai contact de la source.
6. **Une source recopiée** garde son statut et la date de publication de son secret. `last_ok_at` et `last_error` sont
   remis à vide : elle n'a jamais été essayée depuis la destination.
7. **Des champs se créent aussi pour les dépendances** :
   - les variables d'origine `champ` d'une requête copiée (`lireVariables`) ;
   - les `{{clé}}` du sujet et du corps d'un modèle d'e-mail copié (le motif de `src/workflow/wiring.ts`, exporté) ;
   - les clés de champ et les tags que visent les outils maison copiés.

   Pour un e-mail, c'est une exception à la décision 5 du lot 1 : ses variables ont une syntaxe sans ambiguïté.
8. **Le bloc e-mail** reçoit le modèle copié, mais sa boîte d'envoi reste vide : il reste listé « à rebrancher ».
9. **Les choix sont bornés** : une case cochée doit désigner une dépendance que le plan a trouvée dans le scénario
   source. Sinon, 400, et rien n'est lu au-delà. Cocher un agent emporte ses requêtes et sources sans case de plus.
10. **Un template homonyme dont les boutons diffèrent** de ceux de la source est signalé, sans blocage. La comparaison
    lit aussi les templates de la WABA source ; si cette lecture échoue, on le signale (« boutons non comparés »).
11. **Les tags des clauses de condition** ne sont toujours pas déclarés dans la destination : le jaune du lot 1 se clôt
    sans changement, puisqu'un tag se pose par son nom et qu'une condition sur un tag inconnu est simplement fausse.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/ops/duplication/graphe.ts` | `referencesDuGraphe`, la table des codes, les images `/m/` ; `rebrancher` |
| `src/ops/duplication/plan.ts` | Les dépendances, leurs noms, leurs champs, les choix bornés ; les jaunes du plan |
| `src/ops/duplication/nommage.ts` (neuf) | `nomLibre`, `nomOutilLibre` |
| `src/ops/duplication/dependances.pg.ts` (neuf) | Les lectures des dépendances et leurs copies `INSERT … SELECT` |
| `src/ops/duplication/store.pg.ts` | `lireEtat` étendu, `ecrire` dans le nouvel ordre |
| `src/workflow/store.pg.ts` | `insererBrouillon(…, id?)` ; `listNoms(tenantId)`, léger |
| `src/automation/store.pg.ts` | `toutesPourLaDuplication` triée par `created_at, id` ; commentaire de `HORS_WEBHOOK` corrigé |
| `src/workflow/wiring.ts` | Le motif des `{{clé}}` d'un e-mail, exporté |
| `src/http/ops-duplication.ts` | Le corps `dupliquer`, la trace `ops.scenario_duplique`, les messages |
| `web/lib/partage/actions-journal.ts` | L'action `ops.scenario_duplique`, en deux langues |
| `src/index.ts` | `audit` dans les dépendances de la route |
| `web/lib/api/compte.ts`, `web/components/OpsDuplication.tsx`, `web/app/ops/page.tsx` | Les cases, les jaunes de l'onglet |
| `tests/ops-duplication-*.test.ts`, `tests/integration/ops-duplication.integration.test.ts`, `web/e2e/ops-duplication.spec.ts` | Les tests des tâches |

## À surveiller en revue (non couvert d'office)

1. **Une dépendance partagée** : une requête utilisée par le bloc `http` ET par un outil de l'agent, ou une source
   partagée par deux requêtes. Elle n'est copiée qu'une fois, et les deux pointent la même copie. Test en tâches 2 et 4.
2. **Un agent d'un troisième espace** dont l'id est glissé dans `dupliquer` : 400, rien lu ni écrit. Test en tâches 4
   et 5.
3. **Le secret** : le chiffré de la destination est identique, octet pour octet, à celui de la source, et il se
   déchiffre avec la même clé. Test en tâche 4.
4. **Une panne en route** (après l'agent, avant le scénario) ne laisse ni source, ni requête, ni agent, ni fiche dans
   la destination. Test en tâche 4.
5. **L'ordre des templates rendu par Meta, et deux déclencheurs créés dans la même transaction**, ne changent pas
   l'empreinte. Test en tâches 2 et 4.

---

### Tâche 1 : le graphe, ses références et son rebranchement (pur)

**Fichiers** : modifier `src/ops/duplication/graphe.ts` ; test `tests/ops-duplication-graphe.test.ts`.

**Interfaces** :
- Produit :
  - `type ReferenceDependance = { nodeId: string; sorte: 'agent' | 'requete' | 'modele_email'; id: string }` ;
  - `referencesDuGraphe(graphe: WorkflowGraph): ReferenceDependance[]`, qui lit les mêmes clés que `copierGraphe`
    vide : `agentId`, `requestId`, `templateId` d'un bloc `email` ;
  - `GrapheCopie` gagne :
    - `codes: ReadonlyMap<string, string>`, l'ancien code de bloc vers le nouveau ;
    - `imagesSource: string[]`, les `imageUrl` en `/m/` d'un `quick_message` ou d'un `rcs_message` ;
  - `interface Rebranchements { agents: ReadonlyMap<string, { id: string; nom: string }>; requetes: ReadonlyMap<string, { id: string; nom: string }>; modelesEmail: ReadonlyMap<string, string> }`,
    de l'id source vers la copie ;
  - `rebrancher(copie: GrapheCopie, references: ReferenceDependance[], r: Rebranchements): GrapheCopie`.
- Consomme : les fonctions du lot 1.

- [ ] **Écrire les tests** :
  - **Références** : un agent, une requête, un modèle d'e-mail sont rendus avec leur bloc. Une clé vide n'est pas une
    référence. Deux blocs sur le même agent donnent deux références.
  - **Codes** : chaque ancien code mène au nouveau du même bloc.
  - **Images** : une image `/m/` est listée, une adresse externe ne l'est pas.
  - **`rebrancher`** :
    - une copie d'agent met `agentId` et `agentLabel` du bloc, qui sort des `debranches` ;
    - même chose pour une requête (`requestId`, `requeteLabel`) ;
    - un modèle d'e-mail met `templateId` ; le bloc reste dans les `debranches`, avec la raison `email` (sa boîte) ;
    - un bloc sans copie reste vide et listé ;
    - la source n'est pas modifiée.
- [ ] **Lancer** `npx vitest run tests/ops-duplication-graphe.test.ts` : rouge.
- [ ] **Implémenter** ; relancer : vert ; `npm run typecheck`.
- [ ] **Commit** de ces deux fichiers seulement.

### Tâche 2 : les dépendances au plan, leurs noms et les jaunes du plan (pur)

**Fichiers** :
- créer `src/ops/duplication/nommage.ts` ;
- modifier `src/ops/duplication/plan.ts` ;
- tests `tests/ops-duplication-nommage.test.ts` et `tests/ops-duplication-plan.test.ts`.

**Interfaces** :
- **Noms** :
  - `nomLibre(nom: string, pris: Iterable<string>, casse: 'sensible' | 'insensible'): string` ;
  - `nomOutilLibre(nom: string, pris: Iterable<string>): string` : `nom_copie`, `nom_copie_2`, base tronquée à 64
    caractères au total.
- **`EtatDuplication` gagne `dependances`** :
  - `agents: AgentSource[]` (id, label, nombre de fiches, outils : id, nom, origine, cible `workflowId` s'il y en a,
    clés de champ et tags de la cible, requête et source s'il s'agit d'un appel) ;
  - `requetes: RequeteSource[]` (id, label, variables lues, source) ;
  - `sources: SourceSource[]` (id, label, `secret: boolean`) ;
  - `modelesEmail: ModeleEmailSource[]` (id, nom, sujet, corps).
- **`EtatDuplication` gagne aussi** :
  - `nomsPris` : les labels d'agents, de requêtes et de sources de la destination, les noms de ses modèles d'e-mail et
    ceux de ses outils d'espace ;
  - `templatesSource: TemplateDeLaWaba[] | null` ; `TemplateDeLaWaba` gagne `boutons: Array<{ type: string; texte: string }>`.
- **Choix** : `interface ChoixDependances { agents: string[]; requetes: string[]; modelesEmail: string[] }`.
- **`planifierDuplication(etat, choix?: ChoixDependances)`** rend `PlanDuplication`, qui gagne :
  - `dependances` : pour l'aperçu, tout ce que le scénario référence, avec le nom qu'aurait la copie, le secret,
    les outils qui suivraient et ceux qui ne suivraient pas, avec leur raison (`mcp`, `autre_scenario`) ;
  - `copies` : ce que les cases cochées font créer, dans l'ordre d'écriture ;
  - `choixInvalides: string[]` ;
  - `signaux` : les nouveaux s'ajoutent à la liste.

- [ ] **Écrire les tests** :
  - **Nommage** :
    - « Agent » libre reste « Agent » ; pris, il devient « Agent (copie) », puis « Agent (copie 2) » ;
    - « agent » contre « Agent » : pris en `insensible`, libre en `sensible` ;
    - `relance_crm` pris donne `relance_crm_copie` ;
    - un nom de 64 caractères reste sous 64 avec son suffixe.
  - **Plan** :
    - **Sans choix** : aucune copie, et l'aperçu liste chaque dépendance avec son nom de copie (comportement du lot 1
      inchangé).
    - **Choix d'un agent** : il copie ses outils et ses actions. Ses outils d'appel API copient leur requête et leur
      source, même non cochées. Un outil MCP est listé `mcp` et non copié. Un outil maison qui vise un autre
      scénario est listé `autre_scenario` ; celui qui vise le scénario copié suit.
    - **Partage** : une requête cochée ET utilisée par un outil de l'agent n'est copiée qu'une fois ; une source
      partagée par deux requêtes aussi.
    - **Champs** : une variable `champ` d'une requête copiée, un `{{ville}}` d'un modèle d'e-mail copié et la clé
      d'un outil maison copié entrent dans `champsACreer`, avec la définition de la source.
    - **Choix invalide** : un id hors des références rend `choixInvalides` non vide et AUCUNE copie.
    - **Secret** : une source à secret est marquée `secret: true` dans `dependances`.
    - **Jaunes du lot 1** :
      - l'empreinte est la même quel que soit l'ordre des templates rendus par Meta ;
      - un template homonyme dont les boutons diffèrent de la source donne un signal, sans blocage ;
      - `templatesSource === null` donne le signal « boutons non comparés » ;
      - une image `/m/` donne le signal « hébergée par l'espace source ».
- [ ] **Lancer** : rouge.
- [ ] **Implémenter**. L'empreinte reste calculée sur l'état lu, hors `choix`, avec les templates triés par (nom,
  langue) avant le hachage.
- [ ] **Relancer** : vert ; `npm run typecheck`.
- [ ] **Commit**.

### Tâche 3 : lire les dépendances, les noms pris, et les petits correctifs de base

**Fichiers** :
- créer `src/ops/duplication/dependances.pg.ts` ;
- modifier `src/ops/duplication/store.pg.ts`, `src/workflow/store.pg.ts` (`listNoms`, `insererBrouillon(…, id?)`),
  `src/automation/store.pg.ts` et `src/workflow/wiring.ts` ;
- tests `tests/integration/ops-duplication.integration.test.ts` (complété) et `tests/ops-duplication-store.test.ts`.

**Interfaces** :
- **Lecture** : `lireDependances(q: Pick<Pool, 'query'>, source: string, refs: ReferenceDependance[]): Promise<EtatDuplication['dependances']>`.
  - Chaque requête filtre `tenant_id = source`.
  - Les outils d'un agent sont ses liaisons `agent:<id>` ; les fiches sont comptées, pas lues.
- **Noms pris** : `nomsPris(q, destination): Promise<EtatDuplication['nomsPris']>`.
- **Scénarios** : `PgWorkflowStore.listNoms(tenantId): Promise<Array<{ id: string; name: string }>>`, sur les scénarios
  publics seulement, sans les graphes ; `scenarios()` et `lireEtat` l'utilisent à la place de `listResume`.
- **Déclencheurs** : `toutesPourLaDuplication` trie par `created_at, id`. Le commentaire de `HORS_WEBHOOK` dit
  désormais que cette lecture, réservée à la duplication, voit aussi les automations possédées.
- **Variables d'e-mail** : `src/workflow/wiring.ts` exporte le motif de ses `{{clé}}`.

- [ ] **Écrire les tests d'intégration** (Postgres de la CI, JAMAIS en local) :
  - `lireEtat` lit l'agent, ses outils, ses requêtes et sources, et le modèle d'e-mail du scénario ;
  - un agent d'un troisième espace, référencé par un graphe forgé, n'est pas lu (`dependances.agents` vide) ;
  - deux déclencheurs écrits dans la même transaction se lisent toujours dans le même ordre ;
  - `listNoms` ne rend pas le scénario du répondeur.
- [ ] **Implémenter les lectures**. Lire `agent_tool_sources.auth_secret_enc is not null` pour `secret`, jamais le
  chiffré.
- [ ] **Vérifier** : unitaires verts, `npm run typecheck`, `npm run lint`. L'intégration se lit en CI (tâche 6).
- [ ] **Commit**.

### Tâche 4 : copier les dépendances dans la même transaction

**Fichiers** : modifier `src/ops/duplication/dependances.pg.ts` et `src/ops/duplication/store.pg.ts` ; tests
`tests/ops-duplication-store.test.ts` et `tests/integration/ops-duplication.integration.test.ts`.

**Interfaces** (chaque copie prend le client `c` de la transaction et lève si elle n'insère rien) :
- `copierSource(c, source, destination, id, label): Promise<string>` : toutes les colonnes de configuration, chiffré
  compris, `last_ok_at` et `last_error` vides ;
- `copierRequete(c, source, destination, id, label, sourceCopiee): Promise<string>` : `valeurs_test` remis au défaut ;
- `copierModeleEmail(c, source, destination, id, nom): Promise<string>` ;
- `copierAgent(c, source, destination, id, label, outils, workflowCopie, codes): Promise<string>`, qui écrit :
  - l'agent en `draft` ;
  - ses fiches par UN `INSERT … SELECT`, vecteurs et provenance compris, colonne générée exclue ;
  - ses outils, leurs liaisons inactives, et les cibles rebranchées selon la décision 3 ;
- `PgDuplicationStore.ecrire(destination, nomSource, plan)` :
  1. tirer d'avance l'id du nouveau scénario (`randomUUID`) ;
  2. créer les champs ;
  3. copier les sources, les requêtes, les modèles d'e-mail, puis les agents ;
  4. insérer le scénario (`insererBrouillon` avec l'id tiré), son graphe passé par `rebrancher` ;
  5. écrire les déclencheurs ;
  6. `commit`.

  Le scénario s'écrit APRÈS les agents, et les agents connaissent déjà son id : c'est ce qui rompt la dépendance
  croisée entre les deux.

- [ ] **Écrire les tests** :
  - **Unitaire** (faux client à `this`) : l'ordre des écritures ci-dessus, tout par le client, `rollback` sur une panne
    provoquée à la copie de l'agent.
  - **Intégration** :
    - **Copie complète** :
      - l'agent en `draft`, ses fiches avec des vecteurs identiques, ses outils et ses liaisons `actif = false` ;
      - la requête, avec ses en-têtes et sans ses `valeurs_test` ;
      - la source, avec un `auth_secret_enc` identique octet pour octet, déchiffrable avec la même clé ;
      - le modèle d'e-mail ;
      - les blocs du scénario sur les copies ;
      - aucune ligne changée dans la source.
    - **Partage** : une requête partagée n'est copiée qu'une fois.
    - **Noms** : un homonyme de la destination donne « (copie) » ; un outil homonyme donne `_copie`.
    - **Rebranchement** : un outil maison qui envoie un bloc du scénario copié vise la copie et son nouveau code.
    - **Panne** : une panne après l'agent ne laisse RIEN dans la destination.
- [ ] **Implémenter** ; vérifier ; **commit**.

### Tâche 5 : la route, la trace et les messages

**Fichiers** :
- modifier `src/http/ops-duplication.ts`, `src/index.ts` et `web/lib/partage/actions-journal.ts` ;
- test `tests/ops-duplication.test.ts`.

**Interfaces** :
- `OpsDuplicationDeps` gagne `audit: AuditSink`. La route en tire `makeTraceOps`.
- `templatesDe` est appelée pour la source ET pour la destination.
- Le corps de `POST /ops/duplication` gagne `dupliquer?: { agents: string[]; requetes: string[]; modelesEmail: string[] }`,
  avec au plus 20 identifiants par liste, des UUID.
- L'aperçu rend `dependances`.
- Le catalogue gagne `'ops.scenario_duplique': ['Scénario dupliqué depuis un autre espace par Messaging Me', 'Scenario duplicated from another workspace by Messaging Me']`.

- [ ] **Écrire les tests** :
  - **Choix** : un id coché hors des références donne 400, et rien n'est écrit.
  - **Succès** : 201 avec les copies créées ; la trace `ops.scenario_duplique` est écrite DANS la destination,
    auteur = l'exploitant, détail sans donnée personnelle (le scénario et ce qui a été copié, par nom) ; le journal
    applicatif liste les sources dont le secret a été copié, par label.
  - **Tags** : un échec de leur déclaration est journalisé en `warn`, et le 201 reste.
  - **Messages** : une destination au jeton Meta invalide (`TokenInvalidError`) rend 422 avec « le jeton WhatsApp de
    l'espace de destination est invalide : reconnectez son numéro », pas « réessayez ».
- [ ] **Implémenter** ; `npm run auto-attaque`, `npm run typecheck`, `npm run lint` ; **commit**, après `git diff`
  relu dans la même commande. `src/index.ts` est un câblage partagé : on rebase avant de publier.

### Tâche 6 : l'onglet, ses cases et ses jaunes

**Fichiers** :
- modifier `web/components/OpsDuplication.tsx`, `web/lib/api/compte.ts` et `web/app/ops/page.tsx` (commentaire
  « Les quatre onglets ») ;
- e2e `web/e2e/ops-duplication.spec.ts`.

- [ ] **Écrire l'e2e** :
  - **Cases** :
    - une case par dépendance, décochée ;
    - le nom de la copie quand il change ;
    - « secret copié » à côté d'une source à secret ;
    - les outils qui ne suivront pas, avec leur raison ;
    - le corps envoyé porte les cases cochées.
  - **Jaunes** :
    - les listes sont grisées pendant la copie ;
    - choisir comme source l'espace déjà choisi en destination vide la destination ;
    - un échec du chargement des scénarios garde son message et propose « Réessayer ».
- [ ] **Implémenter**. Changer une case n'efface pas l'aperçu (elle n'entre pas dans l'empreinte) ; changer un des
  trois choix l'efface toujours.
- [ ] **Vérifier** :
  - l'e2e de l'onglet et tous les `e2e/ops-*`, sur un build de production servi à la main ;
  - la suite racine entière ;
  - `npm run lint` dans `web/` (c'est `next lint`).
- [ ] **Commit** des fichiers web seulement.

### Tâche 7 : relecture, livraison, essai

- [ ] **Relecture** : une relecture indépendante du lot (`/revue`). Les rouges sont corrigés, les jaunes vont dans
  `todo.md`.
- [ ] **Docs** :
  - `documentation.md` : la section « Dupliquer un scénario dans un autre espace » réécrite pour les dépendances, sans
    récit ;
  - `features.md` : la puce de l'onglet, où ne reste « à venir » que le lot 3 ;
  - `docs/JOURNAL-TECHNIQUE.md` : la livraison ;
  - `todo.md` : les jaunes du lot 1 traités retirés, et ce qui reste.
- [ ] **Publier le serveur** par rebase sur `origin/main`, puis la suite racine, le push et la CI lue job par job.
- [ ] **Déployer** (`migration=aucune`, `-f commit=<sha>`) : Julien approuve. Ensuite, contrôle en production.
- [ ] **Publier la console** après le déploiement, puis sa CI.
- [ ] **Essai réel 267**, inscrit dans `docs/prive/ESSAIS-REELS.md`.
