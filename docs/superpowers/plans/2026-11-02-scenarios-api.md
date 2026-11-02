# Créer des scénarios par l'API et le MCP : v1 (plan)

> **Pour l'exécutant :** suivre ce plan tâche par tâche (superpowers:executing-plans), les cases `- [ ]` servent au
> suivi. Plan COURT par règle du dépôt : fichiers, interfaces, tests attendus, ordre de déploiement ; le code s'écrit à
> l'exécution.

**But :** créer, relire, remplacer et supprimer un scénario simple (template, message à réponses rapides avec fichier
facultatif, agent IA, passage à un humain) par `/v1/scenarios` et par quatre outils MCP, sans ouvrir la console.

**Architecture :** l'appelant envoie une RECETTE (arborescence sans id ni position). Une lecture pure la valide
(Zod `safeParse`), un résolveur va chercher ce qu'elle nomme (templates chez Meta, agents, champs, fichiers), un
compilateur pur en fait le graphe que le moteur lit déjà, en réutilisant les ids et les codes du graphe précédent par
chemin. Un décompilateur pur fait le chemin inverse pour la lecture et pour l'empreinte qui protège un remplacement.
La route REST et l'outil MCP appellent le MÊME service.

**Pile :** TypeScript, Fastify, Postgres, Zod, vitest ; Next.js pour les deux retouches de la console.

**Spec :** [2026-11-02-scenarios-api-design.md](../specs/2026-11-02-scenarios-api-design.md). Elle fait foi ; ce plan dit
seulement où et dans quel ordre.

## Méthode de livraison

**Implémenteur par lot (Claude) et une relecture indépendante du diff en fin de lot**, parce que la production
empruntera ce chemin (chaque scénario écrit est publié et envoie de vrais messages) et que le code touche des invariants
invisibles : branches indexées `btn:<i>`, bouton sans suite traité en trou de montage, sorties d'agent non câblées
remontées à l'équipe, fenêtre de 24 h, codes `nod_` visés par `/v1/sends` et par les « Aller à ». Pas feature-loop :
les critères se testent, mais la raison de chaque refus demande un œil. Un rouge = ce qui casse la production (un
scénario accepté qui n'envoie pas ce qu'il annonce, un scénario de la console abîmé, une offre contournée, une fuite
entre espaces).

**Essai réel qui clôt la v1**, sur la SANDBOX, depuis Claude Code par le MCP (spec, § « Essai réel ») : un template à
deux boutons approuvé ; un scénario avec un PDF, une image légendée suivie de l'agent, « autre réponse » vers l'équipe ;
une adresse de fichier interne refusée ; trois envois par `/v1/sends` à un vrai téléphone, chaque branche cliquée ;
l'affichage dans la console ; un déplacement de bloc accepté, une modification de texte refusée en 409. À inscrire dans
`docs/prive/ESSAIS-REELS.md`.

## Contraintes globales

- Toute écriture PUBLIE (création comme remplacement), aucun brouillon par l'API ; un template non APPROUVÉ dans la
  langue demandée = refus net, rien d'enregistré.
- Fonction d'offre `scenarios` (402 `plan_feature_unavailable` par `corpsRefusFonction('scenarios')`), jamais une liste
  d'offres.
- L'API ne remplace et ne supprime que les scénarios d'origine `api`.
- Blocs produits : `template`, `quick_message`, `agent`, `inbox`, et la fin cachée de l'agent. Aucun autre type.
- Un fichier par message, adresse `https`, lu à l'envoi ; vérifié une fois à l'écriture, jamais stocké. Types :
  JPEG, PNG, GIF, MP4, PDF, jugés sur les octets.
- Zod `safeParse` sur la recette, jamais `parse` ni `as` ; tout `tenant_id = $1` ; isolation tenant vérifiée par
  `tests/scope-tenant.test.ts` et l'auto-attaque.
- Bornes du message : 3 réponses rapides au plus, 20 caractères par réponse, textes distincts ; texte 1 024 avec
  fichier ou réponses, 4 096 sinon. Une seule source pour la console, le moteur et le compilateur.
