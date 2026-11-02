# Créer des scénarios par l'API et le MCP : design de la v1

Cadrage du 2026-11-02 avec Julien. Ce document dit ce qu'on construit et pourquoi ; le plan d'exécution viendra après.

## Intention

Aujourd'hui, un intégrateur ou Claude Code sait **lancer** un scénario (`POST /v1/sends`) et **lister** ceux qui sont
publiés (`GET /v1/scenarios`), mais un scénario ne se **dessine** que dans la console. La v1 permet de créer, relire,
remplacer et supprimer un scénario simple sans ouvrir la console :

- par **Claude Code**, à travers le serveur MCP (« fais-moi un parcours de relance devis ») ;
- par un **intégrateur en REST**, depuis son propre logiciel.

Les deux passent par **un seul compilateur** : une route et un outil MCP qui jugeraient différemment le même scénario
seraient le défaut qu'on a déjà corrigé ailleurs (`ouvertureApi`, une règle, deux appelants).

## Le choix de fond : une recette, jamais le graphe brut

Le graphe d'un scénario (`src/workflow/graph.ts`) a un `data` **opaque** : `parseGraph` vérifie les types, les ids et
les arêtes, jamais le contenu d'un bloc. Un bloc mal rempli ne lève aucune erreur : un agent sans `agentId` devient un
passe-plat, un template sans `templateName` fait attendre le contact après un message jamais envoyé. Le graphe porte aussi des conventions qu'un tiers
reproduirait de travers : la copie des boutons du template (`templateButtons`), des branches **indexées** (`btn:<i>`),
des positions x/y, des codes `nod_…` mintés par le serveur.

L'API reçoit donc une **recette** : une arborescence lisible, sans id ni position. Le serveur la valide strictement
(Zod, `safeParse`, schéma fermé par type de bloc), la compile en graphe, calcule les positions, puis passe par les
mêmes points que la console (`mintNodeCodes`, `parseGraph`).

Un bloc ne s'adresse jamais seul : il n'existe que dans le graphe de son scénario. Un scénario se crée ou se remplace
**en un seul appel**, tout ou rien. Le template, lui, est une ressource à part (revue de Meta asynchrone, réutilisé par
les campagnes) : il se crée avant, par `POST /v1/templates` ou `create_template`, qui existent.

## Décisions de Julien

