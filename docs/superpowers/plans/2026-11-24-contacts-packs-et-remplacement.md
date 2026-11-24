# Packs de contacts du Pro, et remplacement des plus anciens en Business et Entreprise

Décisions de Julien du 2026-11-24, prises à partir de la limite de 10 000 contacts posée sur MUTAC (« que se passe-t-il au
10 001e ? »). Aujourd'hui, un espace plein refuse : les créations (import, console, API, MCP, scénario) partout, et
l'inconnu qui écrit en Free, Pro et Business (`contactsToutesOrigines`, `src/webhooks/espace-plein.ts`).

## Décisions

**Pro : des packs, jamais d'effacement.**
- Un pack ajoute **1 000 contacts**. Il coûte **20 € HT par mois sur un Pro mensuel, et 240 € HT par an sur un Pro annuel**,
  sans remise annuelle. Il est vendu en quantité sur l'abonnement Stripe du Pro, sur le modèle des sièges
  (`src/stripe/sieges.ts`).
- Le retrait d'un pack est **refusé** si les contacts comptés ne tiennent plus dans la limite restante. Il n'est pas
  remboursé et rien n'est effacé : le client fait d'abord le ménage.
- **Le Pro seulement**. Le Business ne reçoit pas de packs.

**Business et Entreprise : l'option « le plus ancien laisse sa place ».**
- Désactivée par défaut, et le comportement actuel ne change pas. Elle se règle à deux endroits : par un administrateur de
  l'espace dans Réglages, et par l'exploitation dans la fiche d'offre de `/ops`.
- Espace plein et option active : chaque nouveau contact compté fait **purger le contact compté le plus ancien en
  création** (`created_at`, puis `id`), autant de fois qu'il faut.
- **Aucun contact n'est protégé**, ni en plein scénario, ni visé par une campagne programmée, ni en STOP (son refus
  survit à la purge).
- **Toutes les entrées sont concernées, imports compris.** L'aperçu de l'import annonce le nombre de contacts qui seront
  effacés avant que le client confirme.
- L'Entreprise ne compte toujours que les contacts créés : chez elle, l'option ne joue que sur les créations, et un
  entrant n'est jamais refusé.
- L'effacement est la **purge existante** (`purgeMany`), irréversible. Chaque remplacement entre au **journal d'audit de
  l'espace** avec le nombre de contacts et leurs identifiants internes, **jamais leur numéro ni leur nom**, sinon le journal
  défait la purge.

## Méthode de livraison

**Implémenteur par lot, puis revue humaine du DIFF**, en deux lots. Les deux touchent à des chemins que la production
emprunte : le lot 1 à la facturation Stripe (un montant faux), le lot 2 à la réception des messages et à la purge
irréversible (une donnée perdue). Les invariants y sont invisibles : Stripe d'abord et la limite ensuite, un verrou par
espace, `ficheComptee`. Les critères se testent, mais il faut un œil sur les cas limites.

**Essai réel qui clôt chaque lot :**
- Lot 1 : sur un espace de test en Pro (Stripe en live, sans mode test), acheter un pack depuis la page Offre. La limite
  doit passer de 1 000 à 2 000 sur la page et dans `get_plan`, et la facture de prorata doit apparaître chez Stripe. Puis
  retirer le pack, refusé tant que plus de 1 000 contacts sont comptés.
- Lot 2 : passer un espace de test en Entreprise à 3 contacts par `/ops`, activer l'option dans Réglages, puis créer un
  4e contact dans la console. Le premier créé doit être purgé, et le journal doit montrer l'entrée sans numéro. Ensuite,
  importer un fichier de 2 contacts et lire l'aperçu, qui doit annoncer 2 effacements. Le cas de l'entrant en Business
  ne se joue pas en réel, faute d'un Business de test plein : il est prouvé par un test d'intégration sur le vrai `pg`
  (banc PGlite, puis job `integration`).

## Lot 1 : les packs de contacts du Pro