- Les erreurs : `{ error, code }`, une phrase française et un code anglais stable (`src/api/erreurs.ts`).
- Pas de tiret cadratin ni demi-cadratin dans les textes, les messages d'erreur et la doc.

## Points à surveiller en relecture

1. **Un texte de bouton presque juste** (casse, espace en trop, emoji) : refus `template_button_unknown` avec la liste
   exacte des textes du template, jamais une correspondance approchée. Test dans la tâche 3.
2. **Un template approuvé en `fr` et en revue en `en`** : jugé par langue ; la recette `en` est refusée, la `fr`
   acceptée. Test dans la tâche 4.
3. **Un remplacement pendant que des contacts attendent** : un bloc dont le chemin survit garde son id, donc le contact
   qui clique reprend au bon endroit. Test dans la tâche 3 (ids réutilisés) et la tâche 4 (le graphe écrit garde l'id).
4. **Deux créations simultanées du même nom** : une seule réussit, l'autre rend 409 `scenario_name_taken` avec l'id de
   la première. Test d'intégration dans la tâche 4.
5. **Une adresse de fichier qui redirige**, ou qui répond lentement : refus `file_refused`, aucune redirection suivie,
   délai borné. Test dans la tâche 4.

## Choix de Claude à relire

- **Pas de clé d'idempotence** sur la création (la spec en proposait une) : le nom unique en tient lieu. Un réessai
  réseau rend 409 `scenario_name_taken` avec l'id déjà créé, que l'appelant relit. La table d'idempotence est liée aux
  envois (`send_id`) ; l'élargir coûtait plus que le service rendu.
- **`GET /v1/scenarios/:id` sous `scenarios:write`** (la spec disait la portée du catalogue) : c'est la lecture qui
  donne l'empreinte d'un remplacement, donc le droit d'écrire doit suffire. La liste reste sous `sends:create`.
- **`scenarios:write` n'entre ni dans `DROITS_PAR_CLAUDE` ni dans `DROITS_CLE_APPLICATION`** : une clé qui publie des
  parcours se crée dans la console, case cochée, comme les autres droits neufs.
- **Brouillon de la console en cours** : un remplacement est refusé (409 `scenario_changed`) si le brouillon décrit une
  autre recette que le publié. Un brouillon qui ne diffère que par les positions ne bloque rien.
- **Règle d'arrêt ajoutée à l'agent APRÈS l'écriture** : sans arête, elle remonte à l'équipe jusqu'au prochain
  remplacement, exactement comme dans un scénario de la console. Dit dans la description des outils.
- **La suppression de la console gagne les refus de l'API** (automation, campagne programmée, widget, répondeur,
  « Aller à »). C'est un changement de comportement de la console : aujourd'hui l'automation part en cascade, en
  silence.
- **La migration part seule, avant le code** : sa colonne n'est lue que par les requêtes neuves, mais un déploiement
  de `main` par un pair sans migration casserait les routes neuves.

## Tâche 1 : la marque d'origine (migration seule)

**Fichiers :** créer `db/migrations/<prochain libre>_scenario_origine.sql` (le numéro se lit par `npm run migrations`) ;
test `tests/migration-scenario-origine.test.ts`.

- `alter table workflows add column if not exists origine text not null default 'console'`, puis la contrainte
  `workflows_origine_chk` (`origine in ('console', 'api')`), sous `set lock_timeout = '5s'`. Aucune autre table.
- [ ] Test : le fichier pose la colonne, le défaut `'console'` et le CHECK sous ce nom (`tests/migration-directives.test.ts`
  vert).
- [ ] Skill `migrations-postgres` relue avant d'écrire ; commit et push SEULS ; déploiement `migration=avant` (ordre
  ci-dessous), puis relecture en base : colonne, défaut, nullabilité, `pg_get_constraintdef`.

## Tâche 2 : les bornes du message, une seule source

