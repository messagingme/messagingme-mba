# Le code d'espace, visible : plan d'implémentation

> **Pour l'exécutant :** sous-skill requise : superpowers:executing-plans (ou subagent-driven-development). Les étapes
> se cochent (`- [ ]`).

**But :** montrer `tenants.public_code` (6 caractères, ex. `k7m2p3`) dans la console, dans `/ops` et dans les alertes
Telegram.

**Architecture :** aucune migration. Une fonction pure donne le code affiché (`public_code`, à défaut le calcul depuis
l'UUID, qui rend la même valeur). Les lectures existantes (comptes de l'identité, vue d'ensemble de `/ops`) ajoutent le
champ ; l'envoi Telegram passe le texte dans un libelleur branché au démarrage, qui ajoute nom et code aux UUID d'espace.

**Spec :** [docs/superpowers/specs/2026-11-19-code-espace-visible-design.md](../specs/2026-11-19-code-espace-visible-design.md)

## Contraintes globales

- 🔴 **Le code n'ouvre rien** : aucune route, garde ou recherche serveur ne l'accepte à la place d'un `tenantId`.
- Forme affichée : minuscules, telle que stockée, identique à l'API (`k7m2p3`). Libellé « Code d'espace » / « Workspace code ».
- **L'arbre partagé est en retard sur origin** (412 commits le 2026-11-19) : travailler dans une copie détachée
  d'`origin/main` (mémoire « copie à part de l'arbre partagé »), commits en plomberie, jamais depuis l'arbre partagé.
- `src/index.ts` et `src/worker.ts` sont du câblage partagé : annonce aux sessions voisines avant de les éditer.
- Console : vouvoiement, `t('fr', 'en')`, pas de tiret cadratin ni demi-cadratin dans aucun texte.
- Avant push : `npm run typecheck`, `npm run lint`, `npx tsx scripts/auto-attaque.mts`, `npm test` à la racine, et
  `npm run lint` dans `web/`.

## Points de vigilance (ce qu'aucun test de tâche ne couvre par défaut)

1. **Console publiée avant l'API** (Vercel au push, API au déploiement) : l'écran reçoit des espaces SANS `tenantCode`.
   Le champ est optionnel côté web et rien ne s'affiche s'il manque. Test en tâche 3.
2. **Libelleur lent ou base en panne** : l'alerte part quand même, texte inchangé, au plus 1 s plus tard. Test en tâche 1.
3. **UUID qui n'est pas un espace** (campagne, job, compte Meta) dans une alerte : laissé tel quel. Test en tâche 1.
4. **Espace ancien sans `public_code`** : la console et `/ops` montrent le code calculé, identique à celui que l'API
   écrirait. Tests en tâches 3 et 4.
