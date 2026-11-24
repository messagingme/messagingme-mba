# Plan : le guide de démarrage de la console (2026-11-24)

Cadrage : `docs/superpowers/specs/2026-11-24-guide-demarrage-design.md`. Maquette validée par Julien le 2026-11-24
(https://claude.ai/artifact/7Q2674zcgEgqp43oWq3LK8). Remplace la fenêtre de `AccueilBienvenue.tsx` ; la visite
(`VisiteConsole.tsx`) reste et devient le lien « Faire le tour de la console ».

## Méthode de livraison

Implémenteur par lot et revue humaine du diff, une relecture indépendante en fin de lot : la coquille partagée
(`AppShell`) est touchée, l'écran est visuel (pas pour feature-loop), et le lot 1 ouvre une route d'espace (isolation
`tenant_id`). Essai réel qui clôt la feature : un compte neuf sur la SANDBOX suit la checklist, puis le parcours agent IA
de bout en bout, dans la console de production, et la carte se coche sans recharger.

## Décisions prises en écrivant ce plan

- **La fenêtre s'ouvre seule tant que la personne n'a rien choisi** (le marquage `accueil_choisi_le` reste tel quel).
  Après un choix, c'est la carte « Bien démarrer » de l'Accueil qui porte la checklist, jusqu'à 5 sur 5 : la fenêtre ne
  se réimpose pas à chaque connexion.
- **La checklist n'est montrée qu'à un administrateur** (ses étapes mènent à des écrans d'administrateur, comme les
  raccourcis d'aujourd'hui). Un autre membre garde le film et la visite.
- **Le parcours en cours vit dans `sessionStorage`** (une commodité par onglet, pas un état à garder) : il survit à la
  navigation, disparaît à la fermeture de l'onglet. Aucune table.
- **Tant que le film n'existe pas**, le bandeau montre le titre sans bouton de lecture : la console ne pointe jamais
  vers un fichier absent.

## Lot 1 : l'API qui dit où en est l'espace

- Route `GET /tenants/:tenantId/demarrage`, module de classe `tenant` dans `modulesDeRoutes` (garde et `etapeEspace`
  posées au montage). Elle rend cinq booléens : `numero` (relié), `outil` (Shopify ou HubSpot connecté),
  `scenarioOuCampagne` (un scénario publié OU une campagne envoyée), `agent` (un agent actif), `bulle` (une bulle active).
- Un store `src/demarrage/store.pg.ts` : une requête `exists` par signal, chacune filtrée `tenant_id = $1`, en une seule
  lecture (`select exists(...) as numero, exists(...) as outil, ...`). Les tables se LISENT avant d'écrire (connexion
  Shopify, HubSpot, `workflows` publiés, campagnes envoyées, agents, widgets) ; les index existants couvrent `tenant_id`.
- Tests : unitaire de la route (forme, un signal faux), intégration du store (chaque signal, et un autre espace qui a tout
  ne coche rien : la fuite entre espaces), `tests/scope-tenant.test.ts` la couvre d'office, `npm run auto-attaque`.
- Aucune migration. Déploiement `migration=aucune` AVANT tout push du lot 2.

## Lot 2 : la fenêtre, la carte de l'Accueil, l'entrée de l'aide

- `web/lib/demarrage.ts` (pur, testé) : les cinq étapes dans l'ordre de Julien (numéro, outil, scénario ou campagne,
  agent IA, bulle), l'étape 0 retirée si le numéro est relié, le compte « N sur 5 », la prochaine étape, et pour chacune
  son parcours (ou son simple lien pour la bulle).
- `AccueilBienvenue.tsx` réécrit d'après la maquette : bandeau du film, progression, lignes « Me guider » ou « Ouvrir »,
  « Faire le tour de la console », « Plus tard, depuis l'Accueil ». Chaque choix marque le compte comme aujourd'hui.
  Une réponse absente de `/demarrage` (API plus ancienne, panne) montre les étapes sans coche, jamais une erreur.
- Carte « Bien démarrer, N sur 5 » en haut de l'Accueil, tant que tout n'est pas fait ; entrée « Bien démarrer » dans
  `BoutonAide.tsx`, qui rouvre la fenêtre.
- Tests : `demarrage.test.ts`, e2e `accueil-bienvenue.spec.ts` mis à jour (coches, « Me guider » lance le parcours, non
  administrateur sans checklist), `web-formes`, `web-vouvoiement`, suite racine entière.

## Lot 3 : le moteur du guide et le parcours agent IA

- `web/lib/guide/parcours.ts` : un parcours = des étapes `{ page, cible, titre, texte (fr, en), passage }`, où `cible`
  désigne un attribut `data-guide` et `passage` dit quand l'étape est faite (page atteinte, élément apparu, signal de
  `/demarrage` devenu vrai). Le bouton « Suivant » reste toujours là.
- `web/components/GuideCompagnon.tsx`, monté par `AppShell` : la carte en haut à droite, repliable en pastille, le cadre
  pulsé sur la cible (le cadre de `VisiteConsole`, sans voile). Une cible absente de l'écran : la carte reste, sans cadre.
- Parcours agent IA, les quatre étapes de la maquette, avec `data-guide` posés dans `web/app/agents/page.tsx`
  (« Nouvel agent », l'onglet « Construire en parlant », la zone de saisie, « Le faire répondre »).
- Tests : `guide-parcours.test.ts` (chaque `cible` de chaque parcours existe en `data-guide` dans `web/`, refuse une
  cible morte), e2e du parcours agent IA sur un faux backend.

## Lot 4 : les parcours Shopify, campagne et scénario

- Shopify : Intégrations, le dépliage Shopify, ce qu'il faut faire chez Shopify, les messages de commande.
- Campagne : import des contacts, le modèle (ou sa demande d'approbation), le lancement.
- Scénario : nouveau scénario, le déclencheur, le premier bloc, la publication.
- Les `data-guide` dans chaque écran, couverts par le test du lot 3 ; un e2e par parcours.

## Lot 5 : le film de bienvenue

- Film motion d'environ 60 s dans `~/engageme-motion` (lire son `CLAUDE.md`), FR et EN, avec une miniature : la console,
  les cinq étapes, « on vous accompagne ». Posé dans `web/public/films/` ; le bandeau du lot 2 affiche alors le bouton de
  lecture (lecteur dans la fenêtre, jamais un nouvel onglet).

## Docs et aide, à chaque lot

`features.md` (section du guide, fiche d'aide et empreinte dans le même commit, `tests/aide-proposer.test.ts` avant le
push), `documentation.md` (la route, le moteur de parcours, la règle des `data-guide`), `npm run aide:carte` si
`web/lib/nav.ts` bouge.

## Ordre de mise en ligne

Lot 1 poussé, CI lue job par job, déployé ; puis lot 2 ; puis lots 3 et 4 (console seule, déployés par Vercel au
push) ; le lot 5 quand le film est validé par Julien.
