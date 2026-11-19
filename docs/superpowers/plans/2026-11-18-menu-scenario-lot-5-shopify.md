# Menu « Scénario », lot 5 : Shopify (trois lignes, un scénario chacune, le pont allumé)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** « Commande payée », « Commande expédiée » et « Panier abandonné » deviennent trois lignes à interrupteur, chacune
avec son scénario du rayon `shopify` dont le premier bloc, verrouillé, est le template que le circuit Shopify envoie ;
quand Meta l'accepte, le parcours d'événement du lot 4 naît sur ce bloc avec toutes les données de l'événement et prend la
suite. La boutique gagne une pause, les anciens messages Shopify s'éteignent (décision 8), et le pont ne s'allume qu'une
fois réglés les défauts que les relectures de 4a et 4b ont trouvés.

**Architecture:** une table `shopify_lignes` (une ligne par événement et par espace, son scénario, son interrupteur) remplace
`shopify_messages` comme source de ce que le circuit envoie ; les deux anciennes tables restent en lecture jusqu'à un lot
ultérieur. Le circuit (`servir`, la relance des paniers) lit le premier bloc PUBLIÉ par `actionOf`, envoie par l'envoi public
comme aujourd'hui, et pose l'option interne `parcoursEvenement` du lot 4b quand le bloc a une suite et que l'offre a la
fonction `scenarios`. Le parcours connaît l'identifiant Meta de son premier message : seul un clic sur CE message le touche,
et son échec de livraison le clôt. La pause et l'interrupteur arrêtent les parcours par préfixe d'origine.