| Sujet | Décision |
|---|---|
| Pour qui | Claude Code (MCP) et intégrateurs REST, dès la v1 |
| Offres | Celles qui ont la fonction `scenarios` : Pro, Entreprise, et Business quand elle existera. Free est refusé avec le lien vers les offres |
| Mise en ligne | **Toute écriture publie tout de suite**, création comme remplacement. Aucun brouillon par l'API |
| Template pas encore approuvé | **Refus net** de l'appel, avec la raison ; rien n'est enregistré |
| Modification | Remplacement du scénario entier |
| Portée | L'API ne remplace et ne supprime **que les scénarios qu'elle a créés** |
| Blocs v1 | Le socle : template, message à réponses rapides, agent IA, passage à un humain |
| Agent IA | **Termine le parcours** : pas de branches de sortie en v1 |
| Suppression | Oui, pour les scénarios de l'API |
| Pièce jointe d'un message | **Un fichier par message**, donné par une **adresse publique lue à l'envoi** (comme la console avec une adresse : rien n'est stocké). Mêmes types que la console : image (JPEG, PNG, GIF), vidéo MP4, PDF |
| Déclencheurs | **Rien de neuf** : `/v1/sends` et le répondeur par défaut existants. Le répondeur reste accessible par le MCP et la console, pas en REST |

## Non-objectifs (v1)

- Les blocs question à menu, étiquette, champ, opt-in, attente, condition, formulaire (Flow), RCS, e-mail, appel HTTP,
  fonction JS, « Aller à », « Envoyer au MBA ».
- Les branches de sortie du bloc agent (règles d'arrêt, délai dépassé).
- Les déclencheurs (mot-clé, étiquette posée, nouveau contact) et le répondeur en REST.
- Le brouillon, le lien de test, la publication à part.
- Modifier ou supprimer un scénario dessiné dans la console.
- Créer le template dans le même appel que le scénario.
- Déposer un fichier par l'API (pas de route `/v1/medias`), copier le fichier dans la médiathèque, plusieurs fichiers
  dans un même message (limite de WhatsApp : on enchaîne des messages), l'audio (ni légende ni bouton chez WhatsApp),
  les documents Office.

## Anti-objectifs (ce qui ferait de la v1 un échec même si elle marche)

- Un scénario accepté par l'API qui se comporte autrement que ce que la recette annonce : un bouton qui ne mène nulle
  part, un bloc vide qui passe en silence.
- Un scénario de la console abîmé par l'API (blocs hors v1 effacés, travail d'un opérateur écrasé).
- Un client Free qui obtient un scénario.
- Un envoi hors fenêtre de 24 h rendu possible par un scénario créé par l'API.

## La recette

Une étape est **exactement un** de ces quatre objets :

```jsonc
// Envoyer un template approuvé. Avec des boutons de réponse rapide, il attend le choix du contact.
{ "template": { "nom": "relance_devis", "langue": "fr", "variables": { "1": { "champ": "prenom" } } },
  "boutons": { "Oui, intéressé": <étape>, "Plus tard": <étape> },   // une entrée par bouton de réponse rapide
  "autre_reponse": <étape> }                                        // facultatif : le contact écrit au lieu de cliquer

// Envoyer un message libre (fenêtre de 24 h), avec un fichier facultatif.
// Avec 1 à 3 réponses rapides, il attend : une branche par réponse, et « autre_reponse » facultative.
{ "message": { "texte": "Voici notre brochure. On en parle demain ?", "fichier": { "url": "https://exemple.fr/brochure.pdf" } },
  "reponses": { "Oui": <étape>, "Non merci": <étape> },
  "autre_reponse": <étape> }
// Sans réponse rapide, il n'attend pas : « suite » est l'étape jouée juste après, facultative.
{ "message": { "texte": "Merci, je vous passe un conseiller." }, "suite": <étape> }

// Confier la conversation à un agent IA : fin du parcours.
{ "agent": { "agent_id": "<uuid>" } }

// Passer la conversation à l'équipe (« À traiter ») : fin du parcours.
{ "humain": {} }
```

Le corps d'une création : `{ "nom": "Relance devis", "entree": <étape> }`.

**Un template sans bouton de réponse rapide termine le parcours** (ni `boutons` ni `autre_reponse` acceptés). Le moteur
ne le fait pas attendre quand l'agent de Meta est le répondeur (`mbaActif`) : la suite partirait aussitôt, et si
c'était un message de session, la garde de fenêtre refuserait le démarrage entier, template compris. Ce sont alors les
réglages du répondeur qui prennent la réponse du contact.

**L'agent « termine le parcours » comme le répondeur par défaut** (`src/repondeur/graphe.ts`) : chaque règle d'arrêt
de l'agent, `humain` et `timeout` mènent à une fin silencieuse cachée ; `echec`, `plafond` et `sans_source` restent sans
arête et remontent à l'équipe. Laisser `humain` sans arête ferait partir la conversation à l'équipe comme trou de
montage et perdrait la dernière phrase de l'agent. La décompilation reconnaît cette fin et ne la montre pas.

Règles de validation (refus 422 avec un `code` stable et la raison en français, comme le reste de `/v1`) :

1. **Le template existe dans l'espace, dans cette langue, et il est APPROUVÉ** chez Meta. Sinon, refus net :
   l'appelant réessaie après l'approbation (`GET /v1/templates/:name` donne le statut).
2. **Les boutons se désignent par leur texte exact.** Le serveur lit les boutons du template approuvé, retrouve
   l'index de chacun et remplit lui-même `templateButtons` : la copie ne vient jamais de l'appelant. Un texte inconnu
   est refusé, avec la liste des textes du template.
3. **Chaque bouton de réponse rapide a sa branche.** Un bouton sans suite, cliqué, remonte la conversation à un humain
   comme « trou de montage » (`executor.ts`, `boutonSansSuite`) : la recette doit dire explicitement `{ "humain": {} }`
   si c'est voulu. Les boutons de lien ou d'appel d'un template ne sont pas des branches.
4. **Le message** : texte non vide et borné, au plus 3 réponses rapides de 20 caractères au plus, textes distincts.
   ⚠️ Ces bornes n'ont pas de source commune aujourd'hui : la console les écrit en dur dans
   `web/components/WorkflowConfigPanel.tsx` (20, 3, 1 024 et 4 096) et ne vérifie pas que les textes sont distincts.
   Le lot les déplace dans `web/lib/partage/`, la console et le compilateur les importent.
   **Le fichier** : un seul, par une adresse `https`. Avec des réponses rapides il part en en-tête du message, sans
   réponse rapide en média légendé, exactement comme un bloc de la console (`sendQuickMessage`,
   `src/workflow/envois-bloc.ts`) : le compilateur le range dans `data.imageUrl`, le champ que le moteur lit. Avec un
   fichier, le texte est limité à 1 024 caractères. Le fichier est lu **à l'envoi** (décision de Julien) : s'il change
   ou disparaît du site, les envois suivants changent ou échouent, et le bloc refuse alors d'envoyer un message sans
   son fichier. **À l'écriture, le serveur le télécharge une fois pour le vérifier, sans le stocker** (mon choix) : une
   adresse interne, injoignable, trop lourde ou d'un type que WhatsApp refuse est refusée en 422, au lieu d'un scénario
   accepté dont chaque envoi échouerait. Mêmes gardes que l'en-tête de template par adresse (`src/api/entete-par-url.ts` :
   résolution publique, connexion vérifiée, aucune redirection suivie, lecture bornée, type jugé sur les octets), donc
   un chemin de plus dans l'inventaire de `tests/lib-adresse-privee.test.ts`. Une adresse de la médiathèque de l'espace
   (posée par la console) est acceptée et relue telle quelle par la décompilation.
