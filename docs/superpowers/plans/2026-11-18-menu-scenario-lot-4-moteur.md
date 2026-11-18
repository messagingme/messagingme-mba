# Menu « Scénario », lot 4 : le moteur des parcours d'événement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un parcours d'événement (Shopify d'abord) naît quand Meta a accepté le premier template, posé sur ce bloc déjà
envoyé et porteur des données de l'événement ; il est seul de son espèce pour un contact, fait céder les automations
« Autres », coexiste avec les répondeurs, les outils d'agent et les sauts, et cède devant l'Inbox, le lien de test, les
campagnes, la chaîne, la publicité et le widget. Le pont qui le fait naître dans le moteur de campagne est posé ÉTEINT :
aucun appelant avant le lot 5.

**Architecture:** une colonne `workflow_runs.evenement` (`{ origine, variables }`) marque le parcours d'événement, et un
index unique partiel garantit par la base une seule place d'événement active par contact (décision 21). Un type de
lancement `evenement_shopify` et un départ `deja_envoye` posent le parcours sur le bloc envoyé sans le rejouer ; une
colonne de la table des lancements dit, pour chaque autre type, s'il remplace, cède ou coexiste. Les reprises ne changent
QUE pour `run.evenement !== null`. Le pont : une colonne `campaigns.parcours_evenement` (scénario, bloc, origine) que lit la
branche « template direct » du moteur de campagne, qui pose alors les payloads `btn:<i>` et demande le parcours après
l'acceptation de Meta.

