# Dupliquer un scénario d'un espace à l'autre, depuis /ops

Date : 2026-11-16. Cadré avec Julien en cinq rondes de questions. Code lu sur `origin/main` (l'arbre partagé avait
259 commits de retard).

## Pourquoi

Un scénario construit et éprouvé dans un espace se refait aujourd'hui bloc par bloc dans un autre : la duplication
qui existe ne copie que dans le MÊME espace. L'exploitant veut, depuis `/ops`, choisir un espace, un scénario, un
espace de destination, et l'y retrouver prêt à rebrancher.

**Le succès** : en trois choix et un récapitulatif, le scénario arrive dans la destination, inactif, avec ce qui peut
le suivre (champs, agent IA, appels API, modèle d'e-mail, templates et Flows recréés chez Meta), et la liste exacte de
ce qui reste à rebrancher à la main.

## Ce qui existe déjà (mesuré sur `origin/main`)

- **La duplication dans un même espace** : `POST /tenants/:tenantId/workflows/:id/duplicate`
  (`src/http/workflows.ts:133`). « X (copie) », codes de blocs refaits (`mintNodeCodes`, `src/workflow/node-codes.ts`),
  sauts internes recâblés (`sautsDeLaCopie`, `src/workflow/aller-a.ts`), écriture en brouillon, tags déclarés
  (`declareTags`).
- **La duplication d'un Flow** : `POST /tenants/:tenantId/flows/:flowId/duplicate` (`src/http/flows.ts:218`). Elle
  recrée le formulaire dans la WABA par `creerFormulaire`, sous un nom unique par WABA (« (copie) », « (copie 2) »),
  et refuse un Flow sans écrans (antérieur au modèle riche).
- **Les templates** n'ont pas de table locale : ils se lisent chez Meta, par WABA (`src/meta/templates.ts`).
  `resumeDuModele` les relit et `buildComponents` sait les regénérer. Un en-tête média se relit comme une URL
  d'exemple, et un handle neuf s'obtient par la Resumable Upload API (`src/meta/media.ts`). `boutonsNonRelus` marque
  un template qu'on ne sait pas regénérer à l'identique.
- **Aucune copie d'agent IA** n'existe.
- **Les secrets des appels API** (`agent_tool_sources.auth_secret_enc`) sont chiffrés en AES-256-GCM sous la clé
  GLOBALE `ENCRYPTION_KEY` (`src/crypto/secretbox.ts`) : le chiffré se recopie d'un espace à l'autre sans être
  déchiffré.
- **Le consentement d'un outil** est tenu en base : `check (actif = false or active_par is not null)`
  (`db/migrations/0127_outils_consommateurs.sql:47`).
- **Les champs** : `user_fields`, `unique (tenant_id, key)`, types text, number, date, datetime, boolean, url, json
  (0289).
- **Les déclencheurs** vivent hors du graphe, dans `automations` (0052) ; `start_node_id` vise un `node.id`.
- **`/ops`** : `ONGLETS` (`web/app/ops/page.tsx:47`), modules `session-ops` montés par `entree(...)`
  (`src/server.ts:768-785`), modèle à suivre `src/http/ops-suppression.ts`.

## Le parcours dans `/ops`

Un sixième onglet, « Dupliquer », après « Réglages ». Un scénario à la fois.

1. **Espace source**, puis **scénario**, deux listes déroulantes. Le scénario système du répondeur
   (`systeme = 'repondeur'`) n'y figure pas.
2. **Espace de destination**, liste déroulante, source exclue.
3. **Récapitulatif**, calculé sans rien écrire :
   - chaque dépendance qui peut suivre, avec une case « dupliquer » **décochée par défaut** : agent IA, appel API,
     modèle d'e-mail, Flow. Case décochée = nœud débranché ;
   - les champs qui seront créés, et les conflits de type ;
   - les templates : réutilisés (déjà dans la WABA de destination) ou à soumettre ;
   - les déclencheurs copiés, et ceux retirés pour conflit ;
   - les nœuds qui arriveront débranchés, par nom de bloc ;
   - « secret copié », en clair, pour chaque source d'appel API qui suit ;
   - les blocages, qui grisent le bouton.
4. **Dupliquer**. Le résultat reprend le récapitulatif avec ce qui a réellement été créé, et le statut de chaque
   soumission chez Meta.

## Ce que devient chaque bloc

| Bloc | Ce qui est propre à l'espace | Dans la copie |
|---|---|---|
| `aller_a` (Aller vers) | `cible` (code `nod_…`), `cibleLibelle` | **Débranché**, toujours, même vers un bloc du même scénario : `cible` et `cibleLibelle` vidés |
| `inbox` (Assigner à un agent) | `assigneA` (`users.id`), `assigneNom` | Vidés : la conversation arrive dans le pot commun, sans personne assignée |
| `agent` (Agent IA) | `agentId`, `agentLabel`, `sorties` | Case cochée : l'id de l'agent copié. Décochée : débranché (`agentId` vidé, arêtes `sortie:<code>` gardées) |
| `http` (Appel API) | `requestId`, `requeteLabel`, `champCible` | Cochée : l'id de la requête copiée. Décochée : débranché. `champCible` assuré |
| `email` | `emailAccountId`, `templateId`, `to[]` | Boîte d'envoi **toujours** vidée. Modèle : copié si coché, sinon vidé. Champs de `to[]` assurés |
| `flow` | `flowId` (id Meta, propre à la WABA), `flowName` | Coché : l'id du Flow recréé dans la WABA de destination. Décoché : débranché |
| `template` | `templateName` + `language` | Réutilisé s'il existe dans la WABA de destination, sinon recréé et soumis. Champs des variables assurés |
| `question` | `champReponse` | Assuré |
| `action`, `tag`, `field` | nom de tag, `fieldKey` | Tags déclarés (`declareTags`), champ assuré |
| `condition` | noms de tags, clés de champ | Idem |
| `js`, `extraire` | `champSource`, `champCible`, `lignes` | Champs assurés, le reste recopié tel quel |
| `quick_message`, `rcs_message` | `imageUrl` (adresse publique `/m/`) | Recopiés tels quels |
| `wait`, `vers_mba`, `mba_handoff`, `mba_disable` | rien | Recopiés |

**Un champ assuré** : une clé absente de la destination y est créée (même clé, libellé, type). Présente avec le même
type, rien ne change. Présente avec un autre type, le champ de la destination n'est jamais modifié et le conflit est
signalé au récapitulatif ; le bloc garde la clé.

🔴 **La fonction de copie du graphe traite les types de blocs dans un `switch` exhaustif sur `WorkflowNodeType`**
(`web/lib/partage/blocs.ts`) : un bloc ajouté plus tard qui porte une référence propre à l'espace ne peut pas passer
sans qu'on décide de son sort, c'est une erreur de compilation. Sans cela, le bloc `extraire`, apparu après la
première lecture du code, serait parti avec une clé de champ jamais créée.

## Le scénario et ses déclencheurs

- Nom « X (copie) », toujours. Codes de blocs refaits au code client de la destination (`mintNodeCodes`). Les
  `node.id` sont conservés : les déclencheurs les visent.
- Écrit en brouillon seulement (`draft_graph`), jamais publié : la copie arrive **inactive**.
- Déclencheurs du scénario copiés avec `enabled = false`. Un mot-clé déjà utilisé par un déclencheur de la
  destination est retiré de la copie et signalé ; s'il n'en reste aucun, le déclencheur ne suit pas. Un déclencheur
  « nouveau contact » quand la destination en a déjà un : retiré, signalé. « Tag ajouté » : copié.
- Ce qui pointe vers le scénario ailleurs (campagnes, widgets, publicités, répondeur) ne suit pas.

## Les dépendances, à la demande

**Nommage, pour toutes** : le même nom s'il est libre dans la destination, sinon « X (copie) », puis « X (copie 2) ».
Un homonyme n'est jamais réutilisé, sauf pour les templates. Dans une même duplication, une dépendance partagée n'est
copiée qu'une fois (deux appels API sur la même source = une seule source copiée).

- **Agent IA** :
  - **Ce qui suit** : sa fiche (objectif, ton, règles, sorties), ses réglages (`mention_ia`, `max_tours`,
    `max_appels_outils`, `budget_micro_eur`, `inactivite_minutes`, `contact_inconnu`, `modele`), et ses fiches de
    connaissance avec leurs vecteurs et `embedding_modele`. Les vecteurs étant recopiés, il n'y a aucune vectorisation
    et rien n'est débité.
  - **Statut** : brouillon.
  - **Ses outils** suivent, avec leurs requêtes et leurs sources (secret compris), mais **désactivés** : `actif = false`
    et `active_par` nul. La base exige qu'un humain de l'espace les active, et l'exploitant n'en est pas membre.
  - **Sa clé Gateway** ne se copie pas : la destination a la sienne.
- **Appel API** : la requête (`connector_requests`) et sa source (`agent_tool_sources`), **secret compris**.
  `auth_secret_enc` est recopié chiffré, sans être déchiffré.
- **Modèle d'e-mail** (`email_templates`) : copié. La boîte d'envoi ne suit jamais, puisqu'elle porte un mot de passe
  SMTP.
- **Flow** : recréé dans la WABA de destination par le chemin de la duplication de Flow (`creerFormulaire`), avec son
  `mapping`, dont les champs sont assurés. Un Flow sans écrans ne se recrée pas : sa case est indisponible et le nœud
  arrive débranché.

## Templates chez Meta

- **Template déjà présent** sous le même nom et la même langue dans la WABA de destination : il est **réutilisé**.
  C'est la seule exception à la règle des homonymes, car en recréer un, c'est une nouvelle approbation pour un contenu
  identique.
- **Template absent** : il est **recréé et soumis** sous le même nom, la même langue et la même catégorie, depuis sa
  lecture chez Meta (`resumeDuModele` puis `buildComponents`).
  - Un en-tête média, ou les images d'un carousel, se télécharge depuis l'URL d'exemple relue, puis se réimporte par
    la Resumable Upload API pour obtenir un handle neuf.
  - Les indications de variables (`template_param_hints`) suivent, et leurs champs sont assurés.
- **Template qu'on ne sait pas regénérer à l'identique** (`boutonsNonRelus` : bouton téléphone, code à copier,
  catalogue, etc.) : il **bloque** la duplication, ce que le récapitulatif annonce.
- **Après la soumission**, le template attend l'approbation. Le scénario étant inactif, rien ne part avant. Meta peut
  changer la catégorie, et le résultat le montre.

## Ordre d'exécution : Meta d'abord, tout ou rien

1. **Refus d'entrée** :
   - la destination n'a pas de WABA, même si le scénario n'a ni template ni Flow ;
   - la source et la destination sont le même espace ;
   - un template ne se regénère pas à l'identique.
2. **Aperçu**, en lecture seule : le récapitulatif et son empreinte.
3. **Exécution** :
   - **Contrôle** : le plan est recalculé ; s'il diffère de l'aperçu affiché (scénario modifié, template apparu, champ
     créé entre-temps), refus : « relancez l'aperçu ».
   - **Chez Meta** : médias réimportés, templates soumis, Flows créés. Au premier échec, on s'arrête et rien n'est
     écrit en base. Le résultat liste ce qui a déjà été créé chez Meta, qu'on **laisse en place** : c'est le choix de
     Julien, et un nom de template supprimé reste indisponible un mois. Un Flow créé garde aussi sa ligne locale,
     écrite par `creerFormulaire`.
   - **En base, en UNE transaction** : champs, tags, sources, requêtes, outils, agent et connaissance, modèles
     d'e-mail, indications de variables, scénario, déclencheurs, trace. Un échec n'écrit rien.
4. **Résultat**.

## Sécurité

- **Routes** : classe `session-ops` (`makeRequireOps`, second facteur), inscrites au registre `modulesDeRoutes`.
  Leur fausse autorité est déclarée dans `FAUSSES_AUTORITES` (`scripts/auto-attaque.mts`), sinon le job `unit` est
  rouge.
- **Entrées** : corps validé par Zod (`safeParse`), identifiants contrôlés par `estUuid`.
- **Isolation** : chaque lecture filtre sur le `tenant_id` de la source, chaque écriture sur celui de la destination.
  Chaque id de dépendance coché est revérifié comme appartenant à la source : un id d'un troisième espace glissé dans
  le corps est refusé, il ne serait pas copié.
- **Secrets** : jamais déchiffrés, jamais rendus par l'aperçu, qui ne dit que « secret copié ». Le mot de passe SMTP ne
  voyage jamais.
- **Trace** : chaque duplication est tracée et signée de son auteur (`auteurOps`), comme les autres écritures de
  `/ops`.
- **Aucun envoi** : la copie n'envoie aucun message et n'émet aucun événement d'automation.

## Tranché par la spec, sans question posée (à contester)

1. **Template non regénérable** à l'identique : il bloque la duplication. C'est la conséquence du « tout ou rien ».
2. **Flow sans écrans** : case indisponible, nœud débranché.
3. **Nom des dépendances** : gardé s'il est libre, « (copie) » seulement en cas d'homonyme. Le scénario, lui, prend
   toujours « (copie) ».
4. **Répondeur** : exclu de la liste des scénarios.
5. **Déclencheurs en conflit** : un mot-clé en conflit est retiré, un déclencheur « nouveau contact » en double aussi.
   Un déclencheur sans plus aucun mot-clé ne suit pas.
6. **Sans WABA** : refus même pour un scénario sans template ni Flow. C'est la lecture littérale de la réponse.
7. **Offre de la destination** sans scénarios ou sans agent IA : signalé au récapitulatif, sans blocage. On peut
   préparer un espace avant de changer son offre.
8. **Avant le lot 3** : un template absent de la destination bloque, et les Flows arrivent débranchés.
9. **Aperçu périmé** : il refuse l'exécution.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff.** La duplication écrit dans les espaces de vrais clients, recopie des
secrets et soumet des templates chez Meta (rien de cela ne se rappelle). Le code touché porte des invariants
invisibles : codes de blocs, unicités par espace, consentement des outils, isolation entre espaces.

## Lots

Chaque lot se livre seul, sans danger, avec une relecture indépendante en fin de lot. La partie console d'un lot se
pousse APRÈS le déploiement de l'API qui porte sa route : un écran qui appelle une route neuve casse dès le push.
Aucune migration n'est prévue, car tout ce qui se copie a déjà sa table.

1. **Le scénario** :
   - l'onglet, l'aperçu et l'exécution ;
   - le scénario en brouillon, avec ses codes refaits ;
   - les déclencheurs désactivés, avec leurs conflits ;
   - les champs et tags assurés ;
   - tous les débranchements (`aller_a`, `inbox`, `agent`, `http`, `email`, `flow`) ;
   - les templates réutilisés s'ils existent dans la destination ; un template absent bloque.
2. **Les dépendances en base** : les cases agent IA (avec connaissance et outils désactivés), appel API (avec le
   secret) et modèle d'e-mail.
3. **Meta** : les templates absents recréés et soumis (médias réimportés), et la case Flow ; le « Meta d'abord, tout
   ou rien ».

## Tests

- **Unitaires** :
  - la copie du graphe, bloc par bloc, case cochée et décochée ;
  - les conflits de déclencheurs ;
  - les champs assurés (absent, même type, autre type) ;
  - le nommage (« (copie) », « (copie 2) ») ;
  - l'empreinte de l'aperçu.
- **Intégration**, sur le Postgres de la CI :
  - la transaction unique, avec un échec provoqué à la dernière écriture qui ne laisse rien ;
  - l'id d'un troisième espace refusé ;
  - aucune écriture dans la source ;
  - des outils copiés inactifs.
- **Meta**, contre des faux :
  - une soumission en échec ne laisse aucune écriture en base ;
  - un template à bouton non relu est bloqué dès l'aperçu ;
  - le média réimporté obtient un handle neuf.
- **`npm run auto-attaque`**, `lint` et `typecheck` avant chaque push. Le test d'isolation est vérifié dans les deux
  sens, et la mutation du filtre est annoncée aux sessions voisines.

## Essai réel qui clôt la fonction

Dupliquer, de la SANDBOX vers un autre espace de test qui a une WABA, un scénario qui contient tous les cas :
- un « aller vers » et un « assigner » ;
- un agent IA avec connaissance et un outil ;
- un appel API à secret ;
- un champ absent de la destination ;
- un template absent de la destination, à en-tête image ;
- un Flow et un e-mail.

Vérifier ensuite :
- le récapitulatif ;
- la copie inactive et les nœuds débranchés là où la table le dit ;
- le template approuvé chez Meta.

Puis publier, activer, et jouer le scénario depuis le téléphone d'essai. L'essai entre dans `docs/prive/ESSAIS-REELS.md`
à la livraison du lot 3.

## À vérifier au plan

- **Images `/m/`** : si elles sont rattachées à l'espace source (purge à sa suppression), la copie doit recopier le
  fichier.
- **Conflit de mot-clé** : il se compare avec la normalisation exacte du déclencheur (casse, accents, mode).
- **Trace** : une table existe-t-elle pour les écritures de `/ops`, ou la trace passe-t-elle par le journal ?

## Hors périmètre

- Plusieurs scénarios à la fois, avec rebranchement des « aller vers » entre eux.
- Recopier campagnes, widgets ou publicités liés au scénario.
- La boîte d'envoi SMTP.
- Synchroniser la copie quand la source change.
- La duplication par le client lui-même (console ou Claude).
