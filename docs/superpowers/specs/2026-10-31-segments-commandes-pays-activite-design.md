# Les segments sur les commandes, le pays et l'activité (design)

Cadré avec Julien le 2026-10-31, en trois rondes de questions. C'est le premier des manques restants de la comparaison
avec les MCP de Wax et de Kanal (`todo.md`, « Le MCP face à Wax et Kanal ») : les deux savent répondre à « mes clients
qui ont commandé deux fois en 90 jours », « mes clients belges », « ceux qui n'ont rien dit depuis trois mois ». Notre
`find_contacts` ne sait cibler que par étiquettes, consentement et, en Entreprise, la dernière analyse.

## Pourquoi

Un e-commerçant pense ses envois en segments d'achat et d'activité : les fidèles, les clients qui ne reviennent plus,
les inactifs à relancer, un pays pour une promotion locale. Sans ces critères, l'assistant doit lire les conversations
une à une, ce qu'il ne peut pas faire sur 5 000 contacts. **Un segment reste une étiquette** : on trouve
(`find_contacts`), on étiquette (`tag_contacts`), on cible l'étiquette (`prepare_campaign`). Les nouveaux critères
entrent dans la cible commune, donc les quatre outils qui la prennent (`find_contacts`, `tag_contacts`,
`set_contact_field`, `prepare_campaign`) les reçoivent d'un coup, et la console aussi.

**Succès** : sur la boutique de développement de l'espace de démonstration, après une commande de test payée par Julien,
l'assistant trouve le contact par « au moins une commande dans les 7 derniers jours », par son pays et par son activité,
l'étiquette, et la console montre le même compte avec les mêmes critères dans la liste des contacts.

## Décisions de Julien (2026-10-31)

1. **Quatre critères** : les commandes Shopify (nombre sur une période, date de la dernière), le montant dépensé, le pays
   par l'indicatif du numéro, l'activité.
2. **Chaque commande payée est enregistrée à sa réception** (date, montant), que le message de confirmation soit branché
   ou non. L'historique commence au déploiement, plus ce que nous avons déjà. Pas de rattrapage lu chez Shopify dans ce
   lot.
3. **L'activité, ce sont les messages reçus du contact ET ses clics sur nos liens tracés.**
4. **MCP et console ensemble**, dans le même chantier.
5. **Offre : Pro et au-dessus**, comme `find_contacts` et la liste des contacts aujourd'hui (fonction `console`). Rien
   de plus à garder.
6. **La date de dernière activité est écrite sur la fiche**, à chaque message reçu et chaque clic attribué, et remplie au
   déploiement depuis l'existant : la conservation des conversations (90 jours par défaut, réglable par espace) efface
   les messages, et un calcul sur eux classerait inactif quelqu'un qui a écrit il y a quatre mois.
