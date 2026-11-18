# Le menu Solutions en cascade, et la page « Avec votre IA » (Build / Run)

Date : 2026-11-18. Demande de Julien, cadrée le même jour (quatre réponses, puis le choix de la mise en page).

## Pourquoi

L'en-tête de la vitrine aligne Fonctionnalités, Solutions, Ressources, Tarifs et Développeurs : la face fonctionnelle et
l'aide technique s'y mélangent, et la page Développeurs ne montre au premier regard qu'une chose, « installez le plugin
dans Claude Code ». Or le produit fait deux choses que le visiteur doit voir dès l'ouverture : **construire** WhatsApp
dans son app (Build), et **piloter** tout le reste depuis n'importe quelle IA par le serveur MCP (Run), scénarios
compris. La section qui le disait (« Ce que vous pouvez construire ») est trop bas, et ne cite pas les scénarios.

Le partage voulu par Julien : **Solutions = le fonctionnel**, **Ressources = l'aide technique**.

## Objectifs

1. Solutions s'ouvre sur trois entrées, chacune déployant sa liste dans un panneau à sa droite : Fonctionnalités,
   Secteurs, Intégrations.
2. Fonctionnalités disparaît de l'en-tête (il vit dans Solutions).
3. Ressources gagne « Documentation développeurs », qui déploie à droite les cinq briques (doc de l'API, doc MCP, plugin
   Claude Code, SDK TypeScript, contrat OpenAPI). La page Intégrations y reste, renommée en aide technique.
4. « Développeurs » devient « Avec votre IA » (« With your AI »).
5. La page s'ouvre sur Build ET Run, en accordéons face à face, avec les moteurs d'IA qui défilent dans le titre.
6. Les scénarios entrent dans la page (démo Run et catalogue).

## Non-objectifs

- Aucune adresse ne change : `/developpeurs/`, `/en/developers/`, les guides `/developpeurs/...`, `/integrations/`,
  `/solutions/...` restent. Seuls les libellés bougent.
- Pas de nouvelle page Fonctionnalités, Secteurs ou Intégrations : les entrées ouvrent un panneau, elles ne mènent nulle
  part.
- Pas de refonte des sections basses de la page (étapes, catalogue, code, FAQ) au-delà de ce qui est écrit ici.

## Anti-objectifs

- Un menu qui traverse l'écran ou déborde : l'en-tête se mesure à 1 141 px en français (règle de la vitrine).
- Un sapin de Noël de logos : les moteurs défilent un par un, jamais tous en même temps dans le titre.
- Un moteur nommé qui ne marche pas : chaque moteur cité est branché une fois par Julien (essai réel), et un échec le
  retire de la page.
- Un pavé de texte : chaque volet MONTRE (la phrase tapée, les outils, le résultat), il ne raconte pas.

## Contraintes

- Vitrine statique, publiée par Vercel au push ; l'en-tête et le pied se changent dans `scripts/vitrine/entete.<langue>.html`
  et `pied.<langue>.html`, puis `npm run vitrine:entete` ; `entete.ts` génère le menu Solutions depuis le registre.
- La page française et la page anglaise de « Avec votre IA » s'écrivent à la main (exception de `en/developers/`).
- La section « Ce que vous pouvez construire » est générée depuis `scripts/plugin/construire.ts` par `plugin:generer`, qui
  écrit aussi la documentation du plugin : la toucher change `plugin/`, dont la publication reste à Julien.
- Les tests qui tiennent la page et l'en-tête (`tests/vitrine-developpeurs.test.ts`, `tests/vitrine-entete.test.ts`,
  `tests/vitrine-anglais.test.ts`) suivent la nouvelle structure ; ce qu'ils protègent (vrais outils dans un ordre que le
  produit accepte, vraie balise de bulle, commandes du plugin, burger et bureau aux mêmes adresses) reste protégé.
- Le dossier partagé a 332 commits de retard et porte le travail non commité d'une autre session sur `scripts/plugin/` et
  `plugin/` : le travail se fait dans une copie à part du code, à jour d'origin, publiée en plomberie sur `main`.

## Approches considérées (mise en page du premier écran)

| Approche | Ce qu'elle donne | Ce qu'elle coûte |
|---|---|---|
| **Accordéons face à face** (choisie par Julien) | Build à gauche, Run à droite, visibles ensemble ; le volet ouvert rejoue sa démo puis passe au suivant | Deux colonnes à tenir au téléphone (elles s'empilent) |
| Interrupteur Build / Run | Un seul écran qui bascule ; très lisible | On ne voit qu'une moitié à la fois, ce que la demande voulait éviter |
| Volets qui s'étirent | Le plus spectaculaire (volets verticaux qui s'élargissent au survol) | Illisible au téléphone sans repli ; titres couchés difficiles à lire |

