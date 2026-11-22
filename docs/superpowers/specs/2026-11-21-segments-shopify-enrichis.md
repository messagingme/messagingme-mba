# Segments Shopify enrichis (spécification)

Étude du 2026-11-21. Document de spécification seulement : aucun code de production n'est modifié par ce texte.
Rien ici n'est une décision de Julien. Les choix recommandés sont marqués comme tels, et les points qui lui reviennent
sont en fin de document.

Quatre chantiers, aux numéros demandés : **1** les lignes de commande (produit, variante, SKU, collection), **2** le
rattrapage de l'historique au branchement, **4** les étiquettes et les segments clients déjà construits dans Shopify,
**7** les segments qui croisent les achats et les signaux des conversations. Les numéros 3, 5 et 6 ne font pas partie
de cette étude.

Le lot déjà livré (3 novembre 2026, spec `docs/superpowers/specs/2026-10-31-segments-commandes-pays-activite-design.md`,
migration `0273_segments.sql`) reste le socle. Cette spec l'étend. Elle ne revient pas sur le pays, ni sur le principe
« un segment de campagne est une étiquette Messaging Me » (`tag_contacts`, puis `prepare_campaign`).

## Comment lire l'effort

- **S** : un chemin déjà ouvert. Pas de scope Shopify nouveau, pas de redéploiement de l'app du marchand. Une migration
  et les filtres qui lisent ce qu'elle écrit.
- **M** : plusieurs portes (donnée, file, console, MCP) ou un scope nouveau avec un repli tant que le marchand ne l'a
  pas approuvé.
- **L** : scope nouveau, redéploiement de l'app chez chaque marchand, reprise en tâche de fond, et une règle d'offre à
  tenir sur Free, Pro, Business et Entreprise.

Le numéro d'une migration ne s'écrit pas ici. Il se lit par `npm run migrations` au moment du lot.

## Les offres, telles qu'elles sont

Grille de `src/offres/offres.ts`. La Free est l'offre `base`.

| Offre | Prix | Contacts en tout | Console (`console`) | Analyse (`analyse`) |
|---|---|---|---|---|
| Free (`base`) | 0 | 100 | non | non |
| Pro | 49 € HT par mois (`PRIX_PRO_HT_CENTIMES.mois` = 4900) | 1 000 | oui | non |
| Business | posé dans `/ops` | 5 000 | oui | non |
| Entreprise | sur devis | sans limite, ou le devis | oui | oui |

`contactsToutesOrigines` vaut pour Free, Pro et Business : une fiche créée compte, et un inconnu qui écrit à un espace
plein n'entre pas. Seule l'Entreprise réglée sur devis ne compte que les fiches créées.

`find_contacts`, `tag_contacts`, `set_contact_field` et `prepare_campaign` exigent la fonction `console`
(`src/mcp/outils-campagnes.ts`). La Free les voit et reçoit le lien de l'offre. Les filtres d'analyse exigent en plus
`analyse`, donc l'Entreprise (`src/mcp/cible.ts`).

L'onglet Shopify d'une fiche est déjà ouvert à toutes les offres (`features.md`, « Onglet Shopify »). Il montre les
commandes payées connues, et il dit qu'elles ne le sont que depuis le branchement, sans les produits.

## État actuel

### Ce qu'une commande payée laisse

`orders/paid` est déjà abonné. Le traitement (`src/shopify/traitement.ts`) appelle d'abord `attribuerCommande`
(`src/shopify/attribution.ts`), puis l'envoi éventuel du message.

`attribuerCommande` écrit une ligne de `shopify_commandes` dès qu'un téléphone de la commande désigne une fiche de
l'espace, que le message de confirmation soit allumé ou non, montant lisible ou non. L'écriture est avalée : une panne
ne bloque pas la confirmation et ne fait pas réessayer Shopify. Le téléphone suit `telephoneDeCommande`
(`src/shopify/donnees.ts`) : livraison, facturation, client, puis le champ de la commande. Le pays de repli est celui
de la boutique.

Si la fiche naît du message de confirmation, elle n'existe pas encore au moment de l'attribution. `servir` la crée en
envoyant, puis rappelle `lierCommande`. Les deux chemins passent par le même upsert (`src/shopify/store.pg.ts`).

Une commande dont le téléphone ne correspond à aucune fiche n'est pas gardée. Aucune fiche n'est créée. Aucun numéro
inconnu n'est conservé. Une fiche créée plus tard ne récupère pas ses commandes passées. Décision du 2026-11-03, écrite
dans la spec du 2026-10-31.

Une boutique en pause enregistre quand même la commande d'une fiche déjà là (l'attribution a lieu avant le retour
anticipé de `servir`). Une boutique coupée n'écoute plus `orders/paid`.

`shopify_commandes` (migration `0246_shopify.sql`, colonnes ajoutées par `0273`) : une ligne par `(tenant_id,
commande_id)`, la fiche, le client Shopify, `payee_le`, `montant`, `devise`, `test`. `payee_le` vient de `processed_at`,
sinon de la réception. Le montant est celui de la boutique (`shop_money`). Les commandes de test comptent. Les
remboursements ne sont pas déduits : on n'écoute pas `refunds/create` ni `orders/cancelled`. La spec du 2026-10-31 l'a
écrit, parce qu'un sujet de plus obligerait chaque marchand à redéployer son app.

Le schéma Zod `schemaCommande` ne retient que les champs cités par les messages et l'attribution. Zod écarte les clés
inconnues. `line_items` n'est pas nommé : s'il est dans le corps, il est jeté.

`shopify_boutiques.commandes_depuis` est la date depuis laquelle toutes les commandes payées d'une fiche connue sont
suivies. Un « aucune commande » dit cette date (`orders_recorded_since`). Un rebranchement remet la date au jour du
rebranchement. Le trou n'est pas caché.

### Ce qu'un filtre sait déjà dire

Les critères voyagent dans `fieldFilters`, clé réservée, opérateur `segment`, valeur JSON
(`web/lib/partage/segments.ts`). Pas de membre neuf de `ContactFilters` : un serveur plus ancien ignorerait un membre
neuf, et un brouillon de campagne repris pendant un retour arrière partirait à tout l'espace. Une clé inconnue cherchée
dans les champs perso ne trouve personne. Une valeur malformée est refusée. « Au moins 0 » sans maximum est refusé,
parce qu'il viserait tout l'espace.

Critères livrés : nombre de commandes, dépense (devise de la boutique actuelle seulement), jours depuis la dernière
commande, actif, inactif, pays. L'activité est une seule date, `contacts.derniere_activite_le` : le dernier message
reçu (appui de bouton et réaction compris, `src/inbox/store.pg.ts`) ou le dernier clic attribué
(`src/links/tracked-links.pg.ts`). Elle ne distingue pas les deux. Les clics sont purgés à
`TRACKED_CLICKS_RETENTION_DAYS` (défaut 730). Les messages suivent la conservation de l'offre (30, 60, 90 jours), la
date sur la fiche leur survit.

La console ne montre « Achats et activité » que si `GET /tenants/:tenantId/contacts/segments` a répondu
(`web/components/FiltresAchatsActivite.tsx`). L'API publique `/v1` n'expose pas ces critères.

L'analyse d'une conversation (Entreprise) écrit sur la fiche une dernière analyse : intention, sentiment, satisfaction,
urgence, résolue, traitée par, action, date (`src/crm/filtre-fiche.ts`, `web/lib/partage/analyse.ts`). Les intentions
fermées sont `demande_devis`, `sav`, `reclamation`, `information`, `prise_rdv`, `achat`, `suivi_commande`, `retour`,
`autre`. Les sentiments sont `positif`, `neutre`, `negatif`. Le sujet est un texte libre et n'est pas filtrable. Il
n'existe pas d'intention « délai de livraison ». `suivi_commande` désigne le suivi d'une commande déjà passée.

`find_contacts` accepte déjà, en Entreprise, l'analyse et les critères de commande dans le même appel. « Dépense
d'au moins 200 et sentiment négatif » et « intention information et au plus 0 commande » sont donc déjà exprimables,
sur les commandes connues depuis `commandes_depuis`, avec les limites ci-dessus. Ce qui manque est nommé au chantier 7.

### L'app Shopify du marchand

Chaque marchand a son app, dans son organisation. Les scopes d'aujourd'hui, dans `plugin/skills/shopify/SKILL.md` :

`read_customers, read_orders, read_checkouts, read_fulfillments`.

Les sujets d'aujourd'hui : `orders/create`, `orders/paid`, `fulfillments/create`, `checkouts/create`,
`checkouts/update`, `app/uninstalled`, plus les trois sujets de conformité. Version d'API : `2026-10`
(`API_VERSION_SHOPIFY` dans `src/shopify/connexion.ts`).

Deux poses des webhooks, à ne pas mélanger (`src/shopify/abonnements.ts`) :

- une boutique `claude_code` les déclare dans `shopify.app.toml`. Les abonner aussi par l'API doublerait chaque
  livraison ;
- une boutique `console` n'a pas ce fichier. Le serveur appelle `webhookSubscriptionCreate` pour `SUJETS_ABONNES`. Les
  sujets de conformité ne s'abonnent pas par l'API : une boutique de la console ne reçoit pas `customers/redact`.

