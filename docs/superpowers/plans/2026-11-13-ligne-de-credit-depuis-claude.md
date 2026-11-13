# La ligne de crédit prise depuis Claude : plan

> **Pour l'exécutant :** superpowers:executing-plans, une tâche après l'autre, cases `- [ ]` cochées au fil de l'eau.

**But :** un client Pro prend l'option ligne de crédit depuis Claude Code ou Codex, puis connecte son numéro par la
fenêtre du partenaire, sans passer par la console.

**Architecture :** un outil MCP `take_credit_line` qui appelle la MÊME prise que la console (`ouvrirOption`), avec une
origine `claude` qui revient sur la page publique « paiement reçu » ; les consignes de Claude imposent l'ordre Pro,
option, connexion, recharge ; le guide `/demarrer/` ouvre le choix « Ligne de crédit » au chemin Pro + Claude Code.

**Spec :** [`docs/superpowers/specs/2026-11-13-ligne-de-credit-depuis-claude-design.md`](../specs/2026-11-13-ligne-de-credit-depuis-claude-design.md)

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, en direct dans cette session, puis UNE relecture indépendante en fin
de lot : l'outil ouvre un paiement Stripe réel et décide de l'ordre option / connexion, dont l'erreur laisse un client à
la carte sans retour possible (`numero_avec_carte`), un invariant que les tests ne voient pas seuls.

**Essai réel qui clôt le lot** : depuis Claude Desktop, sur un espace de test en essai Pro, la formule, puis l'option
(un vrai paiement de 30 € HT, accord de Julien avant), puis un numéro de chez nous par la fenêtre du partenaire, la ligne
posée seule, puis une recharge (détail en tâche 5).

## Contraintes

- Le partenaire n'est nommé nulle part (`git grep -i` de son nom vide avant chaque commit).
- Aucun tiret cadratin ni demi-cadratin dans les textes ; vouvoiement dans la console.
- « ligne de crédit » / « credit line » dans tout texte visible ; les identifiants (`credit_whatsapp`, `option_credit_whatsapp`) ne changent pas.
- `src/index.ts` est un fichier de câblage partagé : annonce aux sessions voisines, commit en plomberie (patch sur origin).
- L'arbre partagé a 188 commits de retard sur origin et une session voisine modifie `src/mcp/outils-numero.ts`, le
  plugin et `web/lib/` : travailler sur une copie à part à jour d'origin.

## Points de vigilance de la relecture

1. Lien de connexion donné avant que l'option soit active : la consigne de `start_whatsapp_connection` doit l'interdire
   quand la personne a dit « ligne de crédit ».
2. Option payée mais Pro encore à confirmer : `ouvrirOption` refuse (`option_apres_essai`) ; Claude doit dire d'attendre
   la confirmation du Pro (`get_plan`), pas d'abandonner.
3. Numéro déjà connecté avec sa carte : refus `numero_avec_carte` transmis avec son texte, et la consigne dit « Support ».
4. Deux appels rapprochés : `option_en_cours` et l'expiration des sessions ouvertes (le dernier lien gagne) ; l'état rendu
   au second appel ne doit pas faire croire à une option payée.
5. Page « paiement reçu » ouverte avec un `produit` inconnu d'elle : elle retombe aujourd'hui sur le texte du NUMÉRO.

---

### Tâche 1 : l'origine `claude` de la prise, et la page « paiement reçu »

**Fichiers :** `src/stripe/option-credit-whatsapp.ts` (`ouvrirOption`), `web/app/paiement-recu/page.tsx`,
`tests/stripe-option-credit-whatsapp.test.ts`, le test de la page sous `web/` s'il existe (sinon un cas dans le test
e2e ou vitest qui couvre `?produit=`).

**Produit :** `ouvrirOption(d, tenantId, places, payeur, origine: 'offre' | 'connecter' | 'claude')`.

- [ ] Test : avec `origine: 'claude'`, `urlSucces` vaut `${page(d, 'claude')}?produit=option_credit_whatsapp` et
  `urlAbandon` la même suivie de `&abonnement=abandon` ; les deux autres origines inchangées.