**Fichiers :** créer `web/lib/partage/message-rapide.ts` ; modifier `web/components/WorkflowConfigPanel.tsx` (les
`maxLength={20}`, `max={1024|4096}`, `qr.length < 3`), `src/workflow/envois-bloc.ts` (`TEXTE_MAX_AVEC_FICHIER_OU_BOUTON`
importé au lieu d'être déclaré) ; test `web/lib/partage/message-rapide.test.ts`.

**Interfaces produites :** `MAX_REPONSES_RAPIDES = 3`, `MAX_TEXTE_REPONSE_RAPIDE = 20`,
`TEXTE_MAX_AVEC_FICHIER_OU_BOUTON = 1024`, `TEXTE_MAX_SIMPLE = 4096`.

- [ ] Test : les quatre valeurs ; `WorkflowConfigPanel.tsx` ne contient plus ces nombres en dur (lecture du texte).
- [ ] Suite racine entière (des tests de la racine lisent `web/`) et suite `web/` entière ; commit.

## Tâche 3 : la recette, le compilateur, le décompilateur (pur)

**Fichiers :** créer `src/workflow/recette.ts` (schéma, lecture, empreinte) et `src/workflow/recette-graphe.ts`
(compilation, décompilation, disposition) ; exporter `MAX_NODES` de `src/workflow/graph.ts` ; tests
`tests/workflow-recette.test.ts`, `tests/workflow-recette-graphe.test.ts`.

**Interfaces produites :**
- `type Etape = EtapeTemplate | EtapeMessage | EtapeAgent | EtapeHumain` (forme de la spec, § « La recette ») ;
  `interface Recette { nom: string; entree: Etape }`.
- `lireRecette(brut: unknown): Issue<Recette, RefusRecette>` : schéma fermé, exactement une clé d'étape, bornes de la
  tâche 2, `suite` seulement sur un message sans réponse, profondeur 20 au plus, `MAX_NODES` blocs au plus.
- `type RefusRecette = { code: CodeApi; message: string; chemin: string }` ; `chemin` lisible (`entree.boutons["Plus
  tard"].message`).
- `referencesDe(r: Recette): { templates: Array<{ nom: string; langue: string }>; agents: string[]; champs: string[];
  fichiers: string[] }`.
- `interface ReferencesResolues { templates: Map<string, { statut: string; boutons: Array<{ type: string; texte: string }>;
  variables: number; indices: Record<string, SourceVariable> }>; agents: Map<string, { actif: boolean; sorties: string[] }>;
  champs: Set<string> }` (clé de template : `nom|langue`).
- `compilerRecette(r: Recette, refs: ReferencesResolues, precedent: WorkflowGraph | null): Issue<WorkflowGraph, RefusRecette>` :
  `data` exactement comme la console l'écrit (`templateName`, `language`, `templateButtons` depuis le template,
  `variables`, `body`, `quickReplies`, `imageUrl`, `agentId`) ; arêtes `btn:<i>` par index du bouton ; arête libre pour
  `autre_reponse` et `suite` ; ni `boutons` ni `autre_reponse` acceptés sur un template sans bouton de réponse rapide ;
  bloc agent câblé comme `grapheDuRepondeur` : chaque `sortie:<code>` de l'agent, `sortie:humain` et `timeout` vers une
  fin silencieuse (même forme que `BLOC_FIN` du répondeur), `echec`, `plafond` et `sans_source` sans arête ; ids et
  `data.code` repris de `precedent` pour chaque bloc au même chemin ; positions calculées.
- `decompilerGraphe(g: WorkflowGraph): Issue<Recette['entree'], { code: 'scenario_not_describable'; message: string }>`.
- `empreinteRecette(e: Etape): string` : SHA-256 du JSON canonique (clés triées), positions et ids exclus.

- [ ] Tests de lecture : chaque refus de la spec rend son code et son chemin (deux clés d'étape, 4 réponses, réponse de
  21 caractères, deux réponses identiques, texte de 1 025 caractères avec fichier, 4 096 sans, adresse `http:`,
  profondeur 21).