**Tech Stack:** TypeScript, Fastify, Postgres (`pg`), pg-boss, vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md` (décisions 2, 3, 4, 15, 20 à 31 ; § 5.4,
5.5, 5.6). Carte du code : `carte-lot4.md` du scratchpad de la session, relue sur `64a1b9621` (les lignes citées ici
viennent de là ; elles bougent, les symboles font foi).

## Méthode de livraison

**Implémenteur par lot et revue humaine du diff**, en trois livraisons, parce que le lot touche trois chemins que la
production emprunte pour tous les espaces (l'avance et le réveil de chaque parcours, chaque démarrage, la branche template
de chaque campagne) et porte des invariants invisibles au compilateur : une seule place d'événement par contact, tenue par
la base ; les prédicats d'index partiels ; des champs requis qui doivent traverser le balayage ; « à nous » décidé AVANT
l'avance. Une relecture indépendante unique par livraison de code (4a, 4b).

1. **4-0, les migrations seules** (tâche 1) : poussées seules, déployées `migration=avant`, appliquées AVANT que le code qui
   les nomme n'arrive sur `main` : les lectures de `workflow_runs` sont sur le chemin de chaque message entrant, et un code
   qui nomme la colonne avant elle y tomberait en 42703. L'ancien code les ignore.
2. **4a, le moteur** (tâches 2 à 7) : `migration=aucune`. Aucun appelant ne crée de parcours d'événement ; pour tous les
   espaces ne changent que la lecture des parcours (une colonne de plus), la cession des automations (sans effet sans
   parcours d'événement) et le routage d'un clic entre deux parcours en attente.
3. **4b, le pont éteint** (tâche 8) : `migration=aucune`, relecture à part : la branche template de TOUTES les campagnes.
   Sans la colonne, rien ne change.

**Essai réel.** Aucun parcours d'événement ne peut naître en production au lot 4 (aucun appelant) : l'essai du § 7 de la
spec clôt le lot 5. Après 4a puis après 4b, un essai de NON-RÉGRESSION sur la SANDBOX (numéro libre dans
`docs/prive/ESSAIS-REELS.md`) : un scénario lancé par Claude Code (un bouton prend sa branche ; une réponse libre va au
répondeur ; une relance « Pas de réponse » part) ; une campagne template (reçue ; un clic sur son bouton ne choisit aucune
branche, comme avant).

## Global Constraints

- Aucun tiret cadratin ni demi-cadratin (code, commentaires, doc).
- `tenant_id = $1` sur chaque requête neuve ; statut écrit en LITTÉRAL (`status in ('waiting','sleeping')`) et prédicats
  d'index partiels repris mot pour mot (0023, 0054, 0085, 0115, et l'index unique neuf).
- Les variables d'un parcours ne vont JAMAIS sur la fiche (`setField`), ni au journal, ni dans un log, ni dans le contexte
  d'un agent ; elles sont lues par `safeParse` (jamais `as`) et s'effacent quand le parcours se termine (décision 28).
- Un parcours ordinaire (`evenement` null) ne change pas : toute branche neuve se lit `run.evenement !== null` ou la
  colonne `devantUnEvenement` ; les suites existantes restent vertes sans toucher leurs attentes.
- Sans `campaigns.parcours_evenement`, le moteur de campagne envoie exactement ce qu'il envoie aujourd'hui (composants,
  routage MM Lite, joignabilité, journal du fil).
- Plafond d'attente d'un parcours d'événement : 72 h (décision 29), une constante exportée, `PLAFOND_ATTENTE_EVENEMENT_MS`.
- `src/worker.ts` est un fichier de câblage partagé : annonce aux sessions voisines avant le push ; on travaille dans une
  copie à part (worktree détaché), rebasée sur origin, et on pousse son SHA.

## Appels du rédacteur (à relire)

1. **Une colonne plutôt qu'une table** pour l'événement d'un parcours et le pont d'une campagne : la purge d'un contact et
   la rétention des parcours les emportent sans retouche ; une table neuve devrait être nommée par la purge RGPD et
   rendrait la migration bloquante.
2. **La fin d'un parcours efface ses variables et garde son origine** (`evenement - 'variables'`) : les liens à clé d'accès
   partent (décision 28) et l'origine reste lisible pour le journal et l'attribution du lot 5. Toute écriture d'un statut
   terminal passe par UN fragment SQL commun, tenu par un test d'inventaire.
3. **Une colonne neuve `campaigns.parcours_evenement`**, pas `campaigns.workflow_id` : celui-ci se lit partout « campagne à
   scénario » (`lanceursDuScenario`, statistiques, historique, branches du moteur), et `insertCampaignRow` efface le nom du
   template dès qu'il est posé.
4. **Le texte lit les variables sous le préfixe du rayon**, avec les clés RÉELLES de Shopify
   (`web/lib/partage/shopify-messages.ts`, en anglais) : `{{shopify.checkout_url}}` ; l'exemple `lien_panier` de la décision
   28 n'existe pas. Un nom nu reste lu sur la fiche. L'adresse d'un bouton de lien d'un message rapide lit la même table
   (le lien du panier en bouton).
5. **Seul `evenement_shopify` naît au lot 4** : les trois familles HubSpot n'auront pas la même politique (lot 6).
6. **La reprise d'un fil `mba` à la naissance** n'écrit en général que notre colonne (`app_workflow`) : le client d'envoi a
   déjà retiré le contact de la liste de l'agent de Meta avant le template (`avantUnModele`). Elle reste indispensable :
   sans elle, le clic sur le premier template est gelé (`peutAgir`).
7. **Le plafond de 72 h se reconnaît au réveil par le bloc** : un bloc qui n'a pas d'échéance propre (template ou question
   sans délai, message à boutons, formulaire) ne peut s'être réveillé que par le plafond ; le parcours se clôt alors, sans
   jamais suivre une flèche `timeout` résiduelle. Aucun drapeau en base.

## Review Focus

- **Deux parcours en attente pour un contact** (l'événement et un ordinaire qui coexiste) : un clic sur le template de
  l'événement va au parcours qui attend sur CE bloc, jamais lu comme du texte par l'ordinaire.
- **Course à la naissance** : deux événements du même contact joués en parallèle ; un seul parcours, le second n'en crée
  aucun, et ce n'est jamais un échec de campagne (le 23505 de l'index devient un refus typé).
- **`avanceDuParcours` sur un fil `mba` avec un parcours d'événement** : le message est traité une seule fois, jamais deux
  voix.
- **Une flèche `timeout` résiduelle sur un template SANS délai** : au plafond, le parcours se clôt, il ne la suit pas.
- **Une campagne template sans la colonne** : composants et routage identiques (une mutation qui pose les payloads sans la
  colonne rougit un test).

---

### Task 1: les migrations (4-0)

**Files:** Create `db/migrations/<NNNN>_parcours_evenement.sql` et `<NNNN+1>_parcours_evenement_unique.sql` (numéros lus
dans le dossier d'une copie à jour d'origin au moment d'écrire : 0297 et 0298 aujourd'hui), `tests/migration-<NNNN>.test.ts`
(modèle `tests/migration-0295.test.ts`).

- Première : `set local lock_timeout = '5s'` ; `workflow_runs.evenement jsonb` et `campaigns.parcours_evenement jsonb`,
  nullables, sans défaut (métadonnée seule, aucune réécriture). En-tête : avant, poussée seule, pourquoi.
- Seconde : `-- migrate: no-transaction` ; `create unique index concurrently if not exists
  workflow_runs_evenement_actif_uniq on workflow_runs (tenant_id, wa_id) where evenement is not null and status in
  ('waiting', 'sleeping')`. En-tête calqué sur 0115 (un `if not exists` saute un index INVALIDE : relire `indisvalid`).
- Test miroir : colonnes, `lock_timeout`, directive, et le prédicat de l'index ÉGAL à celui que lira
  `parcoursDEvenementActif` (une constante exportée du magasin). Vu FAIL avant.
- Avant `migrate` : `pg_stat_activity` sur `workflow_runs` et `campaigns` (commande pour Julien). Après : relecture en
  base (types, nullabilité, `pg_get_indexdef`, `indisvalid`, aucune valeur non nulle). Récit au journal.

### Task 2: le magasin des parcours porte l'événement

**Files:** Modify `src/workflow/run-store.pg.ts`, `src/workflow/wake-sweep.ts`, `src/workflow/executor.ts` (contrat
`runs`, type de `resume`), `tests/executeur-inerte.ts` (défauts inertes des méthodes neuves), les fixtures d'une ligne de
parcours, `tests/run-store-claims.test.ts`. Create `tests/integration/run-evenement.integration.test.ts` (modèle
`run-ne-en-masse`).

**Interfaces (Produces):**
- `EvenementDuParcours = { origine: string; variables: Record<string, string> }` : `origine` de 200 caractères au plus,
  `variables` par `schemaVariables` (`src/api/variables.ts`) ; une valeur illisible en base donne un parcours ordinaire et
  un log SANS la valeur.
- `evenement: EvenementDuParcours | null` REQUIS sur `WorkflowRunRow`, `DueRun` et le type de `resume` ; écrit par
  `start(..., evenement)` (neuvième paramètre), rendu par `findWaitingByWaId`, `byId`, `claimDueSleeping`,
  `claimDueQuestions`, `claimSleepingById`.
- `start` rend `{ refus: 'evenement_actif' }` sur le 23505 de l'index unique, jamais une exception.
- Neuves, chacune rend les identifiants clos (sessions d'agent à fermer) : `parcoursDEvenementActif(tenantId, waId)`,
  `closeOrdinairesByWaId(tenantId, waId)`, `cloreAutresActifs(tenantId, waId, saufId)`, `cloreParOrigine(tenantId,
  origine)`, `cloreParScenarios(tenantId, workflowIds)`.
- Fragment commun d'effacement des variables à tout statut terminal (`closeActiveByWaId`, `closeStaleSleeping`, `setState*`
  et les neuves) ; un test d'inventaire relit chaque `update workflow_runs` du magasin.

Tests : SQL exact des réclamations (vu rouge avant) ; intégration (CI, banc PGlite en local, jamais `DATABASE_URL`) : `start`
écrit et les cinq lectures rendent ; un second parcours d'événement actif est refusé ; `closeOrdinairesByWaId` épargne
l'événement (vu rouge sans `evenement is null`) ; une clôture efface les variables et garde l'origine (vu rouge sans) ;
`cloreParOrigine` ne touche ni un autre contact ni un autre espace.

### Task 3: la table des lancements et la naissance sur un bloc déjà envoyé

**Files:** Modify `src/workflow/lancements.ts`, `src/workflow/executor.ts` (`demarrer`, `runFrom`), `src/workflow/wiring.ts`,
`tests/workflow-lancements.test.ts`. Create `tests/workflow-parcours-evenement.test.ts` (VRAI exécuteur, `creerLancements`,
`bancDuFil`).

**Interfaces (Produces):**
- Type `evenement_shopify` : rayons `['shopify']`, reprise `sauf_operateur`, graphe publié, fenêtre gardée, session
  remplacée `interrompue`, hors offre `gele` (Free : le premier message seul), accord marketing `accord_fiche`,
  `publieLesEtiquettes: true` (décision 30).
- Colonne REQUISE `devantUnEvenement` : `cede` pour `automatisme_ordinaire` et `evenement_shopify` ; `coexiste` pour
  `repondeur`, `repondeur_scenario`, `agent_meta_scenario`, `agent_meta_bloc`, `agent_ia_scenario`, `aller_a`,
  `aller_a_masse` ; `remplace` pour `inbox`, `lien_de_test`, `campagne_scenario`, `campagne_bloc`, `workflow_hubspot`,
  `automatisme_chaine`, `automatisme_publicite_ou_widget`.
- Départ `{ depuis: 'deja_envoye'; noeudId; messageId; evenement }` ; le départ `saut` gagne `evenement` (null pour un
  ordinaire), hérité comme l'accord marketing.
- `runFrom` pour `deja_envoye`, AUCUNE écriture avant un refus possible, dans cet ordre : parcours d'événement actif →
  refus ; bloc présent, template, même modèle et langue que l'envoyé, au moins une flèche sortante ; marche depuis le bloc
  sans rejouer son action ; garde de fenêtre ; reprise `sauf_operateur` (un opérateur = aucun parcours, décision 20) ;
  numéro ; `apply` du reste avec les variables ; clôture des autres parcours actifs et de leurs sessions ; `start`.
- Autres types : `remplace` = comme aujourd'hui ; `cede` = refus (une chaîne) si `parcoursDEvenementActif`, AVANT toute
  reprise de fil ; `coexiste` = `closeOrdinairesByWaId` au lieu de `closeActiveByWaId`.
- Dépendance REQUISE `parcoursEncoreVoulu(tenantId, run)` : câblée inerte (« toujours voulu ») ; la vraie au lot 5.

Tests : posé sur le bloc sans renvoyer le template ; opérateur : aucun parcours, rien demandé à Meta ; fil `mba` : colonne
`app_workflow` ; un ordinaire et sa session clos ; un événement actif : aucun second ; bloc sans flèche, ou autre template :
aucun ; Free : aucun ; automation qui cède (rien d'écrit, la chaîne rendue) ; répondeur qui coexiste (l'événement survit) ;
Inbox, lien de test et campagne qui remplacent. Chaque garde vue dans les deux sens ; la colonne, type par type.

### Task 4: les reprises

**Files:** Modify `src/workflow/executor.ts` (`reprendre`, `advance`, `sauter`, `envoyerBlocDepuisAgent`),
`src/webhooks/workflow-advance.ts`, `src/worker.ts` (câblage d'`avanceDuParcours`).

- Pour `run.evenement !== null` SEULEMENT : fil `mba` → reprise puis la suite ; opérateur → le parcours se CLÔT, au réveil
  comme à la réponse (décision 20 ; un gel garderait la place) ; `parcoursEncoreVoulu` faux → clos sans passer à l'équipe,
  et à une réponse le message va au répondeur (chemin (a)) ; un réveil qui envoie ou attend clôt les ordinaires et leurs
  sessions (décision 21) ; l'événement voyage dans `apply` et dans les trois sauts.
- Pour tous : un clic se route par son message cité (`blocDuMessage`) vers le parcours qui attend sur ce bloc, sinon le
  plus récent.
- `avanceDuParcours` : « à nous » aussi pour un parcours d'événement sur un fil `mba` que l'avance reprendra.
- Décision 31 : un ordinaire qui se réveille pendant un parcours d'événement continue (aucun code, un test qui le fixe).

Tests : un clic `btn:0` prend sa branche ; réveil avec opérateur = clos ; fil `mba` = repris puis la suite ; répondeur
coexistant clos au réveil de l'événement, avec sa session ; garde fausse = clos sans équipe, message au répondeur ; deux
`waiting` : le clic va au parcours de son bloc ; « à nous » sur `mba` ; un saut transmet l'événement et ses variables ;
l'ordinaire réveillé continue. Verts tels quels : `workflow-advance-gele`, `scenario-fil-non-repris`,
`workflow-template-sans-reponse`, `workflow-avance-concurrente`, `integration/escalade-mba`.

### Task 5: l'attente bornée (décision 29)

**Files:** Modify `src/workflow/engine.ts` (`walk`, option `evenement`), `src/workflow/executor.ts` (traduction du repos,
`reprendre`), `tests/workflow-engine.test.ts`, `tests/workflow-parcours-evenement.test.ts`.

- `walk(..., { evenement: true })` : un template sans bouton ni délai continue, comme sous `mbaActif`.
- Une attente sans échéance propre d'un parcours d'événement reçoit `resume_at` = maintenant + le plafond ; à ce réveil,
  le parcours se clôt sans rien envoyer et ne suit JAMAIS une flèche `timeout`.

Tests : template sans bouton ni délai → la suite part ; template à boutons sans délai → `resume_at` à 72 h ; au réveil →
clos, rien d'envoyé, la flèche `timeout` résiduelle ignorée (vu rouge en la suivant) ; template à délai → son délai, pas le
plafond ; parcours ordinaire → aucune échéance (vu rouge si le plafond s'appliquait à tous).

### Task 6: les variables dans les envois

**Files:** Modify `src/workflow/executor.ts` (`apply`, contrat `sendTemplate`), `src/workflow/envois-bloc.ts`,
`src/workflow/template-send.ts`, `src/workflow/engine.ts` (`actionOf`), `src/crm/template.ts` (`parseParamHints`, option
`accepterVariables`, défaut faux pour ses autres appelants).

- Template : source `{ type: 'variable' }` acceptée dans les indices d'un bloc, résolue par les variables du parcours ;
  manquante = refus nommé, qui dit laquelle.
- Texte d'un message rapide, d'une question, adresse d'un bouton de lien : `{{<rayon>.<clé>}}` lu dans les variables ; un
  nom nu reste lu sur la fiche. `firstTemplateParams` intact.

Tests (vrai câblage, `workflow-envois-bloc`) : la variable arrive chez Meta ; manquante refusée ; `{{shopify.checkout_url}}`
rendu ; `{{first_name}}` lu sur la fiche ; aucune variable n'atteint `setField` (vu rouge en la laissant passer).

### Task 7: les arrêts commandés

**Files:** Modify `src/workflow/executor.ts`, `tests/workflow-parcours-evenement.test.ts`.

`arreterParcours(tenantId, { origine } | { workflowIds }, motif)` clôt les parcours et ferme leurs sessions ; appelé au
lot 5 (décisions 4 et 15). Tests : par origine, par scénarios, sessions closes, un autre espace intact.

### Task 8: le pont éteint (4b)

**Files:** Modify `src/campaign/types.ts`, `src/campaign/store.pg.ts` (`getCampaign`, `insertCampaignRow`),
`src/api/envoi-public.ts` (option interne), `src/campaign/engine.ts` (branche template direct, `EngineDeps`),
`src/campaign/run-job.ts` (`CapacitesMoteur`), `src/worker.ts` (`moteur`), `tests/campaign-engine.test.ts`,
`tests/campagne-cablage.test.ts`, `tests/v1-sends.test.ts`, un test d'intégration.

- `{ workflowId, noeudId, type: 'evenement_shopify', origine }` sur la campagne, par une option INTERNE de
  `lancerEnvoiPublic`, jamais lue du corps HTTP.
- Avec la colonne : payloads `btn:<i>` des réponses rapides du bloc ; Meta accepté → d'ABORD la mesure `sent` du bloc avec
  le wamid (toujours, parcours refusé ou non : la protection du clic tardif en dépend), puis UNE demande de parcours
  (scénario, bloc, origine, wamid, variables du destinataire) dans son propre `try` ; refus ou exception = destinataire
  `sent`, la raison à côté (`campaign_recipients.error`), le run continue. Jamais sur un échec, un STOP, la limite du mois,
  le crédit ou une pause de qualité.

Tests : sans la colonne, composants et appels identiques (mutation : payloads sans la colonne → rouge) ; avec : payloads,
mesure posée même parcours refusé, capacité appelée une fois après Meta et jamais sur échec ; refus = `sent` avec raison ;
le corps HTTP ne peut pas poser l'option ; `campagne-cablage` voit la capacité ; intégration : colonne écrite et relue.

### Task 9: documentation, contrôles, relecture, déploiement (chaque livraison)

**Files:** `documentation.md` (§ 4.3 ; l'invariant « au plus un parcours actif par contact » devient « au plus un parcours
d'événement, et des parcours ordinaires » ; « un run endormi est CLOS par le démarrage suivant » nuancé ; l'invariant 34
étendu au parcours), les commentaires que la carte liste, `docs/JOURNAL-TECHNIQUE.md`, `todo.md`.

`npm run typecheck`, `npm test` (« Test Files » lu), `npm run lint`, `npx tsx scripts/auto-attaque.mts`, puis la CI job par
job (`gh run view <id> --json jobs`), intégration comprise. Relecture : qui supposait qu'un démarrage remplace toujours,
qu'un seul parcours vit pour un contact, que le moteur de campagne n'envoie jamais de payload ?
