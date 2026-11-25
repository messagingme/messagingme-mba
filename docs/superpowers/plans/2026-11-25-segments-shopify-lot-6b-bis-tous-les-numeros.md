# Segments Shopify, lot 6b bis : relier un client Shopify par tous ses numéros

Suite du lot 6b (`docs/superpowers/plans/2026-11-24-segments-shopify-lot-6b-etiquettes.md`, en production le
2026-11-25). Son essai réel n'a relié aucune fiche : la règle « le téléphone propre du client seulement »
(`defaultPhoneNumber`) ne trouve presque personne. Mesuré chez Shopify le 2026-11-25, en lecture seule : sur
Maison Saint-Honoré, 8 clients sur 94 ont un téléphone propre, 24 de plus l'ont sur la facturation de leur dernière
commande, 50 seulement sur leur adresse par défaut ; sur la boutique de « Messaging Me demo », les deux clients de
Julien ont son numéro sur leurs adresses enregistrées et sur leurs commandes, jamais dans leurs coordonnées. La
recherche `phone:` de Shopify les trouve bien (elle lit les adresses) ; notre revérification les écartait.

## Décisions de Julien (2026-11-25)

1. **« Le max de numéros »** : un client Shopify se relie par TOUS les numéros que Shopify connaît pour lui, d'où
   qu'ils viennent : ses coordonnées (`defaultPhoneNumber`) et chacune de ses adresses enregistrées (`addressesV2`, 10
   au plus). Mesuré après la relecture : la dernière commande n'apporte aucun numéro que les adresses n'ont pas (Shopify
   range celles du paiement dans le carnet du client), elle n'est pas lue. Une adresse ne se distingue plus
   d'un téléphone propre : « on est sur WhatsApp, on écrit à des numéros ». La règle du 6b « jamais par une adresse »
   est retirée.
2. **Une fiche porte les étiquettes de tous les clients qui ont son numéro**, et un client se relie à toutes les
   fiches de ses numéros. Plus de règle « deux clients au même téléphone ne relient rien » : ils se relient tous les
   deux (tranché ici, au plus près de la décision 1 : c'est le maximum de fiches étiquetées).
3. **Le geste du marchand recherche de nouveau toutes les fiches** : allumer, « Synchroniser maintenant » et
   `sync_shopify_customer_tags` effacent les marques des fiches déjà cherchées, puis cherchent chaque fiche qui a un
   numéro ; la relecture quotidienne ne cherche que les fiches jamais cherchées. Une recherche COMPLÈTE d'une fiche
   remplace ses liens (un numéro retiré chez Shopify défait le lien) ; une page incomplète n'en retire aucun.

Hors lot : le rattrapage du 5b crée toujours la fiche sur le numéro de l'acheteur (le client, puis la facturation),
jamais sur la livraison ; la question est posée à Julien à part.

## Schéma (migration 0326)

- `shopify_clients` devient une table de LIENS : clé primaire `(tenant_id, client_id, contact_id)` ; la contrainte
  `shopify_clients_contact_key` (une fiche, un client) disparaît.
- `shopify_etiquettes` porte le client qui a donné l'étiquette : colonne `client_id` (remplie depuis le lien existant,
  une ligne sans lien est retirée), clé primaire `(tenant_id, contact_id, client_id, etiquette)`, clé étrangère
  `(tenant_id, client_id, contact_id)` vers le lien, en cascade : un lien défait emporte ses étiquettes.
- `migration=avant` : le code neuf écrit `client_id`. L'ancien code, le temps de la bascule, échoue sur l'écriture des
  étiquettes d'une synchronisation (son `on conflict` ne trouve plus sa clé) : seul l'espace de démo en a une allumée,
  relue une fois par jour ; elle reprend au passage suivant. Le critère, la liste et l'onglet de la fiche ne nomment pas
  `client_id` : ils survivent aux deux versions. La purge et l'effacement du branchement suppriment par fiche ou par
  espace : inchangés, donc la migration n'est pas bloquante.
- `customers/redact` ne passe plus par ces liens (`contactsLies`, relecture du lot) : une fiche reliée par le carnet
  d'adresses du client peut être celle d'un proche, que son effacement ne doit pas purger. La fiche du client se retrouve
  par son numéro et ses commandes, comme avant le 6b ; ses liens partent (`oublierClientShopify`), ses étiquettes avec.

## Tâches

1. `etiquettes-lues.ts` : la recherche lit les numéros des coordonnées, des adresses (avec leur pays) et de la dernière
   commande ; chaque client rendu est revérifié sur cet ensemble ; tous les clients d'un numéro sont rendus.
2. `etiquettes.pg.ts` : liens plusieurs à plusieurs ; `demander` (le geste) efface les marques ; `aChercher` cherche
   aussi les fiches déjà reliées ; `ecrireRecherche` remplace les liens d'une fiche si la page était complète ;
   `ecrireClients` lit les étiquettes d'un client pour TOUTES ses fiches ; les étiquettes remplacées par couple
   fiche-client.
3. `etiquettes.ts` : le job passe `complete` ; textes.
4. `ventes.pg.ts` : l'onglet Shopify de la fiche dédoublonne les étiquettes de plusieurs clients.
5. Textes : fiche d'aide « Brancher ma boutique Shopify » (FR, EN, vitrine), `features.md` et l'empreinte de la fiche,
   `documentation.md`, description de `sync_shopify_customer_tags` (catalogue MCP et doc générée), skill shopify du
   plugin (version montée), carte Shopify.

## Tests

- Unitaires : la revérification (un numéro d'adresse au format national avec le pays de l'adresse, un client hors des
  numéros demandés écarté, deux clients pour un numéro rendus tous les deux, un client illisible qui rend la page
  incomplète, la borne du coût dérivée des constantes) ; le job (complete transmis) ; le faux magasin suit le modèle plusieurs à plusieurs.
- Intégration (vrai Postgres, banc PGlite avant la CI) : deux clients d'un numéro relient la fiche, qui porte l'union de
  leurs étiquettes ; un client de deux numéros relie les deux fiches ; la lecture d'un client ne touche pas les
  étiquettes de l'autre client de la même fiche ; un client disparu défait tous ses liens et rend ses fiches à
  chercher ; une recherche complète défait un lien périmé, une incomplète non ; le geste efface les marques, la
  relecture quotidienne non ; la cascade de la fiche et du lien.
- Chaque garde vérifiée dans les deux sens par mutation scriptée.

## Méthode de livraison

**Implémenteur par lot + revue humaine du DIFF**, l'implémenteur étant moi, parce que c'est le chemin que la production
emprunte (la synchronisation écrit les liens et les étiquettes qui ciblent les campagnes), que la migration change deux
clés primaires et ajoute une cascade, et que le code porte des invariants invisibles (les marques, le bail, le verrou
des fiches). Mutations scriptées, UNE relecture indépendante en fin de lot, Julien approuve le déploiement. L'essai réel
qui clôt le lot est celui de son premier essai manqué, rejoué : la fiche de Julien reliée à ses deux clients Shopify.

## Déploiement et essai réel

Un seul déploiement, `migration=avant` (0326), puis la migration relue en base et le vrai code joué en lecture seule ;
l'aide se charge au déploiement ; le plugin après l'API. **L'essai réel qui clôt le lot** : sur « Messaging Me demo »,
« Synchroniser maintenant » ; la fiche de Julien est reliée à ses deux clients et porte « VIP » et « VIP MM » ; le
filtre « Étiquette Shopify : VIP » la retient, elle seule ; « Copier en étiquette Messaging Me » pose « VIP » sur elle.