- [ ] Le voir échouer, l'implémenter (la constante `PRODUIT_OPTION_WA` sert de valeur), le voir passer.
- [ ] La page : `produit === 'option_credit_whatsapp'` affiche « Merci. Retournez dans Claude : il vous confirme votre
  option ligne de crédit dès que Stripe l'a validée, en général en quelques secondes, puis il vous donne le lien pour
  connecter votre numéro. » (et l'anglais), testé.
- [ ] Commit `--only` de ces fichiers.

### Tâche 2 : l'outil `take_credit_line`

**Fichiers :** `src/mcp/outils-offre.ts` (outil et `DepsOffreMcp`), `web/lib/partage/catalogue-mcp.ts` (fiche :
`scope: 'mcp:write'`, `exigePersonne: true`), `src/index.ts` (câblage `mcp.offre.option`), `tests/mcp-offre.test.ts`,
`tests/mcp-serveur.test.ts` (liste des outils), doc générée de `web/public` (`cd web && npm run doc:md`).

**Consomme :** `ouvrirOption(…, 'claude')` (tâche 1), `d.options.vivante(tenantId)`.
**Produit :** `DepsOffreMcp.option = { ouvrir(tenantId, places, payeur): Promise<Issue<{ url: string }>>; etat(tenantId): Promise<{ statut: string; places: number } | null> }`.

- [ ] Tests : `places` absent vaut 1 ; `places` hors bornes refusé (`places_invalides`) ; une option vivante rend
  `{ deja_prise: true, statut, places }` SANS ouvrir de session ; chaque refus d'`ouvrirOption` remonte avec son code
  (`option_avec_le_pro`, `option_inutile`, `numero_avec_carte`, `option_apres_essai`, `formule_en_retard`,
  `option_en_cours`) ; succès : `{ url, places, montant_ht_eur: places × 30, taxe }` ; `plafondCouteux` appelé ;
  annotations `ecriture('Take the credit line option', false, true)`.
- [ ] Le voir échouer, l'implémenter sur le modèle de `subscribe_pro` (signataire, plafond, `valeurOuRefus`), le voir passer.
- [ ] Description de l'outil (anglais) : à prendre APRÈS la confirmation du Pro (`get_plan`) et AVANT tout lien de
  connexion ; 30 € HT par numéro et par mois, payée dès sa prise, même pendant l'essai ; rappeler l'outil dit si
  l'option est payée.
- [ ] Câblage dans `src/index.ts` (annonce, plomberie), `npm run doc:md` dans `web/`, suite `web/` entière, suite
  racine, `npm run typecheck`, `npm run lint`, `npx tsx scripts/auto-attaque.mts`.
- [ ] Commit (plomberie pour `src/index.ts`).

### Tâche 3 : ce que dit Claude

**Fichiers :** `scripts/plugin/generer.ts` (puis `npm run plugin:generer` : `plugin/skills/mise-en-service/SKILL.md`),
`scripts/plugin/faq.ts` si une réponse parle de la prise, la consigne de `get_setup_state` (`src/mcp/outils.ts`) et
celle de `start_whatsapp_connection` (`src/mcp/outils-numero.ts`, voir la contrainte de la session voisine),
`plugin/.claude-plugin/plugin.json` (version + 1), `tests/plugin*.test.ts`, `tests/mcp-numero.test.ts`.

- [ ] Tests : la skill générée nomme `take_credit_line` et l'ordre « subscribe_pro, puis take_credit_line, puis le lien
  de connexion » ; elle ne renvoie plus à l'onglet de la console pour la prise ; la consigne du lien, quand la personne a
  choisi la ligne de crédit et que l'espace n'y a pas droit, dit de prendre l'option d'abord.
- [ ] Les voir échouer, écrire les textes, générer, les voir passer.
- [ ] Commit.

### Tâche 4 : le guide `/demarrer/`

**Fichiers :** `scripts/vitrine/tunnel-textes.ts` (fr et en), `scripts/vitrine/anglais/` si une phrase neuve y entre,
pages générées (`site/demarrer/`, `site/en/get-started/`, guide du centre d'aide), `tests/vitrine-*.test.ts`.

- [ ] Dans la question `paiement`, « Ligne de crédit » n'est plus grisée pour `pro` (elle le reste pour `free`) et mène à
  une question neuve `numero-ligne` : précision « Avec la ligne de crédit, votre numéro quitte l'application WhatsApp
  Business. », réponses « Un numéro à moi » et « Un numéro de chez vous », chacune vers une issue « dites à Claude … »
  (modes `apporte` et `fourni`) ; l'issue « à moi » rappelle qu'un numéro déjà connecté avec sa carte chez Meta passe par
  le Support.
- [ ] Tests : la profondeur de l'arbre et le chapeau (« six questions au plus ») restent justes ; chaque issue atteinte ;
  l'anglais généré sans français resté ; `npm run vitrine:anglais`, `npm run vitrine:entete`, puis la suite racine.
- [ ] Commit (ne part qu'APRÈS le déploiement de l'API et la publication du plugin, voir plus bas).

### Tâche 5 : doc, relecture, déploiement, essai

- [ ] `features.md` (avec `tests/aide-proposer.test.ts` vert et la fiche d'aide relue dans le même commit),
  `documentation.md` (l'outil, l'origine `claude`), journal, `todo.md` si un jaune reste.
- [ ] UNE relecture indépendante du lot, axée sur les cinq points de vigilance et le rayon de souffle (qui d'autre
  lit `ouvrirOption`, la page « paiement reçu », la question `paiement` du tunnel).
- [ ] Ordre de mise en ligne : console (tâche 1, page) et API par `deploy-scaleway.yml`, `migration=aucune`, approuvé
  par Julien ; puis Julien publie le plugin (`plugin.yml`) ; puis `aide:charger` si une fiche a changé ; puis la vitrine
  (tâche 4).
- [ ] Essai réel (`docs/prive/ESSAIS-REELS.md`) : espace de test en essai Pro, depuis Claude Desktop, Pro puis option
  (vrai paiement de 30 € HT, accord de Julien avant), puis numéro de chez nous par la fenêtre du partenaire, ligne posée
  seule, puis une recharge `wa_*`.