5. **L'agent** appartient à l'espace et il est actif.
6. **Les variables du template.** Une source est un champ du contact (`{ "champ": "prenom" }`) ou un texte fixe
   (`{ "texte": "…" }`). Sans `variables`, les associations que la console a posées (les indices que rend
   `GET /v1/templates`) sont **recopiées dans le bloc** à la compilation, pour que l'empreinte couvre ce qui partira : un
   changement d'association dans la console ne modifie pas en silence un scénario de l'API. Une variable sans source est
   refusée, **sauf pour le template d'ouverture**, que `/v1/sends` remplit par ses `params`, comme aujourd'hui.
7. **La taille** : la borne `MAX_NODES` de `src/workflow/graph.ts` (à exporter), et une profondeur bornée.
8. **Le nom** est unique dans l'espace, sans tenir compte de la casse : `/v1/sends` résout un scénario par son nom et
   rend `scenario_ambiguous` sur deux homonymes, ce qui casserait une intégration qui envoie déjà l'autre.
9. **L'ouverture** : le scénario compilé passe par `ouvertureApi` ; ce qu'elle refuserait à l'envoi est refusé à
   l'écriture. Une entrée par message libre est acceptée, mais elle ne partira qu'aux contacts dont la fenêtre est
   ouverte : c'est la règle des envois, inchangée.

## Les routes et les outils

| REST | MCP | Ce qu'il fait |
|---|---|---|
| `POST /v1/scenarios` | `create_scenario` | Compile, enregistre, **publie** ; rend l'uuid, le code `scn_`, le code `nod_` du bloc d'entrée (indispensable pour envoyer un scénario qui ouvre par un message), le nom, la recette relue, l'ouverture calculée |
| `GET /v1/scenarios/:id` | `get_scenario` | Rend la recette relue depuis le graphe publié, et l'empreinte de son contenu |
| `PUT /v1/scenarios/:id` | `update_scenario` | Remplace tout le scénario et **publie** ; exige l'empreinte lue (voir plus bas) |
| `DELETE /v1/scenarios/:id` | `delete_scenario` | Supprime, sauf si le scénario est utilisé |
| `GET /v1/scenarios` (existe) | `list_scenarios` (existe) | Inchangés, à part l'indication de l'origine |

