# Plan : les pages API et MCP de la console, plus claires (2026-10-31)

Source : un audit externe transmis par Julien le 2026-10-31, tranché le même jour. On garde la clarification des deux
pages ; à la place d'un rendu OpenAPI dans la console, un bloc « utiliser le contrat dans votre outil » ; le mode
répétition (`dryRun` sur l'envoi) attend la lecture de l'usage réel de l'API ; pas de sandbox séparée. Aucune route,
aucune migration : la console part à son push.

## Méthode de livraison

**En direct, avec une relecture indépendante en fin de lot**, parce que la production n'emprunte aucun de ces chemins
(des pages de documentation, aucune route, aucune donnée), que tout se défait par un `git revert` et le redéploiement
de Vercel, que les critères sont pour moitié vérifiables par un test (ancres, liens, chaque outil une fois, parité des
deux langues) et pour moitié par un œil (la lisibilité), et que le seul invariant invisible, les ancres publiques et
leurs redirections (`PAGES_DOC`, `CadreDoc`), est déjà tenu par l'e2e de la console.

**Essai réel qui clôt** : Julien ouvre les deux pages en ligne, déconnecté puis connecté à un espace Free, en français
puis en anglais, au téléphone. Il suit le chemin « API » jusqu'à la clé créée, puis un chemin MCP jusqu'à
« Authenticate ». Tout ce que les pages lui font faire doit exister pour une Free.

## Ce que l'audit n'avait pas vu, et qui entre dans le lot

- **L'accueil de l'API donne la clé APRÈS le premier appel**, alors qu'on ne peut rien appeler sans elle.
- **Le guide « Démarrer » envoie dans la console des écrans que Free n'a plus** : les webhooks sortants et les modèles
  (Free ne garde que l'offre, le numéro, les clés d'API, le compte et le support, `MODULES_OUVERTS_AU_FREE`). Pour elle,
  ces gestes passent par l'API (`/v1/webhook-endpoints`, `/v1/templates`) ou par Claude.
- **Rien ne dit que les appels sont réels** : un envoi part vraiment sur WhatsApp, et Meta peut le facturer.

## Tâche 1 : l'accueil de l'API (`web/app/developers/api/page.tsx`)

Dans cet ordre :
1. Ce que fait l'API, en une phrase, puis le tableau « API ou MCP ? » (un composant partagé par les deux pages : qui
   écrit le code, ce qu'on branche, ce que ça ouvre, où commencer).
2. **Votre clé** : où la créer (la console, Developers > Clés d'API, ouverte à toutes les offres ; ou en demandant à
   Claude, `create_api_key`), les droits à cocher, la clé montrée une seule fois, l'adresse de base, et l'avertissement :
   les appels sont réels.
3. **Premier appel** (inchangé : créer une fiche, sans effet chez Meta) et sa réponse.
4. **Ensuite** : le SDK, le guide Démarrer, les concepts (fenêtre de 24 h, consentement, idempotence), les erreurs.
5. **Utiliser le contrat dans votre outil** : `openapi.json`, et comment l'importer dans Postman, Bruno ou Insomnia
   (le bloc OpenAPI actuel, réécrit).
6. **Tous les endpoints** en dernier.

Les ancres `premier-appel`, `endpoints`, `adresse`, `openapi` et `authentification` restent (vitrine, plugin et
anciennes adresses les visent).

## Tâche 2 : la page MCP (`web/app/developers/mcp/page.tsx`)

1. Une phrase, puis le même tableau « API ou MCP ? ».
2. **Trois chemins numérotés**, chacun avec : pour qui, les étapes, une vérification qui ne change rien (« Où en est mon
   espace ? », `get_setup_state`, en lecture), et ce qu'il ouvre :
   - **Claude Code avec le plugin** (recommandé) : tout, mise en service comprise ;
   - **un autre client par OAuth** (ChatGPT, Cursor, VS Code, Lovable) : « sans clé à copier : l'autorisation OAuth »,
     et ce que dit la page d'autorisation du nom du client ;
   - **à la main avec une clé d'API** : la commande `claude mcp add` ; elle n'ouvre pas les outils qui agissent au nom
     d'une personne (mise en service, agent IA, crédit), et ne se combine pas avec le plugin.
3. **Ce qu'il ne fait pas** (inchangé), suivi de **Retirer l'accès et dépannage** : révoquer une clé ou une autorisation
   (Clés d'API), un refus 401, un serveur en double avec le plugin.
4. **Les outils par famille**, un sous-titre par famille, chaque outil gardant son ancre (son nom). Pas de filtre.

Ancres nouvelles des trois chemins et des sections, déclarées dans `PAGES_DOC` à côté de celles des outils.

**Interface** : les familles (`FAMILLES_OUTILS`, déjà bilingues) passent de `scripts/plugin/` à `web/lib/partage/`,
comme le catalogue, pour que la console les lise ; le README du plugin et la page Boutiques Shopify les importent de là.
La garde « chaque outil dans une famille, une seule » suit le fichier.

## Tâche 3 : le guide Démarrer (`web/app/developers/api/quickstart/page.tsx`)

Les étapes webhook et modèle disent les deux voies qui existent pour toutes les offres : l'API (avec l'exemple) ou
Claude ; la console seulement « en formule Pro ». La clé de l'étape 2 porte les droits que les étapes 3 et 4 demandent.

**Écart tranché à l'exécution** : l'étape 1 garde l'inscription. Le tunnel `/demarrer` mène Free au plugin Claude Code,
alors que ce guide sert celui qui écrit son propre code sans Claude ; l'inscription par la console lui reste ouverte, et
la page MCP porte le chemin du plugin.

## Tests attendus

- e2e `web/e2e/developers-api.spec.ts` : chaque ancre déclarée existe (déjà) ; les deux pages à 375 px sans défilement
  horizontal ; le tableau « API ou MCP ? » présent sur les deux ; la tabulation atteint chaque bloc à copier.
- La page MCP range chaque outil du catalogue dans une famille, une seule fois.
- Les gardes existantes : vouvoiement, formes, parité de la doc MCP (`tests/mcp-doc-parite.test.ts`), `doc:md` si la
  doc générée lit ces pages, et la suite racine entière (un lot de `web/` la lance aussi).

## Ordre de déploiement

La console seule, chez Vercel au push. Les liens entrants (vitrine, README du plugin, FAQ) visent des ancres
conservées : rien ne casse entre le push et la lecture.

## Hors du plan

- **Le mode répétition** (`dryRun` sur `POST /v1/sends` : tout vérifier, ne rien envoyer à Meta) : après la lecture de
  l'usage réel de l'API (clés créées, appels par jour), dans un plan à lui.
- **Un rendu OpenAPI dans la console** (Scalar, Swagger) et **une sandbox séparée** : écartés le 2026-10-31.
