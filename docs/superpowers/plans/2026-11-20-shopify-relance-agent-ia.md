# Relance de panier avec agent IA (Shopify) : plan

> **Pour l'exécutant :** lire la spec avant chaque lot. Cases à cocher (`- [ ]`) pour le suivi. Tout se lit et se
> construit sur `origin/main` (l'arbre partagé peut être en retard : mesurer `HEAD...origin/main` avant de lire).

**But :** une quatrième ligne Shopify, « Relance de panier avec agent IA », dont le scénario standard envoie la relance
du panier avec un bouton « Vous avez une question ? » qui mène à un bloc Agent IA choisi à l'allumage.

**Architecture :** une valeur neuve de `shopify_lignes.evenement` (`checkout_abandoned_agent`) qui part sur le même
webhook et la même réclamation que `checkout_abandoned`, exclusive avec elle. L'agent vit dans le bloc Agent IA du
scénario de la ligne, pas en base. Aucun changement dans la réception des messages.

**Pile :** TypeScript, Fastify, Postgres (migrations SQL), Next.js (console), vitest.

**Spec :** [docs/superpowers/specs/2026-11-20-shopify-relance-agent-ia-design.md](../specs/2026-11-20-shopify-relance-agent-ia-design.md)

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que la réclamation des paniers et l'envoi de la relance sont des
chemins que la production emprunte (un défaut = deux relances, ou plus aucune), et que le code touché porte des
invariants invisibles (l'index qui sert la réclamation, l'exclusivité des deux lignes, le premier bloc verrouillé). Une
relecture indépendante par lot, en fin de lot. **Essai réel de clôture** : sur la boutique `messaging-me-essai` et la
SANDBOX en mode MBA, allumer la relance avec agent (choix de l'agent), vérifier que la relance normale s'éteint,
abandonner un vrai panier, recevoir la relance sur un téléphone, taper « Vous avez une question ? », obtenir la réponse
de l'agent ; puis la même chose avec un opérateur qui a pris la conversation (l'agent ne doit pas répondre). Numéro
d'essai pris dans `docs/prive/ESSAIS-REELS.md`.

## Contraintes globales

- Nom de l'automation : « Relance de panier avec agent IA » (fr), « Abandoned checkout reminder with AI agent » (en).
- Bouton : « Vous avez une question ? » (fr), « Have a question? » (en), 25 caractères au plus (borne Meta).
- Valeur en base et dans les types : `checkout_abandoned_agent`.
- Jamais de tiret cadratin ou demi-cadratin dans un texte produit ; vouvoiement dans la console.
- Les deux lignes du panier ne sont JAMAIS actives ensemble, ni en base ni dans ce que la réclamation lit.

## Points de relecture

Cas que la spec implique et qu'aucun test ordinaire n'exercerait ; chacun a son test dans la tâche qui le possède.
1. Allumer l'une pendant qu'un parcours de l'autre attend un clic : le parcours en cours s'arrête (tâche 4).
2. Deux allumages concurrents des deux lignes : une seule reste active (tâche 2, en transaction).
3. Agent supprimé ou désactivé APRÈS l'allumage : le clic finit à l'équipe, et la ligne l'annonce (tâches 5 et 6).
4. Le marchand modifie le template et retire le bouton : l'envoi part quand même, l'avertissement apparaît (tâche 5).
5. Une boutique branchée avant ce lot, relance normale allumée : rien ne change tant que le marchand n'allume pas la
   nouvelle ligne (tâche 2).

---

## Lot 1 : la migration (poussée SEULE, `migration=avant`)

### Tâche 1 : élargir le CHECK de `shopify_lignes.evenement`

**Fichiers :** créer `db/migrations/<prochain numéro>_shopify_ligne_agent.sql` (numéro lu par `npm run migrations`
depuis une copie à jour d'origin) ; test `tests/migration-<numéro>.test.ts`.

- [ ] Lire en production le nom du CHECK créé en ligne par 0299 (`pg_get_constraintdef`, sonde sur `mba-worker`, commande
  à Julien) ; ne jamais le deviner.
- [ ] Test : le fichier retire ce nom SANS `if exists` et recrée le CHECK sous le même nom avec les quatre valeurs
  (`order_paid`, `order_fulfilled`, `checkout_abandoned`, `checkout_abandoned_agent`) ; `set local lock_timeout = '5s'`.
- [ ] Écrire la migration ; en tête, pourquoi `avant` (relâche un CHECK que le code neuf écrit, l'ancien code y survit).
- [ ] `npm test` sur le test de migration, puis commit seul, push, CI lue job par job, déploiement `migration=avant`,
  relecture en base du CHECK (`pg_get_constraintdef`).

## Lot 2 : le serveur

### Tâche 2 : la ligne neuve, la réclamation et l'exclusivité

**Fichiers :** `web/lib/partage/shopify-messages.ts`, `src/shopify/lignes.ts`, `src/shopify/store.pg.ts`,
`src/shopify/relance.ts`, `src/shopify/parcours-voulu.ts` ; tests `tests/shopify-lignes*.test.ts`,
`tests/integration/shopify-*.test.ts`.

**Interfaces produites :**
- `AUTOMATIONS_SHOPIFY` (les quatre valeurs) et `type AutomationShopify`, à côté de `EVENEMENTS_SHOPIFY` qui reste la
  liste des événements de Shopify ; `evenementDe(a: AutomationShopify): EvenementShopify`
  (`checkout_abandoned_agent` → `checkout_abandoned`).
- `NOM_DU_SCENARIO`, `SUJET_DE_L_EVENEMENT` et `LIBELLES_EVENEMENTS` indexés par `AutomationShopify` ; le sujet de la
  ligne avec agent est `checkouts/abandoned` (même origine de parcours : éteindre l'une arrête les relances en cours).
- `PgShopifyStore.allumerLigne(tenantId, automation, par)` : dans UNE transaction, éteint l'autre ligne du panier
  quand `automation` en est une, et rend `{ eteinte: AutomationShopify | null }`.

- [ ] Inventaire d'abord : `git grep -n checkout_abandoned origin/main -- src web db tests` ; chaque occurrence classée
  « événement Shopify » (reste) ou « ligne » (devient `AutomationShopify`), la liste recopiée dans le message de commit.
- [ ] Tests : la réclamation des paniers dus prend la ligne avec agent active (son `workflow_id`) comme la normale ;
  aucune des deux active, rien n'est réclamé ; l'allumage de l'une éteint l'autre en base ; deux allumages concurrents
  (intégration, deux clients) laissent une seule ligne active ; une boutique dont seule la ligne normale existe ne change
  pas (point de relecture 5).
- [ ] Implémenter ; l'index qui sert la réclamation garde son prédicat mot pour mot, ou change avec elle dans la tâche 1
  (sinon, simple balayage sans erreur).
- [ ] `npm run typecheck`, `npm test`, `npx tsx scripts/auto-attaque.mts`, `npm run lint`.

### Tâche 3 : le scénario standard de la ligne avec agent

**Fichiers :** `src/shopify/messages-standard.ts`, `src/shopify/lignes-gestion.ts` ; test
`tests/shopify-messages-standard.test.ts`.

**Interfaces produites :**
- `corpsStandard('checkout_abandoned_agent', domaine)` : le corps du panier, plus un bouton `QUICK_REPLY` « Vous avez
  une question ? » après le bouton URL.
- `grapheDeLaLigneAgent(agentId: string): WorkflowGraph` : le premier bloc verrouillé (`MARQUE_PREMIER_BLOC`), un bloc
  Agent IA (`data.agentId`) relié par l'arête `btn:<index du bouton de réponse rapide>`, ses sorties `humain`, `echec`,
  `plafond` et `sans_source` reliées au passage à l'équipe.

- [ ] Tests : le corps passe `versCorps` et les bornes Meta (bouton de 25 caractères au plus) ; le graphe passe
  `refusDuVerrou` et la validation de publication du builder ; l'arête du bouton vise le bloc Agent IA ; chaque sortie
  d'échec vise le passage à l'équipe.
- [ ] Implémenter ; `assurerLigne` utilise ce graphe pour la ligne avec agent.

### Tâche 4 : l'allumage avec choix de l'agent

**Fichiers :** `src/shopify/lignes-gestion.ts`, `src/http/shopify.ts` ; tests `tests/shopify-lignes-gestion.test.ts`.

**Interfaces :** `reglerLigne(deps, tenantId, automation, { actif, delaiMinutes?, agentId? }, par)`.

- [ ] Tests : allumer la ligne avec agent sans `agentId`, avec un agent inconnu, inactif ou d'un autre espace → 422 avec
  une phrase claire ; allumer avec un agent actif crée ligne et scénario, éteint la ligne normale ET arrête ses parcours
  (point de relecture 1) ; l'inverse aussi ; sur une ligne déjà allumée, un autre `agentId` réécrit l'agent du bloc dans
  le graphe PUBLIÉ sans éteindre ; refus QR code et attestation inchangés.
- [ ] Implémenter (la vérification de l'agent passe par le magasin des agents scopé espace, jamais par l'identifiant seul).

### Tâche 5 : les avertissements de la ligne

**Fichiers :** `src/shopify/lignes-gestion.ts` (ou un module voisin), `src/shopify/gestion.ts` (état) ; test dédié.

**Interfaces produites :** `avertissementsDeLaLigneAgent(graphe, agent, modele): Avertissement[]`, avec
`Avertissement = 'bouton_absent' | 'agent_inactif' | 'modele_en_attente' | 'modele_refuse'`, rendus dans l'état de la
ligne.

- [ ] Tests : un template sans réponse rapide reliée au bloc Agent IA → `bouton_absent` (point de relecture 4) ; un
  agent désactivé ou supprimé → `agent_inactif` (point 3) ; un modèle en attente ou refusé chez Meta → l'avertissement
  qui le dit ; aucun avertissement sur une ligne saine.
- [ ] Implémenter.

### Tâche 6 : les deux vérifications de la spec (§ 8), sur le vrai moteur

**Fichiers :** tests d'intégration du moteur de scénario.

- [ ] Test : un parcours `evenement_shopify` dont le bloc Agent IA vise un agent supprimé, ou un espace sans Crédit IA,
  sort vers le passage à l'équipe et ouvre une demande dans « À traiter » (décision 7).
- [ ] Test : un contact dont un opérateur a pris la conversation après l'envoi tape le bouton ; le parcours n'avance
  pas, aucun tour d'agent n'est enfilé (décision 2).
- [ ] Si l'un échoue, le correctif minimal dans le moteur, vérifié dans les deux sens ; sinon, rien à changer.

### Tâche 7 : le MCP

**Fichiers :** `src/mcp/outils-shopify.ts`, catalogue et doc générée ; tests `tests/mcp-*shopify*.test.ts`.

- [ ] Tests : `set_shopify_message` accepte `checkout_abandoned_agent` avec `agent_id` (mêmes refus que la tâche 4) ;
  `get_shopify_state` rend l'agent et les avertissements.
- [ ] Implémenter, régénérer le catalogue MCP et sa doc (`web/public`, vitrine), relancer les tests qui les lisent.

Fin du lot 2 : relecture indépendante, CI lue job par job, déploiement de l'API (`migration=aucune`).

## Lot 3 : la console (poussée APRÈS le déploiement de l'API)

### Tâche 8 : la quatrième ligne dans Automation > Shopify

**Fichiers :** `web/components/AutomationsShopify.tsx`, `web/lib/i18n.tsx` ; test e2e de la page.

- [ ] Test e2e : sans agent actif, l'interrupteur est grisé avec « Créer un agent IA » ; avec un agent, allumer ouvre le
  choix de l'agent puis allume ; la phrase « La relance de panier normale a été éteinte » s'affiche ; chaque
  avertissement de la tâche 5 a son texte.
- [ ] Implémenter ; `npm run lint` dans `web/`, suite racine entière avant de pousser.

## Lot 4 : l'aide, le plugin, la vitrine

### Tâche 9 : la documentation qui parle de la relance

- [ ] Fiche d'aide Shopify : la nouvelle automation, ses conditions (un agent IA actif, du Crédit IA), l'exclusivité ;
  `features.md` et l'empreinte de la fiche dans le même commit (`tests/aide-proposer.test.ts` vert avant le push) ;
  fiche publique : `npm run vitrine:aide`, version `en/` retraduite.
- [ ] Skill `messagingme:shopify` du plugin (`scripts/plugin/`), `plugin.json` monté.
- [ ] Après le push : `aide:charger` en production, puis Julien lance `gh workflow run plugin.yml --ref main`.

## Déploiement, dans l'ordre

1. Lot 1 seul, `migration=avant`, relecture du CHECK en base.
2. Lot 2, `migration=aucune`.
3. Lot 3 (Vercel au push), seulement après le 2.
4. Lot 4, `aide:charger`, plugin.
5. Essai réel de clôture (Méthode de livraison).
