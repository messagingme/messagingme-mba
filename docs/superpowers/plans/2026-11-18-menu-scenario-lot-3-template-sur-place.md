# Menu « Scénario », lot 3 : écrire ou modifier un template depuis son bloc, et la publication programmée

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dans le Builder, un bloc template peut écrire un nouveau template ou modifier le sien sans quitter le scénario ;
« Publier » pendant la validation de Meta programme la mise en ligne à l'approbation, et un template non approuvé est
refusé proprement à l'envoi.

**Architecture:** un template créé depuis un bloc passe par `creerUnModele` (chemin unique de création), sous un nom
généré par le serveur, et laisse une ligne dans une table neuve (`modeles_de_bloc`) : la marque « créé par le builder »
et son état tranché par Meta. La publication programmée est une copie du brouillon posée sur la ligne du scénario
(`workflows.programmed_graph`), que seul le magasin des scénarios met en ligne, par UNE instruction conditionnée à sa
date : toute publication explicite entre-temps l'efface et l'emporte. Le statut de Meta arrive par le webhook (worker)
et par un filet (API), comme pour l'assistant Shopify (`src/shopify/preparation.ts`, le modèle à suivre).

**Tech Stack:** TypeScript, Fastify, Postgres (`pg`), pg-boss, vitest, Next.js (web/), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md` (décisions 6, 14, 18, 19, 27 ; § 5.1).
Carte du code : run `wf_22150a37-515` de la session, `journal.jsonl` (lot 3, instantané 7db19df1c, relu sur f818a8953).

## Méthode de livraison

**Implémenteur par lot et revue humaine du diff**, en trois livraisons, parce que le lot touche trois chemins que la
production emprunte : la publication de TOUS les scénarios (une garde neuve devant chaque mise en ligne, et un second
écrivain du graphe publié), l'envoi de chaque bloc template (la garde de statut), et la file webhook du worker, celle des
messages entrants (le statut des templates y passe). Les invariants y sont invisibles au compilateur (« seule une
publication explicite écrit le publié », « un e-mail une seule fois », « le nom naît côté serveur »). Une relecture
indépendante unique par livraison de code (3a, 3b).

1. **3a-0, la migration seule** (tâche 1) : poussée seule, déployée `migration=avant`, AVANT que son code n'arrive sur
   `main` : le code neuf écrit la table et les colonnes, l'ancien les ignore et y survit.
2. **3a, le serveur** (tâches 2 à 6) : déployé `migration=aucune`. Aucun écran ne l'appelle encore : sans la console de
   3b, aucun template de bloc n'existe, donc ni refus ni programmation ne peuvent se produire ; seule la garde à l'envoi
   change un comportement visible (un template non approuvé n'est plus envoyé à Meta pour qu'il le refuse).
3. **3b, la console et l'aide** (tâches 7 et 8) : poussée APRÈS le déploiement de 3a (un écran qui appelle une route neuve
   casse dès le push).

**Essai réel qui clôt le lot** (numéro libre dans `docs/prive/ESSAIS-REELS.md`) : sur la SANDBOX, un scénario publié qui
envoie un template A. « Modifier ce template » crée B, en validation chez Meta. Le scénario en ligne envoie toujours A
(lancé par Claude Code, `send_scenario_to_contact`, pas par le lien de test) ; le lien de test, qui joue le brouillon, dit
« en validation chez Meta » au lieu d'une erreur de Meta. « Publier » répond « mise en ligne programmée ». À
l'approbation, l'e-mail « en ligne » arrive, l'envoi suivant porte B, et A reste dans Contenu > Templates. Puis une
campagne active sur ce scénario : « Publier » pendant une validation est refusé avec la phrase qui le dit.

## Global Constraints

- Aucun tiret cadratin ni demi-cadratin (code, commentaires, doc, textes de la console, e-mails) ; la console vouvoie.
- `tenant_id = $1` sur chaque requête neuve, sauf les deux lectures transverses du filet, nommées comme
  `attentesAnciennes` (`src/shopify/store.pg.ts`). Aucun `from workflows` hors de `PgWorkflowStore`.
- Le nom d'un template de bloc naît côté SERVEUR, jamais dans le corps reçu (décision 19) : `nomDuModeleDeBloc`, le nom
  du scénario ramené à `[a-z0-9_]` (accents retirés, 40 caractères au plus, `scenario` s'il ne reste rien), puis `_` et
  l'horodatage en base 36.
- Un template de bloc n'est JAMAIS modifié chez Meta (`modifierUnModele` : renvoi en revue, une modification par 24 h) ni
  supprimé (décision 27) : une modification crée un nouveau template.
- Ni carousel ni en-tête média dans l'édition sur place (décision 27) : ils se créent dans Contenu > Templates.
- E-mails aux administrateurs de l'espace (`a: 'admins'`), une seule fois par occasion (`occasion` = scénario et date de
  programmation), et seulement pour une publication PROGRAMMÉE : « en ligne » ou « refusé » (décision 18).

## Appels du rédacteur (à relire)

1. **La programmation vit sur la ligne du scénario** (`programmed_graph`, `programmed_at`, `programmed_by`) plutôt que dans
   une table : la mise en ligne et toute publication explicite (`publish`, `remplacerPublieParApi`) s'excluent alors par
   une seule instruction, sans transaction (la mise en ligne exige `programmed_at = $date` ; une publication explicite
   remet les trois colonnes à null).
2. **Une campagne devenue active APRÈS la programmation fait attendre la mise en ligne**, sans l'annuler : le filet la
   retente, et le builder dit pourquoi elle attend. Une mise en ligne automatique ne tombe jamais sous une campagne
   active ; une publication à la main reste libre, comme aujourd'hui.
3. **Pas d'e-mail pour un template refusé hors programmation** : le builder affiche le refus et sa raison (pastille, ligne
   d'état), et « Publier » le dit (422). Décision 18 : les e-mails disent « en ligne » ou « refusé » d'une publication
   programmée.
4. **Pas d'état « remplacé »** : plusieurs templates d'un même bloc peuvent être en validation ; compte celui que le
   brouillon (ou la version programmée) nomme. Pas de colonne `remplace` : le ménage des rayons (lots 5 et 6) la calculera
   à la publication qui retire l'ancien.
5. **Les flèches suivent le texte des boutons** : à la pose d'un nouveau template, une flèche `btn:<i>` va au bouton du
   nouveau template qui porte le même texte, sinon elle disparaît ; les autres poignées (« Pas de réponse ») restent.
6. **La garde à l'envoi ne juge que la version de la langue du bloc** (`info.langue === language`) : un repli sur le nom
   seul laisse Meta trancher, comme aujourd'hui. Branche des indices seulement (pas `explicitParams` de la campagne).
7. **L'aide est réécrite au lot 3**, avec une NOUVELLE section de `features.md` (« Écrire un template depuis un scénario »),
   pour ne pas périmer les 17 fiches qui citent « Automatisations ».

## Review Focus

- **Compte 360dialog** : le statut que rend la lecture de ses templates (casse, absence) ne doit pas faire refuser un
  template approuvé à l'envoi : la garde compare sans casse, et un test le fixe.
- **Publication à la main entre la programmation et l'approbation** : la mise en ligne ne fait RIEN (instruction
  conditionnée à `programmed_at`), test d'intégration sur le Postgres de la CI.
- **Statut rejoué par Meta et filet** : une seule mise en ligne, un seul e-mail.
- **Nouveau template sans le bouton du milieu** : aucune flèche ne mène à la mauvaise branche ; « Pas de réponse » reste.
- **Le brouillon ne nomme plus le template approuvé ou refusé** (le marchand a changé d'avis) : rien n'est mis en ligne ni
  envoyé, aucune erreur.

---

### Task 1: la migration (3a-0)

**Files:** Create `db/migrations/<NNNN>_modeles_de_bloc.sql` (numéro lu par `npm run migrations` sur une copie à jour
d'origin, au moment d'écrire), `tests/migration-<NNNN>.test.ts` (modèle : `tests/migration-0293.test.ts`).

- Table `modeles_de_bloc` : `tenant_id` (clé étrangère vers `tenants`, en cascade), `workflow_id` (vers `workflows`, en
  cascade), `node_id`, `modele`, `langue`, `etat` (CHECK `en_validation`, `approuve`, `refuse`), `raison` (300 au plus),
  `categorie`, `par`, `cree_le`, `tranche_le`. Clé primaire `(tenant_id, modele, langue)` ; index `(tenant_id,
  workflow_id)` (lecture du scénario, suppression en cascade).
- `workflows` : `programmed_graph jsonb`, `programmed_at timestamptz`, `programmed_by text`, nulles, sans défaut.
- `set local lock_timeout = '5s'` (clés étrangères vers deux tables chaudes, `alter` de `workflows`).
- Test miroir : colonnes, CHECK égal à la liste du code (`ETATS_MODELE_DE_BLOC`), cascades, lock_timeout. Vu FAIL avant.
- Avant `migrate` : `pg_stat_activity` (aucune transaction longue sur `workflows`). Après : relecture en base (colonnes,
  `pg_get_constraintdef`, `confdeltype = 'c'`). Récit au journal, § « Les migrations, une par une ».

### Task 2: le magasin (table et programmation)

**Files:** Create `src/workflow/modeles-de-bloc.pg.ts`, `tests/integration/modeles-de-bloc.integration.test.ts`.
Modify `src/workflow/store.pg.ts`.

**Interfaces (Produces):**
- `PgModelesDeBloc` : `inserer(l)`, `duScenario(tenantId, workflowId)`, `desModeles(tenantId, paires)`,
  `trancher(tenantId, modele, langue, etat: 'approuve' | 'refuse', raison): Promise<Ligne | null>` (`update ... where
  etat = 'en_validation' returning` : seul un passage gagne), `attentesAnciennes(minutes, limite)` (transverse).
- `PgWorkflowStore` : `programmer(id, tenantId, par): Promise<{ le: string } | null>` (copie `draft_graph`) ;
  `publicationProgrammee(id, tenantId)` ; `programmeesDeLEspace(tenantId)` ; `programmeesAnciennes(limite)`
  (transverse) ; `mettreEnLigneLaVersionProgrammee(id, tenantId, le): Promise<WorkflowRow | null>` (UNE instruction,
  `where programmed_at = $3` ; le brouillon tombe s'il est identique à la version programmée aux positions près, même
  règle que `update`) ; `annulerProgrammation(id, tenantId, le): Promise<boolean>`. `publish` et `remplacerPublieParApi`
  remettent les trois colonnes à null.

Tests d'intégration (CI) : programmer puis publier à la main, la mise en ligne rend null et ne touche pas le publié ;
deux mises en ligne concurrentes, une seule gagne ; tranchage rejoué, un seul `returning` ; un autre espace ne voit rien.
Vérifiés dans les deux sens (condition retirée : le test rougit).

### Task 3: la porte « template d'un bloc »

**Files:** Create `src/workflow/modeles-de-bloc.ts`, `tests/workflow-modeles-de-bloc.test.ts`. Modify `src/http/templates.ts`
(exporter la lecture du corps : `parseTemplateFields`, `indicesDe`, `enteteDe`, `sourcesAEnregistrer`, sans changer POST ni
PATCH).

**Interfaces (Produces):** `nomDuModeleDeBloc(nomScenario: string, maintenant: Date): string` ;
`creerModeleDuBloc(deps, tenantId, { workflowId, nodeId, corps, par })` : lit le scénario (`getById`, graphe de l'éditeur),
exige un bloc `template` de ce graphe, refuse carousel et en-tête média, nomme, crée par `creerUnModele`, insère la ligne
(état selon le statut rendu par Meta, `approuve` d'emblée possible), rend `{ modele, langue, etat, categorie, boutons }`
ou un refus `{ code, erreur }`.

Tests : le nom n'est jamais pris du corps ; bloc inconnu ou d'un autre type, scénario d'un autre espace : refus ; filière
application (aucun WABA) : refus lisible ; catégorie reclassée par Meta rendue telle quelle ; nom : accents, vide, longueur.

### Task 4: publier ou programmer, et la mise en ligne

**Files:** Modify `src/workflow/modeles-de-bloc.ts`, `src/http/workflows.ts`, `tests/workflows.test.ts`,
`tests/routes-inertes.ts`, `web/lib/partage/actions-journal.ts`.

**Interfaces (Produces):**
- `jugerPublication(deps, tenantId, workflowId, brouillon)` : les templates de bloc que le brouillon nomme ; ceux en
  validation relus chez Meta (`statutModele`) puis tranchés ; rend `publier`, `programmer` (ce qu'on attend) ou un refus
  `modele_refuse` (avec la raison de Meta) ou `campagne_active` (`lanceursDuScenario`, type `campagne`).
- `tenterMiseEnLigne(deps, tenantId, workflowId)` : `rien`, `attend_modeles`, `attend_campagne`, `annulee` (un template
  refusé ; e-mail « refusé ») ou `en_ligne` (e-mail « en ligne », journal `workflow.published` avec `programmee`).
- Routes : `POST /tenants/:tenantId/workflows/:id/blocs/:nodeId/modele` (201, sous `limiteCouteuse`, journal
  `workflow.modele_soumis`) ; `GET /tenants/:tenantId/workflows/:id/modeles` (`{ modeles, programmee }`). `publish` :
  après ses contrôles d'aujourd'hui, `jugerPublication` ; 200 publié, 202 programmé (journal
  `workflow.publication_programmee`), 422 `modele_refuse` ou `campagne_active`.

Tests (`tests/workflows.test.ts`) : publication refusée sur un template refusé, programmée sur un template en validation,
refusée sous une campagne active, immédiate quand tout est approuvé (et la programmation effacée) ; un scénario sans
template de bloc publie EXACTEMENT comme avant, sans aucune lecture de Meta ; rôle agent et autre espace refusés.

### Task 5: le statut tranché par Meta, les e-mails et le filet

**Files:** Modify `src/workflow/modeles-de-bloc.ts`, `src/emails-produit/catalogue.ts`, `web/lib/partage/aide-connexion.ts`
(`AIDE_BLOC_TEMPLATE`), `src/worker.ts`, `src/index.ts`, `src/server.ts` (câblage partagé : annonce aux sessions voisines,
commit par plomberie).

**Interfaces (Produces):** `trancherModeleDeBloc(deps, tenantId, { modele, langue, statut, raison })` : tranche la ligne,
puis `tenterMiseEnLigne` pour chaque scénario de l'espace dont la version programmée nomme ce template ;
`relireModelesDeBloc(deps, minutes, limite)` : les attentes anciennes relues chez Meta, puis les programmations anciennes
retentées (celles qui attendent une campagne). E-mails `scenario_programme_en_ligne` et `scenario_programme_refuse`
(scénario, raison bornée à 300, lien `/workflows?open=<id>`, ligne d'aide vers la fiche du bloc). `surStatut` appelle
l'assistant Shopify PUIS `trancherModeleDeBloc`, chacun dans sa capture. Filet : toutes les dix minutes dans l'API, sous
`travauxEnVol`, vingt au plus par passe.

Tests : APPROVED rejoué, un e-mail ; REJECTED, la programmation annulée et un e-mail avec la raison bornée ; le brouillon
ne nomme plus le template, rien ; campagne active à l'approbation, rien puis mise en ligne au filet une fois la campagne
finie ; l'échec d'une branche de `surStatut` ne saute pas l'autre. `tests/emails-produit.test.ts`,
`tests/aide-connexion-adresses.test.ts`, `tests/statuts-modeles.test.ts` verts.

### Task 6: la garde à l'envoi

**Files:** Modify `src/workflow/envois-bloc.ts`, `src/workflow/wiring.ts`, `tests/workflow-envois-bloc.test.ts`.

`templateVarInfo(tenant, name, language, { frais?: boolean })` : `frais` saute le cache de cinq minutes et le rafraîchit.
`sendTemplate`, branche des indices : statut autre qu'APPROVED (sans casse) sur la langue du bloc, relu frais ; toujours
pas approuvé, refus nommé (`SendRefusal`) sans appel à Meta : « en validation chez Meta », « refusé par Meta »,
« mis en pause par Meta », sinon le statut tel quel. Tests : PENDING en cache puis APPROVED frais, l'envoi part ; PENDING
frais, refus et zéro appel à Meta ; `approved` en minuscules part ; repli sur une autre langue, comportement d'aujourd'hui.
Vu dans les deux sens. Le commentaire faux de `template-send.ts:21` (repli sur les exemples, `todo.md`) part avec.

### Task 7: la console (3b)

**Files:** Modify `web/lib/api/templates.ts`, `web/lib/api/scenarios.ts`, `web/components/TemplateForm.tsx` (prop
optionnelle `pourUnBloc`), `web/components/WorkflowConfigPanel.tsx`, `web/components/WorkflowBuilder.tsx`,
`web/components/WorkflowNode.tsx`, `web/lib/workflow-sorties.ts`. Create `web/components/ModeleDuBloc.tsx` (dans `Modale`),
`web/e2e/workflow-template-sur-place.spec.ts`, un test unitaire web de la règle des flèches.

- Panneau du bloc : « Écrire un nouveau template » et « Modifier ce template » (absent sur un carousel ou un en-tête
  média, qui renvoient à Contenu > Templates ; masqués sans WABA) ; ligne d'état (en validation, approuvé « publiez »,
  refusé et sa raison) ; la valeur courante reste une option du choix même non approuvée.
- `TemplateForm` en mode bloc : sans nom, sources initiales = celles du bloc (indices recouverts par `data.variables`),
  sous la catégorie « Meta peut la reclasser ; un template marketing ne part, depuis une automation, qu'aux fiches
  d'accord ». Sans la prop, rien ne change (les e2e de `TemplateForm` restent verts).
- `ModeleDuBloc` : vide d'abord l'enregistrement automatique, appelle la route, puis patche le bloc (`templateName`,
  `language`, `templateButtons`, `templateCards: []`, `variables: []`) et applique la règle des flèches.
- Builder : la liste complète à l'aperçu, les approuvés au choix ; `GET .../modeles` au montage (une route absente est
  tolérée) puis toutes les 15 s, onglet visible, tant qu'un template est en validation ou une mise en ligne programmée ;
  réponses de « Publier » : 202 (bandeau « mise en ligne programmée », ou « attend la fin de la campagne »), 422
  `modele_refuse` et `campagne_active` (leur phrase). Bloc : pastille « En validation chez Meta » ou « Refusé ».

Tests : règle des flèches (bouton du milieu retiré, ordre changé, texte changé, « Pas de réponse » gardée), vue rouge sans
la règle ; e2e : création sur place, pastille, programmation, refus sous campagne, puis approuvé et publié. Suite racine
entière avant le push (des tests de la racine lisent `web/`).

### Task 8: aide, documentation, essai

**Files:** `features.md` (nouvelle section de niveau deux) ; `docs/aide/fiches/bloc-envoi-template.md` et `en/` (une étape :
écrire ou modifier ici, validation, programmation, e-mail, hors carousel et en-tête média) ; `faire-approuver-un-modele.md`
et `en/` (une ligne vers le bloc, zéro redite) ; `web/e2e/captures/bloc-envoi-template.capture.ts` (la modale, l'état en
validation) ; `site/` (`npm run vitrine:aide`, `npm run vitrine:anglais`) ; `documentation.md` (§ 4.3, § 5, § 6, § 12 :
seule une publication explicite ou une programmation tranchée écrit le publié, le nom naît côté serveur) ;
`docs/JOURNAL-TECHNIQUE.md` ; `todo.md` (jaunes de la relecture).

Avant le push : `aide-proposer` et `aide-fiches-format` (`&&`). Après : CI lue job par job, `aide:charger` en production
(commande pour Julien, `docs/aide` comparé à origin), puis l'essai réel.
