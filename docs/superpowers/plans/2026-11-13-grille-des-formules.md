# La grille des formules, réécrite (2026-11-13)

Demande de Julien du 2026-11-13, tranchée le même jour en quatre questions. Quatre lots, livrés l'un après l'autre.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff** pour le lot 1 : la règle des contacts est un chemin que la production
emprunte à chaque message entrant (un inconnu refusé n'entre jamais, sans recours), et elle porte un invariant invisible
(le prédicat SQL `ficheComptee` lu par trois gardes). Les lots 2 à 4 se décident à leur tour, ici même.

L'essai réel qui clôt le lot 1 : un espace de test passé en Pro, sa limite de contacts atteinte, reçoit un message d'un
numéro inconnu ; le message n'entre pas et l'admin reçoit l'e-mail. Puis un deuxième widget refusé en Free.

## Lot 1 : la grille et ce qu'elle promet

1. **Contacts** : Pro et Business comptent toutes les origines, comme Free (`contactsToutesOrigines` vrai sauf
   Entreprise). Un inconnu qui écrit à un Pro ou un Business plein n'entre pas, l'admin est prévenu une fois par jour.
   Les e-mails de seuil (80 %, 100 %) partent aussi au Business ; leurs textes et celui de l'espace plein disent
   l'offre de l'espace et celle qui lève la limite.
2. **Widgets** : une limite de l'offre (`limites.widgets`) : Free 1, Pro 5, Business et Entreprise sans limite. Un
   espace au-dessus garde ses widgets ; seule la création est refusée, en 402 `plan_limit_reached`.
3. **Agent IA en Free** : « 1 agent IA » écrit sur la vitrine seulement (décision de Julien) ; le code n'en limite pas
   le nombre.
4. **Vitrine** (`site/tarifs/`, puis l'anglais par `npm run vitrine:anglais`) : Accès à la console, Scénarios
   conversationnels complexes, WhatsApp Flows, canal e-mail sortant (Pro) puis entrant et sortant (Business),
   orchestrables avec WhatsApp, tableaux de bord personnalisés, agents IA illimités (Pro), widgets personnalisables et
   illimités (Business), IA on premise sur demande (Entreprise), « ligne de crédit » à la place de « Crédit WhatsApp »,
   et le nombre d'outils MCP et de points d'API de chaque formule, dérivés du code (`OUTILS`, `ROUTES_V1` avec la
   `fonction` qui ferme une route) par `tests/vitrine-pages.test.ts`.
5. Les autres pages et textes qui disaient « contacts entrants illimités » en Pro (développeurs, Shopify, plugin),
   tenus par `tests/vitrine-contacts-origines.test.ts`.

**Tests** : `tests/offres.test.ts` (grille, règle), `tests/offres-vue.test.ts`, `tests/http-widgets.test.ts`,
`tests/mcp-widgets.test.ts`, `tests/vitrine-pages.test.ts`, `tests/vitrine-contacts-origines.test.ts`, les e-mails.

**Déploiement** : API et workers (aucune migration) ; la vitrine et la console partent avec le push, sans attendre :
la console tolère une limite de widgets absente, et la vitrine n'appelle aucune route neuve.

## Lot 2 : « ligne de crédit » partout

Console, fiches d'aide (et leurs pages publiques), e-mails, FAQ du plugin, outils MCP. Le nom technique (`option-wa`,
`credit_whatsapp`) ne bouge pas.

## Lot 3 : la médiathèque dans la création d'un modèle

L'en-tête image, vidéo ou document d'un modèle se choisit aussi dans la médiathèque (`ChoixMediatheque`), lue côté
serveur dans l'espace (jamais téléchargée par adresse), puis déposée chez Meta comme un fichier du poste.

## Lot 4 : la phrase de transfert de l'agent

« Qualifier et transférer » passe la main sans un mot quand la sortie `humain` mène à « Passer à un humain » ou n'est
pas câblée (`todo.md`) : la phrase de l'agent part dans ces montages, et une phrase par défaut quand le modèle n'en
écrit aucune.