- [ ] Tests de compilation : template en revue -> `template_not_approved` ; bouton inconnu -> `template_button_unknown`
  avec la liste ; bouton de réponse rapide sans branche -> `quick_reply_unwired` ; bouton de lien ignoré ; agent
  inactif ou d'ailleurs -> `agent_unavailable` ; champ inconnu -> `field_unknown` ; variable sans source refusée sauf sur
  le template d'entrée ; indices recopiés dans le bloc quand `variables` est absent ; `boutons` sur un template sans
  bouton -> refus.
- [ ] Tests de graphe : `parseGraph` accepte le résultat ; `actionOf` rend `sendTemplate` avec les boutons et
  `sendQuickMessage` avec `mediaUrl` ; chaque handle de sortie de l'agent a une arête vers la fin, `echec`, `plafond`,
  `sans_source` n'en ont pas ; `ouvertureApi` sur le graphe d'un template d'entrée rend `whatsapp_template` ; aucun
  couple de blocs à la même position.
- [ ] Tests d'aller-retour : `decompilerGraphe(compilerRecette(r))` égale `r.entree` pour cinq recettes types ; bouger
  un bloc ne change pas l'empreinte, changer un texte la change ; un graphe avec une condition, ou deux branches qui
  rejoignent le même bloc -> `scenario_not_describable`.
- [ ] Test des ids : recompiler avec une réponse renommée garde l'id et le code de l'entrée et de la branche intacte,
  et donne un id neuf à la branche renommée.
- [ ] `npm run typecheck`, `npm run lint`, commit.

## Tâche 4 : le service, la résolution, le store

**Fichiers :** créer `src/workflow/scenarios-api.ts` (service), `src/workflow/fichier-du-bloc.ts` (vérification d'une
adresse) ; modifier `src/workflow/store.pg.ts`, `src/http/workflows.ts` (la suppression de la console passe par
`utilisationsDuScenario`), `src/api/erreurs.ts` (codes), `tests/lib-adresse-privee.test.ts` (inventaire) ; tests
`tests/workflow-scenarios-api.test.ts`, `tests/workflow-fichier-du-bloc.test.ts`,
`tests/integration/workflow-scenarios-api.pg.test.ts`.

