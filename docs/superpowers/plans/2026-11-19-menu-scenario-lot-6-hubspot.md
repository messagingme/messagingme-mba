# Menu « Scénario », lot 6 : HubSpot (changement d'étape, rendez-vous, lancés par un workflow)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** les trois familles HubSpot deviennent des automations du rayon `hubspot`, sur le modèle de Shopify (lot 5) :
leur premier bloc est un template envoyé par l'envoi public qui ne coupe pas le fil, le parcours d'événement du lot 4 naît
sur ce bloc, et la suite se construit dans le builder. L'action des workflows HubSpot ne voit plus que les scénarios du
rayon `hubspot`. Les automations « changement d'étape » du Builder général s'éteignent (décision 8).

**Architecture:** aucune table neuve : `automations` porte le rayon `hubspot` (le rendez-vous exige `automation_fires`,
clé étrangère de 0052). Deux types de lancement : `evenement_hubspot` (étape et rendez-vous, un envoi à UN client qui
publie ses étiquettes, décision 36) et `workflow_hubspot` (l'action d'un workflow, de masse, décision 24). Le pont du
lot 4b (`parcoursEvenement`), aujourd'hui écrit pour `evenement_shopify` seul, s'ouvre aux types d'événement HubSpot ; le
verrou du premier bloc, `premierBloc` et « encore voulu » s'ouvrent au rayon `hubspot`. Le runner ordinaire et le
balayage de dates du worker ne lisent plus que le rayon `general`. Les données du deal se lisent sur la fiche (décision 38).