5. **Filtre de `/ops` en majuscules** (`K7M2P3`, copié d'un e-mail client) : trouve l'espace. Test en tâche 4.

---

### Tâche 1 : le code affiché et le libelleur d'alertes

**Fichiers :**
- Modifier : `src/ids/code.ts` (ajout sous `deriveTenantCode`)
- Créer : `src/ops/libelle-espaces.ts`
- Tests : `tests/ids-code.test.ts`, `tests/ops-libelle-espaces.test.ts` (nouveau)

**Interfaces produites :**
- `codeDEspace(tenantId: string, publicCode: string | null): string` : `publicCode` s'il est non vide, sinon
  `deriveTenantCode(tenantId)`.
- `creerLibelleurEspaces(pool: { query: Pool['query'] }, opts?: { plafondMs?: number }): (texte: string) => Promise<string>`.
  `plafondMs` par défaut 1000.

- [ ] **Étape 1 : tests qui échouent.**
  - `codeDEspace('00000000-0000-0000-0000-000000000001', null)` vaut `'fb0vhn'` (même valeur que `deriveTenantCode`,
    déjà épinglée dans `tests/ids-code-base32.test.ts`) ; avec `'k7m2p3'` rend `'k7m2p3'` ; avec `''` rend le calcul.
  - Libelleur, faux pool qui capture la requête :
    - `'Numéro déconnecté (espace <A>)'`, A espace « Acme » de code `k7m2p3` : rend
      `'Numéro déconnecté (espace <A> « Acme » (k7m2p3))'`.
    - Un UUID inconnu du pool reste inchangé ; un texte sans UUID ne fait AUCUNE requête.
    - Deux occurrences du même UUID : une seule requête, les deux libellées.
    - Plus de 10 UUID distincts : la requête n'en porte que 10.
    - Pool qui rejette : texte inchangé, aucune exception.
    - Pool qui ne répond jamais : texte inchangé en moins de `plafondMs + 100` ms (faux minuteurs de vitest).
    - Espace sans `public_code` en base : libellé avec le code calculé.
- [ ] **Étape 2 :** `npx vitest run tests/ids-code.test.ts tests/ops-libelle-espaces.test.ts` : ÉCHEC (fonctions absentes).
- [ ] **Étape 3 : implémenter.** Regex UUID insensible à la casse ; `select id::text, name, public_code from tenants
  where id = any($1::uuid[])` ; remplacement `<uuid>` par `<uuid> « Nom » (code)` (l'UUID reste, pour la base) ; `Promise.race` contre le plafond.
  Pas de filtre `tenant_id` à ajouter : lecture d'exploitation cross-espace, son seul consommateur est l'alerte interne.
- [ ] **Étape 4 :** même commande : PASS.
- [ ] **Étape 5 : commit** (plomberie, chemins de la tâche seulement).

### Tâche 2 : brancher le libelleur dans l'envoi Telegram

**Fichiers :**
- Modifier : `src/ops/telegram.ts` (`envoyerTelegram`)
- Modifier : `src/index.ts`, `src/worker.ts` (une ligne chacun, après la création du socle, plus l'import)
- Test : `tests/ops-telegram.test.ts`

**Interfaces :**
- Consomme : `creerLibelleurEspaces` (tâche 1), `pool` de `src/db/pool`.
- Produit : `brancherLibelleur(f: ((texte: string) => Promise<string>) | null): void` dans `src/ops/telegram.ts`.

- [ ] **Étape 1 : tests qui échouent.**
  - Configuré, libelleur branché qui ajoute `' [L]'` : le `text` posté vaut `'alerte [L]'`.
  - NON configuré, libelleur branché : le libelleur n'est PAS appelé (aucune lecture en base pour rien).
  - Libelleur qui rejette : le texte d'origine part, l'issue reste `'recue'`.
  - `afterEach` : `brancherLibelleur(null)`, pour ne pas fuir entre tests.
- [ ] **Étape 2 :** `npx vitest run tests/ops-telegram.test.ts` : ÉCHEC.
- [ ] **Étape 3 : implémenter.** Variable de module ; appel APRÈS le test « non configuré », dans un `try` qui retombe
  sur le texte d'origine. Câblage : `brancherLibelleur(creerLibelleurEspaces(pool))` dans `src/index.ts` et
  `src/worker.ts`. Annonce aux sessions voisines AVANT d'éditer ces deux fichiers.
- [ ] **Étape 4 :** `npx vitest run tests/ops-telegram.test.ts` puis `npm run typecheck` : PASS.
- [ ] **Étape 5 : commit** en plomberie (câblage partagé).

### Tâche 3 : la console, menu du compte

**Fichiers :**
- Modifier : `src/user/store.pg.ts` (`getByEmail` : `t.public_code`, renvoie `tenantCode` via `codeDEspace`)
- Modifier : `src/http/espaces.ts` (`CompteDEspace.tenantCode: string`, la réponse de `GET /tenants/:tenantId/espaces` le porte)
- Modifier : `web/lib/api/compte.ts` (`EspaceDuCompte.tenantCode?: string`)
- Modifier : `web/components/AccountMenu.tsx`
- Tests : `tests/espaces.test.ts` (faux `getByEmail` complétés), test du menu à côté des tests web existants de `AccountMenu`
  s'il y en a, sinon cas dans `web/lib/` sur un petit formateur

**Interfaces :** consomme `codeDEspace` (tâche 1).

- [ ] **Étape 0 :** `AccountMenu.tsx` a des changements non commités d'une autre session dans l'arbre partagé :
  travailler sur la version d'origin dans la copie détachée, et relire `git log origin/main -- web/components/AccountMenu.tsx`
  juste avant le commit.
- [ ] **Étape 1 : tests qui échouent.**
  - `GET /tenants/:t/espaces` : chaque espace porte `tenantCode` (`'k7m2p3'` depuis le faux).
  - Menu : l'espace courant affiche son code sous son nom (`data-testid="menu-code-espace"`) avec `BoutonCopier`
    (`web/components/doc-api/elements.tsx`) ; un espace SANS `tenantCode` n'affiche ni code ni bouton (point de
    vigilance 1) ; la liste des autres espaces montre le code en petit à côté du nom.
- [ ] **Étape 2 :** lancer ces tests : ÉCHEC.
- [ ] **Étape 3 : implémenter.** Aucune autre route ne change ; `changer-espace` continue de n'accepter que `tenantId`.
- [ ] **Étape 4 :** tests PASS, `npm run typecheck`, `npm run lint` dans `web/`.
- [ ] **Étape 5 : commit.**

### Tâche 4 : `/ops`, colonne et filtre

**Fichiers :**
- Modifier : `src/ops/store.pg.ts` (`TenantOverviewRow.code: string`, `t.public_code` lu, `codeDEspace` appliqué)
- Modifier : `web/lib/api/compte.ts` (`TenantOverviewRow.code?: string`)
- Modifier : `web/app/ops/page.tsx` (`TenantTable` : code sous le nom ; champ filtre au-dessus du tableau)
- Créer : `web/lib/ops-filtre.ts` avec `filtrerEspaces<T extends { name: string; code?: string }>(lignes: T[], q: string): T[]`
- Tests : `web/lib/ops-filtre.test.ts`, test du store `/ops` existant pour la vue d'ensemble (s'il lit les colonnes)

- [ ] **Étape 1 : tests qui échouent.** `filtrerEspaces` : `''` rend tout ; `'acme'` trouve « ACME Corp » ; `'K7M2P3'`
  trouve le code `k7m2p3` ; espaces autour ignorés ; une ligne sans `code` reste trouvable par son nom. Store : une
  ligne sans `public_code` reçoit le code calculé.
- [ ] **Étape 2 :** ÉCHEC.
- [ ] **Étape 3 : implémenter.** Filtre côté client sur la liste déjà chargée, aucune route nouvelle (point 🔴 des
  contraintes : le code ne devient pas un paramètre serveur).
- [ ] **Étape 4 :** PASS, `npm run lint` dans `web/`.
- [ ] **Étape 5 : commit.**

### Tâche 5 : remplir les vides, documenter, clore

**Fichiers :**
- Créer : `scripts/remplir-codes-espaces.mjs` (exécuté par Julien dans `mba-worker`, forme de la mémoire « sonde de la
  prod chez Scaleway »)
- Modifier : `documentation.md` (§ `tenants` : le code est affiché, n'ouvre rien), `features.md` (menu du compte, `/ops`)

- [ ] **Étape 1 :** le script compte `where public_code is null`, puis, sauf drapeau `--compter`, pose
  `deriveTenantCode(id)` par `update ... where id = $1 and public_code is null` (idempotent), et recompte. Il importe
  `deriveTenantCode` du vrai module (`/app/src/ids/code.ts`).
- [ ] **Étape 2 :** commande `--compter` donnée à Julien ; s'il reste des vides, la commande de remplissage.
- [ ] **Étape 3 :** si une section de `features.md` citée par une fiche d'aide change : fiche relue, empreinte, et
  `npx vitest run tests/aide-proposer.test.ts` vert AVANT le push, dans le même commit.
- [ ] **Étape 4 :** relecture indépendante du lot (une, en fin de lot), puis déploiement de l'API (`migration=aucune`).

## Méthode de livraison

**En direct, sans agent, puis UNE relecture indépendante en fin de lot**, parce que le lot est petit, réversible et
sans migration : il ajoute un champ à deux lectures, un écran et un libellé d'alerte, et chaque critère se vérifie par
un test. Le seul chemin de production sensible est l'envoi d'alerte, protégé par le plafond et le repli sur le texte
d'origine (testés). La relecture regarde en priorité le rayon de souffle sur `getByEmail` (lu aussi par la connexion
Google et `/auth`) et l'absence de toute route qui accepterait le code.

Essai réel qui clôt : sur la vraie console, lire et copier le code dans le menu du compte d'un vrai espace, le retrouver
par le filtre de `/ops` en le tapant en majuscules, puis créer un espace d'essai et vérifier que l'annonce Telegram
porte « Nom » et le code.