- **Migration** (`avant`, le webhook l'écrit) : `abonnements_offre.packs_contacts int not null default 0`. Son numéro se lit
  par `npm run migrations` (0316 et 0318 à 0320 sont réservés par les sessions voisines).
- **Les droits** : dans `droitsDe`, et là seulement, la limite de contacts du Pro gagne `1 000 × packs`, comme les sièges y
  gagnent des utilisateurs. Constantes `CONTACTS_PAR_PACK` et `PRIX_PACK_CONTACTS_HT_CENTIMES = { mois: 2000, an: 24000 }`
  à côté de `PRIX_SIEGE_HT_CENTIMES`. `offre.pg.ts` lit les packs avec les sièges.
- **Stripe** : `src/stripe/packs-contacts.ts`, calqué sur `sieges.ts`. Un pack à la fois, l'état de départ refuse une vue
  périmée, `pending_if_incomplete`, la limite suit ce que Stripe rend. Retrait refusé si les contacts comptés dépassent la
  limite restante. Deux prix : `STRIPE_PRIX_PACK_CONTACTS_MOIS` et `_AN`, vides = pas en vente (503
  `packs_contacts_indisponibles`). Le webhook (`traitement-abonnements.ts`) relit la quantité à chaque modification de
  l'abonnement.
- **Route** : `POST /tenants/:tenantId/offre/packs-contacts` à côté de `/offre/sieges` (`offre-paiement.ts`), plafond
  coûteux, payeur autorisé.
- **Écrans** : la vue de l'offre (`vue.ts`) rend `packsContacts { inclus, achetes, periodicite }`. La page Offre propose
  « Ajouter 1 000 contacts » et « Retirer », avec le prix de la formule. Le refus de limite d'un Pro (`phraseLimite`)
  propose le pack. `get_plan` (MCP) donne les packs, comme il donne les sièges.
- **Docs** : `features.md`, la fiche « Choisir mon offre » (empreinte et version `en/`, puis `vitrine:aide`), la page des
  tarifs de la vitrine (`tests/vitrine-pages.test.ts` vérifie ses chiffres) et le catalogue MCP.
- **Geste de Julien, avant la mise en vente** : créer chez Stripe, en live, deux prix récurrents sur un produit « Pack de
  1 000 contacts » (20 € HT par mois, 240 € HT par an), puis poser leurs deux identifiants dans le conteneur `mba-api` et le
  `.env.prod` de la machine des workers. Tant qu'ils sont vides, l'écran affiche « pas encore en vente ».
- **Tests** : sur le modèle de ceux des sièges : achat, refus de paiement sans aucun effet, webhook, retrait refusé et
  retrait accepté, limite lue par `droitsDe`. Plus la parité du prix entre le code, la vitrine et la fiche d'aide.

## Lot 2 : le remplacement des plus anciens (Business, Entreprise)

- **Migration** (`avant`) : `tenant_settings.contacts_remplacer_anciens boolean not null default false`.
- **Le réglage** : route d'espace réservée aux administrateurs, refusée hors Business et Entreprise. Dans Réglages, une case
  avec l'avertissement « irréversible : la conversation, les messages et l'analyse du contact le plus ancien sont
  effacés ». Dans la fiche d'offre `/ops`, la même case, tracée avec son auteur. Une offre qui redescend en Pro ou en Free
  ignore le réglage : il se lit avec l'offre (`limiteContactsDe` rend aussi `remplacer`).
- **Le mécanisme, à un seul endroit** : `PgContactStore.faireDeLaPlace(tenantId, n)`. Sous un verrou d'avis par espace,
  avec toutes les requêtes passées par le client qui tient le verrou : compter avec `ficheComptee`, choisir les `n` plus
  anciens, puis purger avec la même transaction que la purge. L'appelant crée ensuite. `listeAgent` se retire chez Meta
  après le `commit`, comme le fait `effacement.ts`.
- **Les chemins** : les trois gardes de création (`verifierPlaceContacts`, donc `upsertByPhoneReturningId`,
  `upsertManyByPhone` et `creerFicheApi`) font de la place au lieu de lever `LimiteOffreError` quand l'option est active.
  La porte de l'espace plein (`inconnusRefuses`, Business seulement) fait de la place au lieu d'écarter l'entrant. Un
  échec de remplacement laisse entrer l'entrant, puisqu'une limite commerciale ne coupe jamais la réception. Une création,
  elle, reste refusée.
- **L'aperçu des imports** (`placesContacts`, import CSV et clients Shopify) annonce « N contacts parmi les plus anciens
  seront effacés ».
- **Journal** : une entrée d'audit `contacts.remplaces` par opération, avec le nombre et les identifiants internes, signée
  du chemin (entrant, import, console, API, MCP, scénario).
- **Rayon de souffle, à vérifier dans le diff** :
  - Un numéro purgé entre dans `numeros_effaces`, donc le rattrapage Shopify (lot 5b) ne recrée jamais sa fiche.
  - Une campagne programmée garde ses lignes anonymisées.
  - Un parcours en cours est effacé avec le contact.
  - Le quota de suppressions du jour (Free seulement) ne s'applique pas.
  - Deux créations simultanées sur la dernière place ne purgent pas deux fois : c'est le rôle du verrou.
- **Docs** : `features.md`, une section de la fiche d'aide sur les contacts (fiche et empreinte), et le manuel (§ limite de
  contacts).
- **Tests** : unitaires (choix du plus ancien, Pro et Free jamais touchés, Entreprise sans entrant, journal sans numéro),
  intégration sur le vrai `pg` (verrou, ordre, purge et création, concurrence à la dernière place), e2e (case de
  Réglages, case de `/ops`, aperçu de l'import).