**Tech Stack:** TypeScript, Fastify, Postgres (`pg`), pg-boss, Next.js (console), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md` : § 2.2, § 3 (décisions 1 à 40, dont
36 à 40 pour ce lot), § 5.3, § 5.5, § 5.6, § 5.8, § 7. Carte du code (relue sur `c88c309e8`, les symboles font foi, les
lignes bougent) : la section « Carte » ci-dessous.

## Méthode de livraison

**Implémenteur par lot et revue humaine du diff**, pour 6a, 6b et 6c : le lot réécrit le chemin que la production emprunte
pour chaque événement HubSpot (étape, rendez-vous, action de workflow), porte une bascule irréversible (6b), et touche
des invariants que le compilateur ne voit pas (une place d'événement par contact, une naissance par origine, la décision
24, le consentement de service). **En direct** pour 6d (aide et doc : du texte réversible). L'essai réel qui clôt la
feature est celui de la section « Essai réel », plus bas, sur le portail HubSpot de test relié à la SANDBOX.

## Carte (cartographie du 2026-11-19)

- **Étape** : `POST /hubspot/deal-stage` (`src/http/hubspot-events.ts:77-143`) crée la fiche, écrit les `hs_*`, publie en
  file ; le worker (`src/worker.ts:446-453`) démarre en `automatisme_ordinaire` (`src/automation/match.ts:89-93`,
  `src/workflow/lancements.ts:262`) ; rien ne part si le fil est tenu (`src/workflow/executor.ts:2060-2064`). La route
  ignore l'offre (modèle : `gardesEspace`, `src/http/hubspot-workflow.ts:205-215`).
- **Rendez-vous** : balayage du worker (`src/worker.ts:2013-2026`), claim par marqueur (`src/automation/runner.ts:295-299`).
  L'envoi public ne vit que dans l'API (`src/index.ts:1607`) : le balayage du rayon `hubspot` vit dans l'API, comme
  `relancerPaniers` (`src/index.ts:4095-4104`). Clé `hs_` à exiger (`src/http/automations.ts:199-208`).
- **Workflow** : liste et lancement lisent `listPublies(t, 'general')` (`src/index.ts:2381`, épinglé
  `tests/hubspot-workflow-cablage.test.ts:48`), refusent `conseiller_en_main` (`src/http/hubspot-workflow.ts:356-359`),
  envoient `{ scenario }` (`src/hubspot-workflow/envoi.ts:101-110`), démarrés en `workflow_hubspot`
  (`src/campaign/engine.ts:843-852`). Le pont n'existe que pour une cible template (`src/api/envoi-public.ts:643`).
- **À ouvrir au rayon `hubspot`** : le pont (littéral `'evenement_shopify'`, `src/campaign/parcours-evenement.ts:26`,
  `src/worker.ts:967-971`), `premierBloc` (`src/shopify/premier-bloc.ts:92`), le verrou (`src/http/workflows.ts:242`,
  `src/workflow/publication.ts:35`), « encore voulu » (`src/workflow/wiring.ts:663-664`, une origine `hubspot:` reste
  voulue, `src/shopify/parcours-voulu.ts:34`).
- **Jaunes de l'écran « Autres »** : écritures par identifiant sans rayon (`src/automation/store.pg.ts:179-253`), limite
  et gel tous rayons (`src/offres/automations.ts:21-24`), étape encore créable (`src/http/automations.ts:162-171`).

## Invariants (Review Focus)

- Une place d'événement par contact, toutes sources : l'index 0298, prédicat repris mot pour mot.
- Une naissance par origine, tous statuts (0300, `executor.ts:1970`) : l'origine HubSpot porte la fenêtre de 24 h de la
  décision 37 (`hubspot:etape:<ligne>:<deal>:<étape>:<jour UTC>`, `hubspot:rdv:<ligne>:<contact>:<champ>:<date>`, un seul
  constructeur, `src/hubspot/origine.ts`), en 200 caractères au plus (`src/workflow/evenement.ts:34`). Relu en 6b : la
  LIGNE y entre (écart accepté : deux lignes sur la même étape font deux parcours, et éteindre ou supprimer une ligne
  arrête les siens par préfixe) ; le PORTAIL n'y est pas (il ne se lit que par le réseau du connecteur, jamais en base).
  L'origine est aussi la clé d'idempotence de l'envoi du premier bloc.
- « Encore voulu » d'une origine `hubspot:` relit sa ligne (`src/hubspot/parcours-voulu.ts`) : absente, éteinte ou d'une
  autre famille, le parcours se clôt ; une origine `hubspot:` illisible n'est plus voulue.
- Le verrou du premier bloc ne vaut que si la version de référence PORTE un bloc marqué (`refusSelonLeVerrou`) : un
  scénario lancé par un workflow (déplacé par la bascule, ou créé par sa ligne) s'enregistre, se publie et se met en ligne
  librement, mais un corps reçu n'y pose jamais de marque.
- Décision 24 : `ne_en_masse = !publieLesEtiquettes` (`executor.ts:2174-2177`) ; `workflow_hubspot` garde `false`
  (`lancements.ts:275`), `evenement_hubspot` publie (décision 36).
- `workflow_hubspot` remplace un parcours Shopify (`lancements.ts:206`) ; les types neufs cèdent (décision 3).
- Consentement : jamais le `consent: 'opted_in'` de Shopify (`src/shopify/envoi.ts:87`) ; HubSpot n'atteste que par
  `accordMarketing`, `serviceSeulement` reste (`src/hubspot-workflow/envoi.ts:100`, `:127`). Les lignes d'étape et de
  rendez-vous n'ont pas d'`accordMarketing` : leur premier bloc part sans consentement écrit, Service seulement
  (`src/hubspot/circuit.ts`).
- Plafonds : seul le runner borne une étape changée en masse (`runner.ts:257-270`) ; le compteur Shopify ne compte rien
  (`src/shopify/envoi.ts:91`) : le plafond par ligne de la décision 36 se reporte sur le nouveau circuit (6b :
  `servirLigneHubspot`, `AUTOMATION_MAX_FIRES_PER_HOUR` compté sur `automation_fires`, la ligne étant une automation).
- `listEnabled` et `tenantsAvecDeclencheurDate` filtrent le rayon `general` depuis 6a (épinglé
  `tests/automations-rayon.test.ts`) : le runner et le balayage de dates du worker ne relisent jamais une ligne `hubspot`
  (sans filtre, le runner la relirait, la refuserait, et son tir serait effacé). Les rendez-vous HubSpot ont leur propre
  balayage, dans l'API (`src/hubspot/rendez-vous.ts`).
- `PREFIXE_LIGNE_HUBSPOT` décide `workflow_hubspot` (`src/hubspot-workflow/ligne.ts:18-19`) et l'exclusion des leviers
  (`src/shopify/perimetre-leviers.ts:30-33`) : les lignes neuves le respectent.
- « Un parcours tient le fil » et `pendantUneAttente` (`executor.ts:2406-2419`) : génériques, testés par famille.

## 6a : le moteur, inerte (`migration=aucune`)

1. **Les types de lancement** (`src/workflow/lancements.ts`) : `evenement_hubspot` (unitaire, publie ses étiquettes,
   cède comme les types neufs) ; `workflow_hubspot` inchangé. Tests : `tests/workflow-lancements.test.ts` (priorités,
   `ne_en_masse`).
2. **Le pont et le premier bloc au rayon `hubspot`** : le type d'événement du pont devient un ensemble
   (`evenement_shopify`, `evenement_hubspot`) ; `premierBloc`, le verrou du premier bloc à l'enregistrement et à la
   publication, et « encore voulu » pour une origine `hubspot:`. Tests : ceux du pont et du verrou existants, plus un cas
   `hubspot` chacun.
3. **Le runner et le balayage de dates du worker au rayon `general`** (`listEnabled` filtre le rayon ; le test épinglé
   change délibérément, avec sa raison).
4. **Les jaunes « Autres »** : les écritures par identifiant filtrent le rayon `general` ; la limite d'automations de
   l'offre et le gel ne comptent que le rayon `general` (les lignes HubSpot ont leur plafond, décision 36) ; « changement
   d'étape » n'est plus créable dans Autres (refus propre, message qui renvoie à Automation > HubSpot).
5. **L'origine HubSpot et sa fenêtre** (décision 37) : un constructeur unique d'origine, borné à 200 caractères, testé.
6. **Vérifier** : suite racine, `tsc`, `lint`, auto-attaque ; e2e aucun (rien ne change à l'écran sauf le refus de 4).

## 6b : les circuits et la bascule (`migration=avant`, après la sonde de Julien)

1. **Étape** : la route trouve la ligne (rayon `hubspot`, `hubspot_deal_stage`, pipeline et étape), lit l'offre
   (`gardesEspace`), envoie le premier bloc PUBLIÉ par l'envoi public avec le pont, comme `servir` le fait pour Shopify ;
   consentement de service ; plafond par ligne ; origine de la tâche 5.
2. **Rendez-vous** : le balayage du rayon `hubspot` dans l'API (comme `relancerPaniers`), clé `hs_` exigée, claim par
   marqueur, même envoi.
3. **Workflow** (décision 41) : les deux actions (« Lancer un scénario », « Lancer un scénario (transaction) ») listent
   et lancent les scénarios publiés du rayon `hubspot` marqués « lancés par un workflow » (une marque : un `trigger_kind`
   `hubspot_workflow` hors `kindsFor`), avec l'ENVOI D'AUJOURD'HUI (`{ scenario }`, type `workflow_hubspot`, le flux du
   devis PDF inchangé) ; un scénario du Builder ressort en `scenario_refuse` avec son message (décision 39) ; le refus
   `conseiller_en_main` RESTE ce soir (la décision 2 pour cette famille et l'envoi par le pont passent au lot 6e). Le
   jaune `resolveScenario` (`src/ids/resolve.ts:31-32`) tombe : la résolution reçoit le rayon. Tests qui changent :
   `http-hubspot-workflow`, `hubspot-workflow-cablage` (`listPublies` au rayon `hubspot`), `campagne-cablage`.
4. **Les routes des lignes HubSpot** (lister, créer, régler, allumer, éteindre), au modèle de `src/shopify/lignes-gestion.ts`,
   chaque requête sur `tenant_id = $1`, dans le registre des routes (`modulesDeRoutes`, classe `tenant`). Le contrat,
   fixé ici pour que la console (6c) se construise en même temps :

   ```
   GET    /tenants/:tenantId/hubspot/lignes          -> { connecte: boolean, automationsCoupees: boolean,
                                                          workflowsCoupes: boolean, lignes: LigneHubspotVue[] }
   POST   /tenants/:tenantId/hubspot/lignes          { famille, config, nom? } -> 201 { ligne: LigneHubspotVue }
   PUT    /tenants/:tenantId/hubspot/lignes/:id      { actif: boolean } -> { ligne: LigneHubspotVue }   (ce soir, l'interrupteur seul)
   DELETE /tenants/:tenantId/hubspot/lignes/:id      -> 204 (arrête ses parcours ; le scénario reste, hors liste)
   Tout refus : { error: string, code?: string }, une phrase en français que la console affiche telle quelle.

   LigneHubspotVue = {
     id: string                      // l'automation, rayon hubspot
     famille: 'etape' | 'rdv' | 'workflow'
     config:                         // selon la famille
       | { pipelineId: string, stageId: string, stageLabel?: string }                 // etape
       | { fieldKey: string /* hs_… */, sens: 'avant' | 'apres', delaiMinutes: number } // rdv
       | {}                                                                            // workflow
     actif: boolean
     workflowId: string, scenario: string | null
     modele: string | null, langue: string | null, etatChezMeta: string | null       // comme LigneShopifyVue
     blocs: number, versionProgrammee: boolean
   }
   ```

   `POST` crée l'automation ET son scénario (rayon `hubspot`, premier bloc template verrouillé, vide ; pour la famille
   `workflow`, un bloc template NON marqué), ligne éteinte ; la console ouvre alors le builder, et peut renommer le scénario
   par `PATCH /tenants/:t/workflows/:id { name }`. Une étape déjà réglée (même paire pipeline et étape) est refusée en 409
   (`etape_deja_reglee`). `actif: true` sans premier template publié est refusé en 409 (`a_completer`). Un rendez-vous
   n'accepte qu'une propriété date et heure `hs_*` déclarée dans l'espace, `sens` `avant` ou `apres`, un délai entier
   positif d'au plus 30 jours. `modele` se lit sur le graphe PUBLIÉ. Les rôles : ceux de l'écran Automation d'aujourd'hui
   (lecture à tous, écritures aux administrateurs) ; l'offre : `crm` (Entreprise), qui borne aussi la création, la limite
   d'automations ne comptant que le rayon général.
5. **La bascule** (migration, `avant`) : les `hubspot_deal_stage` du rayon `general` s'éteignent (la sonde du
   2026-11-19 n'en trouve qu'une, déjà éteinte, sur la SANDBOX) ; « Date d'un champ » reste dans Autres (décision 40) ; et
   (décision 41) les scénarios qu'une action de workflow HubSpot a lancés dans les 90 derniers jours (campagnes
   `HubSpot · workflow …`) passent au rayon `hubspot` avec leur ligne `hubspot_workflow` allumée, SAUF ceux qu'une
   automation du rayon `general` vise encore (la migration les laisse et le dit par un `raise notice`). La sonde en a
   trouvé quatre : MUTAC `devis_avec_pdf` (lancé le matin même) et `devis` (3 parcours vivants), « Messaging Me demo »
   `testPDF`, SANDBOX `tets question`. 🔴 À PROUVER par un test avant d'écrire la migration : un parcours VIVANT d'un
   scénario déplacé (MUTAC `devis` en a trois) continue après le changement de rayon (l'exécuteur, le réveil, l'avance
   sur un clic et le balayage des parcours lisent-ils le graphe sans filtre de rayon ?) ; sinon, la migration ne déplace
   pas un scénario qui a des parcours vivants, et le dit. Après : relecture en base point par point, et un essai du
   workflow de MUTAC le lendemain matin.

## 6c : la console (construite en même temps que 6b, poussée après son déploiement)

Sur le contrat de la tâche 4 de 6b, contre une API simulée dans les e2e : un composant `AutomationsHubspot`
(`web/components/AutomationsHubspot.tsx`, client `web/lib/api-hubspot-lignes.ts`, états purs dans
`web/lib/hubspot-lignes.ts` au modèle de `web/lib/shopify-lignes.ts`), rendu sous la section Shopify de l'écran Automation
(le lot 7 le range ensuite sur `/automations/hubspot`). La section HubSpot (visible avec un portail relié) : les étapes réglées (« Ajouter » : pipeline et
étape), les rendez-vous (champ date `hs_` et délai), les scénarios lancés par un workflow (« Ajouter ») ; chaque ligne avec
son interrupteur, son état et « Ouvrir le scénario » ; le builder d'un scénario `hubspot` (premier bloc verrouillé ; les
variables lisent les champs de la fiche). Autres sans « changement d'étape ». E2E sur le build de production (port libre).

## 6d : l'aide et la doc (en direct)

`features.md` (§ HubSpot et automations), les fiches HubSpot et automations (français et anglais, empreintes, captures),
`documentation.md`, le journal, `todo.md` ; `aide:charger` par Julien.

## La sonde avant la bascule (Julien, machine des workers, lecture seule, sans `SET`)

```sql
select t.name, a.name, a.enabled, a.trigger_config, (select max(fired_at) from automation_fires f where f.automation_id = a.id) dernier
from automations a join tenants t on t.id = a.tenant_id
where a.trigger_kind = 'hubspot_deal_stage'
   or (a.trigger_kind = 'avant_date' and starts_with(a.trigger_config->>'fieldKey', 'hs_'))
order by a.trigger_kind, a.enabled desc;

select t.name, w.code, w.name, w.rayon, count(distinct c.id) envois, max(c.created_at) dernier,
  (select count(*) from workflow_runs x where x.workflow_id = w.id and x.status in ('waiting', 'sleeping')) vivants
from campaigns c join tenants t on t.id = c.tenant_id
join workflows w on w.id = c.workflow_id and w.tenant_id = c.tenant_id
where starts_with(c.name, 'HubSpot · workflow ') and c.created_at > now() - interval '90 days'
group by t.name, w.id order by dernier desc;
```

## Déploiement

6a (`migration=aucune`) ; la sonde ; 6b (`migration=avant`) ; 6c (console, après 6b) ; 6d ; puis le lot 7. Chaque
déploiement de l'API attend l'approbation de Julien dans GitHub.

## Essai réel

Sur le portail HubSpot de test relié à la SANDBOX : un changement d'étape réel lance le premier template puis sa suite ;
un rendez-vous de test reçoit son rappel ; un workflow HubSpot lance un scénario du rayon `hubspot`, et un ancien
workflow qui vise un scénario du Builder ressort en `scenario_refuse`. Numéros libres dans `docs/prive/ESSAIS-REELS.md`.