**Interfaces produites :**
- `verifierFichierDuBloc(url: string, deps?: DepsTelechargement): Promise<null | string>` : mêmes gardes que
  `telechargerEntete` (plafond selon le genre de l'adresse, 16 Mo au plus), type par `typeFichier`, `verifierVideo` pour
  un MP4 ; rend la raison du refus. Une adresse de la médiathèque de l'espace (`codeDeMediatheque`) se vérifie par sa
  fiche, sans HTTP.
- `PgWorkflowStore` :
  - `creerPublieParApi(tenantId, nom, graphe): Promise<{ id: string; code: string } | { nomPris: string }>` : sous
    `pg_advisory_xact_lock` de l'espace, nom comparé sans casse à TOUS les scénarios de l'espace, insertion avec
    `origine = 'api'`, `graph` et `published_at = now()`, `draft_graph` null. Toutes les requêtes par le client du verrou.
  - `remplacerPublieParApi(id, tenantId, controle: (ligne: WorkflowRow & { origine: string }) => RefusRecette | null,
    graphe): Promise<'ok' | 'inconnu' | RefusRecette>` : transaction, `select … for update`, `controle`, puis `graph`,
    `draft_graph = null`, `published_at = now()`.
  - `utilisationsDuScenario(tenantId, id): Promise<string[]>` : les raisons lisibles (publicité, lien de chaîne, widget,
    automation, campagne programmée ou en cours, chaîne de campagne, répondeur `tenant_settings.repondeur_workflow_id`,
    « Aller à » d'un autre scénario). Le relevé des clés étrangères vers `workflows` est fait à l'exécution sur les
    migrations ; `workflow_runs`, `workflow_node_events` et `workflow_reports` n'en sont pas.
  - `supprimerParApi(id, tenantId): Promise<'ok' | 'inconnu' | 'console' | { utilise: string[] }>`.
  - `origine` n'entre PAS dans `COLS` : lue seulement par ces méthodes.
- `interface DepsScenariosApi` : `scenarios` (le store), `offres`, `templates(tenantId): Promise<TemplateSummary[]>`,
  `indices`, `agents`, `champs`, `verifierFichier`, `tenantCode`, `journal`.
- `creerScenario(deps, tenantId, brut, auteur)`, `lireScenario(deps, tenantId, id)`,
  `remplacerScenario(deps, tenantId, id, brut, empreinte, auteur)`, `supprimerScenario(deps, tenantId, id, auteur)` :
  tous rendent `Issue<Reponse, { statut: number; code: CodeApi; message: string; details?: object }>`. Réponse d'écriture
  et de lecture : `{ id, code, nom, entreeCode, recette, empreinte, ouverture }`. Ordre : offre, lecture, résolution,
  compilation, `mintNodeCodes`, `parseGraph`, `ouvertureApi`, écriture, journal (`workflow.published` ou
  `workflow.deleted`, `{ origine: 'api' | 'mcp' }`).
- Codes neufs (`STATUT_PAR_CODE`) : `template_not_approved` 422, `template_button_unknown` 422, `quick_reply_unwired` 422,
  `agent_unavailable` 422, `field_unknown` 422, `file_refused` 422, `scenario_name_taken` 409,
  `scenario_managed_in_console` 409, `scenario_changed` 409, `scenario_not_describable` 409, `scenario_in_use` 409,
  `precondition_required` 428.

- [ ] Tests du service (dépendances simulées) : Free -> 402 avant toute lecture chez Meta ; template `fr` approuvé et `en`
  en revue (point 2) ; remplacement d'un scénario `console` -> 409 ; empreinte périmée -> 409 `scenario_changed` ;
  brouillon de la console d'une autre recette -> 409 ; brouillon ne différant que par les positions -> accepté ;
  remplacement qui garde l'id du bloc où un contact attend (point 3) ; le journal porte l'origine.
- [ ] Tests du fichier : adresse interne, redirection 302 (point 5), 404, 20 Mo, HTML servi sous `.pdf`, MOV renommé
  `.mp4` -> refus nommé ; PDF, PNG, MP4 valides -> `null` ; l'inventaire de `tests/lib-adresse-privee.test.ts` le compte.
- [ ] Intégration (Postgres de la CI) : deux `creerPublieParApi` concurrents du même nom, à la casse près (point 4) ;
  `origine` posée ; `graph` publié, `draft_graph` null ; `utilisationsDuScenario` voit une automation, un widget et le
  répondeur ; suppression d'un scénario `console` refusée ; aucune ligne d'un autre espace lue ni écrite.
- [ ] Test de la route de la console : suppression d'un scénario visé par une automation -> 409 avec la raison.
  `grep` de `web/e2e` sur la suppression de scénario avant de pousser.
- [ ] `npm run typecheck`, `npm run lint`, commit.

## Tâche 5 : les routes REST et le droit `scenarios:write`

**Fichiers :** créer `src/http/v1-scenarios.ts` ; modifier `src/server.ts` (registre `modulesDeRoutes`, montage sous
`[requireApiKey, requireScope('scenarios:write')]`), `src/index.ts` (dépendances), `web/lib/partage/droits-api.ts`
(`API_SCOPES` reçoit `'scenarios:write'`), l'écran de création des clés (libellé de la case), `src/api/openapi/document.ts`
et `registre.ts` (quatre opérations), `src/api/usage-guard.ts` (opération `scenarios.write`), `src/http/v1-catalogues.ts`
(`origine` dans la liste) ; régénérer `sdk/` (`npm run sdk:contrat`) et la doc de `web/public` (`cd web && npm run
doc:md`) ; tests `tests/v1-scenarios.test.ts`.

- `POST /v1/scenarios` (201), `GET /v1/scenarios/:id` (200), `PUT /v1/scenarios/:id` (200, empreinte en `If-Match` ou
  `empreinte` du corps, absente -> 428 `precondition_required`), `DELETE /v1/scenarios/:id` (200). `:id` = uuid ou code
  `scn_`. Chaque appel compté par `compterOuRefuser(…, 'scenarios.write')`.
- [ ] Tests : une clé sans le droit -> 403 ; un id d'un autre espace -> 404 ; chaque issue du service traduite en statut
  et code ; `If-Match` absent -> 428 ; `tests/openapi.test.ts`, `tests/scope-tenant.test.ts`, `doc-md.test.ts` (suite
  `web/` entière) verts.
- [ ] `npx tsx scripts/auto-attaque.mts` en local ; annonce aux sessions voisines (câblage partagé) ; commit par
  plomberie (`server.ts`, `index.ts`).

## Tâche 6 : les outils MCP

**Fichiers :** créer `src/mcp/outils-scenarios.ts` ; modifier `src/mcp/outils.ts` (assemblage, et `origine` dans
`list_scenarios`), `web/lib/partage/catalogue-mcp.ts` (quatre fiches), `scripts/plugin/faq.ts` (« créer un parcours par
Claude Code »), `plugin/.claude-plugin/plugin.json` (version montée) ; régénérer (`npm run plugin:generer`,
`cd web && npm run doc:md`) ; tests `tests/mcp-outils-scenarios.test.ts`.

- `create_scenario`, `update_scenario`, `delete_scenario` : `fonction: 'scenarios'`, `scope: 'mcp:write'`,
  `exigePersonne: true`, annotations d'écriture (`delete_scenario` destructive). `get_scenario` : `mcp:read`,
  `fonction: 'scenarios'`. Chacun appelle le service de la tâche 4, rien d'autre.
- Le schéma d'entrée ANNONCE toutes les bornes que la lecture applique (règle du dépôt sur la sortie d'un modèle) :
  3 réponses, 20 caractères, 1 024 et 4 096, profondeur, types de fichier, https. Description : un template se crée
  d'abord (`create_template`) et doit être approuvé ; toute écriture publie ; un scénario qui ouvre par un message
  part à ceux dont la fenêtre est ouverte ; une règle d'arrêt ajoutée plus tard à l'agent remonte à l'équipe.
- [ ] Tests : sans personne, les trois écritures absentes de `outilsPour` ; Free -> refus avec le lien de l'offre ; un
  test de parité exige que chaque borne de `lireRecette` figure dans le schéma annoncé (modèle :
  `tests/agent-setup-bornes.test.ts`) ; la même recette donne le même graphe par le MCP et par la route.
- [ ] Suite racine et suite `web/` entières, auto-attaque ; commit.

## Tâche 7 : la documentation

**Fichiers :** `features.md` (la fonction, vue utilisateur), les fiches d'aide qui citent la section touchée (empreinte
dans le même commit, `tests/aide-proposer.test.ts` vert avant le push), `documentation.md` (invariants : recette
compilée, ids par chemin, origine, empreinte sur la recette), `todo.md` (v2 : blocs question, étiquette, attente,
condition ; sorties de l'agent ; déclencheurs ; répondeur en REST), `docs/prive/ESSAIS-REELS.md`.

- [ ] Commit ; la vitrine Développeurs n'est PAS touchée dans ce lot (nouveauté publique = accord de Julien d'abord).

## Ordre de déploiement

1. Tâche 1 poussée seule ; `gh run list` vert ; `gh workflow run deploy-scaleway.yml --ref main -f migration=avant`,
   approuvé par Julien ; relecture en base.
2. Tâches 2 à 7 poussées après la relecture indépendante du lot, CI lue job par job (`gh run view <id> --json jobs`).
   Vercel publie la console aussitôt : la case `scenarios:write` existe avant l'API, et une clé créée avec elle serait
   refusée en 400. Fenêtre réduite en déployant l'API dans la foulée.
3. `gh workflow run deploy-scaleway.yml --ref main -f migration=aucune`, approuvé par Julien.
4. `gh workflow run plugin.yml --ref main` (version montée, lots des pairs déployés).
5. L'essai réel.