**Tech Stack:** TypeScript, Fastify, Postgres (`pg`), pg-boss, Next.js (console), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md` (décisions 1 à 31, § 2.1, 2.4, 5.1 à 5.9,
7). Carte du code : `carte-lot5.md` du scratchpad de la session, relue sur `9a4689ec9` (les lignes bougent, les symboles
font foi). Jaunes repris : `todo.md`, sections 4b, 4a, lot 2 et 3a/3b nommées dans chaque tâche.

## Méthode de livraison

**Implémenteur par lot et revue humaine du diff**, en cinq livraisons, parce que le lot réécrit le chemin que la production
emprunte pour CHAQUE commande et chaque panier de chaque boutique (réception, relance, attribution), qu'il allume le pont
de 4b sur toutes les campagnes Shopify, et qu'il porte des invariants que le compilateur ne voit pas : une seule place
d'événement par contact (un arrêt doit précéder la naissance suivante), la migration avant le code des webhooks, un verrou
de graphe que le serveur doit tenir, des données à clé d'accès qui ne vont jamais sur la fiche. Une relecture indépendante
unique par livraison de code (5a, 5b, 5c) ; Julien approuve chaque déploiement.

1. **5-0, les migrations seules** (tâche 1) : 0299 et 0300, poussées seules, `migration=avant`. Chaque webhook Shopify
   lira les colonnes neuves de `shopify_boutiques` (42703 sinon, puis Shopify désabonne).
2. **5a, le moteur prêt à s'allumer** (tâches 2 à 5) : `migration=aucune`. Inerte : aucune origine `shopify` n'existe et
   rien ne pose le pont.
3. **5b, le circuit et la bascule** (tâches 6 à 10) : `migration=avant` (0301, l'extinction des anciens messages), APRÈS la
   sonde de la bascule lue par Julien. Le déploiement de l'API EST la bascule.
4. **5c, la console** (tâches 11 et 12) : poussée APRÈS le déploiement de 5b (ses écrans appellent des routes de 5b).
5. **5d, plugin, aide et doc** (tâche 13) : la skill publiée par Julien après l'API, `aide:charger` après la console.

**Essai réel.** Après 5b, une non-régression sur la SANDBOX (une confirmation d'un bloc réglée par `set_shopify_message` ;
pause puis reprise : aucun panier relancé après coup). Après 5c, l'essai du § 7 de la spec qui clôt la feature : un panier
en deux temps (sans réponse, clic, commande entre les deux) et une commande payée pendant qu'un opérateur tient le fil.
Numéros libres dans `docs/prive/ESSAIS-REELS.md`.

## Global Constraints

- Aucun tiret cadratin ni demi-cadratin (code, commentaires, doc, textes de la console et du MCP).
- `tenant_id = $1` sur chaque requête neuve ; statuts écrits en LITTÉRAL ; le prédicat d'un index partiel repris mot pour
  mot dans la requête qu'il sert (0298 et 0300).
- Les données d'un événement (dont `order_status_url` et `checkout_url`, à clé d'accès) ne vont JAMAIS sur la fiche, ni
  dans un log, ni dans les indices d'un template (`template_param_hints`) ; elles vivent dans `campaign_recipients.variables`
  et dans le parcours, effacées à sa fin.
- Le premier message d'une commande part même quand un opérateur tient le fil, sans le couper (décision 2) ; aucune panne
  du parcours, de l'arrêt du panier ou du pont ne fait perdre une confirmation (anti-objectif 1).
- Un webhook Shopify reste traité dans la requête : trois lectures de plus au plus (ligne, scénario publié, indices).
- Origine d'un parcours : `shopify:<domaine>:<sujet>:<référence>`, le sujet et la référence de la clé d'idempotence
  d'aujourd'hui (`orders/paid`, `fulfillments/create`, `checkouts/abandoned`) ; `ORIGINE_MAX` 200 ; plus longue, pas de pont.
- Le rayon `general` ne change pas : aucun ménage de template, aucun verrou, aucune variable Shopify hors du rayon `shopify`.

## Review Focus

1. Un webhook rejoué à cheval sur le déploiement de 5b : même clé d'idempotence, corps différent, issue `refuse`
   (`idempotency_key_reused`), rare, accepté et écrit dans le journal du déploiement.
2. Deux événements du même contact en quelques secondes (payée puis expédiée) : le second envoie son premier message sans
   suite, et un clic sur ce message va au répondeur ou à l'agent sans clore le premier parcours (tâche 2).
3. Un template du premier bloc modifié pendant que des parcours vivent : le circuit envoie la version PUBLIÉE jusqu'à
   l'approbation (lot 3) ; une naissance dont le modèle ne correspond plus au bloc publié est refusée, nommée dans Campagnes.
4. Un espace qui repasse de Pro à Free avec un scénario de plusieurs blocs : seul le premier part, sans pont, sans erreur
   écrite sur les destinataires.
5. La boutique en pause pendant qu'un parcours dort : il s'arrête ; à la reprise, ni le premier message perdu ni le panier
   abandonné pendant la pause ne partent.

## Appels du constructeur (à relire par Julien)

- **A1. `shopify_lignes`**, table neuve, plutôt que des lignes d'`automations` (dont le chemin chaud, la limite de l'offre, le
  gel en Base et l'écran « Autres » devraient tous exclure un type neuf ; la Free y perdrait 3 places) ou une colonne de
  `shopify_messages`. Les deux jaunes « Lot 5 » de l'écran Autres (rayon non filtré, limite) passent au lot 6.
- **A2. La pause** : `shopify_boutiques.pause_le` et `paniers_depuis`. En pause, rien ne part et rien n'est rejoué à la
  reprise ; l'attribution, la fermeture des paniers et le RGPD continuent. `paniers_depuis` se pose à la reprise et au
  rallumage de la ligne du panier : il ferme AUSSI le défaut d'aujourd'hui (une relance éteinte puis rallumée relance
  aussitôt les paniers notés avant l'arrêt).
- **A3. « Couper » et « éteindre » arrêtent les parcours** de la boutique ou de la ligne (décision 15) ; les lignes sont
  gardées ÉTEINTES quand la boutique est effacée (configuration sans donnée personnelle).
- **A4. Un parcours d'événement qui atteint un message de session fenêtre fermée se clôt** (journal seul), sans passer à
  l'équipe : sinon « À traiter » se remplirait d'un client par panier (le builder l'a prévenu, décision 16).
- **A5. Le clic sur un message qui n'est pas celui du parcours** (le premier message d'un second événement, un bloc d'un
  autre scénario) va au répondeur ou à l'agent, et le parcours continue d'attendre (décision 3, « sans clore le parcours »).
- **A6. Free** : le circuit ne pose le pont que si le premier bloc a une suite ET que l'offre a `scenarios` ; en Free, seul
  le premier message part (§ 5.6).
- **A7. Catégorie** : la console laisse le marchand choisir (UTILITY proposé pour une commande, MARKETING pour le panier et
  tout envoi après une attente, avec le rappel que Meta peut reclasser) ; `set_shopify_message` garde son refus d'un
  MARKETING pour une commande (Claude n'en a pas besoin, et l'erreur coûte cher).
- **A8. L'écran au lot 5** : une section « Shopify » en tête de l'écran Automation, visible avec une boutique ; la barre ne
  change pas (le lot 7 la range sous « Scénario ») ; la page vitrine « en cinq temps » attend le lot 7.
- **A9. Les templates de l'ancien assistant** (`shopify_<événement>_<horodatage>`) restent chez Meta ; l'e-mail de bascule
  ne s'écrit que si la sonde trouve un espace Free réel à message actif.

---

### Task 1 : 5-0, les migrations 0299 et 0300

**Files:** Create `db/migrations/0299_shopify_lignes.sql`, `db/migrations/0300_parcours_evenement_origine.sql`,
`tests/migration-0299.test.ts` (modèle : `tests/migration-0297.test.ts`).

- 0299 (transaction, `lock_timeout` 5 s) : `shopify_lignes (tenant_id uuid not null references tenants on delete cascade,
  evenement text not null check (evenement in ('order_paid','order_fulfilled','checkout_abandoned')), workflow_id uuid not
  null references workflows on delete cascade, actif boolean not null default false, modifie_par` (comme
  `shopify_messages`), `modifie_le timestamptz not null default now(), primary key (tenant_id, evenement))`, index sur
  `workflow_id` ; `shopify_boutiques.pause_le` et `.paniers_depuis`, `timestamptz` nulles, sans défaut.
- 0299 aussi (décision 32) : le CHECK de `ventes_attribuees.source` (créé EN LIGNE par 0261, son nom se lit en base AVANT
  d'écrire la migration) admet `commande_payee` et `commande_expediee` : le nouveau posé `not valid`, l'ancien retiré SANS
  `if exists` (un nom faux fait échouer la migration au lieu de laisser l'ancien en place), puis `validate constraint`.
  `ventes_attribuees_relance_chk` ne change pas.
- 0300 (`-- migrate: no-transaction`, idempotente) : `create index concurrently if not exists workflow_runs_evenement_idx on
  workflow_runs (tenant_id, wa_id) where evenement is not null` (tous statuts : la naissance idempotente de la tâche 2).
- Tests : le texte des deux fichiers (colonnes, CHECK, cascades, directive, `if not exists`), `migration-directives` vert ;
  sur le banc, une vente `commande_payee` insérée, une source inconnue refusée.
- Avant `migrate` : la sonde `pg_stat_activity` sur `workflows`, `tenants`, `shopify_boutiques`, `workflow_runs` (script
  pour Julien). Après : relecture en base point par point (`pg_get_constraintdef`, `confdeltype`, prédicat EXACT,
  `indisvalid`), script en lecture seule pour Julien.

### Task 2 : le parcours connaît son message (jaunes 1 et 2 de 4b)

**Files:** `src/workflow/evenement.ts`, `src/workflow/executor.ts` (`parcoursDuClic`, `boutonDuBlocCourant`),
`src/workflow/run-store.pg.ts`, `src/workflow/lancements.ts`, `src/campaign/engine.ts`, `src/webhooks/delivery.ts`,
`src/worker.ts` (câblage partagé : annonce, plomberie), tests `workflow-parcours-evenement`, `campaign-engine`,
`webhook-delivery`, intégration `run-evenement`.

- `EvenementDuParcours.messageId?: string` (l'identifiant Meta du premier message), lu par `schemaEvenement` ; le moteur de
  campagne le passe à la naissance (`res.messageId`).
- Le clic : un parcours d'événement ne reçoit un clic (`btn:`, `card:`, `row:`) sur un message de son bloc de départ que si
  c'est `evenement.messageId`, et jamais un clic sur un message mesuré d'un AUTRE scénario que le sien. Sinon le message va
  au répondeur ou à l'agent comme un message hors parcours, et le parcours continue d'attendre (A5). Un parcours ordinaire
  ne change pas.
- L'échec de livraison : un accusé `failed` sur `evenement.messageId` clôt le parcours s'il n'a pas quitté son bloc de
  départ, en marquant l'événement `premierNonLivre: true` (variables effacées) ; espace résolu par le numéro de l'accusé,
  `tenant_id = $1`, servi par l'index de 0298.
- La naissance idempotente : `evenement_shopify` est refusé (« déjà né pour cet événement ») si un parcours de la même
  origine existe pour ce contact, quel que soit son statut, sauf `premierNonLivre` ; requête servie par 0300 (prédicat
  `evenement is not null` écrit tel quel). La relance automatique fait donc renaître un parcours clos par l'échec, jamais
  un parcours terminé normalement.
- Tests, vus rouges : le clic du panier B ne touche pas A et part au répondeur ; le clic sur « commande expédiée » ne clôt
  pas « commande payée » ; `failed` clôt, `delivered` ne clôt pas, un `failed` d'un autre espace ne touche rien ; une
  seconde naissance de la même origine est refusée, admise après `premierNonLivre`.

### Task 3 : le pont dans le bon ordre (jaunes 3 à 6 de 4b)

**Files:** `src/campaign/engine.ts`, `src/meta/template-components.ts`, `src/workflow/template-send.ts`,
`src/campaign/store.pg.ts`, `src/api/envoi-public.ts`, `src/worker.ts`, tests `campaign-engine`, `v1-sends`,
`campagne-cablage`, `template-components`.

- Ordre : destinataire `sent` et journal du fil écrits AVANT la mesure et la naissance ; la raison d'une naissance refusée
  s'écrit ensuite sur le destinataire, qui reste `sent`. Le chemin « message et scénario » ne change pas.
- Un seul constructeur des payloads de réponses rapides, dans `src/meta/template-components.ts`, utilisé par le pont et par
  `buildWorkflowTemplateComponents`.
- `mesurerEnvoiDuBloc` et `naitreParcoursEvenement` câblées DANS le bloc `dryRun` du worker, comme `noterJoignabilite`.
- `insertCampaignRow` n'écrit jamais `parcours_evenement` pour une campagne RCS ou à scénario (filtre d'`envoi-public` vu
  rouge).
- Tests : numéro délié et crédit levés par la naissance (les mutations M4 et M5 de la relecture rougissent) ; chaque
  « jamais sur un échec » un par un ; « sans la colonne » avec les deux capacités câblées ; l'accusé `failed` arrivé
  pendant la naissance trouve son destinataire.

### Task 4 : les jaunes de 4a qui conditionnent l'allumage

**Files:** `src/workflow/run-store.pg.ts`, `src/workflow/executor.ts`, `src/workflow/lancements.ts`,
`src/webhooks/workflow-advance.ts`, `src/automation/runner.ts` (commentaire), `documentation.md`, tests
`workflow-parcours-evenement`, `workflow-lancements`, `run-store-claims`, intégration `run-evenement`.

- `start` : un statut terminal à l'insertion écrit l'événement sans ses variables (inventaire de `run-store-claims` étendu à
  l'insertion) ; l'escalade d'un départ `deja_envoye` est collante ; l'événement passe `schemaEvenement` avant l'écriture
  (refus nommé, jamais une écriture illisible).
- Au réveil, les gardes du plafond et du graphe absent passent AVANT `reclaimControl`.
- `advance` rend « message pris » ; `avanceDuParcours` le lit au lieu de relire « à nous ».
- Un clic redélivré n'est traité qu'une fois, même si le parcours a quitté le bloc cité entre-temps.
- Textes : le refus d'une naissance devant un opérateur dit l'événement (il ira dans Campagnes) ; le journal distingue un
  refus de Meta d'un opérateur ; un clic sur un parcours plus voulu va au répondeur ou à l'agent ; `documentation.md`
  (« un run endormi est CLOS par le démarrage suivant », invariant 34), `runner.ts`, `lancements.ts`, `cloreAutresActifs`,
  la JSDoc de `cloreSessionDuRun` ; la mémoire d'un agent qui voit un `{{shopify.x}}` rendu est écrite comme acceptée.
- Tests : la colonne `devantUnEvenement` attendue type par type (sur le modèle de `MARKETING_ATTENDU`) avec un faux qui
  distingue les deux clôtures ; le plafond à la réponse et au réveil ; `aUneEcheancePropre` d'un bloc agent ; l'événement
  porté par un saut au réveil ; les variables d'un bloc envoyé par l'outil d'un agent ; « plus voulu » lu avant la reprise.
- Restent au `todo.md` (sans effet sur l'allumage) : les « écarts du parcours ordinaire » de la relecture de 4a.

### Task 5 : arrêter par préfixe, « encore voulu », la fenêtre fermée

**Files:** `src/workflow/run-store.pg.ts`, `src/workflow/executor.ts`, `src/workflow/wiring.ts`, `src/shopify/store.pg.ts`
(lectures), tests `workflow-parcours-evenement`, `wiring-parcours-voulu` (neuf), intégration `run-evenement`.

- `cloreParPrefixe(tenantId, prefixe, waId?)` : `starts_with(evenement->>'origine', $2)` (jamais `like`), statuts
  littéraux, `EFFACER_VARIABLES` ; `arreterParcours({ prefixe, waId? })`. Ligne et pause raisonnent sur l'origine, jamais
  sur `cloreParScenarios` (un saut change `workflow_id`).
- La vraie `parcoursEncoreVoulu` : préfixe autre que `shopify` = vrai ; boutique absente, coupée ou en pause = faux ; ligne
  de l'événement éteinte = faux ; panier : `panierOuvert(jeton)`. Le magasin est passé ENTIER (test par une classe dont la
  méthode lit `this`).
- A4 : pour `run.evenement !== null`, un message de session atteint fenêtre fermée clôt le parcours (journal), sans
  `inbox` ni équipe ; un parcours ordinaire ne change pas.
- Tests : autre espace et autre contact intacts (intégration) ; chaque « faux » vu rouge ; la fenêtre fermée.

### Task 6 : la ligne, son premier bloc, son origine

**Files:** Create `src/shopify/premier-bloc.ts`, `src/shopify/lignes.ts` ; modify `src/shopify/store.pg.ts`,
`src/shopify/envoi.ts`, tests `shopify-premier-bloc` (neuf), `shopify-lignes` (neuf), intégration `shopify-store`.

- Le magasin : lignes (lire, poser, allumer, éteindre), pause et reprise (`paniers_depuis`), `pause_le` dans la boutique lue
  par chaque webhook ; `PANIERS_DUS` joint `shopify_lignes ... and l.actif`, exige `b.pause_le is null` et
  `(b.paniers_depuis is null or p.maj_le >= b.paniers_depuis)`, et rend `l.workflow_id`.
- `premierBloc(tenantId, evenement)` : la ligne, le scénario PUBLIÉ, le bloc VERROUILLÉ lu par `actionOf` (nom sans
  espaces, langue « fr » par défaut, boutons) ; sources effectives (indices du modèle puis sources du bloc) ; une source
  `variable` hors `DONNEES_PAR_EVENEMENT` ou absente = `donnee_manquante` ; rend aussi « a une suite ».
- `EnvoiShopify` porte des `params` ; les variables du destinataire = TOUTES les données de l'événement (jaune 4b) ; le pont
  passé en option quand il y a une suite, que l'offre a `scenarios` et que l'origine tient dans 200 caractères.
- Tests vus rouges : `paniers_depuis` (un panier noté avant la reprise ne part pas), la pause, chaque issue du premier bloc.

### Task 7 : le circuit (réception, relance, arrêt du panier)

**Files:** `src/shopify/traitement.ts`, `src/shopify/relance.ts`, `src/http/shopify-webhooks.ts`, tests
`shopify-traitement`, `shopify-relance`, `shopify-webhook` (attentes changées : le dire dans le commit).

- `servir` : pause = 200 sans réserver ; ligne absente ou éteinte = rien, comme un message inactif aujourd'hui ; premier bloc
  illisible = issue nommée ; sinon l'envoi, réservation, clé, consentement, fiche et issue inchangés.
- `relanceActive` = ligne du panier allumée ET boutique hors pause ; la relance lit le premier bloc une fois par espace et
  par passage ; la branche texte de la relance part.
- Décision 33 : avant d'envoyer la relance d'un panier, la relance arrête les parcours des AUTRES paniers de ce contact
  (préfixe `shopify:<domaine>:checkouts/abandoned:`), pour que la naissance du plus récent trouve la place libre ; un
  parcours de commande n'est jamais arrêté par un panier.
- `fermerSiPanier` arrête les parcours du panier de ce contact (préfixe `shopify:<domaine>:checkouts/abandoned:`), AVANT
  l'envoi de la confirmation, en best-effort (journal, jamais bloquant : il est hors du `try` de `servir`).
- Tests vus rouges : un arrêt en panne n'empêche pas la confirmation ; un panier qui dort ne bloque pas la naissance de
  « commande payée » ; pause = rien ne part, l'attribution continue.

### Task 8 : la gestion, les routes, le MCP, l'ancien assistant

**Files:** `src/shopify/gestion.ts`, `src/shopify/preparation.ts`, `src/http/shopify.ts`, `src/mcp/outils-shopify.ts`,
`src/mcp/outils-modeles.ts` (description), `src/index.ts`, `src/worker.ts` (câblage partagé), `web/lib/partage/actions-journal.ts`,
`db/migrations/0301_bascule_shopify.sql`, `web/public` et la vitrine (`cd web && npm run doc:md`, `npm run vitrine:cas`),
tests `shopify-gestion`, `shopify-preparation`, `http-shopify`, `mcp-serveur`, `journal-libelles`, `web/lib/doc-md.test.ts`.

- `etatShopify` rend les lignes (allumée, scénario, premier template et son état chez Meta, nombre de blocs) et la pause,
  et garde `messages` et `attentes` pour les anciens plugins ; `couperShopify` arrête les parcours de la boutique.
- Routes (sous `g.admin`) : `PATCH /integrations/shopify` `{ pause }` ; `PUT /integrations/shopify/lignes/:evenement`
  `{ actif, delaiMinutes? }` : le premier allumage crée le scénario (rayon `shopify`, nom par événement, un bloc template
  VERROUILLÉ, marque posée par le serveur, sans template chez Meta) et exige `scenarios` ; éteindre arrête les parcours.
- `set_shopify_message` : mêmes paramètres ; crée ligne et scénario d'un bloc s'il manque, sinon remplace le template du
  bloc verrouillé en gardant la suite (refus si les réponses rapides changent et qu'une flèche part d'elles), publie par le
  magasin (la Free n'a pas `scenarios`), patche aussi le brouillon et dit qu'une version programmée est annulée, dit les
  étapes restantes (décision 7) ; `active: false` éteint et arrête. `get_shopify_state` décrit chaque événement par sa
  ligne (« seule la première étape part » en Free).
- L'assistant : sa route refuse avec une phrase (l'ancien écran l'appelle encore) ; `activerSelonStatut` (worker) et
  `relireAttentes` (API) retirés du câblage ; `traiterOubli` garde son consommateur.
- 0301 (`migration=avant` au déploiement de 5b) : les anciens messages éteints (`actif = false`) et les attentes vidées.
- Journal : `shopify.pause`, `shopify.reprise`, `shopify.ligne`.

### Task 9 : le verrou, le ménage chez Meta, l'attribution

**Files:** `src/http/workflows.ts`, `src/workflow/store.pg.ts`, `src/templates/modeles-de-bloc.ts`, `src/shopify/preparation.ts`,
`src/shopify/ventes.pg.ts` et voisins selon Q1, tests `http-workflows`, `workflow-store`, `shopify-menage` (neuf),
`shopify-attribution`.

- Verrou serveur (décisions 13, 23) : pour un scénario du rayon `shopify`, `PATCH` et `publish` refusent un graphe dont le
  bloc marqué manque, n'est pas un template, reçoit une arête ou un « Aller à » ; `GET /nodes` au rayon du scénario édité
  (jaune du lot 2) ; `DELETE /workflows/:id` d'un scénario tenu par une ligne est refusé en nommant la ligne
  (`UTILISATIONS`).
- Ménage (§ 5.1) : à chaque mise en ligne d'un scénario `shopify`, les templates que le publié ne nomme plus ET marqués dans
  `modeles_de_bloc` sont programmés à l'oubli sur la file existante (job discriminé), relus 15 min plus tard (marque, aucun
  graphe de l'espace ne les nomme), puis supprimés (garde des campagnes actives). Jamais au rayon `general`.
- Jaune 3a « lignes en validation à vie » : réglé ici (l'état d'une ligne en dépend).

### Task 10 : le retour sur investissement par automation (décision 32)

**Files:** `src/shopify/attribution.ts` (`SourceVente`), `src/shopify/ventes.pg.ts` (`TOUCHES`),
`src/shopify/perimetre-leviers.ts`, `src/shopify/cout-leviers.pg.ts`, `src/shopify/chiffre.ts`, `src/shopify/roi.ts`,
`src/mcp/outils-chiffres.ts` (`get_revenue_stats`), tests `shopify-attribution`, `shopify-perimetre-leviers`,
`shopify-roi`, `shopify-chiffre`, intégration `ventes-store`.

- Un message envoyé par un bloc d'un scénario tenu par une ligne (mesure `workflow_node_events.meta_message_id`, jointe à
  `shopify_lignes.workflow_id`) est une touche de l'automation de cette ligne : le panier entier en `relance_panier`
  (`relance_le` = l'envoi qui touche), « Commande payée » et « Commande expédiée » sous `commande_payee` et
  `commande_expediee`. Le premier message d'une commande reste hors leviers (il suit la vente) ; la relance prouvée par le
  panier ne change pas.
- Le coût du ROI lit le même périmètre ; `get_revenue_stats` et le chiffre donnent une ligne par automation, libellés
  « Panier abandonné », « Commande payée », « Commande expédiée ». Les libellés de la console suivent en 5c (tâche 11).
- Tests vus rouges : chaque source, la dernière touche entre une campagne et un bloc de ligne, le coût par automation, un
  bloc du rayon `general` qui reste « Scénarios ».

### Task 11 : la console Shopify

**Files:** `web/app/automations/page.tsx`, `web/components/ReglageShopify.tsx`, suppressions `ShopifyAssistant.tsx`,
`web/lib/shopify-assistant.ts` (+ test), `web/lib/api-shopify.ts`, e2e `shopify.spec.ts`.

- Section « Shopify » en tête de l'écran Automation (visible avec une boutique) : trois lignes, interrupteur, état (à créer,
  éteinte, en validation chez Meta, active, nouvelle version en validation), délai du panier (`DELAIS_PROPOSES`), « Ouvrir le
  scénario ». `ReglageShopify` perd la liste et l'assistant, gagne la pause. Chaque route neuve tolère le 404.
- Le retour sur investissement (décision 32) : une ligne par automation dans Quantitatif et sur la fiche contact
  (`web/lib/ventes.ts`, `web/lib/partage/achats-shopify.ts`).

### Task 12 : le builder d'un scénario Shopify

**Files:** `web/components/WorkflowBuilder.tsx`, `WorkflowConfigPanel.tsx`, `SourceDeVariable.tsx`, le formulaire de
template en mode bloc, tests de composant et e2e.

- Le bloc verrouillé (ni ✕, ni arête entrante, toujours template, formulaire prérempli par `TEXTES_PROPOSES` et la catégorie
  proposée) ; les données Shopify dans le choix des variables d'un template, rangées sur le BLOC (source `variable`, exemples
  `EXEMPLES_DONNEES`), jamais dans les indices du template ; `{{shopify.x}}` dans le texte d'un message rapide ou d'une
  question, au rayon `shopify` seulement ; « Aller à » du rayon ; le lien de test avec des données d'exemple.
- Jaunes 3b (« Modifier ce template » proposé sur un template que Templates refuse, choix de variables écrasés par le sondage,
  phrase contradictoire de l'étape 7) et lot 2 (« chemins morts signalés »).
- `npm run lint` dans `web/`, suite web entière, e2e sur une console de production construite.

### Task 13 : plugin, aide, doc

**Files:** `plugin/skills/shopify/SKILL.md`, `plugin/.claude-plugin/plugin.json` (version montée), `features.md`
(§ « Boutique Shopify »), `docs/aide/fiches/brancher-ma-boutique-shopify.md` (+ capture, `vitrine:aide`, `en/`),
`documentation.md`, `docs/JOURNAL-TECHNIQUE.md`, `todo.md`, `web/lib/mcp-outils.ts`.

- La fiche et son empreinte dans le MÊME commit que `features.md` (`tests/aide-proposer.test.ts` avant le push) ; la
  publication du plugin et `aide:charger` par Julien, dans cet ordre, après l'API et la console.

## Décisions de Julien après la cartographie (2026-11-19, spec § 3.3)

- **32 (Q1, décision 10)** : le retour sur investissement montre UNE LIGNE PAR AUTOMATION Shopify (tâches 1 et 10).
- **33 (Q2, décision 3 pour la ligne du panier)** : la relance d'un second panier arrête le parcours du panier précédent du
  même contact ; le plus récent a son propre parcours (tâche 7). Les commandes gardent la décision 3.
