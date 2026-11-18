# Page « Avec votre IA », lot 2 : Build / Run

**Goal :** la page `/developpeurs/` (et `/en/developers/`) s'ouvre sur Build et Run en accordéons face à face, avec les
moteurs d'IA qui défilent dans le titre ; une voie « Votre IA » pour les connecteurs ; les scénarios entrent au
catalogue ; la page prend le nom « Avec votre IA ».

**Spec :** `docs/superpowers/specs/2026-11-18-menu-solutions-et-page-avec-votre-ia-design.md` (le lot 1, le menu, est
en ligne : `ecb4f3cc4`).

**Architecture :** les deux pages restent écrites à la main ; le premier écran remplace la `figure.dev-terminal` par
deux colonnes `.ia-colonne` (Build, Run) de `details.ia-volet` exclusifs ; `site.js` joue le volet ouvert (le même
mécanisme de `--t` que la séance actuelle), le fait avancer seul et fait tourner le nom du moteur du titre. Les
pastilles d'offre et les outils montrés sont tenus par `tests/vitrine-developpeurs.test.ts` contre le code.

## Méthode de livraison

**En direct, sans agent**, parce que le lot ne touche aucun chemin que la production emprunte (deux pages statiques,
leur CSS et leur script, un texte du catalogue), qu'il se défait d'un commit, et que son critère est un œil : Julien
juge le premier écran sur captures avant le push. Une relecture indépendante en fin de lot. Essai réel qui clôt le
lot : la page publiée regardée au bureau et au téléphone, puis Julien branche le serveur MCP comme connecteur depuis
ChatGPT, Mistral et Perplexity et mène une demande Run jusqu'au bout ; un moteur qui échoue sort de la page.

## Contraintes

- Copie à part, publication en plomberie sur `main`, jamais pendant la CI d'un pair (comme le lot 1).
- Moteurs du titre, dans l'ordre : Claude, ChatGPT, Mistral, Perplexity, Codex, Cursor. Jamais Gemini.
- Les volets Build : Brancher votre numéro ; Un agent IA qui lit votre site ; La bulle sur votre site ; API, SDK et
  webhooks. Les volets Run : Créer un scénario ; Lancer une campagne ; Répondre à une conversation ; Lire vos chiffres.
  Outils de chaque volet : ceux de la spec, au mot près.
- « Gratuit et sans abonnement » sur la colonne Build ; une pastille d'offre par volet Run, calculée.
- Fenêtre Run neutre : logo et nom du moteur seulement. Pas de tiret cadratin, vouvoiement, pas de pavé.
- Logos : tracés libres (LobeHub MIT pour OpenAI et Cursor, déjà dans `~/engageme-motion/engageme-cas-agent-app/logos/` ;
  Simple Icons CC0 pour Mistral et Perplexity, pris au paquet `simple-icons` de npm, version épinglée), sans retouche.

## Review Focus

- Mouvement réduit : rien ne défile, chaque volet ouvert montre son état final, le titre dit « votre IA » et pose les
  logos en rangée.
- Le volet ouvert qui change pendant qu'on lit (survol ou focus) : pause ; un clic arrête le défilement de sa colonne.
- Le téléphone : les deux colonnes s'empilent sans débordement, la hauteur du premier écran ne saute pas quand un volet
  s'ouvre (hauteur réservée).
- Un lecteur d'écran lit le titre entier avec la liste des moteurs, une seule fois (le nom qui tourne est `aria-hidden`).
- La page anglaise : mêmes outils, mêmes pastilles, aucun reste de français.

---

### Tâche 1 : les tests de la page, rouges d'abord

**Fichier :** `tests/vitrine-developpeurs.test.ts`.

- [ ] `le terminal montre de vrais outils…` ne lit plus que la colonne Build (`<div class="ia-colonne" data-colonne="build">`) :
  l'ordre exigé reste le même (`get_setup_state` en tête, `create_widget` en dernier).
- [ ] Nouveau `page <langue> : chaque volet Run montre de vrais outils et la pastille de son offre` : dans
  `data-colonne="run"`, quatre `details.ia-volet` ; chaque `data-outil` existe dans `CATALOGUE_MCP` ; chaque volet porte
  `data-offre` égal à `offreDeLaCarte({ outils })` et le texte de `NOMS_OFFRES[langue][offre]` ; les outils du volet
  scénario sont `create_scenario` puis `send_scenario_to_contact`.
- [ ] Nouveau `page <langue> : le titre nomme les moteurs, sans Gemini` : le texte masqué du `h1` cite, dans l'ordre,
  Claude, ChatGPT, Mistral, Perplexity, Codex, Cursor ; la page ne contient pas « Gemini ».
- [ ] Nouveau `page <langue> : trois voies pour démarrer` : Claude Code, Codex, puis « Votre IA » qui porte l'adresse
  `${API_PUBLIQUE}/mcp` (remplace le test `dev-autres`).