- **Clé d'API** : une portée nouvelle `scenarios:write` pour les écritures, sur le modèle de `templates:write`. Les
  clés existantes ne la reçoivent pas d'office. La lecture d'un scénario prend la portée du catalogue existant.
- **Outils MCP d'écriture : une personne exigée** (`exigePersonne`), comme `create_template` et
  `set_default_responder`. Un scénario publié envoie de vrais messages et peut devenir celui du répondeur : on ne
  l'ouvre pas à un client MCP sans personne derrière. Lecture (`get_scenario`) sans cette exigence.
- **Garde d'offre** : la fonction `scenarios` de l'espace, par le refus commun des offres (`src/offres/refus.ts`),
  jamais une liste d'offres écrite à la main. Business l'aura le jour où elle la reçoit.
- **Plafonds** : ceux de l'API publique, comptés comme tout appel `/v1` (`compterOuRefuser`). Le MCP partage le même
  compteur.
- **Journal** : chaque écriture inscrit `workflow.published` (ou sa suppression) avec l'origine `api` ou `mcp` et
  l'auteur (clé ou personne), comme la console inscrit la publication.
- **Idempotence** de la création : la même mécanique que `/v1/sends` (clé obligatoire, même clé avec un autre corps
  refusée). Un réessai réseau ne doit pas créer deux scénarios.

## Origine, relecture et conflits

- **Marque d'origine.** Une colonne sur `workflows` dit qui l'a créé (`console` par défaut, `api`). Elle est posée à
  la création et ne change jamais. C'est une **migration** qui ajoute une colonne lue et écrite par le code : elle part
  en `avant`. Le remplacement et la suppression refusent tout scénario d'origine `console` (403 ou 409 avec un code
  stable, à trancher par le plan).
- **Un scénario de l'API reste un scénario normal** : la console l'ouvre, le modifie, le publie.
- **Relecture.** `GET` reconstruit la recette depuis le graphe publié (décompilation). C'est possible tant que le
  graphe ne contient que des blocs v1 en arbre (pas de branches qui se rejoignent, pas de boucle). Sinon, `GET` rend
  la raison au lieu d'une recette, et le scénario n'est plus remplaçable par l'API : on ne réécrit pas ce qu'on ne
  sait pas décrire.
- **Conflit avec la console.** La console réenregistre un scénario à la simple ouverture (React Flow mesure les blocs),
  donc une date de modification ou un compteur de version refuserait l'API à tort. Le contrôle porte sur le
  **contenu** : `GET` rend une empreinte de la recette décompilée, `PUT` l'exige (`If-Match` ou champ du corps) et
  refuse en 409 si la recette actuelle a une autre empreinte. Bouger un bloc ne change pas l'empreinte ; modifier un
  texte, si.
- **Identifiants stables au remplacement.** Recompiler fabrique de nouveaux blocs, et `mintNodeCodes` leur
  donnerait de nouveaux codes. Trois choses casseraient en silence : l'envoi par `/v1/sends` d'un scénario qui ouvre
  par un message (il vise le code `nod_` de l'entrée), un « Aller à » de la console qui vise un de ces blocs, et les
  contacts en cours (les parcours lisent le graphe publié, `grapheDuRun`). Le compilateur **réutilise donc l'id et le
  code de chaque bloc dont le chemin dans l'arbre est le même** (l'entrée, puis le texte du bouton ou de la réponse
  suivi). Un contact arrêté sur un bloc qui existe encore continue ; sur un bloc retiré, il connaît le sort qu'il
  connaît déjà quand la console publie une version qui retire son bloc. C'est le choix de Julien : toute écriture
  publie, et les parcours basculent.
