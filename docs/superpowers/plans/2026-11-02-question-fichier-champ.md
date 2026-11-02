# Ranger la réponse d'un bloc Question, pièce jointe comprise : plan

> **Pour l'exécutant :** méthode `superpowers:executing-plans` (ou `subagent-driven-development`), tâche par tâche, cases
> `- [ ]` à cocher. Plan court par règle du dépôt : tâches, interfaces, tests attendus, ordre de déploiement, pas de code.

**But :** un bloc Question reconnaît une pièce jointe par son type réel, range toute réponse dans un champ personnalisé,
et un bloc Appel API de scénario transmet la pièce par un lien fabriqué à l'appel, valable 15 minutes.

**Architecture :** la capture se fait dans `WorkflowExecutor.advance`, à partir du message entrant (type et MIME déjà
dans `InboundMessage.media`). Le champ reçoit une mention lisible ; une table relie (espace, contact, champ) au message
de Meta et à la mention exacte. Seul `creerAppelHttpScenario` remplace une mention encore vivante par un lien signé
`/f/<jeton>`, servi par l'API à partir du chemin existant (`lireMediaRecu`, `enTetesMedia`).

**Pile :** TypeScript, Fastify, pg-boss, Postgres, Next.js (console), vitest.

**Spec :** [docs/superpowers/specs/2026-11-02-question-fichier-champ-design.md](../specs/2026-11-02-question-fichier-champ-design.md)

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, avec une relecture indépendante en fin de lot. La raison : la
production emprunte ce chemin (l'avance d'un parcours sur chaque réponse, une route publique qui sert des pièces
d'identité, une migration lue par le chemin chaud), et le code porte des invariants qu'aucun test d'un seul fichier ne
voit (la capacité de fabriquer un lien donnée au seul chemin du scénario, la mention qui doit être encore celle du champ,
le refus de publier). Les critères sont testables, mais la sécurité du lien demande un œil. feature-loop écarté parce que
le rayon de souffle n'est pas faible.

**L'essai réel qui clôt la fonctionnalité** est celui de la spec (§ « Essai réel qui clôt la fonctionnalité ») : depuis un
vrai téléphone, sur l'espace SANDBOX, une photo de pièce reçue, rangée, transmise par un Appel API à un récepteur de test
qui télécharge les mêmes octets, puis les sept contre-épreuves (lien échu, texte, photo envoyée en fichier, vidéo non
cochée, champ réécrit, lectures de la fiche, publication refusée). Tant qu'il n'a pas tourné, la fonctionnalité est
verte, pas éprouvée.

## Contraintes globales

- Lien valable **15 minutes** après sa fabrication, réutilisable pendant ce délai ; au-delà des **7 jours** de Meta, « expiré ».
- Types : photo = `image/*` (envoyée comme image ou comme document), PDF = `application/pdf`, vidéo = `video/*`, vocal =
  `audio/*`, autre document = tout autre document ; **photo et PDF cochés par défaut** ; un sticker n'est jamais accepté.
- Un seul fichier par question. Un bloc Question sans les nouveaux réglages se comporte **exactement** comme avant.
- Aucune variable d'environnement nouvelle : la clé du jeton se dérive d'`AUTH_SECRET` (modèle :
  `src/emails-produit/desinscription.ts`).
- La route `/f/` rend toujours un 4xx, jamais un 5xx.
- Le lien ne sort que dans la requête d'un Appel API de scénario : jamais dans un champ, un journal, un `console.*`, un
  export, une réponse d'API, un prompt.
- Données du bloc dans `node.data` : `champReponse` (clé du champ), `champReponseLabel`, `rangerLigne` (booléen),
  `attendreFichier` (booléen), `genresFichier` (liste) ; handle de la sortie : `fichier`. Constantes partagées console et
  serveur dans `web/lib/partage/question-piece.ts`.
- Console : vouvoiement, pas de tiret cadratin ni demi-cadratin dans les textes et la doc.
- On part d'`origin/main` à jour (l'arbre partagé est en retard), on annonce aux sessions voisines avant d'éditer
  `src/index.ts`, `src/server.ts`, `src/worker.ts`, et ces fichiers se commitent en plomberie (CLAUDE.md du projet).

