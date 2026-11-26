# Packs de contacts du Business, et alertes de contacts de l'Entreprise

Décisions de Julien du 2026-11-26, qui font suite au plan `2026-11-24-contacts-packs-et-remplacement.md` (lots 1 à 3 en
production le 2026-11-25). Deux manques relevés à la clôture : l'Entreprise ne reçoit aucune alerte de contacts, et ses
e-mails lui proposent une offre supérieure qui n'existe pas pour elle.

## Décisions

**Entreprise : pas de pack, « il nous contacte et on s'arrange ».**
- Elle reçoit les alertes à **80 % et à 100 %** de sa limite de contacts posée dans /ops, comme les autres offres. Sans
  limite, elle ne reçoit rien.
- Ses e-mails (les deux alertes, et le refus d'un contact quand l'espace est plein) disent « **contactez-nous** pour
  relever votre limite », jamais une offre supérieure ni un pack. Si l'option « le plus ancien laisse sa place » est
  cochée, l'alerte à 100 % dit qu'à partir de là, chaque nouveau contact efface le plus ancien.
- Les mêmes franchissements nous préviennent **sur Telegram**, pour qu'on appelle le client avant qu'il refuse des clients
  ou efface des contacts.

**Business : il achète des packs de 1 000 contacts par Stripe.**
- Le pack coûte **20 € HT par mois seulement**. C'est le prix mensuel déjà créé pour le Pro
  (`STRIPE_PRIX_PACK_CONTACTS_MOIS`), sans prix annuel. Il prend la forme d'un **abonnement Stripe à part**, sur le modèle
  de l'option ligne de crédit (`src/stripe/option-credit-whatsapp.ts`), puisque le Business n'a pas d'abonnement Stripe
  à lui.
- Sa limite devient : la limite posée dans /ops (ou les 5 000 de la grille) + 1 000 par pack. Le retrait d'un pack est
  refusé si les contacts comptés ne tiennent plus, sans remboursement.
- Ses alertes à 80 % et à 100 %, et son e-mail « espace plein », proposent le pack au lieu de l'Entreprise.

## Méthode de livraison

**Implémenteur par lot, puis revue humaine du DIFF**, en deux lots. Le lot A envoie des e-mails à de vrais clients et des
alertes sur Telegram. Le lot B ajoute une facturation Stripe (un montant faux) et touche une limite que lit la réception
des messages. Les invariants sont ceux du lot 1 (Stripe d'abord, la limite ensuite) et ceux des seuils (un seul e-mail
par franchissement, relâché sous le seuil).

**Essai réel qui clôt chaque lot :**
- Lot A : passer un espace de test en Entreprise limitée à 3 contacts par /ops, puis lui créer 3 contacts. Il faut voir
  l'e-mail « contactez-nous » à 100 % chez l'administrateur et l'alerte Telegram chez nous. Puis faire écrire un 4e
  contact depuis le téléphone d'essai : il doit recevoir l'e-mail de refus « contactez-nous ».
- Lot B : sur un espace de test passé en Business, acheter un pack depuis la page Offre (Stripe en live). La limite doit
  passer de 5 000 à 6 000 sur la page et dans `get_plan`, et l'abonnement à part doit apparaître chez Stripe. Retirer le
  pack ensuite.

## Lot A : les alertes de contacts de l'Entreprise

- **Le balayage** (`src/emails-produit/alertes.ts`) : `limitesAlertables` surveille la limite de contacts de l'Entreprise
  (celle de /ops, avec sa famille de seuils). `emissionContacts` y prend des textes « contactez-nous », plus la phrase de
  l'option quand elle est cochée.
- **Le catalogue** (`src/emails-produit/catalogue.ts`) : `limite_contacts_entreprise_80` et `_100`, plus la variante
  Entreprise de `espace_plein_entrant`. Le refus affiché à l'écran (`phraseLimite`) dit « contactez-nous » pour
  l'Entreprise.
- **Telegram** : un message par franchissement, avec le nom de l'espace, son usage et sa limite. Il passe par l'alerte
  d'exploitation existante, après la réservation de l'e-mail, pour ne pas partir deux fois.
- **Tests** : seuils de l'Entreprise, textes sans offre supérieure, Telegram une fois par franchissement, Entreprise
  sans limite jamais alertée.

## Lot B : les packs de contacts du Business

- **Migration** (`avant`) : la table de l'abonnement à part et sa quantité, sur le modèle des options de la ligne de
  crédit. Son numéro se lit par `npm run migrations`.
- **Les droits** : dans `droitsDe`, la limite de contacts du Business gagne `1 000 × packs`, après la limite de /ops. La
  porte de l'espace plein relit les packs dans la même requête, comme elle le fait déjà pour le Pro.
- **Stripe** : un premier achat ouvre une session Checkout pour un abonnement mensuel à part, marqué d'un produit
  `pack_contacts`. Le webhook l'aiguille sur cette marque, et les ajouts et retraits suivants changent sa quantité.
  Stripe d'abord, la limite ensuite, prorata à l'ajout, retrait sans remboursement, et refusé si ça ne tient pas.
- **Route et écran** : la route du pack existante prend le Business. La page Offre du Business propose « Ajouter 1 000
  contacts, 20 € HT par mois ». `get_plan` donne les packs du Business.
- **Docs** : `features.md`, la fiche « Choisir mon offre » (empreinte, version `en/`, `vitrine:aide`), la page des tarifs
  de la vitrine (ligne Business, chiffres tenus par `tests/vitrine-pages.test.ts`), le catalogue MCP.
- **Tests** : sur le modèle de ceux de l'option ligne de crédit et des packs du Pro : premier achat, ajout, retrait refusé
  et retrait accepté, webhook, limite lue par `droitsDe` et par la porte de l'espace plein.
