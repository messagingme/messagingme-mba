# Segments Shopify, lot 6d : les étiquettes en direct (webhooks)

Spec : `docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`, chantier 4, lot 4b ; feuille de route, lot 6
(après 6a, 6b, 6b bis et 6c, en production). Julien a demandé d'enchaîner les lots le 2026-11-26.

Une étiquette posée ou retirée sur un client dans Shopify doit arriver sur ses fiches en quelques secondes, au lieu
d'attendre la relecture quotidienne. Le modèle ne change pas (aucune migration) : les étiquettes restent rangées par
couple fiche-client (lot 6b bis), et la relecture quotidienne reste le filet, la livraison d'un webhook n'étant pas
garantie.

## Ce que la doc de Shopify fixe, et ce qu'elle laisse ouvert

Lu le 2026-11-26 (`WebhookSubscriptionTopic`, référence des webhooks) : les sujets `CUSTOMER_TAGS_ADDED` et
`CUSTOMER_TAGS_REMOVED`, droit `read_customers`, s'abonnent par `webhookSubscriptionCreate` (pas de sujet REST) ; leur
corps d'exemple est `{ "customerId": "gid://shopify/Customer/1", "tags": ["tag1", "tag2"], "occurredAt": "…" }`. La
doc ne dit ni la valeur exacte de l'en-tête `X-Shopify-Topic` (les sujets s'écrivent `customer.tags_added`), ni si
`tags` porte les seules étiquettes ajoutées ou retirées, ni la ligne à écrire dans `shopify.app.toml`.

## Décisions

1. **Abonnés par l'API, pour les boutiques de la console hors Free seulement, à part du branchement** : les deux sujets
   ont leur propre liste (`SUJETS_ETIQUETTES`), `SUJETS_ABONNES` garde ses six sujets (un sujet d'étiquettes refusé ne
   doit jamais faire échouer un branchement). Chaque synchronisation des étiquettes les abonne, une fois les téléphones
   cherchés et avant le premier client lu ; une boutique déjà branchée se réabonne ainsi d'elle-même (un sujet déjà
   abonné vaut « déjà »). Une panne d'abonnement se journalise et ne bloque rien.
2. **Pas de changement du `shopify.app.toml` de la skill** (boutiques de Claude Code) dans ce lot : l'écriture du sujet
   dans le toml n'est pas vérifiée, et une ligne fausse ferait échouer `shopify app deploy` chez chaque nouveau
   marchand. Elle se mesurera au premier déploiement réel ; d'ici là, la relecture quotidienne couvre ces boutiques.
3. **Appliqués tels quels, sans relire le client** : `customer.tags_added` ajoute ces étiquettes, `customer.tags_removed`
   les retire (sans la casse), sur chaque fiche ACTIVE reliée au client, et seulement quand la synchronisation est
   allumée et l'offre n'est pas la Free (qui synchronise à la demande). Aucun appel à Shopify, aucune file : une écriture
   en base. Un client relié à aucune fiche est ignoré.
4. **Toujours 200** (recommandation de la spec) : une panne d'écriture se journalise au lieu de faire réessayer
   Shopify, une étiquette n'étant pas une confirmation de commande ; la relecture quotidienne répare.
5. **Les deux écritures du sujet sont acceptées** (`customer.tags_added`, `customers/tags_added`), et un sujet inconnu se
   journalise par son nom : si l'en-tête réel diffère, le journal le dira au premier essai.

## Tâches

1. `src/shopify/abonnements.ts` : les deux sujets ; l'abonnement d'une liste de sujets.
2. `src/shopify/etiquettes.pg.ts` : `appliquerDuWebhook(tenant, client, étiquettes, sens)`, fiches actives verrouillées
   comme les autres écritures, l'espace sur chaque requête.
3. `src/shopify/traitement.ts` : les deux sujets, Zod sur le corps, toujours 200 ; le sujet inconnu journalisé.
4. `src/shopify/etiquettes.ts` : l'abonnement pendant la synchronisation (console hors Free), avant le premier client lu.
5. Câblage (`src/index.ts`), tests, `documentation.md`. `features.md` et l'aide de la boutique (page publique de la
   vitrine) partent APRÈS l'essai réel : elles promettent « en quelques secondes », ce que seul l'essai prouve (l'en-tête
   réel du sujet, le sens de `tags`).

## Tests

Unitaires (le traitement des deux sujets, les deux écritures, le corps illisible, la boutique débranchée ; l'abonnement
au début d'une synchronisation, console seulement, sans bloquer), intégration sur le banc PGlite (l'ajout et le retrait
sur toutes les fiches du client, fiches actives seules, rien sans synchronisation allumée ni en Free, l'espace).

## Méthode de livraison

**En direct, puis une relecture indépendante**, parce que le lot est petit (aucune migration, aucun écran), réversible,
et que ses critères se testent ; mais il touche le récepteur des webhooks Shopify, un chemin que la production emprunte
à chaque commande, d'où la relecture et la mutation de ses gardes. L'essai réel qui clôt le lot, sur « Messaging Me
demo » (branchée par la console) : « Synchroniser maintenant » une fois (elle abonne les deux sujets), puis poser
l'étiquette « Essai » sur le client de Julien dans Shopify : sa fiche la porte en quelques secondes ; la retirer : elle
part, et « VIP » reste. Relu en base.