## Points de revue (non couverts par la spec, à tenir par un test)

1. **Meta redélivre le même message** : l'avance dédoublonne déjà (`lastMessageId`) ; l'écriture de la pièce est un
   upsert, donc rejouée sans doublon. Test en tâche 4.
2. **Le fil est tenu par un humain ou l'agent de Meta** (`mayAct` faux) : l'avance est gelée, rien n'est rangé. Test en tâche 4.
3. **La pièce arrive après l'échéance « Pas de réponse »** : aucun parcours n'attend, rien n'est rangé, le message va à
   l'Inbox comme aujourd'hui. Test en tâche 4.
4. **Le champ est réécrit par un autre chemin** (bloc Action, API, console, import) : l'Appel API envoie la valeur
   écrite, pas de lien. Test en tâche 6.
5. **Un jeton d'un espace présenté pour un message d'un autre espace**, ou altéré, ou échu : même refus générique, aucune
   trace écrite, aucun octet servi. Test en tâche 7.

---

### Tâche 1 : la table qui relie un champ à la pièce (lot 0, poussée SEULE)

**Fichiers :** créer `db/migrations/<numéro>_pieces_question.sql` (numéro lu par `npm run migrations` sur `origin/main`
à jour, jamais deviné) ; test d'intégration `tests/integration/pieces-question.test.ts`.

**Schéma :** `pieces_question (tenant_id uuid not null → tenants on delete cascade, contact_id uuid not null → contacts
on delete cascade, cle_champ text not null, meta_message_id text not null, mention text not null, cree_le timestamptz not
null default now(), primary key (tenant_id, contact_id, cle_champ))`.

- [ ] Vérifier comment la purge RGPD efface un contact (`src/crm/contact-store.pg.ts`) : suppression réelle, la cascade
      suffit ; anonymisation, la purge supprime aussi ses lignes de `pieces_question`, dans ce même lot.
- [ ] Écrire la migration, puis `npx vitest run tests/migration-directives.test.ts` : vert.
- [ ] Test d'intégration (CI seulement) : la suppression d'un contact emporte ses lignes ; la clé primaire refuse un
      doublon (espace, contact, champ).
- [ ] Commit `--only` de la migration et de son test, push seul, CI lue job par job (`gh run view <id> --json jobs`).
- [ ] Déploiement `gh workflow run deploy-scaleway.yml --ref main -f migration=avant`, approuvé par Julien, après
      `git log <déployé>..origin/main` et accord des sessions dont le code partirait avec.
- [ ] Relire en base point par point (colonnes, nullabilité, défauts, clés étrangères et `confdeltype`), sur la machine
      des workers.

### Tâche 2 : le classement et la mention (pur)

**Fichiers :** créer `web/lib/partage/question-piece.ts`, `src/workflow/question-piece.ts` ; test
`tests/workflow-question-piece.test.ts`.

**Produit :**
- `web/lib/partage/question-piece.ts` : `type GenrePiece = 'photo' | 'pdf' | 'document' | 'video' | 'vocal'`,
  `GENRES_PIECE`, `GENRES_PAR_DEFAUT = ['photo', 'pdf']`, `SORTIE_FICHIER = 'fichier'`.
- `classerPiece(typeMeta: string, mime: string | null): GenrePiece | null`.
- `mentionDePiece(recuLe: Date, fuseau: string, genre: GenrePiece): string` : « Pièce reçue le 02/11/2026 à 14 h 32 (photo) ».
- `reglagesQuestion(node: WorkflowNode): { champ: string | null; rangerLigne: boolean; genres: GenrePiece[] | null }`
  (`genres` nul quand `attendreFichier` est faux ; liste vide ou illisible = `GENRES_PAR_DEFAUT`).
- `refusFichierSansSuite(graph: WorkflowGraph): string | null` : la raison lisible quand un bloc Question attend un
  fichier sans arête `fichier`.

