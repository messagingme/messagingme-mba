# Lot 3v-2d de l'aide à la connexion : le Crédit WhatsApp sur la page Tarifs et dans le centre d'aide

**But :** la vente du Crédit WhatsApp ouverte (2026-11-11), la page Tarifs le montre sur les cartes Pro et Business,
à son prix tenu par le code, et le centre d'aide public a sa fiche : prendre l'option, connecter son numéro sans carte,
recharger, en trois étapes et trois captures.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md)
(lot 3v-2) ; la décision du 2026-10-19 (la page Tarifs ne dit pas « commission »).

## Méthode de livraison

En direct, une relecture indépendante du diff, parce que ce sont des pages de la vitrine et une fiche, réversibles, que
tiennent les tests du centre d'aide et du prix des tarifs : rien que l'API emprunte. Captures et rendu montrés à Julien
avant le push (nouveauté publique).

**Essai réel :** sur `app.messagingme.fr/tarifs/` et `/en/pricing/`, la ligne « Crédit WhatsApp » des cartes Pro et
Business dit 30 € HT par numéro et par mois ; `app.messagingme.fr/aide/payer-ses-messages-sans-carte-chez-meta/` et sa
version anglaise s'ouvrent avec leurs trois captures ; le bot d'aide de la console répond sur le Crédit WhatsApp après
`aide:charger`.

## Ce qui change

1. **Tarifs** (`site/tarifs/index.html`, le dictionnaire anglais `scripts/vitrine/anglais/tarifs.json`) : la ligne
   « Crédit WhatsApp en option » sous « Un numéro fourni, inclus » des cartes Pro et Business. Son prix
   (`data-offre="option-wa.prix-mois"`) est tenu par `PRIX_OPTION_WA_HT_CENTIMES` dans `tests/vitrine-pages.test.ts`.
2. **La fiche publique** `docs/aide/fiches/payer-ses-messages-sans-carte-chez-meta.md` et sa traduction : rubrique
   « Démarrer avec la console », rang 4, offre Pro, prérequis « Ce qu'il faut chez Meta », hors « Comment faire » (l'écran
   Offre a déjà sa page). Sa source est la section « Crédit WhatsApp » de `features.md`, qui ne l'annonce plus « à
   venir » : son empreinte change, et la fiche « Recharger le Crédit WhatsApp », de même source, la suit.
3. **Les captures** (`web/e2e/captures/payer-ses-messages-sans-carte-chez-meta.capture.ts`, puis `site/img/aide/`) :
   l'option à prendre, la carte « Crédit WhatsApp » avec « Le mien » et « Connecter sans carte chez Meta », la recharge.
4. **Les pages générées** (`npm run vitrine:aide`) : la page, son menu dans chaque page d'aide, le plan du site,
   `llms.txt` ; les compteurs de `tests/vitrine-aide.test.ts` et la liste publique de `tests/aide-fiches-format.test.ts`.

## Ordre de déploiement

1. Le push : la vitrine par Vercel.
2. Julien : `aide:charger`, avec une image qui contient la fiche (le prochain déploiement de l'API, ou la fiche montée
   par-dessus l'image en service).
