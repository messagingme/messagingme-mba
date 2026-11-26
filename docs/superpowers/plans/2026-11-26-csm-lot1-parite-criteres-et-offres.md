# Lot 1 du CSM virtuel : la parité des critères, les routes Business et Entreprise, le chantier Shopify tranché

Demande de Julien (2026-11-26) : « il faut être super rigoureux pour qu'on n'oublie rien à terme, comme on va devoir tout
coder et pas que faire grâce à la console ». Suite de B1 (`2026-11-24-csm-lot1-b1-parite.md`), qui tient les adresses et
le corps des routes d'écriture. Trois trous relevés en relisant ce que la session des segments Shopify avait livré.

## Les trois trous

1. **Les critères d'une route de lecture.** `GET /contacts` était servie par `find_contacts` sans `reste`, alors que la
   cible MCP ne sait poser ni l'exclusion d'une étiquette, ni la joignabilité, ni le risque, ni un champ personnalisé, ni
   un nom ou un numéro combinés aux autres critères. La parité des champs ne lit que le corps des routes d'écriture :
   personne ne pouvait le voir.
2. **Les routes Business et Entreprise.** L'inventaire les écarte en mesurant l'offre, et le plan B1 les renvoie au lot 7
   « sans liste écrite à la main ». Il y en a 116 : rien ne les nommait, le lot 7 aurait dû les retrouver de mémoire.
3. **Le chantier Shopify « à part ».** Dix routes portaient `exclue('Shopify : chantier à part')`. Le chantier des
   segments Shopify est fini le 2026-11-26 : l'exclusion ne disait plus rien de vrai.

## Ce qui est livré

- `tests/parite/criteres.ts` et `tests/parite-criteres.test.ts` : chaque critère que la console sait poser (les clés de
  `ContactFilters`, les deux familles de champs, chaque clé de segment) a son argument MCP, ou un `aFaire` B10 qui dit
  quoi exposer. La liste se DÉRIVE du code ; chaque argument nommé existe dans `find_contacts` et `prepare_campaign`, et
  `lireCibleMcp` le traduit vraiment dans son critère (un exemple par argument). `GET /contacts`, `/contacts/count` et
  `/contacts/ids` portent désormais un `reste` qui renvoie à cette table.
- `tests/parite/offres-superieures.ts` et `tests/parite-offres-superieures.test.ts` : les 116 routes fermées au Pro, une
  par une, avec ce qu'un outil devra en exposer au lot 7. Aucune route dans les deux tables : avec `ADRESSES`, chaque
  route de console a une ligne, et une seule.
- Les dix routes Shopify tranchées dans `ADRESSES` : `set_shopify_message` sert l'interrupteur d'une automation et son
  délai ; l'attestation est servie en partie (l'outil l'enregistre, il ne sait pas la retirer) ; ce que le volet
  annonce, par `get_shopify_state` et la réponse de `find_contacts` (les dates du suivi) ; les produits, les collections
  et les étiquettes Shopify en partie (l'outil rend les 20 ou les 50 premiers, sans la recherche de la console) ; la pause
  de la boutique et les achats d'une fiche sont des `aFaire` B10 ; la route des messages, qui répond 410, est exclue.
  Leurs trois corps entrent dans la parité des champs (trois schémas de `src/http/shopify.ts` reçoivent `export`), qui a
  trouvé un écart neuf : l'`agent_id` de `set_shopify_message` n'annonce pas le format uuid que la route exige.

## Tests

Les deux gardes sont vérifiées dans les deux sens par huit mutations scriptées, toutes rouges, chaque fichier restauré à
l'identique (md5) : un critère retiré, un critère ajouté au modèle commun, une clé de segment ajoutée, un argument mal
relié, un argument inexistant, une route Business retirée, une entrée morte, une route dans les deux tables.

## Déploiement

Rien ne part en production : des tests, et le mot `export` devant trois schémas existants. La CI `unit` suffit.

## Méthode de livraison

En direct, sans agent : ce sont des tables de tests et des exports, réversibles par un commit, qu'aucun chemin de
production n'emprunte. L'essai réel qui clôt l'étape est la mutation de chaque garde (voir Tests), et la relecture des
décisions Shopify par Julien, qui reste libre de transformer un `aFaire` en exclusion.