- [ ] Tests d'abord : `image` + `image/jpeg` → photo ; `document` + `image/jpeg` → photo ; `document` + `image/heic` →
      photo ; `document` + `application/pdf` → pdf ; `document` + `application/msword` → document ; `video` + `video/mp4`
      → video ; `audio` + `audio/ogg; codecs=opus` → vocal ; `sticker` + `image/webp` → null ; mime nul → null ; la
      mention dans `Europe/Paris` d'un instant UTC donne l'heure de Paris ; `reglagesQuestion` d'un bloc ancien (aucune
      clé nouvelle) rend `{ champ: null, rangerLigne: false, genres: null }` ; `refusFichierSansSuite` : nul sans
      attente, nul avec l'arête `fichier`, une raison qui nomme le bloc sinon.
- [ ] Vérifier qu'ils échouent, implémenter, `npx vitest run tests/workflow-question-piece.test.ts` vert, commit.

### Tâche 3 : le magasin des pièces

**Fichiers :** créer `src/workflow/pieces-question.pg.ts` ; test `tests/integration/pieces-question.test.ts` (complété).

**Produit :** `PgPiecesQuestion` avec
- `noter(tenantId: string, waId: string, cle: string, metaMessageId: string, mention: string): Promise<void>` : upsert,
  contact résolu par le numéro DANS l'espace (même résolution que `setField` / `mergeFieldsByPhone`) ;
- `liensPossibles(tenantId: string, waId: string): Promise<Array<{ cle: string; metaMessageId: string; mention: string }>>`
  (une requête, filtrée sur `tenant_id`).

- [ ] Tests d'intégration : un second `noter` sur le même champ remplace le premier ; un autre espace ne lit rien ;
      un numéro inconnu n'écrit rien et ne lève pas. Commit.

### Tâche 4 : la capture et le routage dans `advance`

**Fichiers :** modifier `src/webhooks/workflow-advance.ts`, `src/application/entrant.ts` (si ses messages portent un
média), `src/worker.ts` (câblage partagé : annonce, plomberie), `src/workflow/executor.ts`, `src/workflow/wiring.ts` ;
tests `tests/workflow-question-exec.test.ts` et `tests/workflow-advance.test.ts` (complétés).

**Interfaces :**
- `entrant` d'`advance` devient `{ reaction: boolean; formulaire?: boolean; type?: string; texte?: string | null; media?: { mime: string | null } }`,
  rempli par `processWorkflowAdvance` depuis `InboundMessage` (`type`, `body` seulement quand `type === 'text'`, `media`).
- `WorkflowExecutorDeps` gagne, REQUIS : `piecesQuestion: Pick<PgPiecesQuestion, 'noter'>` et
  `fuseau(tenantId: string): Promise<string>` (la lecture de fuseau qu'`evalContext` emploie déjà dans `wiring.ts`).

**Règle**, sur un bloc `question`, après la garde `mayAct` et avant le routage : classer la pièce ; acceptée, le handle
devient `SORTIE_FICHIER`, la mesure se range sous ce handle ; puis, si un champ est choisi : pièce acceptée → `noter`
puis `setField(mention)` (dans cet ordre : un échec entre les deux laisse un champ qui ne fabrique rien) ; ligne de menu
→ son titre seulement si `rangerLigne` ; texte → le texte ; pièce refusée → rien. Une écriture en échec est journalisée et
le routage continue.

- [ ] Tests d'abord (graphe de `workflow-question-exec.test.ts` augmenté d'une arête `fichier`) : photo acceptée →
      sortie `fichier`, `setField(champ, mention)`, `noter(…, wamid, mention)` ; document JPEG → `fichier` ; vidéo avec
      les types par défaut → sortie libre, aucun `setField` ; sticker → libre, rien ; texte → libre, `setField(champ,
      texte)` ; `row:1` avec `rangerLigne` faux → rien rangé, vrai → le titre ; `attendreFichier` faux et une photo →
      libre, rien rangé ; bloc sans réglages nouveaux → les tests existants passent tels quels et `setField` n'est jamais
      appelé ; `mayAct` faux → rien rangé ; même message rejoué → un seul `noter` effectif (point de revue 1) ; aucun
      parcours en attente → rien (point de revue 3) ; « Fichier reçu » puis fin sans envoi → le message est transmis au
      répondeur comme aujourd'hui (décision de Julien, rien ne change sur `aLuLaSaisie`). Dans
      `workflow-advance.test.ts` : `processWorkflowAdvance` transmet `type`, `media` et, pour un texte seulement, `texte`.