7. **Travail dans une copie à part du code**, publiée sur `main` par plomberie (le dossier partagé porte le travail
   d'autres sessions).
8. **Essai réel** : Julien paie une commande de test sur la boutique de développement après le déploiement ; Claude fait
   le reste par le vrai MCP et la console.
9. **Les commandes de test comptent** comme les autres (un segment sert à cibler, pas à faire un chiffre), à l'inverse
   du chiffre d'affaires attribué. Le drapeau `test` est gardé sur la ligne.
10. **Une commande payée puis remboursée ou annulée reste comptée** : nous n'écoutons que `orders/paid`, et l'outil le
    dit (« commandes payées, remboursements non déduits »). S'abonner aux annulations obligerait chaque marchand à
    redéployer l'app de son organisation.

## Mes choix (à relire)

- **Une seule notion d'activité** : « a écrit ou cliqué ». Deux critères : actif dans les N derniers jours, et inactif
  depuis N jours, qui **inclut les contacts jamais actifs** (un contact importé qui n'a jamais rien fait est bien
  inactif). Tout message reçu compte, un appui de bouton et une réaction compris.
- **Le montant est dans la devise de la boutique** (`montantBoutique`, déjà utilisé par l'attribution) : une boutique par
  espace, donc une devise.
- **Les commandes connues** : chaque commande payée reçue depuis le déploiement, plus les lignes que `shopify_commandes`
  a déjà (les commandes qui ont déclenché un message), datées et chiffrées par `ventes_attribuees` quand elle les
  connaît, sinon datées de leur réception et sans montant. L'outil rend la date depuis laquelle **toutes** les commandes
  sont suivies (`orders_recorded_since`) : un « aucune commande » ne doit pas faire croire à « n'a jamais acheté ».
- **Un critère de commande sans boutique est REFUSÉ par l'outil**, avec le renvoi vers `get_shopify_state` : sans ce
  refus, « au plus 0 commande » viserait tout l'espace. La console ne propose ces critères que si une boutique est
  connue de l'espace.
- **Une boutique coupée garde son historique et ses critères** : ses commandes restent, mais plus rien n'entre ; l'outil
  rend alors aussi la date de la coupure. **Un rebranchement remet la date de début du suivi complet à ce jour-là** (le
  trou de la coupure est dit, pas caché). **Chaque commande garde sa devise** : si l'espace change de boutique et de
  devise, la dépense ne somme que les commandes dans la devise de la boutique actuelle ; le nombre de commandes, lui,
  les compte toutes.
- **L'activité d'avant le déploiement n'est connue que par ce qui restait** : les messages encore conservés par l'espace
  et les clics (gardés deux ans). L'outil rend la date depuis laquelle l'activité est complète (le déploiement), comme
  pour les commandes, pour qu'« inactif depuis 180 jours » ne se lise pas comme une certitude au lendemain du lot.
- **Une commande dont la fiche naît du message de confirmation** se complète au passage du message (la ligne écrite
  après l'envoi reçoit aussi sa date et son montant) : sinon le premier achat d'un nouveau client ne compterait pas.
- **La fenêtre entre la migration et le déploiement de l'API** (quelques minutes) n'est pas rattrapée : les commandes
  payées pendant ces minutes et sans message branché manquent, l'activité de ces minutes se rattrape au prochain message
  ou clic du contact. Dit dans le journal.
- **Effacement Shopify** (décision de Julien du 2026-11-03, après la relecture) : `customers/redact` purge toute fiche
  liée aux commandes nommées, y compris une fiche liée seulement pour les segments, comme avant pour les fiches à qui
  l'on avait écrit.
- **Seules les fiches existantes reçoivent leurs commandes** : une commande dont le téléphone ne correspond à aucune
  fiche n'est pas gardée (aucune fiche créée, aucun numéro d'inconnu conservé). Une fiche créée plus tard ne récupère
  pas ses commandes passées.
- **Le pays, côté MCP, se dit en code ISO** (`FR`, `BE`), traduit en indicatif par `libphonenumber-js` (déjà dans les
  dépendances). Plusieurs pays = l'un d'eux. Un indicatif partagé (+1 États-Unis, Canada et Caraïbes, +7 Russie et
  Kazakhstan, +44 Royaume-Uni et îles anglo-normandes) ne se cible que par son pays principal, qui les vise tous ; un
  autre pays de l'indicatif est refusé en nommant le principal (relecture du lot : cibler PR aurait visé les États-Unis). Chaque contact rendu porte son pays
  (`country`, lu sur son numéro). **La console garde son champ « Téléphone commence par »**, qui fait déjà ce travail.
- **Les bornes** : périodes de 1 à 3 650 jours, nombre de commandes de 0 à 1 000, montant de 0 à 10 000 000, 20 pays au
  plus. Toutes annoncées dans le schéma de l'outil (règle du dépôt sur les bornes).

## Les données

### Les commandes (`shopify_commandes`, étendue)

La table existe (migration 0246) : une ligne par commande, sa fiche, son client Shopify ; elle sert aujourd'hui à
retrouver la fiche d'une demande d'effacement. Elle reçoit la date de paiement, le montant, la devise et le drapeau
`test` :

- **À la réception de `orders/paid`**, quelle que soit la suite (message branché ou non, téléphone ou non) : si le
  téléphone de la commande désigne une fiche de l'espace, la ligne s'écrit ou se complète. **Jamais un frein** : comme
  l'attribution, une panne ici ne bloque ni la confirmation ni ne fait réessayer Shopify.
- `fulfillments/create` continue d'écrire sa ligne comme aujourd'hui, sans écraser une date ou un montant connus.
- **La migration remplit l'existant** depuis `ventes_attribuees` (date et montant par `commande_id`), sinon la date de
  réception, et pose sur chaque boutique la date du début du suivi complet (`now()` à la migration, puis à chaque
  connexion ou rebranchement).
- Rien ne change à la purge : `purgeMany` efface déjà les lignes de la fiche, la déconnexion de la boutique aussi. Une
  boutique coupée n'écoute plus `orders/paid`, donc n'écrit plus rien.

### La dernière activité (`contacts`, nouvelle colonne)

- Écrite par les deux seuls chemins concernés : le message reçu (`recordInbound`, WhatsApp et RCS) et le clic attribué
  (`recordClick` avec un contact). Elle ne recule jamais.
- Remplie par la migration depuis les messages reçus encore conservés et les clics attribués.
- **La purge d'une fiche la remet à vide**, avec les autres colonnes qu'elle efface.

### Le pays

Rien à stocker : un préfixe du numéro E.164, servi par l'index qui sert déjà « Téléphone commence par ».

## Les critères (contrat commun)

Ils voyagent dans `fieldFilters`, sous des clés réservées (`segment_commandes`, `segment_depense`,
`segment_derniere_commande`, `segment_actif`, `segment_inactif`, `segment_pays`), l'opérateur `segment` et leur valeur en
JSON (`web/lib/partage/segments.ts`), donc par les deux analyseurs (le fil GET de la liste et le corps d'une action en
masse ou d'une campagne), la sérialisation de la console, la reprise d'un brouillon de campagne et le `WHERE` de
`buildContactWhere`. Chaque sous-requête porte `tenant_id = $1` : c'est le seul contrôle d'isolation (le rôle de
l'application contourne la RLS).

🔴 **Pas de membre neuf de `ContactFilters`** (corrigé pendant la construction, la règle des filtres d'analyse, amendement
6 du 2026-10-01) : un serveur plus ancien IGNORERAIT un membre neuf, et un brouillon de campagne repris pendant un retour
arrière de l'API partirait à tout l'espace. Un serveur ancien qui reçoit `segment_commandes` le cherche dans le jsonb des
champs perso, où il n'est jamais : il ne trouve personne. Les clés sont réservées (`estCleReservee`) : aucun champ perso
ne peut les prendre. Une liste de plus de 20 filtres de champ qui porte un segment est refusée, jamais tronquée.

| Critère | Sens |
|---|---|
| Commandes | nombre de commandes connues, au moins et/ou au plus, sur les N derniers jours ou depuis le début du suivi |
| Dépense | somme de leurs montants connus, au moins et/ou au plus, même période |
| Dernière commande | il y a au moins et/ou au plus N jours ; exige une commande connue |
| Actif | dernière activité dans les N derniers jours |
| Inactif | aucune activité depuis N jours, jamais actif compris |
| Pays | le numéro commence par l'indicatif de l'un des pays |

Un critère malformé (borne hors plage, minimum au-dessus du maximum, pays inconnu, objet vide) est **refusé**, jamais
ignoré : ignoré, il élargirait l'audience, et une campagne construite dessus partirait à tout l'espace.

## L'outil MCP

`find_contacts` (et par la cible commune `tag_contacts`, `set_contact_field`, `prepare_campaign`) annonce les nouveaux
paramètres en anglais, comme les autres : `orders`, `spent`, `days_since_last_order` (objets `min`, `max`, et
`within_days` pour les deux premiers), `active_within_days`, `inactive_for_days`, `countries`. La description dit les
exemples de Julien (« two orders in 90 days », un pays, « no activity since »), que la dépense est dans la devise de la
boutique, que ce sont des commandes payées (remboursements non déduits, commandes de test comprises), et ce qu'est une
activité. La réponse rend, quand le critère est posé, `orders_recorded_since` (et la date de coupure d'une boutique
coupée) et `activity_complete_since`.

## La console

Le panneau de filtres (partagé par la liste des contacts et le choix des destinataires d'une campagne) reçoit une partie
« Achats et activité » : l'activité toujours, les commandes, la dépense (avec la devise de la boutique) et la dernière
commande seulement si une boutique est branchée. Un filtre déjà posé reste visible pour être retiré.

## L'ordre de mise en production

Une console servie avant l'API (Vercel publie au push) ne propose aucun de ces critères : le panneau ne les montre que si
`GET .../contacts/segments` a répondu. Et un critère qui atteindrait quand même une API plus ancienne n'y trouve
personne (ci-dessus). L'ordre console/API est donc sans danger, et le lot part en un commit :

1. La migration, en `avant` : elle ajoute des colonnes que le code neuf écrit sur deux chemins chauds.
2. L'API et les workers ; la console part au même push, sa garde la tient muette jusqu'au déploiement.

## Hors de ce lot

- Le rattrapage de l'historique des commandes lu chez Shopify (60 jours sans un accès étendu).
- Un sélecteur de pays dans la console (le préfixe du numéro y suffit).
- Les critères d'achat sur les produits ou les collections (Shopify ne les envoie pas dans ce que nous gardons).
- Les clics anonymes (templates approuvés avant les jetons) : ils ne désignent personne.
- Les remboursements et les annulations (abonnements Shopify de plus, à redéployer chez chaque marchand).
- L'inactivité dans `prepare_contacts_deletion` et `delete_contacts` : la colonne de ce lot la rend possible, mais un
  effacement est irréversible et ouvert à la Free, et l'activité d'avant le déploiement n'est pas complète. Ces outils
  refusent toute clé inconnue, donc rien ne change pour eux.
