# Duplication de scénario entre espaces, lot 3 : plan d'implémentation

> **Pour l'exécutant** : un implémenteur exécute les tâches dans l'ordre, une relecture indépendante passe en fin de
> lot, puis Julien relit le diff. Les cases `- [ ]` suivent l'avancement.

**But** : dans l'onglet « Dupliquer » de `/ops`, les templates absents de la destination et les Flows ne bloquent plus
la duplication et n'arrivent plus forcément débranchés. Une case, décochée par défaut, les fait recréer chez Meta :
- un **template absent** est recréé dans la WABA de destination et soumis à l'approbation, sous le même nom, la même
  langue et la même catégorie ;
- un **Flow** est recréé dans la WABA de destination, et publié si celui de la source l'est.

Le lot emporte aussi les treize jaunes de la relecture du lot 2 (section de la duplication du `todo.md`).

**Architecture** : les lots 1 et 2 restent la colonne vertébrale (`planifierDuplication`, `PgDuplicationStore.ecrire`,
`/ops/duplication`). Ce lot ajoute une étape AVANT la transaction de base : « Meta d'abord, tout ou rien ».
- **Ce qui est pur** : le plan dit, pour chaque template et chaque Flow du scénario, s'il est réutilisé, recréable
  (avec sa case) ou non recréable (avec sa raison) ; une fonction pure traduit un template lu en demande de création.
- **Ce qui parle à Meta** : une orchestration crée les Flows, les publie, puis crée les templates par les chemins qui
  existent déjà (`creerFormulaire`, `publish`, `creerUnModele`). Au premier échec, elle s'arrête et rend ce qu'elle a
  déjà créé.
- **Ce qui écrit en base** : la transaction du lot 2, qui rebranche en plus les blocs Flow sur leurs copies.

**Stack** : Fastify, Postgres (`pg`), Zod, vitest, Next.js (console), Playwright (e2e).

**Spec** : [docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md](../specs/2026-11-16-duplication-scenario-entre-espaces-design.md),
sections « Templates chez Meta », « Ordre d'exécution » et « Lots », lot 3, avec la note du 2026-11-17. Plans des lots
1 et 2 : [lot 1](2026-11-16-duplication-scenario-lot-1.md), [lot 2](2026-11-17-duplication-scenario-lot-2.md).

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que ce lot crée chez Meta des objets qu'on ne rappelle pas :
un template soumis garde son nom un mois même supprimé, et un Flow publié ne se modifie plus. Le code touché porte des
invariants invisibles :
- les liens tracés d'un bouton URL appartiennent à UN espace (`tracked_links`), et un lien de la source recopié tel
  quel compterait les clics de la destination chez la source ;
- un bouton Flow exige un Flow PUBLIÉ de la même WABA, et une adresse de bouton à champ exige que ce champ existe
  avant la soumission ;
- le verrou court de la duplication doit couvrir toute la durée des appels à Meta.

Une relecture indépendante passe en fin de lot (`/revue`, avec sa section « Rayon de souffle »), puis Julien relit le
diff. L'intégration se prouve d'abord sur le banc PGlite, puis en CI.

