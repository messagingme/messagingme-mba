# Menu Solutions en cascade, lot 1 : l'en-tête

**Goal :** Solutions ouvre Fonctionnalités, Secteurs et Intégrations dans un panneau à droite ; Fonctionnalités quitte
le premier niveau ; Ressources ouvre la documentation développeurs ; « Développeurs » devient « Avec votre IA ».

**Spec :** `docs/superpowers/specs/2026-11-18-menu-solutions-et-page-avec-votre-ia-design.md` (le lot 2, la page
Build / Run, aura son propre plan).

**Architecture :** les gabarits `scripts/vitrine/entete.<langue>.html` portent la structure ; `entete.ts` y insère
Secteurs et Intégrations depuis le registre, puis marque la page active et ouvre ses groupes ; `npm run vitrine:entete`
réécrit chaque page. Le panneau à droite est un `<details name>` imbriqué : le clic marche sans script, `site.js` ajoute
le survol.

## Méthode de livraison

**En direct, sans agent**, parce que le lot ne touche aucun chemin que la production emprunte (HTML statique, CSS, un
script de page), qu'il se défait d'un commit, et que son critère est un œil : Julien juge le rendu sur captures avant le
push. Une relecture indépendante en fin de lot. Essai réel qui clôt le lot : Julien clique le menu au bureau et au
téléphone sur la vitrine publiée, en français et en anglais.

## Contraintes

- Travail dans la copie à part `scratchpad/mm-ia` (dossier partagé en retard de 332 commits), publication en plomberie
  sur `main` (`commit-tree -p origin/main`, `push <sha>:main`), jamais pendant la CI d'un pair.
- Aucune adresse ne change. Libellés : Fonctionnalités / Features, Secteurs / Industries, Intégrations / Integrations,
  Documentation développeurs / Developer documentation, Guides d'intégration / Integration guides, Avec votre IA / With
  your AI.
- Les sept cas SaaS sortent du menu ; burger et bureau gardent les mêmes adresses.
- Pas de tiret cadratin ni demi-cadratin. Vouvoiement.

## Review Focus

- La souris qui part en diagonale d'une ligne vers son panneau survole la ligne d'en dessous : le survol n'ouvre
  qu'après un court arrêt, sinon le panneau visé se ferme sous le pointeur.
- Le panneau de Ressources, le plus à droite, déborde de l'écran à 1 141 px : mesuré ; s'il déborde, il s'ouvre à
  gauche.
- La barre à 1 141 px en français (le seuil du burger) : aucun débordement, « Se connecter » entier.
- Le clavier seul : Tab, Entrée sur Solutions puis sur Secteurs, Tab jusqu'aux liens, Échap referme et rend le focus.
- Un navigateur sans `details[name]` (Safari avant 17.2) : deux panneaux ouverts à la fois ; `site.js` ferme les autres
  à l'ouverture.

---

### Tâche 1 : l'en-tête généré

**Fichiers :** `scripts/vitrine/entete.fr.html`, `entete.en.html`, `pied.fr.html`, `pied.en.html`,
`scripts/vitrine/entete.ts`, `tests/vitrine-entete.test.ts`.

**Interfaces :**
- Inchangé : `enteteVitrine(langue: Langue, adresse: string, jumelle: string): string`.
- Remplace `liensSolutions` : `liensSecteurs(langue: Langue, retrait: string): string` (les secteurs `enLigne` du
  registre, puis la page chapeau SaaS en ligne ordinaire, sans ses cas) et `liensIntegrations(langue: Langue, retrait:
  string): string` (les boutiques `enLigne`, puis `HUBSPOT_SOLUTION`). Une ligne a la forme actuelle de
  `.menu-secteur` (icône, `strong`, `small`).
- `ouvrirGroupesActifs(entete: string): string` : parcourt les `<details` et `</details>` avec un compteur de profondeur
  et ajoute ` open` à chaque `burger-groupe` ou `burger-sous-groupe` dont le contenu porte `aria-current="page"`.
  Remplace la regex non gourmande actuelle, fausse dès que les `details` s'imbriquent.
- Gabarits : `{{secteurs}}`, `{{secteurs-burger}}`, `{{integrations}}`, `{{integrations-burger}}`.
- Bureau : chaque entrée de cascade est `<details class="menu-cascade" name="solutions|ressources"><summary>…
  </summary><div class="menu-sous-panneau">liens</div></details>`, dans le `.menu-panneau` de son menu.
  Burger : `<details class="burger-sous-groupe"><summary>…</summary><div class="burger-liens">liens</div></details>`
  dans le `.burger-liens` du groupe.