- [ ] Vérifier l'échec, implémenter, `npm run typecheck` puis la suite unitaire ENTIÈRE (`npm test`) verte, commit.

### Tâche 5 : le refus de publier

**Fichiers :** modifier `src/http/workflows.ts` (route de publication) ; test `tests/workflows.test.ts` (celui qui tient
déjà `aller_a_invalide`).

- [ ] Test : un brouillon dont une Question attend un fichier sans arête `fichier` → 422, `code: 'fichier_sans_suite'`,
      message « Publication refusée : … » ; reliée → publication normale ; brouillon sans Question → inchangé.
- [ ] Implémenter à côté du refus `aller_a_invalide`, en appelant `refusFichierSansSuite` sur le brouillon. Vérifier par
      `git grep "publish("` qu'aucun autre chemin ne publie un graphe qui peut contenir une Question (l'API de scénarios
      du 2026-11-02 n'en compose pas). Commit.

### Tâche 6 : le jeton, et le lien fabriqué à l'Appel API

**Fichiers :** créer `src/workflow/piece-lien.ts` ; modifier `src/workflow/appel-http.ts`, `src/workflow/wiring.ts` ;
tests `tests/workflow-piece-lien.test.ts`, `tests/workflow-appel-http.test.ts` (complété).

**Produit :**
- `DUREE_LIEN_PIECE_MS = 15 * 60_000` ;
  `jetonPiece(tenantId: string, metaMessageId: string, expireLe: Date, secret: string): string` (le `wamid` encodé en
  base64url, le tout signé HMAC-SHA256 avec une clé dérivée de `secret` pour l'usage `question:piece:v1`) ;
  `lireJetonPiece(jeton: string, secret: string, maintenant: Date): { tenantId: string; metaMessageId: string } | null`
  (temps constant, longueur bornée) ; `lienPiece(baseApi: string, jeton: string): string` (`<base>/f/<jeton>`).
- `DepsAppelHttpScenario` gagne, REQUIS : `pieces: { liensPossibles: PgPiecesQuestion['liensPossibles'] }`,
  `secretPiece: string`, `baseApi: string`, `maintenant?(): Date`. Dans `creerAppelHttpScenario`, après
  `projectionContact`, une copie de la projection où chaque champ dont la valeur est ENCORE la mention notée devient
  `lienPiece(...)`. Câblé dans `wiring.ts` par un objet imbriqué, `satisfies` posé sur l'objet intérieur.

- [ ] Tests du jeton : aller-retour ; espace ou wamid modifié → nul ; signature modifiée → nul ; `maintenant` une
      milliseconde après l'échéance → nul, une milliseconde avant → valide ; secret vide → refus à la création, nul à la lecture ; un wamid contenant
      `.`, `=`, `+` ou `/` fait l'aller-retour.
- [ ] Tests de l'Appel API : champ portant la mention vivante → le transport reçoit une adresse `/f/` ; champ réécrit
      (valeur ≠ mention notée) → la valeur, aucun lien (point de revue 4) ; appel en échec dont la variable porte le lien
      → ni le `console.warn`, ni `journal.ouvrir`, ni `journal.clore` ne contiennent `/f/`.
- [ ] Vérifier par `git grep liensPossibles` que seul `creerAppelHttpScenario` le consomme (agent IA, poussée d'opt-out,
      bouton « Essayer » n'y touchent pas). Suite unitaire entière verte, commit.

### Tâche 7 : la route publique `/f/:jeton`

**Fichiers :** créer `src/http/piece-question.ts` ; modifier `src/server.ts` (registre, classe `code-url`), `src/index.ts`
(câblage), `src/audit/store.pg.ts` (action `piece.telechargee`), `scripts/auto-attaque.mts` si la sonde l'exige ; test
`tests/piece-question-route.test.ts`.

**Interface :** `registerPieceQuestion(app, deps: { secret: string; message: DepotConversationsV1['message'];
lireMediaMessage: V1ConversationsRouteDeps['lireMediaMessage']; tracer(tenantId: string, idInterne: string): Promise<void>;
maintenant?(): Date })`. Réponses : jeton illisible, faux ou échu, ou message inconnu → 404 `lien_invalide` (le même
corps) ; `media.expired` ou `MediaExpire` → 410 `media_expired` ; `MediaTropGros` → 422 ; autre panne de Meta → 422 ;
succès → octets avec `enTetesMedia`, puis `tracer` (best-effort, n'empêche pas l'envoi). Plafond de débit par adresse
IP sur le modèle des routes publiques existantes.

- [ ] Tests (injection Fastify) : lien valide → 200, les octets, `x-content-type-options: nosniff`, `cache-control:
      private, no-store` ; jeton échu, altéré, ou d'un autre espace → 404 identiques, `tracer` jamais appelé, aucun appel
      à `lireMediaMessage` (point de revue 5) ; média expiré → 410 ; trop gros → 422 ; le corps d'une réponse ne contient
      jamais le jeton.
- [ ] `npx tsx scripts/auto-attaque.mts` vert en local, `tests/scope-tenant.test.ts` vert. Commit en plomberie
      (`server.ts`, `index.ts`).

### Tâche 8 : fin du lot serveur

- [ ] `npm run typecheck`, lint, `npm test` entier, auto-attaque : verts. Push, CI lue job par job (unit, integration,
      securite).
- [ ] UNE relecture indépendante du lot (correctness, sécurité du lien, rayon de souffle : qui supposait qu'une Question
      ne range rien, qui lit `entrant`, qui lit les champs d'un contact).
- [ ] Déploiement `migration=aucune`, approuvé par Julien, puis vérifier que l'image de `mba-api` et la révision du
      worker sont celles du commit.

### Tâche 9 : la console, poussée APRÈS le déploiement de l'API

**Raison de l'ordre :** un écran publié avant l'API laisserait cocher « Attendre un fichier » sur un moteur qui
l'ignore : la pièce partirait par la sortie libre.

**Fichiers :** modifier `web/components/WorkflowConfigPanel.tsx` (section `question`), `web/components/WorkflowNode.tsx`
(poignée `fichier` « Fichier reçu », marquée orpheline comme une ligne), `web/components/WorkflowBuilder.tsx` (décocher
l'attente retire les arêtes `fichier`, comme la suppression d'une ligne), `features.md` (section « Nouveau bloc
« Question » »), `docs/aide/fiches/creer-un-scenario.md` et sa version `en/` si elle existe, avec leur empreinte ;
tests `tests/workflow-question-node.test.ts` (complété) et la suite web.

- [ ] Réglages : liste des champs (la même que le bloc Action « Poser un champ »), case « Ranger aussi la ligne choisie
      dans le menu » (visible avec un menu et un champ), case « Attendre un fichier » et ses cinq types (photo et PDF
      cochés). Le refus 422 de publication s'affiche avec son message.
- [ ] Tests : poignée `fichier` présente seulement avec l'attente ; décocher retire l'arête ; `tests/web-vouvoiement.test.ts`,
      `tests/web-formes.test.ts`, `tests/aide-proposer.test.ts` verts ; suite racine ENTIÈRE et suite web vertes.
- [ ] Mettre à jour `documentation.md` (l'invariant du lien fabriqué à l'appel, la route `/f/`, la table) et le
      journal technique. Commit `--only`, push après le déploiement de la tâche 8.

### Tâche 10 : l'essai réel

- [ ] Dérouler l'essai de la spec sur SANDBOX, ses huit points, et consigner le résultat dans `docs/prive/ESSAIS-REELS.md`.
      Si un espace sur un numéro 360dialog est disponible, refaire le point 1 dessus (la lecture du fichier passe par sa clé).
- [ ] Un défaut trouvé ici repasse par la tâche qui possède le code, avec son test vérifié dans les deux sens.