- [ ] Gardés tels quels : commandes du plugin, balise de la bulle, exemple du SDK, liens, FAQ, `#demarrer` deux fois, trois
  promesses `dev-sans`.

### Tâche 2 : les logos

**Fichier :** `scripts/vitrine/logos-assistants.ts` (clés `openai`, `cursor`, `mistral`, `perplexity`, même forme que
les autres, provenance écrite en tête).

- [ ] Tracés copiés sans retouche ; `npx vitest run tests/vitrine-cas.test.ts` vert (les pages de cas lisent ce fichier).

### Tâche 3 : la page française

**Fichier :** `site/developpeurs/index.html`.

- [ ] Premier écran : surtitre « Avec votre IA » ; `h1` « Construisez WhatsApp dans votre app. Pilotez-le depuis »
  suivi du nom qui tourne (logo + nom, `aria-hidden`) et d'un `span.masque` qui donne la liste ; « Démarrer » vers
  `#demarrer` ; les trois promesses ; les deux colonnes (Build : fenêtre de terminal, badge « Gratuit et sans
  abonnement » ; Run : fenêtre de conversation neutre, logo et nom du moteur du volet) ; les cinq briques dessous.
- [ ] Chaque volet : `summary` (titre, pastille Run), puis sa séance en `li` à `--t` (la phrase, les appels
  `data-outil`, le résultat : balise réelle pour la bulle, bulle WhatsApp, carte de chiffres). Build reprend la séance
  actuelle découpée en trois, plus l'appel du SDK (`data-exemple` reste dans « Ou par le code »).
- [ ] `#demarrer` : troisième voie « Votre IA » (logos ChatGPT, Claude, Mistral, Perplexity, Cursor ; l'adresse du serveur
  MCP en bloc copiable), à la place de la ligne `dev-autres`.
- [ ] Renommages : `<title>`, `description`, JSON-LD (fil d'Ariane « Avec votre IA ») ; même surtitre et fil sur
  `developpeurs/compte-meta-business/`.

### Tâche 4 : le style et le mouvement

**Fichiers :** `site/site.css` (bloc `.ia-*`), `site/site.js` (le bloc du terminal devient celui des volets).

- [ ] CSS : deux colonnes au-delà de 961 px, empilées en dessous ; hauteur des colonnes réservée ; volet ouvert en
  relief, barre de progression `.ia-progression` animée sur la durée du volet ; pastilles ; nom qui tourne (entrée par
  le bas, sortie par le haut, largeur animée) ; tout mouvement sous `prefers-reduced-motion: no-preference`.
- [ ] JS : par colonne, à l'écran seulement (IntersectionObserver), jouer le volet ouvert puis ouvrir le suivant ;
  pause au survol et au focus ; un clic fixe le volet et arrête la colonne ; le moteur de l'en-tête Run suit le volet
  (`data-moteur`). Le titre tourne toutes les 2,4 s. Sans IntersectionObserver ou en mouvement réduit : volets finis,
  rien ne tourne.
- [ ] Vérification dans l'aperçu : chaque ligne du Review Focus, bureau et téléphone.

### Tâche 5 : le catalogue

**Fichier :** `scripts/plugin/construire.ts`, puis `npm run plugin:generer` (réécrit le bloc des deux pages et la
documentation du plugin).

- [ ] Dans « Leur écrire au bon moment », une capacité scénarios (`create_scenario`, `send_scenario_to_contact`,
  `list_scenarios`), lien vers la fiche d'aide publique « Créer un scénario » ; « Piloter depuis Claude » devient
  « Piloter depuis votre IA » (« Run it from your AI »).
- [ ] `npx vitest run tests/plugin*.test.ts tests/vitrine-*.test.ts` vert ; si un pair a poussé `scripts/plugin/` ou
  `plugin/` entre-temps, reprendre sa version et régénérer sur l'arbre fusionné.

### Tâche 6 : la page anglaise

**Fichiers :** `site/en/developers/index.html`, `site/en/developers/meta-business-account/` (par `vitrine:anglais`,
avec l'entrée « Avec votre IA » → « With your AI » dans son dictionnaire).

- [ ] Même structure, textes traduits, console en `?lang=en`, pastilles `Pro` / `Free`.

### Tâche 7 : vérification, relecture, publication

- [ ] `npx vitest run` (racine), `typecheck`, `lint`, `auto-attaque` ; captures bureau et téléphone, deux langues, un
  volet de chaque colonne ouvert ; envoyées à Julien, son oui avant le push.
- [ ] Une relecture indépendante ; jaunes au `todo.md` ; commit en plomberie, CI lue job par job, page publiée relue.
- [ ] Après la publication : Julien charge `aide:charger` si une fiche a bougé (aucune prévue) et publie le plugin
  quand il le décide (sa documentation a changé, `plugin.json` à monter).