- **Un brouillon de la console en cours** sur un scénario de l'API : le remplacement publie par-dessus et l'efface.
  Le plan doit décider si l'empreinte couvre aussi le brouillon (refus si la console a un brouillon non publié), ce
  que je recommande.

## Suppression

Refusée (409, code stable, raison lisible) si le scénario est utilisé par une publicité ou un lien de chaîne (les deux
contrôles de la route de la console), par un widget (`widgets.workflow_id` est en `on delete set null` : le widget
perdrait son scénario sans bruit), par le répondeur par défaut, par une automation, par une campagne programmée, ou
visé par un « Aller à » d'un autre scénario. Le plan liste ce qui existe déjà et ce qui manque ; la route de la console
gagne au passage les contrôles qui lui manquent, puisque c'est le même geste.

Les parcours en cours ne bloquent pas la suppression : `workflow_runs` part en cascade, comme quand la console supprime.
Mon choix, aligné sur la console.

## Positions

Le serveur dispose les blocs de haut en bas, une colonne par branche, pour que la console affiche un scénario lisible.
La disposition n'a pas à être belle ; elle ne doit pas superposer deux blocs.

## Contraintes

- Le contrat REST est public et documenté : registre OpenAPI (`src/api/openapi/registre.ts`), `tests/openapi.test.ts`.
- Les outils MCP entrent dans le catalogue, la doc générée de `web/public` et le plugin (FAQ dans
  `scripts/plugin/faq.ts`, version de `plugin.json` montée, publication après l'API).
- Le registre des modules de routes (`modulesDeRoutes`) et l'auto-attaque (`npm run auto-attaque`) couvrent les routes
  neuves.
- `features.md` décrit la fonction ; les fiches d'aide qui citent la section ont leur empreinte dans le même commit.

## Laissé au constructeur

- Le nom exact de la colonne d'origine, les codes d'erreur, la forme de l'empreinte.
- La forme de la décompilation et des positions.

## Choix faits après la relecture à froid (à vérifier par Julien)

Un relecteur a lu ce document sans contexte. Ses questions se tranchaient toutes sur ce que le produit fait déjà ; ces
choix sont les miens, pas des décisions de Julien :
- la fin d'un bloc agent câblée comme le répondeur ;
- un template sans réponse rapide qui termine le parcours, et `suite` pour un message sans réponse rapide ;
- les identifiants de blocs gardés par chemin au remplacement ;
- une personne exigée derrière les outils MCP d'écriture ;
- les associations de variables recopiées dans le bloc, et le template d'ouverture exempté ;
- le nom unique, sans tenir compte de la casse ;
- un widget qui bloque la suppression, et des parcours en cours qui ne la bloquent pas ;
- le fichier d'un message téléchargé une fois à l'écriture pour être vérifié, sans être stocké.

## Méthode de livraison

**Implémenteur par lot et revue humaine du diff.** La production empruntera ce chemin (chaque scénario créé envoie de
vrais messages), et le code touche des invariants invisibles : branches indexées, passe-plats muets, trou de montage
sur un bouton sans suite, fenêtre de 24 h, codes de blocs.

## Essai réel qui clôt la v1

Sur la SANDBOX, depuis Claude Code et par le MCP :
1. créer un template à deux boutons de réponse rapide, attendre son approbation ;
2. créer un scénario : template, un bouton vers un message à réponses rapides qui porte un PDF, l'autre vers une
   image légendée suivie de l'agent IA, et « autre réponse » vers l'équipe ; puis tenter la même création avec une
   adresse de fichier interne ou cassée : refusée ;
3. l'envoyer à un vrai téléphone par `/v1/sends`, cliquer chaque branche sur trois envois, vérifier ce qui arrive ;
4. ouvrir le scénario dans la console : il s'affiche lisiblement, sans bloc superposé ;
5. le modifier dans la console (déplacer un bloc), puis le remplacer par l'API : accepté ; modifier un texte dans la
   console, puis le remplacer avec l'ancienne empreinte : refusé en 409.