Julien a choisi les accordéons face à face : c'était son idée, les deux moitiés se voient à l'ouverture, et le repli
téléphone est naturel.

## Ce qui est décidé

### Le menu Solutions (bureau)

Un clic sur « Solutions » ouvre le panneau actuel. Il porte trois lignes, chacune avec son icône et sa phrase courte :

| Ligne | Son panneau à droite |
|---|---|
| Fonctionnalités | les six pages `/fonctionnalites/...`, libellés et phrases de l'ancien menu |
| Secteurs | les secteurs en ligne au registre (aujourd'hui Transport et mobilités, Enseignement supérieur, Assurance, Voyage et tourisme), puis SaaS et app builders |
| Intégrations | Boutiques Shopify (`/solutions/shopify/`), Deep HubSpot integration |

- Les sept cas d'usage de SaaS et app builders **sortent du menu** (sa page les liste).
- Le panneau de droite s'ouvre au **clic** (demande de Julien) et aussi au survol et au focus ; une seule ligne ouverte à
  la fois ; Échap referme. Il réutilise le panneau à droite qui sert aujourd'hui aux cas SaaS (`.menu-sous-panneau`).
- La génération depuis le registre reste : un secteur ou une boutique mis en ligne entre seul dans sa liste.

### Le menu Ressources (bureau)

Dans cet ordre : **Documentation développeurs** (panneau à droite : Doc de l'API, Doc MCP, Plugin Claude Code, SDK
TypeScript, Contrat OpenAPI, avec les libellés, phrases et adresses du bloc `dev-portes` de la page, celui de la
capture fournie par Julien) ; Aide ;
**Guides d'intégration** (« Integration guides », `/integrations/`, « Salesforce, Dynamics, HubSpot, Shopify ») ; Centre
de confiance ; Blog.

### L'en-tête

Solutions · Ressources · Tarifs · **Avec votre IA** (`/developpeurs/`), puis les langues, Démarrer, Se connecter. En
anglais : Solutions · Resources · Pricing · **With your AI**. Le pied de page renomme son lien de la même façon.

### Le burger (téléphone)

Mêmes adresses que le bureau (le test l'exige). Solutions et Ressources restent des groupes dépliants ; Fonctionnalités,
Secteurs, Intégrations et Documentation développeurs y deviennent des sous-groupes dépliants. La page active ouvre son
groupe ET son sous-groupe.

### La page « Avec votre IA », premier écran

Croquis (bureau) :

```
  [Avec votre IA · Gratuit et sans abonnement]
  Construisez WhatsApp dans votre app.
  Pilotez-le depuis [◉ ChatGPT]              <- logo + nom qui défilent
  [Démarrer]   aucun compte · numéro fourni · compte Meta Business ou app WhatsApp Business

  ┌─ BUILD · dans votre app ───────┐  ┌─ RUN · depuis [◉ ChatGPT] ─────┐
  │ ▸ Brancher votre numéro        │  │ ▾ Créer un scénario            │
  │ ▾ Un agent IA qui lit le site  │  │   > « Relance les paniers      │
  │   > /messagingme:demarrer      │  │     abandonnés après 2 h »     │
  │   ● create_agent     ✓         │  │   ● create_scenario   ✓        │
  │   ● import_site   12 fiches    │  │   [ bulle WhatsApp du message ]│
  │   ━━━━━━━━━━━──── progression  │  │   ━━━━━───────── progression   │
  │ ▸ La bulle sur votre site      │  │ ▸ Lancer une campagne          │
  │ ▸ API, SDK et webhooks         │  │ ▸ Répondre à une conversation  │
  └────────────────────────────────┘  │ ▸ Lire vos chiffres            │
                                       └────────────────────────────────┘
  [Doc de l'API] [Doc MCP] [Plugin Claude Code] [SDK TypeScript] [Contrat OpenAPI]
```

- **Le titre** nomme les deux gestes. Le nom qui défile parcourt Claude, ChatGPT, Mistral, Perplexity, Codex, Cursor
  (Gemini retiré par Julien), chacun avec son logo, l'un après l'autre (entrée et sortie animées, comme Wax mais avec le
  logo). Un lecteur d'écran et un moteur de recherche lisent la phrase entière avec la liste des moteurs ; mouvement
  réduit : le titre dit « votre IA » et les logos se posent en une rangée fixe. « Claude » couvre claude.ai et Claude
  Code, que le serveur d'autorisation connaît déjà (`src/oauth/clients.ts`).
- **L'en-tête de la colonne Run** montre un moteur par volet (le moteur change quand le volet change, sans être calé
  sur le titre, qui tourne sur sa propre horloge). La fenêtre reste NEUTRE : seuls le logo et le nom changent, on
  n'imite l'interface d'aucun moteur. Mouvement réduit : le moteur du premier volet, fixe. *(Choix du constructeur de la
  conception, à corriger par Julien.)*