- Ressources, dans cet ordre : la cascade Documentation développeurs (les cinq liens du bloc `dev-portes` de la page de
  sa langue, mêmes libellés, phrases, icônes et adresses, `?lang=en` compris), Aide, Guides d'intégration
  (`/integrations/`, « Salesforce, Dynamics, HubSpot, Shopify »), Centre de confiance, Blog.
- Premier niveau : Solutions, Ressources, Tarifs, Avec votre IA (`/developpeurs/`, classe `nav-dev` gardée).

- [ ] **Tests d'abord** dans `tests/vitrine-entete.test.ts`, rouges avant le code :
  - `marque la page active…` étendu : pour `/fonctionnalites/whatsapp-et-rcs/`, deux `aria-current`, un
    `burger-groupe` ouvert et un `burger-sous-groupe` ouvert ; pour `/aide/`, un groupe ouvert, aucun sous-groupe ;
    pour l'accueil (fr et en), aucun `open`.
  - `Solutions : Fonctionnalités, Secteurs, Intégrations, dans cet ordre` (fr, en) : les libellés des `menu-cascade`
    du panneau Solutions ; Fonctionnalités porte les six adresses `/fonctionnalites/…` (ou `/en/features/…`) ;
    Secteurs, les adresses des secteurs `enLigne` puis celle de `TEXTES_CARREFOUR` ; Intégrations, celles des
    boutiques `enLigne` puis de `HUBSPOT_SOLUTION`.
  - `le premier niveau : Solutions, Ressources, Tarifs, Avec votre IA` (fr, en), et aucune adresse `/cas-d-usage/`
    dans l'en-tête.
  - `la documentation développeurs porte les cinq briques de la page` (fr, en) : ses adresses, dans l'ordre, égalent
    celles de `<nav class="dev-portes"` de `developpeurs/index.html` et `en/developers/index.html`.
  - `le pied de page mène à « Avec votre IA »` (fr, en).
- [ ] Gabarits, pied et générateur, puis `npx vitest run tests/vitrine-entete.test.ts` : vert, sauf « chaque page
  porte l'en-tête » (rouge jusqu'à la tâche 3).

### Tâche 2 : le panneau à droite, son style et son survol

**Fichiers :** `site/site.css` (bloc du menu Solutions, l. 1512 à 1534, et bloc du burger), `site/site.js` (premier
bloc).

- [ ] CSS : `.menu-cascade > summary` prend la forme d'un lien du panneau, avec la flèche `.menu-suite` vers la droite ;
  `.menu-cascade[open] > summary` en surbrillance ; `.menu-sous-panneau` s'affiche quand sa cascade est ouverte, à
  droite du panneau, avec l'animation `menu-ouvre`. `.burger-sous-groupe` : un sous-accordéon en retrait. Les règles
  mortes partent (`.menu-groupe`, `.menu-chapeau`, `.menu-sous`, le bloc `max-width:1100px`).
- [ ] JS : sur `details.menu-cascade`, à l'ouverture, fermer ses sœurs ; à la souris (`pointerType === 'mouse'`),
  ouvrir après 150 ms passés sur la ligne, annuler à la sortie.
- [ ] Vérification dans l'aperçu (tâche 3) : chaque ligne du Review Focus.

### Tâche 3 : pages régénérées, fil d'Ariane, rendu

**Fichiers :** `scripts/vitrine/aide.ts` (l. 577 et 588 : « Avec votre IA » / « With your AI »), toutes les pages de
`site/` (générées).

- [ ] `npm run vitrine:aide`, `npm run vitrine:anglais`, puis `npm run vitrine:entete`.
- [ ] `npx vitest run` sur toute la suite racine, `npm run typecheck`, `npm run lint`, `npm run auto-attaque` : verts
  (un rouge hors du lot se rejoue sur origin vierge avant d'être imputé).
- [ ] Aperçu servi par Node depuis la copie : captures du menu Solutions (chaque cascade ouverte), de Ressources, du
  burger (téléphone, sous-groupes ouverts), en français et en anglais ; mesures à 1 141 px. Envoyées à Julien avec
  le lien, son oui avant le push.

### Tâche 4 : relecture et publication

- [ ] Une relecture indépendante du diff (correctness, cas limites, rayon de souffle : qui supposait les cas SaaS dans
  le menu, `liensSolutions`, la regex d'ouverture).
- [ ] Commit en plomberie avec la spec et ce plan, `tests/plan-methode.test.ts` vert ; `gh run list` (aucune CI d'un
  pair en cours), push ; verdict de la CI lu job par job (`gh run view <id> --json jobs`) ; la page publiée relue par
  `curl`.