**Essai réel qui clôt la fonction (le numéro se prend à l'inscription)** : celui de la spec, de la SANDBOX vers un
autre espace de test qui a une WABA, avec un « aller vers », un « assigner », un agent IA avec connaissance et outil,
un appel API à secret, un champ absent, un template absent à en-tête image, un Flow et un e-mail ; puis le cas réel de
Julien, `audencia_campus` de la SANDBOX vers MUTAC (son template `audencia_campus_paris` absent de MUTAC). Vérifier le
récapitulatif, la copie inactive, les templates soumis puis approuvés chez Meta, le Flow publié ; puis publier,
activer, et jouer le scénario depuis le téléphone d'essai.

## Où on travaille

Dans la copie à part `<scratchpad>/mm-lot2` (worktree détaché), remise sur la tête d'`origin/main` avant de coder, avec
ses `node_modules` (vérifier d'abord que les verrous `package-lock.json` n'ont pas bougé). Commits locaux par
`git commit --only`, publication par rebase sur `origin/main` juste avant chaque push.

## Contraintes globales

- **Aucune migration** : tout ce qui se crée a déjà sa table (`flows`, `tracked_links`, `template_param_hints`).
- **Côté Meta** : aucun envoi de message, aucune suppression. Ce qui a été créé reste en place si la suite échoue, et
  la réponse le liste (choix de Julien, spec).
- **Réponses de l'API** : jamais de 5xx. Corps lu par Zod `safeParse` ; identifiants contrôlés par `estUuid`.
- **Isolation** : chaque lecture de la source filtre sur l'espace source, chaque écriture vise la destination ; un
  template recréé ne porte JAMAIS un lien tracé de la source.
- **Console** : textes `t('fr', 'en')`, vouvoiement, les formes et icônes existantes.
- **Rédaction** : pas de tiret cadratin ni demi-cadratin.

## Décidé (à contester avant le code)

**Par Julien, le 2026-11-17** :
1. **Une case par template absent** de la destination, décochée par défaut, comme pour l'agent IA. Décochée, le bloc
   qui l'envoie arrive débranché (son template vidé). Un template absent ne bloque donc plus la duplication.
2. **Templates et Flows dans ce même lot.** Un template à bouton Flow coche son Flow avec lui : la case du Flow est
   cochée et verrouillée tant que celle du template l'est.

**Par ce plan** :
3. **Non recréable, donc sans case et débranché**, avec sa raison au récapitulatif :
   - un bouton que la lecture ne rend pas tel quel (`boutonsNonRelus` : téléphone, code à copier, catalogue) ;
   - une catégorie que la création ne connaît pas (autre que `MARKETING` et `UTILITY`, donc `AUTHENTICATION`) ;
   - un média d'en-tête ou une image de carte de carrousel sans adresse relue ;
   - un bouton Flow dont le Flow source n'est pas recréable (sans écrans, ou inconnu de la base de la source).
4. **La lecture de la source passe par `listerModeles`**, qui remet l'adresse d'origine à la place de nos liens
   tracés : la source n'est jamais recopiée avec un code `/r/` de son espace.
5. **La recréation passe par `creerUnModele`** pour l'espace de destination, la création même de l'écran Modèles :
   - de nouveaux liens tracés naissent dans la destination ;
   - les indications de variables de la source (`indices.get`) sont recopiées ;
   - la durée de validité (`ttlSecondes`) suit ;
   - l'en-tête média et les images de carrousel sont téléchargés depuis l'adresse relue, puis déposés pour la
     destination (`telechargerEntete`, `deposerEntete`, une place de `placesEntete` tenue par fichier) ;
   - un en-tête texte à variable reprend l'exemple générique de `buildComponents`, la lecture ne rendant pas celui de
     la source.
6. **Un Flow coché** est recréé par `creerFormulaire` sous un nom libre de la destination (« (copie) » sinon), avec son
   `mapping` et ses champs ; il est **publié** si celui de la source l'est (`publish`, puis `markPublished`), puisqu'un
   bloc Flow et un bouton Flow n'envoient qu'un Flow publié.
7. **L'ordre d'exécution**, après le contrôle de l'empreinte :
   1. les champs que nomment les adresses des boutons des templates cochés : la création les exige, et la lit hors
      de toute transaction ;
   2. les Flows cochés, créés puis publiés ;
   3. les templates cochés, chacun avec l'identifiant de son Flow recréé ;
   4. la transaction du lot 2, qui rebranche aussi les blocs Flow (`flowId`, `flowName`) sur leurs copies.

   Au premier refus chez Meta, l'exécution s'arrête : 422, avec la liste de ce qui a été créé chez Meta. Restent
   alors les champs de l'étape 1, les lignes locales des Flows (`creerFormulaire` les écrit) et les liens tracés
   des templates acceptés, qui suivent ce qui existe vraiment chez Meta.
8. **Un plafond de 10 templates et Flows à recréer par duplication**, refusé dès le récapitulatif : chaque objet coûte
   quelques secondes chez Meta, et Cloudflare coupe une requête au bout de 100 s. Le bail du verrou court passe de 2 à
   5 minutes (`BAIL_DUPLICATION_MS`).
9. **Le résultat** liste les templates soumis avec leur statut (en attente d'approbation) et les Flows créés ou
   publiés ; la trace `ops.scenario_duplique` les nomme aussi.
10. **Les treize jaunes du lot 2** partent avec ce lot (tâche 6), dont la case de requête que la route refuse et
    l'empreinte qui hache tous les templates de la source : seuls ceux que le scénario désigne y entrent désormais.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/ops/duplication/meta.ts` (neuf) | Pur : l'état des templates et Flows du scénario, la raison d'un non recréable, la traduction d'un template lu en `CreateTemplateInput` |
| `src/ops/duplication/meta-execution.ts` (neuf) | L'orchestration chez Meta : champs, Flows, templates, arrêt au premier refus |
| `src/ops/duplication/plan.ts` | Les templates et Flows dans l'aperçu, les choix bornés, le plafond, l'empreinte restreinte aux templates désignés |
| `src/ops/duplication/graphe.ts` | `rebrancher` pose aussi les Flows copiés ; un template décoché vide son bloc |
| `src/ops/duplication/store.pg.ts`, `dependances.pg.ts` | Les Flows de la source lus (écrans, publication), et les jaunes du lot 2 |
| `src/http/ops-duplication.ts`, `src/index.ts` | `dupliquer` gagne `templates` et `flows` ; l'orchestration avant `ecrire` ; le bail ; les messages |
| `web/lib/api/compte.ts`, `web/components/OpsDuplication.tsx` | Les cases des templates et des Flows, la liaison, le résultat |
| `tests/ops-duplication-*.test.ts`, `tests/integration/ops-duplication.integration.test.ts`, `web/e2e/ops-duplication.spec.ts` | Les tests des tâches |

## À surveiller en revue (non couvert d'office)

1. **Un template recréé à l'identique, forme par forme** : en-tête texte à variable, en-tête image, vidéo et document,
   carrousel, bouton URL tracé, bouton URL à champ, bouton Flow, réponses rapides, pied de page, durée de validité.
   Une fixture par forme en tâche 2.
2. **Aucun lien de la source dans la destination** : un template de la source à lien tracé est recréé avec l'adresse
   d'origine, et le lien neuf est alloué dans la destination. Test en tâches 2 et 3.
3. **Un refus au milieu** : Flow créé, premier template accepté, second refusé. 422 qui liste le Flow et le premier
   template, aucune transaction de base, jamais de 5xx. Test en tâche 3.
4. **Un template apparu dans la destination** entre l'aperçu et l'exécution : 409 « relancez l'aperçu », rien créé
   chez Meta. Test en tâche 4.
5. **La durée** : le plafond refuse au récapitulatif, et le verrou tient toute l'exécution. Test en tâches 1 et 4.

---

### Tâche 1 : les templates et les Flows dans le plan (pur)

**Fichiers** : créer `src/ops/duplication/meta.ts` ; modifier `src/ops/duplication/plan.ts` ; tests
`tests/ops-duplication-meta.test.ts` et `tests/ops-duplication-plan.test.ts`.

**Interfaces** :
- `EtatDuplication` gagne `flowsSource: FlowSource[]` (id, nom, écrans présents ou non, publié ou non) et
  `nomsPris.flows`.
- `pourquoiNonRecreable(t: TemplateSummary, flows: FlowSource[]): RaisonNonRecreable | null`.
- `ApercuDependances` gagne `templates` (nom, langue, `etat` : `reutilise` | `a_recreer` | `non_recreable`, la raison,
  le Flow lié) et `flows` (nom, nom de la copie, publié).
- `ChoixDependances` gagne `templates: Array<{ nom: string; langue: string }>` et `flows: string[]` ; un template coché
  emporte son Flow ; un choix hors de l'aperçu rend `choixInvalides`.
- Le plafond : plus de 10 objets cochés à recréer rend un blocage nommé.

- [ ] **Écrire les tests** : un template absent devient `a_recreer`, décoché il débranche son bloc ; chaque raison de
  non recréable ; le template à bouton Flow emporte son Flow ; le plafond ; l'empreinte ne change pas quand un
  template que le scénario ne désigne pas apparaît dans la source, mais change quand un template désigné apparaît
  dans la destination.
- [ ] **Lancer** : rouge. **Implémenter** ; relancer : vert ; `npm run typecheck`.
- [ ] **Commit**.

### Tâche 2 : traduire un template lu en demande de création (pur)

**Fichiers** : `src/ops/duplication/meta.ts` ; test `tests/ops-duplication-meta.test.ts`.

**Interfaces** : `versDemandeDeCreation(t: TemplateSummary, flowCopie: string | null): { input: CreateTemplateInput; medias: MediaARedeposer[] }`,
où `MediaARedeposer` dit l'adresse relue, le format et la place (en-tête ou carte `i`) ; la demande garde ces places
vides jusqu'au dépôt.

- [ ] **Écrire les tests**, une fixture par forme de la § « À surveiller » (1) : nom, langue, catégorie, corps et
  exemples, pied de page, boutons dans l'ordre, durée de validité ; un bouton URL garde l'adresse d'origine que
  `listerModeles` a remise ; un bouton Flow prend l'identifiant de la copie.
- [ ] **Implémenter** ; vert ; **commit**.

### Tâche 3 : l'orchestration chez Meta

**Fichiers** : créer `src/ops/duplication/meta-execution.ts` ; test `tests/ops-duplication-meta-execution.test.ts`.

**Interfaces** : `executerChezMeta(deps, source, destination, plan): Promise<{ ok: true; flows: Map<string, { id: string; nom: string }>; templates: TemplateSoumis[] } | { ok: false; refus: string; crees: CreationMeta[] }>`,
avec `deps` = `DepsGestionModeles` et `DepsCreationModele` de la destination, le client de Flows de la destination,
la persistance des Flows, le magasin des champs.

- [ ] **Écrire les tests**, contre des faux qui notent l'ordre des appels : champs, puis Flows (création, publication si
  publiée à la source), puis dépôt des médias, puis `creerUnModele` avec les indications de la source ; un refus au
  second template rend `ok: false` avec le Flow et le premier template ; un dépôt de média qui échoue arrête avant la
  soumission ; un lien tracé est alloué dans la destination, jamais dans la source.
- [ ] **Implémenter** ; vert ; **commit**.

### Tâche 4 : la route, le rebranchement des Flows, le verrou

**Fichiers** : `src/ops/duplication/graphe.ts`, `store.pg.ts`, `dependances.pg.ts`, `src/http/ops-duplication.ts`,
`src/index.ts` (câblage partagé : annoncé avant, rebasé avant le push) ; tests `tests/ops-duplication-graphe.test.ts`,
`tests/ops-duplication.test.ts`, `tests/integration/ops-duplication.integration.test.ts`.

- [ ] **Écrire les tests** :
  - **graphe** : un bloc Flow coché prend l'identifiant et le nom de la copie ; un template décoché vide son bloc, qui
    entre dans `debranches` ;
  - **route** : l'orchestration précède `ecrire` ; son refus rend 422 avec la liste, sans `ecrire` ; un template apparu
    dans la destination rend 409 sans aucun appel à Meta ; le bail de 5 minutes ;
  - **intégration** (banc PGlite, puis CI) : les Flows de la source lus dans l'espace source seulement ; un bloc Flow
    rebranché dans la copie.
- [ ] **Implémenter** ; `npm run auto-attaque`, `npm run typecheck`, `npm run lint` ; **commit**.

### Tâche 5 : l'onglet

**Fichiers** : `web/lib/api/compte.ts`, `web/components/OpsDuplication.tsx` ; e2e `web/e2e/ops-duplication.spec.ts`.

- [ ] **Écrire l'e2e** : une case par template à recréer et par Flow, décochées ; un template non recréable sans case,
  avec sa raison ; cocher un template à bouton Flow coche et verrouille son Flow ; le corps envoyé porte les cases ; le
  résultat liste les templates soumis et les Flows ; un refus liste ce qui a été créé chez Meta.
- [ ] **Implémenter** ; **vérifier** sur un build de production servi à la main : cet e2e, tous les `e2e/ops-*`, la
  suite racine entière, `npm run lint` dans `web/`.
- [ ] **Commit** des fichiers web seulement (poussé APRÈS le déploiement de l'API).

### Tâche 6 : les jaunes du lot 2

**Fichiers** : ceux que nomme la section de la duplication du `todo.md`.

- [ ] Une case de requête seulement pour une requête qu'un bloc désigne ; les autres sous leur agent.
- [ ] Les références filtrées par `estUuid` avant `lireDependances`.
- [ ] `secret_publie_le` remis à `null` à la copie d'une source.
- [ ] Les champs que créera chaque dépendance, au récapitulatif.
- [ ] `scenariosDeLaCible` partagé avec `src/agent/catalog.pg.ts`, la liste des handlers à cible tirée d'`exigeUneCible`.
- [ ] Un test d'intégration par `copierX` avec l'identifiant d'un troisième espace : levée, zéro ligne.
- [ ] Les `gestes` des outils copiés lus : leurs tags déclarés, leurs clés de champ créées.
- [ ] Une action qui vise un bloc absent de la copie : `cible_illisible`.
- [ ] L'empreinte comparée avant les choix (409 avant 400).
- [ ] `copiees` tolère une réponse sans `dependancesCopiees`.
- [ ] Une destination dont l'offre n'ouvre pas l'agent IA, signalée quand un agent est proposé.
- [ ] Les textes : JSDoc de `listNoms` et de `renderText`, en-tête de `src/http/ops-duplication.ts`,
  `estImageDeLEspace` restreint à nos hôtes ; et « réessayez » distingué d'une WABA sans jeton.
- [ ] Chaque point avec son test, vu rouge sans son correctif ; **commit**.

### Tâche 7 : relecture, livraison, essai

- [ ] **Relecture** : une relecture indépendante du lot (`/revue`). Les rouges sont corrigés, les jaunes vont au
  `todo.md`.
- [ ] **Docs** : `documentation.md` (§ « Dupliquer un scénario dans un autre espace », sans récit), `features.md` (la
  puce de l'onglet, plus rien « à venir »), `docs/JOURNAL-TECHNIQUE.md`, `todo.md`.
- [ ] **Publier le serveur** par rebase sur `origin/main`, la suite racine, le push, la CI lue job par job.
- [ ] **Déployer** (`migration=aucune`, `-f commit=<sha>`) : Julien approuve. Puis la fumée en production.
- [ ] **Publier la console** après le déploiement, puis sa CI.
- [ ] **L'essai réel**, inscrit dans `docs/prive/ESSAIS-REELS.md` sous le prochain numéro libre.