- **Les offres** : « Gratuit et sans abonnement » se pose sur la colonne Build (tout y est en Free). Chaque volet Run
  porte la pastille de la plus petite offre qui l'ouvre, CALCULÉE depuis le code (`offreDeLaCarte`,
  `scripts/vitrine/offres-outils.ts`), jamais écrite à la main : aujourd'hui Pro pour scénario, campagne et chiffres,
  Free pour la conversation. Un test refuse une pastille restée en arrière.
- **Build** (fenêtre de terminal, comme la séance d'aujourd'hui) : Brancher votre numéro ; Un agent IA qui lit votre
  site ; La bulle sur votre site (avec la vraie balise) ; API, SDK et webhooks (l'appel du SDK, pas des outils MCP).
  Les trois premiers volets reprennent la séance actuelle, découpée : mêmes outils, même ordre, même balise.
- **Run** (fenêtre de conversation) : Créer un scénario (`create_scenario`, puis `send_scenario_to_contact`) ; Lancer
  une campagne (`find_contacts`, `prepare_campaign`, `launch_campaign`) ; Répondre à une conversation
  (`list_conversations`, `get_conversation`, `reply_in_open_window`) ; Lire vos chiffres (`get_message_stats`,
  `get_campaign_stats`, `get_ai_stats` ; pas les analyses de conversation, de l'Entreprise). Chaque volet finit sur un
  résultat visible : la bulle WhatsApp du message, la campagne partie, la réponse envoyée, une petite carte de chiffres.
- **Comportement** : un volet ouvert par colonne ; il rejoue sa démo (phrase, appels un par un, résultat), une barre de
  progression court sous lui, puis le volet suivant s'ouvre seul. Survol ou focus : pause. Clic : ouvre ce volet et
  arrête le défilement de sa colonne. Hors de l'écran : rien ne tourne. Mouvement réduit : aucun défilement automatique,
  chaque volet ouvert montre son état final.
- **Téléphone** : Build puis Run, l'un sous l'autre ; le titre garde son nom qui défile.
- Les cinq briques restent sous les accordéons (la porte du code, sans compte).

### La suite de la page

- **Démarrer** (`#demarrer`) : les voies Claude Code et Codex restent ; une troisième voie, « Votre IA », montre les
  logos de ChatGPT, Claude, Mistral, Perplexity et Cursor, et l'adresse du serveur MCP à ajouter comme connecteur
  (elle remplace la ligne « Cursor, VS Code ou Lovable »).
- **Ce que vous pouvez construire** : une ligne « scénarios » entre dans « Leur écrire au bon moment » (créer un parcours
  en une phrase, l'envoyer à un contact, avec ses outils) ; « Piloter depuis Claude » devient « Piloter depuis votre IA ».
- **Ou par le code** et la **FAQ** ne changent pas.
- Les guides `/developpeurs/...` gardent leur adresse ; leur fil d'Ariane suit le nouveau nom.

## Ce qui est laissé au constructeur

- Les phrases exactes des volets, des titres et des sous-titres, dans le ton de la vitrine (pas de tiret cadratin, pas de
  réassurance technique), et leur traduction anglaise.
- Le choix des icônes des trois lignes de Solutions et de « Documentation développeurs ».
- Les tracés des logos manquants (ChatGPT, Mistral, Perplexity, Cursor), pris aux mêmes sources libres que les
  logos déjà montrés (LobeHub, Simple Icons), sans retouche.
- Le lot 2 régénère la documentation du plugin (`plugin:generer`) : si un pair a poussé `scripts/plugin/` ou `plugin/`
  entre-temps, on reprend sa version, on régénère sur l'arbre fusionné, et seuls nos blocs diffèrent d'origin.
- Les durées d'animation, à régler à l'œil.
- La forme des tests mis à jour, tant qu'ils protègent ce qu'ils protégeaient.

## Livraison

Deux lots, chacun relu une fois, rendu montré à Julien (captures bureau et téléphone, deux langues) avant le push :

1. **Le menu** (en-tête, burger, pied, générateur, tests), en français et en anglais.
2. **La page « Avec votre IA »** (premier écran, voie « Votre IA », ligne scénarios, renommages), en français et en
   anglais.

**Essai réel qui clôt la feature** : le menu cliqué au bureau et au téléphone sur la vitrine publiée ; puis Julien,
avec ses comptes, branche le serveur MCP comme connecteur depuis ChatGPT, Mistral et Perplexity et mène une demande Run
jusqu'au bout. Un moteur qui échoue sort de la liste (titre, voie « Votre IA ») par un correctif aussitôt.