Le même lien d'installation approuve un scope ajouté plus tard (`lienInstallation`). Déclarer un scope dans le fichier
ne le donne pas : il est effectif quand la boutique l'a approuvé. La doc dit de le vérifier par
`currentAppInstallation.accessScopes`
([Access scopes, Checking granted access scopes](https://shopify.dev/docs/api/usage/access-scopes)).

`read_customers` couvre déjà `Customer` et `Segment`
([tableau des scopes](https://shopify.dev/docs/api/usage/access-scopes)). `read_products` couvre `Product`,
`ProductVariant` et `Collection`. Il n'est pas dans l'app. `read_all_orders` non plus.

L'import des clients abonnés (`src/shopify/clients.ts`) lit déjà l'Admin API en GraphQL, page par page, avec le seau
de débit (`extensions.cost.throttleStatus`), un budget de 25 s (`BUDGET_LECTURE_MS`) et le téléphone du client seul
(`defaultPhoneNumber`), pas celui d'une adresse. Les fiches importées depuis Claude Code naissent consentantes, sous
la responsabilité du marchand. Celles importées depuis la carte de la console naissent sans consentement WhatsApp
(`features.md`). Un STOP reste un STOP. Cet import crée une fiche dès que le numéro est un E.164 valide. Il ne
demande pas à Meta si le numéro est sur WhatsApp. Les chantiers ci-dessous ne généralisent pas cette porte : la règle
de la section suivante s'applique à tout ce qu'ils créent ou enrichissent. Étendre la même règle à l'import déjà en
production est une question ouverte.

## Qualité des numéros / contacts adressables

Règle de Julien, dure, pour les quatre chantiers. Shopify nous envoie toutes les commandes payées : le webhook
`orders/paid` sert d'abord le message « WhatsApp après la commande », et la reprise du chantier 2 relit le même stock.
Beaucoup de ces commandes n'ont aucun téléphone, ou un téléphone illisible, ou un téléphone valide qui n'est pas sur
WhatsApp. On ne crée une fiche, et on ne rattache une commande, que pour un numéro valide et adressable sur WhatsApp.
On ne conserve pas un numéro qu'on ne peut pas écrire.

Un contact adressable, dans cette spec : un E.164 que `normalizePhone` accepte, que `estUnFixe` ne refuse pas, et qui
n'est pas un « non » WhatsApp encore frais (`verdictWhatsApp` = `non`, péremption 90 jours,
`PEREMPTION_WHATSAPP_MS`). Un numéro jamais éprouvé est adressable au sens « on a le droit d'essayer une fois », pas
au sens « on le sait sur WhatsApp ». Le pourcentage montré au marchand sépare les deux.

### Ce qui se passe aujourd'hui

Le téléphone d'une commande est `telephoneDeCommande` (`src/shopify/donnees.ts`). Quatre candidats, dans cet ordre, le
premier E.164 valide gagne :

1. `shipping_address.phone`, pays de l'adresse ;
2. `billing_address.phone`, pays de l'adresse ;
3. `customer.phone`, sans pays propre : le pays de la boutique, sinon `FR` ;
4. `phone` sur la commande elle-même, même repli.

`telephoneE164` appelle `normalizePhone` (`src/crm/phone.ts`, `libphonenumber-js`, `isValid`). Un texte vide est sauté.
Un texte qui ne donne pas d'E.164 est sauté. S'il n'en reste aucun, le résultat est `null`. Le pays par défaut en
dernier ressort est `FR`, pas le pays de la boutique, quand ni l'adresse ni la boutique n'ont un code pays connu.

Le schéma de la commande ne nomme pas de téléphone marketing SMS. Depuis l'API `2025-01`, `sms_marketing_consent` a
été retiré des webhooks qui contiennent un client, `orders/paid` compris
([changelog](https://shopify.dev/changelog/posts/new-customer-s-webhook-and-changes-to-existing-customer-s-webhooks-payload)).
On ne peut donc pas le lire sur le corps actuel. Le quatrième candidat, `phone` sur la commande, est le seul champ
d'ordre « téléphone de la commande » en plus du client et des adresses. L'import des clients, lui, lit
`defaultPhoneNumber.phoneNumber` et son `marketingState`, pas une adresse.

`estUnFixe` (ligne fixe, numéro gratuit, coût partagé, surtaxé, et VOIP française) existe et sert les workflows
HubSpot. Le chemin Shopify ne l'appelle pas. Un fixe français valide devient un E.164 et peut fonder une fiche.

**(a) Aucun téléphone.** `telephoneDeCommande` rend `null`. `attribuerCommande` ne crée pas de fiche et n'écrit pas
`shopify_commandes` (le commentaire du fichier le dit : sans téléphone, ou téléphone sans fiche, aucune fiche). Si le
montant se lit, une relecture UTM est programmée (`programmerPreuve`) : `ventes_attribuees` peut alors recevoir
l'identifiant de commande, le montant, la devise et la date, avec `contact_id` nul, et seulement si une preuve UTM
existe. Cette table ne porte pas de téléphone (`db/migrations/0261_ventes_attribuees.sql`). `servir` inscrit
`sans_telephone` et n'appelle `lierCommande` que si `s.telephone !== null`. Aucune fiche, aucune ligne de segment.

**(b) Téléphone mal formé.** Même issue que (a) dès que les quatre candidats échouent à `isValid`. Le texte brut n'est
pas écrit. On ne garde pas la chaîne refusée.

**(c) E.164 valide, pas sur WhatsApp.** Rien ne l'interroge avant l'envoi. Le dépôt n'appelle aucune API « ce numéro
est-il sur WhatsApp ». Meta le dit à l'échec de livraison.

- Message de confirmation éteint, et aucune fiche à ce numéro : comme (a). La commande n'est pas gardée. Pas de fiche.
- Message éteint, fiche déjà là : `attribuerCommande` écrit `shopify_commandes` sur cette fiche, joignable ou non. Les
  produits du chantier 1 suivraient le même upsert.
- Message allumé : `envoyerPremierBloc` passe par `lancerEnvoiPublic`. Pour un template, `resoudreDestinataires` crée
  la fiche (`creer: 'phone'`) avant l'appel à Meta (`src/api/envoi-public.ts`), avec `consent: opted_in` et la source
  `shopify:<domaine>` (`src/shopify/envoi.ts`). La fiche compte dans le plafond tout de suite
  (`contactsToutesOrigines`). Puis `servir` rattache la commande si `findByPhone` la trouve. L'acceptation de l'API
  n'est pas une livraison. Le `131026` arrive ensuite, souvent par le webhook
  ([codes d'erreur Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes) : `131026`,
  « Unable to deliver message », numéro pas sur WhatsApp, conditions non acceptées, ou application trop ancienne).
  `classify` ne le rejoue pas dans la seconde (`src/meta/errors.ts`). Le balayage de campagne le retente une fois, et
  au second échec pose `whatsapp_joignable = false` (`src/campaign/retry-sweep.ts`, `src/contacts/joignabilite.pg.ts`).
  La fiche reste. Elle compte toujours dans les 100, les 1 000 ou les 5 000. Le filtre « sauf les injoignables connus »
  existe (`connu_injoignable`) et n'est pas le défaut d'une campagne.

Donc aujourd'hui : pas de numéro ou numéro illisible, on ne stocke pas le numéro et on ne crée personne (hors la vente
attribuée sans contact, qui n'a pas de téléphone). Numéro valide hors WhatsApp : si le message part, on crée la fiche
avant de le savoir, on la garde, et elle remplit le plafond.

### Comportement cible

La normalisation reste `telephoneE164` / `normalizePhone`, pays de l'adresse puis pays de la boutique, `FR` seulement
en dernier. On change l'ordre de victoire : un candidat `estUnFixe` est sauté, on essaye le suivant. Un fixe de
livraison ne doit pas masquer un mobile sur le client, ni fonder une fiche. Un numéro qui n'a aucun candidat ni valide
ni mobile est une commande sans numéro utilisable.

Ces commandes ne laissent aucune donnée personnelle. Pas de téléphone, pas de nom, pas d'adresse, pas d'identifiant
client Shopify, pas de ligne dans `shopify_commandes`. Le webhook est quand même acquitté : le message, s'il est
allumé, a déjà son issue `sans_telephone`. On garde au plus des comptes, par espace et par jour, sans identifiant de
commande : reçues, sans numéro utilisable, numéro non mobile, rattachées à une fiche adressable, éprouvées et livrées,
éprouvées et non livrées (`131026` au second échec). `ventes_attribuees` sans contact (identifiant de commande, montant,
devise, pas de téléphone) reste le chemin du chiffre d'affaires déjà livré. Cette spec ne le vide pas. Elle ne s'en
sert pas comme carnet.

**Savoir qu'un numéro n'est pas sur WhatsApp.** Il n'y a pas d'appel de vérification dans ce dépôt, et le `131026` est
le signal que Meta documente. Il dit « pas livrable », ce qui couvre aussi des conditions non acceptées et un client
trop ancien : ce n'est pas une preuve éternelle. D'où la politique déjà en code, qu'on garde : pas de rejeu immédiat,
une relance, puis le « non ». Le « non » périme à 90 jours. On ne rallonge pas les essais. Deux échecs suffisent. Un
troisième envoi automatique vers le même numéro, sans geste nouveau, ne part pas tant que le « non » est frais.

**Après le second `131026`.**

- Fiche née de cet envoi Shopify, sans message entrant de la personne : on la purge. Elle sort du plafond. Les
  commandes et les lignes partent avec elle (cascade déjà prévue). Le compte « non livrées » augmente. On ne garde pas
  le numéro. Une commande suivante pourra réessayer, parce qu'on n'a pas de liste noire : c'est le prix de ne pas
  stocker le numéro, et `131026` n'est pas définitif à vie. Un condensat du type de l'empreinte STOP (illisible, pour
  ne pas recréer tout de suite) est une question ouverte, pas le défaut.
- Fiche déjà là pour une autre raison (elle a écrit, elle a été importée, un envoi précédent a été livré) : on ne la
  purge pas. On pose le « non », comme aujourd'hui. Elle reste dans le plafond : c'est une personne avec qui l'espace
  a déjà une fiche légitime, pas un numéro mort créé en masse. Les segments et les campagnes de ces chantiers
  l'écartent tant que le verdict est `non`. Le filtre « sauf les injoignables connus » devient le défaut des cibles
  qui utilisent un critère Shopify de cette spec, pas un filtre que l'assistant doit penser à poser.

On ne crée pas de fiche « pour stocker la commande » sans envoi. La seule création admise est celle que l'envoi d'un
template fait déjà, et elle ne devient durable que si le message n'a pas fini en second `131026`. Le plafond ne se
remplit pas de numéros morts.

### Le chiffre montré au marchand

« X % de vos commandes sont joignables sur WhatsApp. »

X = commandes livrées au moins une fois sur WhatsApp, divisées par les commandes reçues sur la période (webhook, et
reprise une fois qu'elle a classé chaque commande). Une commande au numéro valide jamais éprouvé n'entre pas dans X
comme un échec : elle est « pas encore éprouvée ». L'écran montre quatre parts qui font le tout :

- pas de numéro utilisable (absent, illisible, ou non mobile) ;
- numéro utilisable, pas encore éprouvé ;
- livrée sur WhatsApp ;
- éprouvée, non livrée (`131026` au second échec).

X est la troisième part. Sans la quatrième ligne, un marchand qui n'a pas allumé la confirmation lirait 0 % et
croirait que personne n'est sur WhatsApp. Le texte le dit : « joignable » veut dire « un message est arrivé », pas
« le numéro a l'air bon ».

### La règle dans chaque chantier

**Chantier 1.** Les lignes et les collections ne s'écrivent que sur une fiche adressable déjà résolue par le téléphone
utilisable. Pas de fiche créée pour porter un produit. Une fiche au verdict `non` ne reçoit pas de nouvelle ligne. Les
commandes sans numéro utilisable n'ont pas de ligne, seulement le compte du jour.

**Chantier 2.** La reprise 60 jours (Free) et 24 mois (Pro) ne crée aucune fiche. Elle ne rattache que les commandes
dont le téléphone utilisable est déjà celui d'une fiche adressable. Le reste est un compte, pas une file d'attente de
numéros. L'action Pro « fiches d'acheteurs » ne pré-crée pas jusqu'à 1 000. Elle n'envoie que vers des numéros
utilisables, dans les places restantes, et une fiche qui finit en second `131026` sans message entrant est purgée et
libère sa place. Le plafond 1 000 ne se remplit pas de numéros morts. L'aperçu compte sans rien écrire.

**Chantier 4.** Étiquettes et segments Shopify ne se posent que sur des fiches adressables. Pas de fiche créée pour
accueillir une étiquette. Un client Shopify dont le seul numéro est inutilisable, ou dont la fiche est en verdict
`non`, compte dans « membres lus, pas de fiche adressable » et n'est pas stocké.

**Chantier 7.** Les signaux de conversation (réponse, clic, analyse) n'existent que sur des fiches déjà adressables :
quelqu'un a écrit, a cliqué un lien qui le désigne, ou a une analyse. Ce chantier ne crée personne pour croiser un
achat. « A cliqué sans jamais répondre » ne recrute pas les numéros que le `131026` a écartés.

## Chantier 1. Lignes de commande, produits et collections

### État actuel

On garde la commande, pas ce qu'elle contient. L'onglet Shopify le dit. Le filtre « a acheté X » n'existe pas. La spec
du 2026-10-31 l'a laissé hors du lot : « Shopify ne les envoie pas dans ce que nous gardons ». La phrase vise ce que
le schéma retient. Le corps, lui, est plus large. Voir ci-dessous.

`shopify_lignes` (migration `0299_shopify_lignes.sql`) est le réglage des automations de message. Ce nom est pris. Les
lignes de commande ne s'y mettent pas. `effacerBranchement` éteint `shopify_lignes` et supprime `shopify_commandes`
(`src/shopify/store.pg.ts`).

### Ce que le webhook contient

Doc officielle, deux pages qui se complètent.

1. [Webhooks, delivery structure](https://shopify.dev/docs/apps/build/webhooks/delivery-structure) : par défaut, le
   corps JSON est la ressource REST entière du sujet. `include_fields` ne sert que si l'abonnement le demande. Les
   abonnements actuels ne le demandent pas.
2. [Order, REST Admin](https://shopify.dev/docs/api/admin-rest/latest/resources/order) : une ligne (`line_items[]`)
   porte notamment `id`, `product_id`, `variant_id`, `sku`, `title`, `variant_title`, `name`, `quantity`,
   `current_quantity`, `price`, `price_set`, `gift_card`, `vendor`, `properties`. `product_id` « can be null if the
   original product associated with the order is deleted at a later date ». `price` est le prix boutique avant
   remises. Aucune propriété de cette liste n'est une collection.

Liam, de Shopify, le 2025-12-12, sur le forum
([fil](https://community.shopify.dev/t/which-order-fields-change-in-each-webhook-event-orders-create-vs-orders-paid-vs-orders-fulfilled/27018)) :
tous les webhooks de commande (`orders/create`, `orders/paid`, `orders/updated`, `orders/cancelled`, …) envoient
l'objet Order entier, pas un delta. `orders/paid` et `orders/updated` partent tous les deux quand une commande est
payée. On n'est pas abonné à `orders/updated`. Il cite aussi la doc : la livraison d'un webhook n'est pas garantie, une
reprise périodique doit relire l'API. Le chantier 2 est cette reprise.

Depuis l'API `2026-10`, les lignes des webhooks de commande portent aussi `selling_plan_id` (nul hors abonnement)
([changelog](https://shopify.dev/changelog/posts/orders-webhooks-now-include-selling_plan_id-on-line-items)). On ne
s'en sert pas dans ces chantiers.

La mesure du 2026-10-21 citée dans `src/shopify/donnees.ts` a porté sur le téléphone, l'absence de `customer` et les
champs d'expédition. Elle n'a pas porté sur `line_items`. Le premier lot de ce chantier confirme, sur un vrai
`orders/paid` de la boutique de développement, que `line_items`, `product_id`, `variant_id` et `sku` arrivent, avant
d'en dépendre.

### La résolution des collections

Une collection n'est pas dans la ligne. Elle se lit sur le produit.

[Product.collections](https://shopify.dev/docs/api/admin-graphql/latest/queries/product) est une connexion paginée
(`first`, `after`, `pageInfo`). L'exemple `CollectionsForProduct` de cette page demande `read_products` sur l'objet
`Product`. La requête `collections` documente `collection_type` avec les valeurs `custom` et `smart`
([collections](https://shopify.dev/docs/api/admin-graphql/latest/queries/collections)) : une collection manuelle et une
collection automatique, dont les règles font entrer et sortir des produits sans qu'une commande change.

Conséquence : « a acheté dans la collection Été » veut dire « a acheté un produit qui est dans cette collection à la
dernière lecture », pas « qui y était le jour du paiement ». L'API ne rend pas l'appartenance historique. Un instantané
pris à la résolution, des minutes ou des heures après le paiement, n'est pas non plus le jour du paiement.

Recommandation : le filtre de collection dit cette phrase, en console et dans la description de l'outil. On ne promet
pas l'appartenance au jour de la commande. Un instantané figé au paiement serait un lot ultérieur, et il resterait
faux pour tout ce que le chantier 2 relit après coup.

Un produit est dans plusieurs collections. On suit `pageInfo`. Au-delà de 50 collections pour un produit, on s'arrête
et on marque la fiche produit, pour qu'un filtre ne prétende pas à l'exhaustivité. 50 est un plafond à nous, pas un
plafond de Shopify.

La résolution ne se fait pas dans le webhook. Shopify coupe la livraison à 5 s. L'attribution a déjà un budget de
1 500 ms (`BUDGET_ATTRIBUTION_MS`). Un appel Admin par produit, sur le chemin qui confirme la commande, casserait
cette règle. Les lignes s'écrivent avec la commande. Les collections se résolvent dans une file, au premier besoin et
au plus une fois par jour et par produit tant qu'un filtre de collection est armé.

### Proposition

Deux lots, le second optionnel pour qui n'a pas besoin des collections.

**Lot 1a, sans scope nouveau.** À chaque `orders/paid` d'une fiche adressable, enregistrer les lignes que le corps porte
déjà : identifiant de ligne, produit, variante, SKU, titre, titre de variante, quantité, drapeau carte cadeau. Les
filtres « a acheté ce produit ou ce SKU », « a acheté X et pas Y », « dernier achat de X il y a au moins N jours »
lisent cette table. Le sélecteur de la console liste les produits déjà vus sur les fiches de l'espace (titre, SKU,
identifiant), pas le catalogue entier.

**Lot 1b, scope `read_products`.** Résoudre les collections des produits vus, les mettre en cache, filtrer « a acheté
un produit de cette collection ». Tant que la boutique n'a pas approuvé le scope, le filtre est refusé avec
`lienInstallation`, il ne rend pas zéro contact. Un zéro serait une campagne vide prise pour une vérité.

La vente croisée est un seul critère, pas deux filtres libres. Il exige au moins un produit acheté. Une exclusion
seule (« n'a pas acheté Y ») viserait presque tout l'espace : elle est refusée, comme « au moins 0 commande ». Les
produits demandés se cumulent (tous). Les exclusions se cumulent (aucun). Le « ou » entre produits achetés n'est pas
dans ce lot.

Le réassort est le même objet que « jours depuis la dernière commande », borné à un produit ou à un SKU : au moins N
jours et, si on le pose, au plus M jours. Il exige un achat connu de ce produit. « Il y a au moins 180 jours » ne
retient pas quelqu'un qui n'a jamais acheté X.

Les cartes cadeaux (`gift_card: true` dans la doc REST) sont stockées et écartées des filtres produit. La commande,
elle, continue de compter dans le nombre et la dépense. Un pourboire ou une ligne sur mesure a souvent `product_id`
nul : on garde le titre et le SKU, le filtre par identifiant de produit ne la voit pas, le filtre par SKU la voit si
le SKU est là.

On ne stocke pas le prix de la ligne. La dépense reste le montant de la commande, déjà en devise boutique. On ne
réécrit pas les lignes quand un remboursement arrive. `quantity` est la quantité au paiement, pas `current_quantity`.
C'est la décision du 2026-10-31 (remboursements non déduits), appliquée aux produits. La rouvrir est une question
ouverte, pas un effet de bord de ce lot.

### Modèle de données et migrations

Nouvelle table `shopify_commande_lignes`, jamais `shopify_lignes` :

- `tenant_id`, `commande_id`, `ligne_id` : clé primaire. `ligne_id` est le `id` REST de la ligne, en texte.
- Clé étrangère `(tenant_id, commande_id)` vers `shopify_commandes`, `on delete cascade`. La purge d'une fiche, qui
  supprime déjà ses commandes, emporte les lignes. `customers/redact` aussi, puisqu'il efface les fiches liées.
- `produit_id`, `variante_id`, `sku` : textes nullables. Vides ramenés à nul.
- `titre` : texte requis, borné (200 caractères, au-delà on coupe). `variante_titre` nullable, même borne.
- `quantite` : entier de 1 à 100 000. Une quantité illisible écarte la ligne, pas la commande.
- `carte_cadeau` : booléen, défaut faux.
- `tronquee` n'est pas sur la ligne : un booléen `lignes_tronquees` sur `shopify_commandes`, défaut faux, si le corps
  portait plus de lignes que le plafond.

Plafond proposé : 250 lignes par commande, l'ordre du corps. Au-delà, on garde les 250 premières et on lève le
drapeau. Le filtre et l'outil disent alors que cette commande est incomplète. 250 est à nous. La doc REST lue pour
cette spec ne fixe pas de maximum de lignes.

Index, prédicat égal au `where` de la requête (la règle du dépôt sur les index partiels) :

- `(tenant_id, produit_id)` où `produit_id is not null and carte_cadeau = false` ;
- `(tenant_id, sku)` où `sku is not null and carte_cadeau = false`.

La requête de segment joint `shopify_commandes` (`tenant_id = $1`, période sur `payee_le`) et cette table. Chaque
sous-requête nomme `tenant_id = $1`.

Cache des collections, lot 1b seulement :

- `shopify_produits` : `(tenant_id, produit_id)`, titre, `collections_lues_le`, `collections_incompletes`. Une ligne
  même si le produit n'est dans aucune collection, pour ne pas relire sans fin.
- `shopify_produit_collections` : `(tenant_id, produit_id, collection_id)`, titre de la collection. Remplacée en bloc
  à chaque lecture réussie du produit.

Migration en `avant` : `orders/paid` est un chemin chaud, et le code neuf nomme la table. L'ancien code ne la nomme
pas, il survit. `lock_timeout` 5 s. La table est neuve, le verrou chaud est celui de `shopify_commandes` si on y
ajoute `lignes_tronquees` (colonne nullable ou à défaut constant). `effacerBranchement` doit supprimer
`shopify_commande_lignes` avant `shopify_commandes`, ou s'en remettre à la cascade : à écrire dans le même lot, avec
le test qui coupe une boutique.

L'upsert de ligne est dans la même fonction que `lierCommande`, appelée depuis `attribuerCommande` et depuis `servir`.
Un seul des deux chemins laisserait le premier achat d'un client neuf sans produits. L'échec des lignes est journalisé
et avalé, comme `shopify_commande_non_notee`. Pas d'appel HTTP.

### Webhooks et scopes

Lot 1a : aucun sujet nouveau, aucun scope nouveau. On lit `line_items` du `orders/paid` déjà reçu.

Lot 1b : scope `read_products`, à ajouter dans le bloc `shopify.app.toml` de la skill, et à approuver sur la boutique
(lien d'installation). Pas d'approbation Shopify préalable : `read_products` n'est pas dans la liste « Shopify
approval required » de la page des scopes. La vérification se fait par `currentAppInstallation.accessScopes`. Sans le
scope, pas d'appel, un refus explicite.

Pas de webhook `products/update` ni `collections/update` dans ce lot. Une collection automatique bougerait sans qu'on
le sache jusqu'à la prochaine lecture (au plus 24 h tant qu'un filtre de collection est utilisé, et à la demande).
C'est assumé, et dit dans l'écran.

### Impact UI, MCP, API

Console, offre Pro et au-dessus (la fonction `console`, comme les filtres actuels) :

- dans « Achats et activité », un produit acheté (un ou plusieurs), un produit exclu, une fenêtre en jours, et le
  réassort (dernier achat de ce produit, il y a au moins / au plus N jours) ;
- la collection seulement si `GET .../contacts/segments` annonce `collections: true`. Sinon le contrôle n'est pas là.
  Un critère déjà posé dans un brouillon reste visible pour être retiré ;
- la phrase de suivi existante reste. On y ajoute, si `lignes_tronquees` concerne la cible, que certaines commandes
  n'ont pas toutes leurs lignes. Pour les collections : « telles qu'elles sont dans la boutique, lues le … » ;
- l'onglet Shopify de la fiche liste, sous chaque commande, le titre, la variante, le SKU et la quantité. Toutes les
  offres, puisque l'onglet l'est déjà. `features.md` dit aujourd'hui que les produits ne sont pas gardés : le lot qui
  code met cette phrase à jour, avec l'empreinte d'aide si une fiche publique en dépend.

MCP, mêmes outils que la cible commune, descriptions en anglais, bornes dans le schéma :

- `bought` : liste de `{ product_id }` ou `{ sku }`, 1 à 20, fenêtre `within_days` optionnelle ;
- `not_bought` : même forme, refusée si `bought` est absent ;
- `days_since_product` : un produit ou un SKU, `min` et `max` en jours, les bornes de `BORNES_SEGMENTS` ;
- `collections` : liste d'identifiants, lot 1b, refusée sans scope.

Clés réservées nouvelles dans `web/lib/partage/segments.ts`, opérateur `segment`. Elles entrent dans le plafond de 20
filtres de champ. Au-delà, refus, pas de troncature.

L'API publique `/v1` ne gagne pas de route. Le jour où un filtre de contact y entre, il réutilise ces clés, il
n'invente pas un membre de `ContactFilters`.

### Cas limites

- Commande sans `customer` (invité) : les lignes se gardent si le téléphone trouve une fiche. `client_id` reste nul.
- `product_id` nul à la relecture d'une vieille commande, produit supprimé entre-temps (phrase de la doc REST) : le
  SKU et le titre restent cherchables. L'identifiant de produit, non.
- Webhook rejoué : upsert sur `(tenant_id, commande_id, ligne_id)`.
- Deux produits, deux devises de boutique dans le temps : les lignes n'ont pas de montant. Le nombre de commandes
  compte toutes les devises, la dépense seulement la devise actuelle. Inchangé.
- Filtre produit sans boutique : refusé, comme les critères de commande actuels.
- Boutique coupée : les lignes restent, plus rien n'entre, les collections ne se relisent plus. Le filtre dit la date
  de coupure, déjà rendue.
- Ligne dont le titre dépasse la borne : on coupe le titre, on garde la ligne. On ne rejette pas la commande.
- Cadeau : le téléphone de livraison peut être celui du destinataire. S'il est utilisable, les lignes suivent cette
  fiche, comme la commande entière aujourd'hui. S'il est un fixe (`estUnFixe`), on le saute et on essaye le candidat
  suivant (section « Qualité des numéros »).

### RGPD et consentement

Les lignes sont des données d'achat rattachées à une fiche qui existe déjà. Même base que `shopify_commandes`.
`customers/redact` efface les fiches liées à la commande ou au client, et la cascade emporte les lignes. La coupure
et `shop/redact` passent par `effacerBranchement`, qui doit emporter la nouvelle table. La purge d'une fiche aussi.

On ne crée pas de fiche. On ne rattache pas une commande à une fiche au verdict WhatsApp `non`. On ne change pas le
consentement. Un modèle marketing continue de n'atteindre que les contacts consentants. Enregistrer qu'une fiche
adressable a acheté un produit ne l'abonne pas.

`customers/data_request` envoie aujourd'hui un e-mail aux admins et n'exporte pas le détail. Le lot 1a ajoute les
lignes (titre, SKU, quantité, date) à ce que cet e-mail annonce comme détenu, ou le dit dans la question ouverte si
le contenu de l'e-mail ne se change pas dans le même lot. On n'oublie pas le sujet : un produit acheté fait partie
des données de la personne.

Les titres de collection sont des données du catalogue, pas d'une personne. Le lien produit-fiche, si.

### Effort et lots

| Lot | Contenu | Effort |
|---|---|---|
| 1a | Table, parse du webhook, double écriture, filtres produit / SKU / réassort / exclusion, console, MCP, onglet fiche | M |
| 1b | `read_products`, cache, file de résolution, filtre collection, repli si le scope manque | M |

Le chantier entier est un L s'il part en un seul lot, à cause du redéploiement marchand du 1b. Il se coupe : 1a est
utile seul.

## Chantier 2. Rattrapage de l'historique

### État actuel

`commandes_depuis` est posé à la connexion. Avant, rien. La spec du 2026-10-31 a écarté le rattrapage et cité « 60
jours sans un accès étendu ».

`read_orders` est déjà accordé. Il ne donne, par défaut, que les commandes créées dans les 60 derniers jours.

### Ce que la doc Shopify fixe

[Access scopes, Orders permissions](https://shopify.dev/docs/api/usage/access-scopes) :

| Scopes | Accès |
|---|---|
| `read_orders` | Lire les commandes créées dans les 60 derniers jours |
| `read_orders` et `read_all_orders` | Lire toutes les commandes, y compris les plus anciennes |

`read_all_orders` ne donne rien seul. Il étend `read_orders`. La même page, note sur les apps créées dans le Dev
Dashboard d'une organisation marchande, pour les boutiques de cette organisation : pas de demande d'approbation à
Shopify. On ajoute le scope, on publie une version, le marchand l'approuve sur la boutique, on vérifie
`currentAppInstallation`. Nos apps sont dans ce cas (skill : l'app est créée dans l'organisation du marchand). Une
app d'organisation partenaire, elle, doit demander l'accès dans le Dev Dashboard avant de pouvoir déclarer le scope.
Ce n'est pas notre chemin.

L'objet GraphQL [Order](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order) répète la fenêtre de 60 jours
et renvoie vers cette page. Il expose `lineItems`, une connexion paginée. Les collections n'y sont pas. Le lot 1a a
donc de quoi remplir `shopify_commande_lignes` pendant la reprise, sans `read_products`.

Un fil du forum (janvier 2026, réponse d'un employé Shopify) dit qu'une app d'organisation marchande lirait tout
l'historique avec `read_orders` seul. Ce n'est pas ce que la page des scopes écrit. La spec suit la page. Le premier
lot mesure, sur la boutique de développement, une commande créée il y a plus de 60 jours avec le scope actuel. Si la
mesure contredit la page, on le dit dans le journal du lot avant d'ajouter `read_all_orders`.

La REST Admin est une API héritée depuis le 1er octobre 2024, et les nouvelles apps publiques doivent être en GraphQL
depuis le 1er avril 2025 (encadré de la page Order REST). Nos apps ne sont pas publiques. La reprise utilise quand
même GraphQL, comme `lireClientsAbonnes`. Les webhooks, eux, restent au format REST : c'est le défaut de livraison.

[Limites de débit GraphQL](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits) : le seau est par
couple app et boutique. Restauration : 100 points par seconde (Standard), 200 (Advanced), 1 000 (Plus), 2 000
(Commerce Components). Une requête ne dépasse pas 1 000 points. Le seau doit couvrir le coût demandé avant l'exécution,
l'écart avec le coût réel est rendu ensuite. L'exemple de la même page montre un seau de 1 000 et une restauration de
50 : les chiffres varient. `src/shopify/clients.ts` a mesuré, sur une boutique, un seau de 2 000 rendu à 100 par
seconde. Le job lit `extensions.cost.throttleStatus`, il ne code pas le plan. La même page prévient qu'une page
d'objets chargés de connexions (des commandes avec toutes leurs lignes) peut répondre `INTERNAL_SERVER_ERROR` ou
`5xx` même sous le plafond de coût : on demande alors moins d'objets, on va chercher les lignes à part, ou on passe
aux [opérations groupées](https://shopify.dev/docs/api/usage/bulk-operations/queries).

Pagination : curseur `after`, `pageInfo.hasNextPage` et `endCursor`, comme l'import des clients. Les arguments de
liste plafonnent souvent à 250. Pour les commandes avec lignes, pages petites (proposition : 20 commandes, 50 lignes,
suite de lignes si `hasNextPage`), à cause du 5xx ci-dessus.

La fenêtre de 60 jours porte sur la date de création de la commande, pas sur la date de paiement. Une commande créée
il y a 90 jours et payée hier est hors de `read_orders`. L'écran dit « commandes créées depuis … », et `payee_le`
reste `processedAt` quand il est lisible.

Données client protégées : la page des scopes dit qu'un scope ne suffit pas. Tant que l'app n'est pas configurée pour
ces données, l'API n'en rend pas sur une boutique qui n'est pas de développement. Le téléphone, le nom et l'adresse
d'une commande en font partie. L'import des clients a déjà le message (`acces_refuse`). La reprise réutilise ce
message au premier refus, elle n'en invente pas un autre.

### Faut-il garder les commandes sans fiche ?

Recommandation : **non, par défaut.** On rattache aux fiches adressables déjà là. On compte les autres dans le bilan du job. On
ne stocke pas leur téléphone. Une fiche créée ensuite est servie par une reprise relancée, pas par une table d'attente.

Pour :

- le réassort et la vente croisée visent d'abord des gens à qui l'on peut écrire, donc des fiches ;
- la décision du 2026-11-03 a refusé de conserver un numéro sans fiche, et `customers/redact` ne saurait pas quoi
  effacer d'une ligne orpheline dont on aurait jeté le lien ;
- le plafond de contacts est un plafond de fiches. Une table d'inconnus le contournerait sans le dire.

Contre, et c'est le vrai manque :

- un acheteur qui n'a jamais écrit, et qui n'a pas reçu de confirmation (message éteint, ou téléphone alors inconnu),
  n'a pas de fiche. Son historique ne se rattache à personne. Le rattrapage n'enrichit que le carnet déjà constitué ;
- l'import actuel (`FILTRE_ABONNES` dans `src/shopify/clients.ts`) ne crée une fiche que pour un client abonné au
  marketing e-mail ou SMS, avec le téléphone du client. Un acheteur non abonné n'entre pas par cette porte.

Le pont Pro, « fiches des acheteurs », ne déroge pas à la règle des numéros. Il est décrit plus bas. Il ne fait pas
partie du rattrapage silencieux, et il ne pré-crée pas un carnet de numéros non éprouvés.

Téléphones. Pour rattacher, on reprend les mêmes candidats que `telephoneDeCommande`, avec le saut des non-mobiles de
la section « Qualité des numéros », afin qu'une commande relue tombe sur la même fiche que le webhook une fois cette
règle en place. Pour une création, on ne prend que le téléphone du client (`customer.defaultPhoneNumber` en GraphQL,
comme `lireClientsAbonnes`), et seulement s'il est utilisable. Une adresse peut être celle d'un destinataire de
cadeau, et `customers/redact` porte le téléphone du client. Un cadeau rattache le destinataire s'il a déjà une fiche
adressable. Il ne crée pas de fiche à son nom.

### Trois options

Les trois gardent le lot 1a : une commande rattrapée écrit aussi ses lignes. Les trois refusent de stocker un numéro
sans fiche. Les trois sont relançables et idempotentes (`lierCommande` et l'upsert des lignes).

**Option A, profondeur selon l'offre. Recommandée.**

| | Free | Pro, et Business, et Entreprise |
|---|---|---|
| Déclenchement | Outil MCP, une personne nommée, aperçu puis confirmation. Pas au branchement. | Le même outil, plus un bouton sur la carte Shopify. Pas au branchement. |
| Fenêtre | 60 jours, scope actuel, pas de redéploiement | 60 jours sans rien changer. Jusqu'à 24 mois si `read_all_orders` est accordé. Au-delà de 24 mois : non, dans ce lot. |
| Rattachement | Fiches adressables déjà là seulement. Le carnet Free en a au plus 100, et une fiche au verdict `non` ne reçoit rien. | Fiches adressables déjà là. Le volume suit le carnet (1 000, 5 000, ou le devis). Pas de numéro inutilisable stocké. |
| Fiches nouvelles | Non. L'import des abonnés marketing existe déjà. Cette spec ne l'élargit pas aux numéros non éprouvés. | Action à part. Numéro de client utilisable seulement. Place libérée si le second `131026` purge une fiche sans message entrant. |
| Ciblage campagne | Non : `find_contacts` exige `console`. L'onglet fiche, lui, montre l'historique, toutes offres. | Oui, console et MCP. |

Ce qui fait passer au Pro : cibler et envoyer (déjà fermé en Free), aller au-delà de 60 jours, et proposer des fiches
d'acheteurs qui ne sont pas abonnés au marketing Shopify, sans remplir les 1 000 contacts de numéros qui ne sont pas
sur WhatsApp. La Free voit, sur les fiches adressables qu'elle a déjà, les commandes créées dans les 60 jours. Elle ne
crée personne par ce chantier.

24 mois est un choix à nous, pas une limite Shopify. `read_all_orders` ouvrirait tout l'historique. On s'arrête à 24
mois pour borner le job, le dire, et laisser un lot ultérieur si un marchand veut plus. La question ouverte le porte.

**Option B, même fenêtre, plafond au nombre de contacts.** Tout le monde : 60 jours, fiches existantes. Free : au plus
100 commandes rattachées. Pro : au plus 1 000. Le plafond est sur les commandes, calqué sur le plafond de fiches.

Elle se refuse. Un contact à trois commandes en demande trois. Un Pro de 1 000 fiches actives peut avoir plusieurs
milliers de commandes sur 60 jours. Le plafond qui existe déjà est celui des fiches. Plafonner les commandes coupe
l'historique des meilleurs clients, qui sont ceux du réassort.

**Option C, automatique au branchement, Pro seulement.** Dès la connexion, tout l'historique, et des fiches créées
jusqu'au plafond.

Elle se refuse. Remplir l'espace bloque les messages entrants (`contactsToutesOrigines`). Le branchement ne doit pas
choisir à la place du marchand combien de personnes naissent. L'import des abonnés a déjà la bonne forme : un aperçu,
puis un nombre. On la garde.

### Le job

File pg-boss nouvelle, entrée de `BASE_QUEUES` (`src/queue/names.ts`), sinon elle est invisible de `/ops` et sa file
d'échec n'est surveillée par personne (`tests/queue-names.test.ts`). Aucune file du dépôt ne déduplique : l'unicité
est à l'exécution. Un verrou par espace et par genre de reprise, sur le modèle de `src/campaign/run-lock.ts` : un bail,
un jeton de garde, un drapeau de relance. Les requêtes du travail passent par la connexion qui tient le verrou.

Le worker porte le job. L'API et l'outil ne font que l'enfiler et lire l'état. L'aperçu, lui, est synchrone, borné
comme la lecture des clients (25 s), et dit : commandes lisibles, déjà rattachées à une fiche adressable, rattachables,
sans fiche adressable, sans numéro utilisable, fenêtre, scope `read_all_orders` oui ou non. Les comptes n'embarquent
aucun numéro. S'il n'a pas fini de compter, il le
dit (`complet: false`), il ne présente pas un compte partiel comme un total.

La reprise elle-même reprend à son curseur. Un plantage ne recommence pas à zéro les écritures (elles sont
idempotentes) et ne recommence pas la lecture au début. Statuts proposés : `en_attente`, `en_cours`, `partiel`,
`termine`, `refuse` (scope ou données protégées), `erreur`.

Quelles commandes : celles créées dans la fenêtre, qui ont été payées, remboursement ultérieur compris (payée,
partiellement remboursée, remboursée). Une commande seulement autorisée ou annulée avant paiement ne compte pas, en
cohérence avec « on n'écoute que `orders/paid` ». La chaîne de recherche exacte (`query` de la connexion `orders`) se
vérifie sur la boutique de développement en API `2026-10` avant d'être figée. Les commandes de test se gardent, drapeau
`test`, comme aujourd'hui.

Ordre conseillé au marchand, écrit sur le bouton : les commandes se rattachent aux fiches déjà là. Importer les
clients, ou créer les fiches d'acheteurs, puis lancer le rattrapage. Le relancer après coup rattrape les fiches
nouvelles.

Création de fiches (Pro et au-dessus, action séparée), sous la règle des numéros :

- l'aperçu compte les acheteurs de la fenêtre qui ont un téléphone client utilisable et pas de fiche adressable, du
  plus récent au plus ancien. Il n'écrit aucun numéro ;
- le marchand choisit le nombre, au plus les places restantes (`limiteContactsDe`), et au plus `IMPORT_MAX` (5 000).
  Un numéro inutilisable ne prend pas de place ;
- la fiche naît parce qu'un template part, pas pour stocker la commande. Consentement : la source `shopify:<domaine>`
  de l'envoi existant pose déjà `opted_in` quand le message de confirmation part. Cette action-ci ne pose pas un
  second accord. Un achat seul n'est pas un opt-in. Un STOP connu renaît désabonné ;
- au second `131026`, si la personne n'a jamais écrit, la fiche est purgée et la place revient. Le compte « non
  livrées » augmente. On ne garde pas le numéro ;
- étiquette proposée, pour celles qui restent : « Acheteur Shopify », pas « Shopify ». L'import des abonnés pose déjà
  « Shopify ». Question ouverte si l'équipe préfère la même étiquette ;
- un modèle marketing ne part quand même qu'aux consentants. Le bouton le dit.

Free : pas de cette action. Le texte de l'outil renvoie vers le Pro, et rappelle que l'import des abonnés, lui, existe.

Business a la même mécanique que le Pro, avec 5 000 contacts. L'Entreprise aussi, sans plafond de fiches autre que le
devis. Ni l'un ni l'autre n'a une fenêtre plus longue que le Pro : la profondeur Shopify n'est pas le critère qui
sépare le Business de l'Entreprise. L'analyse, si (chantier 7).

### Modèle de données et migrations

Table `shopify_reprises` : `tenant_id`, genre (`commandes` ou `fiches_acheteurs`), curseur, statut, comptes (rattachées,
sans fiche, sans téléphone, fiches créées), `erreur`, `fenetre_debut`, `commence_le`, `fini_le`, `par` (l'utilisateur
qui a lancé). Une reprise vivante par espace et par genre.

Pas de colonne nouvelle sur le chemin `orders/paid`, si le lot 1a a déjà `shopify_commande_lignes`. La reprise écrit
dans les tables de ce lot. Migration en `apres` possible : l'ancien code ne la lit pas, et le job neuf n'est pas encore
en production quand la migration part. Si le même déploiement ajoute l'écriture webhook des lignes, la migration des
lignes reste `avant` (chantier 1) et celle de `shopify_reprises` peut la suivre.

`commandes_depuis` ne recule pas au premier jour rattrapé. Cette date veut dire « à partir d'ici, chaque commande
payée d'une fiche connue est entrée au fil de l'eau ». Le rattrapage est un autre stock, avec des trous (sans
téléphone, sans fiche, hors fenêtre). L'outil rend les deux : `orders_recorded_since` inchangé, et
`orders_backfill` (`from`, `to`, `finished_at`, `orders_attached`). Un « aucune commande en 18 mois » dit la fenêtre
réellement lue. Sans cela, le rattrapage mentirait par son silence.

### Webhooks et scopes

Aucun webhook nouveau. La reprise est un appel Admin.

`read_orders` suffit pour 60 jours. `read_all_orders` pour la fenêtre de 24 mois : skill, publication de l'app,
approbation sur la boutique, contrôle de `accessScopes` avant d'enfiler le job long. Sans le scope, le bouton Pro
propose 60 jours et explique les 24 mois. Il ne lance pas une reprise qui échouerait à la première page ancienne.

Le job s'arrête proprement sur `THROTTLED` répété, `ACCESS_DENIED`, et un 5xx de page trop grosse (on réduit la page
et on reprend au curseur). Au bout d'un budget par passage (proposition : 2 minutes de travail, puis on se réenfile),
pour ne pas tenir un worker. Le curseur est le point de reprise.

### Impact UI, MCP, API

Carte Shopify de la console (Pro et au-dessus) : « Rattraper les commandes ». Aperçu, fenêtre, bouton. État du job
visible (en cours, partiel, terminé, refusé). Deuxième bouton, « Créer des fiches d'acheteurs », avec les places
restantes.

MCP, personne nommée, comme `import_shopify_customers` :

- `preview_shopify_order_history` ;
- `import_shopify_order_history`, qui enfile et rend l'identifiant de reprise ;
- `get_shopify_order_history` pour l'état ;
- `preview_shopify_buyers` et `import_shopify_buyers`, Pro et au-dessus, refusés en Free avec le lien de l'offre.

`find_contacts` ne change pas dans ce chantier, à part le bloc `orders_backfill` de la réponse quand un critère de
commande est posé. Les filtres du chantier 1 s'appliquent au stock rattrapé sans paramètre nouveau : c'est la même
table.

Pas de route `/v1`. Pas de lancement au branchement.

### Cas limites

- La même commande arrive ensuite par `orders/paid` (elle est dans les 60 jours et le marchand était déjà branché) :
  l'upsert ne double pas.
- Commande rattrapée dont la fiche est née plus tard : une nouvelle reprise la rattache. L'ancienne ne se réveille pas
  seule.
- Espace plein au milieu de la création de fiches : on s'arrête, le bilan dit combien ont été créées et que la limite
  de l'offre est atteinte. On ne dépasse pas.
- Deux lancements : le second est refusé tant que le bail tient, avec la phrase qui le dit.
- Boutique coupée pendant le job : on s'arrête, on ne rappelle pas l'API.
- Données protégées refusées : statut `refuse`, le même geste que l'import de clients (accès de l'app sur une boutique
  en production).
- Devise mêlée : inchangé, la dépense ne somme que la devise actuelle.
- Commande sans ligne (ou lignes illisibles) : la commande se rattache quand même. Le filtre produit ne la voit pas.
  Le nombre de commandes la voit.

### RGPD et consentement

Rattacher une commande à une fiche existante est le même traitement que le webhook. La personne est déjà dans
l'espace. La reprise ne change pas son consentement.

Créer une fiche est un acte du marchand, comme l'import. Consentement WhatsApp inconnu. Source d'origine tracée
(`shopify_reprise`, distincte de `shopify:<domaine>` qui, elle, est posée quand un message de confirmation part et
marque la fiche consentante). On ne réutilise pas cette source : un rattrapage ne doit pas fabriquer un accord.

Les téléphones lus et non rattachés ne sont pas écrits. Le bilan ne garde que des comptes.

`customers/redact` et la purge couvrent les fiches créées, donc leurs commandes et leurs lignes, à condition que
`client_id` soit posé à la création. La création l'écrit. Un effacement par numéro de client retrouve alors la fiche
même si le téléphone de `customers/redact` diffère de celui qu'on a gardé.

La base légale côté marchand (intérêt légitime ou relation contractuelle pour ses propres clients) n'est pas à
trancher dans le code. Le produit se borne à ne pas décider à sa place, à ne pas conserver d'inconnu, et à ne pas
présenter un achat comme un opt-in WhatsApp.

### Effort et lots

| Lot | Contenu | Effort |
|---|---|---|
| 2a | Reprise 60 jours, fiches existantes, lignes comprises, aperçu, job, MCP, bouton Pro, onglet fiche à jour | M |
| 2b | `read_all_orders`, fenêtre 24 mois, repli 60 jours, skill et lien d'installation | M |
| 2c | Fiches d'acheteurs, Pro et au-dessus : numéro utilisable, purge au second `131026` sans message entrant | M |

Le chantier est un L. 2a se livre seul, et c'est lui qui rend le lot 1a utile sur le passé récent. 2b et 2c sont le
motif de passage au Pro.

## Chantier 4. Étiquettes et segments natifs Shopify

### État actuel

Les étiquettes Messaging Me sont celles du mini-CRM. Elles déclenchent des automations, elles ciblent des campagnes,
`tag_contacts` les pose. L'import des clients abonnés en pose une, « Shopify », au moment de la création. Rien ne lit
les étiquettes que le marchand a mises sur un client dans Shopify, ni les segments qu'il y a construits.

`read_customers` est déjà là, et la page des scopes le fait porter sur `Customer` et sur `Segment`.

### Ce que la doc Shopify fixe

Depuis l'API `2025-01`, `tags` a été retiré des corps de webhook qui contiennent un client, dont `orders/paid` et
`customers/update`
([changelog](https://shopify.dev/changelog/posts/new-customer-s-webhook-and-changes-to-existing-customer-s-webhooks-payload)).
Notre version est `2026-10`. On ne lit donc pas d'étiquette dans `orders/paid`.

Les sujets qui les remplacent
([WebhookSubscriptionTopic](https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic)) :

- `CUSTOMER_TAGS_ADDED` et `CUSTOMER_TAGS_REMOVED`, scope `read_customers` ;
- `CUSTOMER_JOINED_SEGMENT` et `CUSTOMER_LEFT_SEGMENT`, scope `read_customers` ;
- `SEGMENTS_CREATE`, `SEGMENTS_UPDATE`, `SEGMENTS_DELETE`, scope `read_customers`.

Exemples de corps
([référence des webhooks](https://shopify.dev/docs/api/webhooks/latest)) :

- étiquettes : `{ "customerId": "gid://shopify/Customer/1", "tags": ["tag1", "tag2"], "occurredAt": "..." }` ;
- segment : `{ "shop_id": "gid://shopify/Shop/1", "customer_id": "gid://shopify/Customer/2", "segment_id": "gid://shopify/Segment/3" }`.

Les deux formes ne se parsent pas avec les mêmes noms de champs. Le corps « segment » n'a ni téléphone, ni nom. On ne
peut l'appliquer que si ce `customer_id` est déjà lié à une fiche.

`customer.tags_added` n'existe pas en création de webhook REST. Un employé Shopify le confirme le 2025-10-29
([fil](https://community.shopify.dev/t/cannot-create-customer-tags-added-webhook/24556)) : le sujet est GraphQL.
`webhookSubscriptionCreate`, déjà utilisé pour la console, est le bon appel. Le nom d'énumération est
`CUSTOMER_TAGS_ADDED`.

La liste des segments se lit par la requête `segments` (identifiant, nom, requête ShopifyQL, curseur)
([guide](https://shopify.dev/docs/apps/build/marketing/customer-segments/manage)). Ce guide plafonne `first` et `last`
à 250, et le nombre de segments lus à 250. La page `customerSegmentMembers` dit, elle, une page maximale de 1 000
([requête](https://shopify.dev/docs/api/admin-graphql/latest/queries/customerSegmentMembers)). Le lot commence à 250.
Il ne monte que si un appel mesuré en `2026-10` accepte davantage.

Les membres se lisent par `customerSegmentMembers`, avec `segmentId` ou avec la requête du segment. Depuis `2023-01`,
une requête trop lourde répond `USE_CUSTOMER_SEGMENT_MEMBERS_QUERY_CREATE_MUTATION`. Il faut alors
`customerSegmentMembersQueryCreate`, puis attendre `done`, puis relire avec `queryId`
([guide de migration](https://shopify.dev/docs/apps/build/marketing/customer-segments/migrate-to-async-queries)). Un
lot qui ignore ce code échoue sur les segments riches (ceux qui parlent de produits achetés, justement). Le guide dit
que la plupart des requêtes asynchrones finissent en cinq secondes, et que certaines prennent une à deux minutes, ou
plus.

On ne réévalue pas le ShopifyQL nous-mêmes. La chaîne `query` est gardée pour l'affichage. Les membres viennent de
Shopify. Deux moteurs divergeraient sans erreur.

### Proposition

Trois listes, qui ne se mélangent pas.

1. **Étiquettes Messaging Me.** Inchangées. Seul le marchand, une automation, ou `tag_contacts` les pose.
2. **Étiquettes Shopify.** Une table à part, en lecture. La synchro ne les copie jamais dans les étiquettes Messaging
   Me. Un même mot, « VIP », peut exister des deux côtés : ce sont deux critères. L'écran les montre dans deux blocs,
   le second marqué Shopify.
3. **Segments Shopify.** Une troisième liste, encore plus mobile, parce que la définition et les membres bougent chez
   Shopify sans que personne ne renomme une étiquette. On ne les copie pas non plus. Le filtre dit « membre de ce
   segment à la dernière synchro », et il donne la date.

Le seul pont est une action explicite : « créer une étiquette Messaging Me avec les fiches de cette étiquette Shopify
(ou de ce segment), maintenant ». C'est un `tag_contacts` sur la cible du moment. Pas de suivi ensuite. Le marchand
nomme l'étiquette d'arrivée. Une campagne qui doit partir sur un instantané étiquette d'abord, comme aujourd'hui. Une
campagne qui doit suivre le segment Shopify filtre le segment, et la date de synchro est dans le récapitulatif.

Le rapprochement se fait par l'identifiant de client Shopify déjà posé sur `shopify_commandes.client_id`, et, à défaut,
par le téléphone du client (`defaultPhoneNumber`), jamais par une adresse. On ne pagine pas toute la boutique à chaque
passage : on interroge les clients dont on a déjà l'identifiant (lots de 250, plafond d'entrée de l'API cité par la
page des limites). Les fiches sans identifiant de client passent par le téléphone, une fois, et l'identifiant trouvé
est gardé pour la fois d'après.

On ne crée pas de fiche. On ne pose rien sur une fiche au verdict `non`. Un membre dont le numéro n'est pas utilisable,
ou qui n'a pas de fiche adressable, est compté (« 142 membres, 37 fiches adressables ») et oublié : pas de téléphone,
pas d'identifiant client orphelin. Ce compte peut mener à l'action du chantier 2, qui reste soumise au `131026`.

Fréquence recommandée :

- la synchro est éteinte tant que le marchand ne l'allume pas. Pas de parcours quotidien de toutes les boutiques
  branchées ;
- une fois allumée, Pro, Business et Entreprise : une reprise au plus toutes les 24 h, plus un bouton « maintenant » ;
- Free : le même travail, en manuel depuis le MCP, au plus une fois par 24 h, et sans le bouton de console. Le résultat
  sert à dire ce que le Pro pourrait cibler. `find_contacts` reste fermé ;
- les webhooks d'étiquettes (lot 4b) raccourcissent le délai. Ils ne remplacent pas la reprise : la livraison n'est
  pas garantie. Une boutique qui n'a jamais redéployé son app n'a pas ces sujets, et la reprise quotidienne suffit.

Les webhooks `customer.joined_segment` et `customer.left_segment` ne sont pas abonnés dans ce chantier. Le corps ne
porte pas de téléphone, et un segment par défaut (« tous les clients », « n'ont pas acheté ») peut battre à chaque
commande. On ne s'abonne pas à un feu dont on n'a pas mesuré le volume. La reprise des segments cochés par le marchand
suffit à la journée. S'abonner plus tard, seulement aux segments cochés, est une question ouverte : la doc lue ne
montre pas de filtre par `segment_id` sur l'abonnement.

Vingt segments suivis au plus, choisis par le marchand dans la liste lue chez Shopify. Au-delà, refus. Vingt est à
nous. Le guide plafonne la lecture de la liste à 250 : on peut les afficher, on n'en suit que 20.

### Modèle de données et migrations

- `shopify_clients` : `(tenant_id, client_id)` vers `contact_id`, `vu_le`. Le lien stable, mieux que de rescanner
  `shopify_commandes`. Rempli par les commandes déjà là et par la reprise.
- `shopify_etiquettes` : `(tenant_id, contact_id, etiquette)`, `vue_le`. L'étiquette est un texte borné. La borne
  exacte se fige sur le champ `Customer.tags` de l'API `2026-10` au moment du lot. On ne devine pas 255 ici.
- `shopify_segments_natifs` : `(tenant_id, segment_id)`, nom, requête, `suivi` (booléen), `synchro_le`,
  `synchro_partielle` (booléen), `membres_lus`, `membres_fiches`.
- `shopify_segment_membres` : `(tenant_id, segment_id, contact_id)`. Remplacée pour ce segment à chaque synchro
  terminée. Une synchro partielle ne supprime pas les membres d'avant : elle le dit (`synchro_partielle`), pour ne
  pas rétrécir une cible au milieu d'un rate limit.

Toutes ces tables cascadent avec la fiche ou partent dans `effacerBranchement`. Migration : tables neuves, l'ancien
code ne les nomme pas. `apres` si aucun chemin chaud ne les écrit encore. Le jour où `orders/paid` commence à remplir
`shopify_clients` en passant (il a déjà `client_id`), cette écriture-là suit la règle du chemin chaud : la table existe
avant le code, migration `avant`.

Les filtres sont des clés réservées : `segment_etiquette_shopify` (liste de textes, 1 à 20, mode tous ou l'un d'eux)
et `segment_segment_shopify` (liste d'identifiants suivis, 1 à 20). Refus si la synchro n'a jamais abouti : on ne
répond pas « personne » à un segment pas encore lu. Une fois lue, y compris à zéro fiche, le filtre s'applique, et la
réponse porte `shopify_tags_synced_at` ou `shopify_segments_synced_at`.

### Webhooks et scopes

Lot 4a (étiquettes par reprise) et lot 4c (segments par reprise) : aucun sujet nouveau, aucun scope nouveau.
`read_customers` suffit, d'après le tableau des scopes et les pages `segments` et `customerSegmentMembers`.

Lot 4b (fraîcheur des étiquettes) : `CUSTOMER_TAGS_ADDED` et `CUSTOMER_TAGS_REMOVED` dans `SUJETS_ABONNES` pour la
console, et dans le toml de la skill pour Claude Code. Les boutiques déjà branchées : la console se réabonne au
prochain passage (un rattrapage d'abonnement au démarrage du worker, ou au bouton), Claude Code attend que le marchand
redéploie son app. Tant qu'il ne l'a pas fait, la reprise du 4a couvre. On ne double pas un abonnement toml par l'API
sur une boutique `claude_code`.

Un événement d'étiquette dont le `customerId` n'est lié à aucune fiche est ignoré. On ne va pas chercher le client
dans le webhook. La reprise le fera si une fiche existe. Le webhook répond 200. Une panne d'écriture répond 503 pour
que Shopify réessaie, comme les autres sujets, sauf si l'on choisit d'avaler : recommandation, avaler et journaliser,
parce qu'une étiquette n'est pas une confirmation de commande, et qu'un 503 sur un client bavard en étiquettes
réessaierait pendant des heures. La reprise quotidienne répare.

### Impact UI, MCP, API

Console, Pro et au-dessus :

- bloc « Étiquettes Shopify », distinct du bloc « Étiquettes », avec la date de synchro et le bouton de copie
  explicite vers une étiquette Messaging Me ;
- bloc « Segments Shopify », les segments suivis, la date, le compte « membres chez Shopify / fiches ici », le même
  bouton de copie ;
- réglage sur la carte Shopify : allumer la synchro, choisir jusqu'à 20 segments. Éteint par défaut.

MCP :

- `sync_shopify_customer_tags` et `sync_shopify_segments`, personne nommée, qui enfilent ;
- `find_contacts` : `shopify_tags` et `shopify_segments`, avec la date dans la réponse ;
- la description dit que ces listes ne sont pas les étiquettes Messaging Me, et qu'une campagne qui doit figer la
  cible appelle `tag_contacts`.

L'API publique ne reçoit pas ces filtres dans ce chantier.

### Cas limites

- Étiquette Shopify renommée : Shopify traite souvent un renommage comme un retrait plus un ajout. La reprise
  quotidienne réaligne. Entre les deux, l'ancien texte peut rester. L'écran ne promet pas l'instantané.
- Client fusionné chez Shopify (`customers/merge`, scope `read_customer_merge`, que nous n'avons pas) : hors lot. La
  reprise par téléphone recoud ce qu'elle peut. Question ouverte.
- Segment supprimé chez Shopify : à la reprise, il disparaît de la liste. Un filtre qui le cite encore est refusé,
  avec le nom qu'on avait, pas élargi à tout l'espace.
- Segment dont la requête asynchrone n'a pas fini au budget : `synchro_partielle`, les anciens membres restent, le
  filtre le dit. On ne remplace pas une cible complète par une moitié.
- Mot réservé : une étiquette Shopify dont le texte est une clé `segment_*` n'a aucun effet sur les clés réservées.
  Elle vit dans sa table.
- Boutique coupée : on garde le dernier état, on n'appelle plus Shopify, les filtres restent utilisables avec la date.

### RGPD et consentement

Étiquettes et appartenances sont des données personnelles dès qu'elles sont sur une fiche. Elles partent avec la fiche,
avec `customers/redact`, et avec la coupure de la boutique. On ne garde pas le nom d'un client Shopify qui n'a pas de
fiche, ni son téléphone, ni la liste brute des membres.

Lire un segment ne crée pas de consentement WhatsApp. Copier vers une étiquette Messaging Me n'en crée pas non plus :
`tag_contacts` n'abonne pas. Une campagne marketing sur cette étiquette continue de n'envoyer qu'aux consentants.

Allumer la synchro est un acte du marchand. On ne la démarre pas à la connexion.

### Effort et lots

| Lot | Contenu | Effort |
|---|---|---|
| 4a | Lien client, reprise des étiquettes, table séparée, filtres, console, MCP, copie explicite | M |
| 4b | Webhooks d'étiquettes, réabonnement console, toml, sans changer le modèle | S |
| 4c | Liste des segments, choix de 20, reprise des membres, asynchrone compris, filtres | M |

Le chantier est un L en un seul lot. 4a se livre seul. 4c est le plus utile au marchand qui a déjà des segments, et il
ne dépend pas de 4b.

## Chantier 7. Achats et conversations

La règle des numéros s'applique sans création de fiche. Une réponse, un clic attribué et une analyse sont déjà le fait
d'une personne qui a un numéro. On ne recrute pas, pour ces critères, les commandes sans numéro utilisable ni les
fiches purgées après un second `131026`.

### État actuel

Deux familles de signaux, déjà écrites, déjà filtrables, pas croisées dans le temps.

**Sans IA, Pro et au-dessus** (la fonction `console`) :

- commandes, dépense, dernière commande, depuis `commandes_depuis` ;
- actif et inactif. Une seule date. Quelqu'un qui a cliqué et quelqu'un qui a écrit sont le même « actif ». « A cliqué
  sans jamais répondre » est inexprimable ;
- « a écrit ou cliqué, et au plus 0 commande » est exprimable. Il mélange les deux gestes.

**Avec IA, Entreprise seulement.** La dernière analyse sur la fiche. Le coût est le crédit du client, au prix client
(`prixClientMicroEur`), parce que l'analyse passe par le gateway de l'espace. La Free, le Pro et le Business n'ont pas
la fonction `analyse` : le job ne tourne pas, le filtre est refusé avec le lien de l'offre.

Ce qui est déjà exprimable en Entreprise, par la simple addition des filtres actuels, et qu'il ne faut pas reconstruire :

- « dépense d'au moins N et sentiment `negatif` » ;
- « intention `information` et au plus 0 commande sur la période » ;
- « inactif depuis N jours et au moins une commande ».

Ce que cette addition ne dit pas :

- que le sentiment date d'après la commande, ou d'avant ;
- qu'un clic n'est pas une réponse ;
- qu'une intention précise « délai de livraison » a été dite. Cette intention n'est pas dans la liste fermée. Le sujet
  libre n'est pas filtrable. `suivi_commande` est le mauvais proxy pour « a demandé un délai sans commander » : ce
  code désigne quelqu'un qui suit une commande déjà passée.

La fiche ne garde qu'une analyse, la dernière. Il n'y a pas d'historique des sentiments. « Mécontent lors de sa
dernière conversation » est exactement ce que la colonne dit. « Mécontent lors de la conversation qui a suivi sa
commande de mars, puis de nouveau content en avril » ne l'est pas, si avril a été analysé après.

### Proposition

Deux versions. La légère n'appelle aucun modèle. La complète ne fait pas tourner l'analyse plus souvent qu'aujourd'hui :
elle croise, au moment du filtre, des colonnes déjà payées.

**Pro, léger, coût IA nul.** Séparer la date de réponse et la date de clic. Les chemins d'écriture existent :
`noterActivite` pour tout message reçu, `recordClick` pour un clic attribué. On les écrit chacune à sa place.
`derniere_activite_le` reste le maximum des deux, pour que les filtres déjà en production ne changent pas de sens.

Critères nouveaux, sans modèle :

- a répondu (message reçu) dans les N jours ;
- a cliqué un lien suivi dans les N jours ;
- a cliqué dans les N jours et n'a jamais répondu ;
- a répondu dans les N jours et n'a aucune commande payée connue dans les N jours (ou depuis le début du suivi).

« A cliqué sans jamais répondre » est le troisième. Un appui de bouton est une réponse : c'est un message reçu, la
définition actuelle de l'activité. Un clic est un lien `/r/`. On ne mélange pas les deux dans le libellé. Les clics
sans contact (jetons d'avant l'attribution) restent ignorés, comme aujourd'hui.

Exemples Pro, tous sans IA :

- « a cliqué sans jamais répondre » : le critère dédié ;
- « a écrit cette semaine et n'a pas commandé depuis 30 jours » : réponse dans les 7 jours, et dernière commande il y
  a au moins 30 jours, ou au plus 0 commande ;
- « bon client silencieux » : dépense minimale, et inactif depuis N jours. Déjà possible aujourd'hui. Le lot ne le
  réécrit pas, il le cite dans l'aide.

**Entreprise, complet.** On ajoute le temps. Un critère `segment_apres_analyse` : la dernière commande payée est
absente, ou antérieure à `analyse_le`, ou postérieure. Combiné aux filtres d'analyse déjà là.

Exemples, et ce qu'ils sont vraiment :

- « a demandé un délai de livraison sans commander ». Pas de code pour « délai ». Le rapprochement honnête est :
  intention `information` ou `achat`, et aucune commande payée après `analyse_le`. On le documente ainsi dans l'outil,
  on n'invente pas une intention. Ajouter une intention « délai de livraison » demanderait une migration qui relâche le
  CHECK avant le déploiement, un prompt, et la parité des tests. C'est une question ouverte, pas ce lot.
- « client VIP mécontent lors de sa dernière conversation » : dépense minimale, sentiment `negatif`, et, si l'on veut
  « à propos de son achat », `analyse_le` après la dernière commande. Sans le troisième terme, on a un client qui a
  beaucoup dépensé et dont la dernière conversation, peut-être sans lien avec une commande, était négative. L'outil
  distingue les deux. VIP n'est pas une étiquette à nous : c'est un seuil de dépense, ou une étiquette Shopify du
  chantier 4 si le marchand l'a déjà.
- « a cliqué sans jamais répondre » : le critère Pro. Il n'a pas besoin de l'Entreprise.

On ne lance pas l'analyse à la réception d'une commande, ni au clic. Le coût resterait celui d'aujourd'hui : une
analyse par conversation, quand le job actuel la décide, débitée au prix client, réservée à l'Entreprise. Un modèle
« léger » en Pro pour deviner une intention est hors proposition. Il ferait payer une demi-analyse, ou la ferait payer
sur notre clé, et il doublerait le catalogue d'intentions.

### Modèle de données et migrations

Deux colonnes sur `contacts` :

- `derniere_reponse_le` : le dernier message reçu ;
- `dernier_clic_le` : le dernier clic attribué.

Remplies par la migration comme `derniere_activite_le` en `0273` : agrégat avant l' `alter`, messages encore conservés
d'un côté, clics de l'autre. `derniere_activite_le` n'est pas recalculée. Les deux nouvelles ne reculent jamais. La
purge d'une fiche les remet à vide, au même endroit que `derniere_activite_le` (`src/crm/contact-store.pg.ts`).

Migration `avant`, `lock_timeout` 5 s. `recordInbound` et le clic sont des chemins chauds. L'ancien code ne nomme pas
les colonnes, il survit. Le code neuf les écrit au mieux, sans lever, comme `noterActivite` : une panne ne rejoue pas
le webhook Meta. La fiche rattrape la date au geste suivant. L'agrégat de la migration couvre le trou d'avant le
déploiement. Après, c'est le geste qui écrit.

Pas de table d'historique des analyses. « La dernière » reste la dernière.

Clés réservées : `segment_reponse`, `segment_clic`, `segment_clic_sans_reponse` (un nombre de jours), et, Entreprise,
`segment_commande_vs_analyse` avec une valeur fermée `aucune_apres`, `commande_apres`, `analyse_apres_commande`. Toute
autre valeur est refusée. `segment_clic_sans_reponse` exige le nombre de jours du clic. « Sans jamais répondre » est
`derniere_reponse_le is null`, pas « pas répondu dans les N jours ». Quelqu'un qui a répondu il y a un an n'est pas
dans « jamais ».

`activite_complete_since` reste. On ajoute `reply_complete_since` et `click_complete_since` si les deux stocks n'ont
pas la même profondeur : les messages conservés remontent à la rétention de l'offre, les clics à 730 jours. Le dire,
sinon « n'a jamais répondu » est faux pour un message déjà purgé dont le clic, lui, est encore là. Recommandation :
« n'a jamais répondu » veut dire « aucune réponse depuis `reply_complete_since` », et l'outil le dit. On ne prétend
pas à l'éternité.

### Webhooks et scopes

Aucun webhook Shopify, aucun scope. Les signaux sont déjà chez nous. Le chantier 7 ne dépend pas des chantiers 1, 2
et 4 pour les critères de clic et de réponse. Il en dépend pour « tel produit, et mécontent » : ça, c'est le lot 1a
plus ce critère. L'ordre de la feuille de route le permet sans le bloquer.

### Impact UI, MCP, API

Console :

- Pro : dans « Achats et activité », séparer « a écrit » et « a cliqué ». Garder « actif » tel quel, pour les brouillons
  déjà enregistrés. Ajouter « a cliqué sans jamais répondre » ;
- Entreprise : la section « Dernière analyse » existe. On y ajoute le rapport à la dernière commande (aucune après
  l'analyse, une commande après, l'analyse après la dernière commande). On ne crée pas un assistant de segment.

MCP, `find_contacts` et la cible commune :

- `replied_within_days`, `clicked_within_days`, `clicked_without_reply_days` : entiers, bornes de `BORNES_SEGMENTS`,
  annoncés dans le schéma. Ouverts avec `console`, donc Pro. Pas d'`analyse` ;
- `order_vs_analysis` : énumération fermée, refusée sans la fonction `analyse` ;
- la description donne les trois exemples, avec la limite sur « délai de livraison » et sur « dernière analyse
  seulement ». Elle rappelle `reply_complete_since`.

Campagnes : rien à part. Un filtre de la liste est un filtre de campagne. Le récapitulatif de `prepare_campaign` montre
les critères, comme il montre déjà les autres.

API publique : pas dans ce chantier.

### Cas limites

- Clic puis réponse : hors de « sans jamais répondre ». C'est le sens de « jamais ».
- Réponse puis clic : dans « a cliqué », pas dans « sans jamais répondre ».
- Jamais rien fait : dans « inactif », pas dans « a cliqué sans répondre » (il n'a pas cliqué).
- Analyse sans date de commande, boutique absente : `order_vs_analysis` est refusé, comme un critère de commande sans
  boutique. Sinon « aucune commande après l'analyse » viserait tout l'espace.
- Fiche analysée, conversation purgée ensuite : les colonnes d'analyse survivent, c'est déjà le cas. Le croisement
  aussi.
- Deux analyses : on n'en a qu'une. Le filtre ne promet pas la conversation d'il y a trois mois si une plus récente a
  écrasé la fiche.
- Bouton « où est ma commande » : c'est une réponse, pas un clic, et l'intention probable est `suivi_commande`, donc
  quelqu'un qui a déjà commandé. Le critère Pro « a répondu et n'a pas commandé » ne le retient pas si la commande est
  connue. Cohérent.

### RGPD et consentement

Aucune donnée nouvelle venue de Shopify. Deux dates de plus sur la fiche, du même ordre que `derniere_activite_le`,
effacées avec elle. Pas de conservation au-delà : la date survit à la purge des messages, comme aujourd'hui, et part
avec la fiche.

Pas de nouvel appel de modèle, donc pas de débit de crédit supplémentaire, ni côté client ni sur la clé maison. Le
croisement Entreprise lit des colonnes déjà produites pour l'offre qui les a payées. On ne fait pas tourner l'analyse
en Pro « un peu ».

Un filtre n'envoie rien. Le consentement marketing reste celui de la campagne.

### Effort et lots

| Lot | Contenu | Effort |
|---|---|---|
| 7a | Deux dates, trois critères Pro, console, MCP, phrases de complétude. Coût IA nul | M |
| 7b | Rapport temporel commande / dernière analyse, Entreprise seulement | S |

7a est un M à cause des deux chemins chauds, de la migration de remplissage et des trois portes (filtre, console,
MCP). 7b est un S : une clé, une clause, un contrôle, un refus d'offre. Le chantier n'est pas un L.

## Feuille de route

L'ordre privilégie ce qui ne demande aucun redéploiement de l'app du marchand, et ce qui rend un segment vrai plus tôt.

| Ordre | Lot | Dépend de | Pourquoi là |
|---|---|---|---|
| 1 | 1a, lignes et filtres produit | rien | Le corps `orders/paid` a déjà les lignes. Vente croisée et réassort, depuis le branchement, sans scope nouveau. |
| 2 | 7a, réponse et clic séparés | rien | Indépendant de Shopify. « A cliqué sans jamais répondre », Pro, sans IA. Peut partir en parallèle de 1a. |
| 3 | 2a, rattrapage 60 jours | 1a | Même scope qu'aujourd'hui. Remplit les lignes sur le passé récent. Rend l'onglet fiche honnête, y compris en Free. |
| 4 | 4a, étiquettes Shopify en lecture | rien d'autre que `read_customers`, déjà là | Le marchand retrouve ses étiquettes sans les mélanger aux nôtres. Pas de webhook. |
| 5 | 2c, fiches d'acheteurs | 2a, et la règle des numéros | Pro. Numéro utilisable seulement. Un second `131026` sans message entrant purge la fiche et rend la place. |
| 6 | 2b, 24 mois | 2a | Demande `read_all_orders` et un redéploiement. À grouper avec 1b et 4b pour ne faire approuver l'app qu'une fois. |
| 7 | 4c, segments natifs | 4a pour le lien client | Le marchand coche jusqu'à 20 segments. Asynchrone à prévoir dès ce lot. |
| 8 | 1b, collections | 1a, et le redéploiement de 2b si on groupe les scopes | `read_products`. Sémantique « collection actuelle », dite dans l'écran. |
| 9 | 7b, temps de l'analyse | 7a utile, pas requis | Entreprise. Petit. Peut monter dès que 7a est là, sans attendre Shopify. |
| 10 | 4b, webhooks d'étiquettes | 4a | Fraîcheur sous la journée. Inutile tant que la reprise quotidienne suffit. |

En parallèle, sans se gêner : 1a et 7a. Puis 2a. Le groupe « le marchand redéploie » (2b, 1b, 4b) part dans une seule
mise à jour de la skill et un seul lien d'installation, même si les lots de code sont séparés. Une approbation par
boutique, pas trois.

Gains rapides, dans l'ordre : **1a**, **7a**, **2a**. Les trois tiennent avec les scopes déjà installés. 1a et 2a
donnent la vente croisée et le réassort sur 60 jours. 7a donne le signal conversationnel que le Pro peut avoir sans
payer une analyse.

Ce qui attend volontairement : les remboursements, l'appartenance à une collection au jour du paiement, l'historique
des analyses, une intention « délai de livraison », les webhooks de segment, la copie automatique des étiquettes.

Ordre de mise en production, pour chaque lot qui touche la console : la console ne montre un critère que si
`GET .../contacts/segments` l'annonce. Un critère qui atteint une API plus ancienne ne trouve personne. Le même filet
que le lot du 2026-10-31. La migration qui ajoute une colonne écrite par un chemin chaud part en `avant`.

## Questions ouvertes

1. **Julien, fiches d'acheteurs.** On n'en pré-crée pas jusqu'au plafond. Seul un numéro utilisable, et seulement parce
   qu'un template part. Au second `131026` sans message entrant, la fiche est purgée et la place revient. La Free n'a
   pas cette action. Est-ce le levier Pro voulu, ou la création d'acheteurs doit-elle rester l'import des abonnés
   marketing ?
2. **Julien, consentement.** Un achat ne pose pas `opted_in`, y compris quand Claude Code lance l'action. Ça diverge
   de l'import des abonnés depuis Claude Code, qui pose l'accord sous attestation. On confirme la divergence ?
3. **Julien, étiquette des fiches créées.** « Acheteur Shopify », pour ne pas rejoindre en silence l'étiquette
   « Shopify » de l'import d'abonnés. Autre nom, ou la même étiquette ?
4. **Julien, 24 mois.** `read_all_orders` pourrait tout lire. On borne à 24 mois. Plus court (12) ou plus long ?
5. **Julien, remboursements.** On continue de ne pas les déduire, produits compris. Le rouvrir oblige un sujet de plus
   (`refunds/create` ou `orders/updated`) et un redéploiement chez chaque marchand. On le laisse fermé ?
6. **Mesure, 60 jours.** Sur l'app de la boutique de développement, une commande créée il y a plus de 60 jours est-elle
   lisible avec `read_orders` seul ? La page des scopes dit non. Un employé Shopify, sur le forum, a dit oui pour une
   app d'organisation marchande. La mesure tranche avant d'ajouter `read_all_orders`.
7. **Mesure, `line_items`.** Confirmer sur un vrai `orders/paid` en `2026-10` que `product_id`, `variant_id` et `sku`
   sont dans le corps que nous recevons. La doc dit que le corps est la ressource REST entière. On ne l'a pas remesuré
   depuis le lot 0 du connecteur.
8. **Collections.** « Telles qu'elles sont aujourd'hui » est la recommandation. Faut-il, plus tard, un instantané au
   moment où nous lisons le produit après le paiement, sachant que le rattrapage ne pourra jamais le reconstruire ?
9. **Cartes cadeaux.** Écartées des filtres produit, la commande restant comptée. On les inclut plutôt ?
10. **Plafond de lignes.** 250 par commande, avec un drapeau si le corps en avait plus. Autre plafond ?
11. **Segments suivis.** 20 par espace. La liste lue peut en montrer jusqu'à 250. Autre maximum ?
12. **Webhooks de segment.** On ne s'abonne pas à `customer.joined_segment` tant qu'on n'a pas mesuré le volume et
    trouvé un filtre par segment. On valide cette prudence ?
13. **Intention « délai de livraison ».** On ne l'ajoute pas. Le critère Entreprise dit `information` ou `achat`, et
    aucune commande après l'analyse. Un code de plus est une migration de CHECK et un prompt. On le veut ?
14. **`customers/data_request`.** L'e-mail aux admins doit-il, dans le lot 1a, lister les produits achetés, ou un lot
    RGPD à part s'en charge ? Aujourd'hui cet e-mail ne détaille pas les commandes.
15. **Fusion de clients Shopify.** Sans `read_customer_merge`, une fusion casse le lien `client_id` jusqu'à la reprise
    par téléphone. On l'accepte pour ces lots ?
16. **API publique.** Ces critères restent ceux de la console et du MCP. On confirme qu'aucun filtre `/v1` ne part
    dans ces lots ?
17. **Business.** Même profondeur et mêmes actions que le Pro, avec 5 000 contacts, sans l'analyse. On confirme qu'on
    ne lui réserve pas une fenêtre d'historique plus longue ?
18. **Julien, purge après `131026`.** On purge la fiche née de l'envoi Shopify si la personne n'a jamais écrit, pour
    ne pas remplir le plafond. On garde une fiche qui existait déjà, avec le verdict `non`. On ne garde pas de liste
    de numéros. Un condensat illisible, sur le modèle de l'empreinte STOP, éviterait de recréer la même fiche à la
    commande suivante. On le veut, ou le réessai à la prochaine commande suffit ?
19. **`131026` n'est pas seulement « pas sur WhatsApp ».** La doc Meta cite aussi les conditions non acceptées et une
    application trop ancienne. La péremption à 90 jours reste. On confirme qu'on ne traite pas ce code comme un refus
    définitif à vie ?
20. **Fixes.** `estUnFixe` est appliqué au chemin Shopify (aujourd'hui HubSpot seulement) : un fixe est sauté, le
    candidat suivant est essayé. On confirme ?
21. **Plafond et fiches déjà injoignables.** Elles restent dans les 100, 1 000 et 5 000. Seules les fiches purgées
    par la règle 18 en sortent. Faut-il, plus tard, ne plus compter un verdict `non` frais ?
22. **Import des abonnés déjà en production.** Il crée une fiche sur un E.164 sans demander à Meta. Cette spec ne le
    change pas. Le même second `131026` doit-il le rattraper dans un lot à part ?
23. **Ventes sans contact.** `ventes_attribuees` peut garder l'identifiant de commande et le montant, sans téléphone,
    quand la preuve UTM existe. On le laisse. On confirme qu'aucun carnet ne se reconstruit depuis cette table ?
24. **Le pourcentage.** X = commandes livrées au moins une fois / commandes reçues, avec les quatre parts (sans numéro
    utilisable, pas encore éprouvé, livrée, non livrée). La définition convient-elle au marchand ?

## Sources

Doc Meta, pour le `131026` :

- [Error codes, Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes) : `131026`,
  « Unable to deliver message » (numéro pas sur WhatsApp, conditions non acceptées, ou application trop ancienne).

Doc Shopify, lue pour cette spec :

- [Access scopes](https://shopify.dev/docs/api/usage/access-scopes), en particulier Orders permissions, Protected
  customer data, et Checking granted access scopes.
- [GraphQL Admin API rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits).
- [Bulk operations](https://shopify.dev/docs/api/usage/bulk-operations/queries), citée comme suite si la pagination ne
  tient pas, sans en figer ici la mutation.
- [Webhook delivery structure](https://shopify.dev/docs/apps/build/webhooks/delivery-structure).
- [Order, REST](https://shopify.dev/docs/api/admin-rest/latest/resources/order), propriétés de `line_items`.
- [Order, GraphQL](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order), fenêtre de 60 jours et `lineItems`.
- [product](https://shopify.dev/docs/api/admin-graphql/latest/queries/product), `collections`.
- [collections](https://shopify.dev/docs/api/admin-graphql/latest/queries/collections), `collection_type` `custom` et
  `smart`.
- [Changelog, selling_plan_id](https://shopify.dev/changelog/posts/orders-webhooks-now-include-selling_plan_id-on-line-items),
  API `2026-10`.
- [Changelog, webhooks client](https://shopify.dev/changelog/posts/new-customer-s-webhook-and-changes-to-existing-customer-s-webhooks-payload),
  API `2025-01`, retrait de `tags`.
- [WebhookSubscriptionTopic](https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic).
- [Référence des webhooks](https://shopify.dev/docs/api/webhooks/latest), exemples `customer.tags_added` et
  `customer.joined_segment`.
- [Manage customer segments](https://shopify.dev/docs/apps/build/marketing/customer-segments/manage).
- [customerSegmentMembers](https://shopify.dev/docs/api/admin-graphql/latest/queries/customerSegmentMembers).
- [Migrate to async segmentation queries](https://shopify.dev/docs/apps/build/marketing/customer-segments/migrate-to-async-queries).
- [customerSegmentMembersQueryCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/customerSegmentMembersQueryCreate).

Fils d'employés Shopify, cités comme tels et non comme la doc de référence quand ils divergent :

- [Champs des webhooks de commande](https://community.shopify.dev/t/which-order-fields-change-in-each-webhook-event-orders-create-vs-orders-paid-vs-orders-fulfilled/27018),
  Liam, 2025-12-12.
- [customer.tags_added absent de la REST](https://community.shopify.dev/t/cannot-create-customer-tags-added-webhook/24556),
  Donal, 2025-10-29.
- [read_all_orders selon le type d'app](https://community.shopify.dev/t/read-all-orders-through-admin-api/28964),
  janvier 2026. La page des scopes prime tant que la mesure du point 6 n'est pas faite.

Code et docs du dépôt cités dans le texte : `src/shopify/donnees.ts`, `attribution.ts`, `traitement.ts`, `clients.ts`,
`abonnements.ts`, `store.pg.ts`, `src/crm/segments.ts`, `src/crm/contact-filters.ts`, `src/mcp/cible.ts`,
`src/mcp/outils-campagnes.ts`, `src/offres/offres.ts`, `web/lib/partage/segments.ts`,
`web/components/FiltresAchatsActivite.tsx`, `plugin/skills/shopify/SKILL.md`, migrations `0246`, `0273`, `0299`,
`features.md`, et la spec du 2026-10-31.
