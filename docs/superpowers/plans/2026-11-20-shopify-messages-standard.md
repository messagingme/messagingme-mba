# Automation Shopify : messages standard, aperçu au survol, retour depuis le scénario

**Spec :** `docs/superpowers/specs/2026-11-20-shopify-messages-standard-design.md`.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff** : le lot crée et soumet des templates chez Meta sans geste explicite du
marchand (au branchement) et touche le premier bloc verrouillé, un chemin que la production emprunte, avec des invariants
invisibles (nom des templates face au ménage, version programmée et non publiée). Deux implémenteurs en parallèle sur des
fichiers disjoints (serveur : moi ; console : un agent), puis UNE relecture indépendante du lot entier.

L'essai réel qui clôt la feature (spec § 7) : la boutique de dev `messaging-me-essai` rebranchée à un espace de test, les
trois messages « en validation » puis approuvés par Meta, la bulle au survol, la commande payée allumée et reçue sur un
vrai téléphone avec ses données, le retour depuis le scénario, « Modifier ce template » sur le premier bloc.

## Tâches

### T1. Les textes standard (partagé)
- `web/lib/partage/shopify-messages.ts` : `TEXTES_PROPOSES` aux textes de la spec § 2.4 (prénom dans le panier ;
  transporteur retiré de l'expédition), commentaire de la décision du 2026-10-23 remplacé.
- `src/shopify/messages-standard.ts` (neuf) : `versCorps(evenement, texte)` (repris de `e4be79bfe^:src/shopify/preparation.ts`)
  et `corpsStandard(evenement): { corps: Record<string, unknown>; variables: DonneeShopify[] }`, corps au format de
  `POST /templates` (`category` UTILITY ou MARKETING pour le panier, `language: 'fr'`, `body` à `{{n}}`, `example`
  `EXEMPLES_DONNEES`, `footer` `PIED_STOP.fr` pour le panier).
- Tests : `tests/shopify-messages-standard.test.ts` : les trois corps passent `parseTemplateFields`, ne commencent ni ne
  finissent par une variable, variables dans l'ordre, catégorie, pied du panier seulement.

### T2. Proposer le message standard d'une ligne (serveur)
- `src/shopify/lignes-gestion.ts` : `proposerMessageStandard(deps, tenantId, evenement, par): Promise<IssueProposition>`
  (`'propose' | 'deja' | 'sans_compte' | 'filiere_application' | 'refuse_par_meta' | 'echec'`), jamais levée :
  `assurerLigne`, puis sortie `deja` si le bloc verrouillé du graphe publié OU de la version programmée nomme un template ;
  filière `application` sautée ; `creerModeleDuBloc` (nom serveur, ligne `modeles_de_bloc`) ; le bloc reçoit template,
  langue, `templateButtons: []`, `templateCards: []`, sources `variable` dans le brouillon (`update`), puis
  `programmer(id, tenant, null, graphe)` (en validation) ou `publish` + `programmerMenage` (approuvé d'emblée).
- `DepsLignesShopify` : `creation: DepsCreationDeBloc`, `filiere(tenantId)`, `workflows` + `'programmer'`.
- `connecterShopify` (`gestion.ts`) : après un branchement réussi, `Promise.allSettled` des trois propositions ;
  journalise, ne change jamais l'issue du branchement.
- `reglerLigne` : allumer refuse 409 sur la filière `application` (`PHRASE_SHOPIFY_QR_CODE`) ; allumer une ligne dont le
  bloc est vide appelle `proposerMessageStandard` (best-effort).
- `tenterMiseEnLigne` (`modeles-de-bloc.ts`) : pas d'e-mail « en ligne » pour une programmation sans auteur (`par` nul)
  d'un rayon `shopify` (le message standard ; la ligne est éteinte). Le refus garde son e-mail.
- Câblage `src/index.ts` (annoncé aux pairs) : les nouvelles dépendances des lignes.
- Tests : `tests/shopify-lignes-gestion.test.ts` (proposition : propose, deja publié, deja programmé, sans compte,
  filière application, refus Meta ; allumer un cas vide propose ; QR refusé), `tests/shopify-gestion.test.ts` (le
  branchement propose les trois et réussit même si Meta refuse), `tests/workflow-modeles-de-bloc.test.ts` (pas d'e-mail
  « en ligne » sans auteur au rayon shopify ; e-mail gardé sinon).

### T3. L'aperçu dans l'état d'une ligne (serveur)
- `EtatLigne.apercu: { corps: string; pied: string | null; exemples: string[]; enValidation: boolean } | null` : le
  template du bloc verrouillé de la version programmée, sinon de la publiée ; exemples par position depuis les sources
  `variable` du bloc (`EXEMPLES_DONNEES`), `{{n}}` sinon. `get_shopify_state` : `message` (le corps) et
  `template_pending` quand une version attend Meta.
- Tests : `tests/shopify-lignes-gestion.test.ts` (aperçu publié, programmé, absent).

### T4. Améliorer le message dans le scénario (serveur et console)
- Lien de test d'un scénario `shopify` : l'événement d'exemple de sa ligne (`EXEMPLES_DONNEES`) en variables du lancement.
- « Modifier ce template » : `TemplateForm` n'envoie pas les sources `variable` en `paramHints`.
- `web/lib/workflow-canevas.ts` `toRF` : `deletable: false` sur le bloc marqué.

### T5. La console (agent)
- `web/lib/api-shopify.ts` : `apercu` lu défensivement. `web/lib/shopify-lignes.ts` : états `prete` (éteinte, message
  approuvé) et `eteinte_en_validation` ; allumée sans template publié mais programmée : `en_validation`.
- `web/components/AutomationsShopify.tsx` : bulle au survol et au focus (`TemplateBodyText`, motif `CaptureAuSurvol`),
  ligne cliquable vers `/workflows?open=<id>`.
- `web/app/workflows/page.tsx` : retour selon le rayon (`/automations/shopify`, `/automations/hubspot`).
- Tests : `web/lib/shopify-lignes.test.ts`, `web/e2e/shopify.spec.ts` (survol, clic), retour.

### T6. Doc et promesses
- `features.md` § Boutique Shopify + fiche `brancher-ma-boutique-shopify` FR et EN (empreinte, `vitrine:aide`),
  `plugin/skills/shopify/SKILL.md` + version de `plugin.json`, descriptions MCP (catalogue régénéré), vitrine
  (`boutique-textes.ts`, `aide-claude-textes.ts`), `documentation.md`, `todo.md` (jaunes soldés), journal.

## Vérifications avant push
`npm run typecheck`, `npm test`, `npm run lint`, `npx tsx scripts/auto-attaque.mts`, `npm run lint` et `npx tsc` dans
`web/`, e2e Shopify (serveur lancé soi-même, pas le port 3000).

## Déploiement
Aucune migration. API d'abord (`migration=aucune`, clic de Julien), la console arrive avec le push : elle lit `apercu`
défensivement, donc l'ordre ne casse rien. Puis `aide:charger`, le plugin, l'essai réel de la spec § 7.
