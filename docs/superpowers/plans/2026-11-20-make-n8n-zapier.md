# Make, n8n, Zapier : la section de Tools > Intégrations et ses fiches (2026-11-20)

Demande de Julien : une section pour les outils d'automatisation, qui sépare **recevoir** (l'outil nous pousse de
l'information) et **envoyer** (nous la poussons vers l'outil), avec les options de chaque sens. Les fiches d'aide
existantes servent au maximum ; celles qui manquent se créent. Rien de neuf côté serveur : tout existe déjà.

## Ce qui existe et sert tel quel

- Tools > Webhooks (webhook entrant) ; Developers > Webhooks sortants ; Developers > Clés d'API ; Tools > Connecteurs
  API ; le bloc Appel API d'un scénario.
- Fiches : « Brancher un connecteur API » (`brancher-un-connecteur-api`), « Le bloc Appel API » (`bloc-appel-api`).

## Tâches

1. Fiche « Recevoir des données par webhook » (`recevoir-des-donnees-par-webhook`, écran `webhooks`, section
   « Webhooks entrants (menu Tools) ») : créer, copier l'adresse, envoi de test, attacher les valeurs, contacts et
   consentement, scénario facultatif. Publique, version anglaise, captures (`aide:captures`).
2. Fiche « Envoyer les événements à votre outil » (`envoyer-les-evenements-a-votre-outil`, section « Webhooks sortants
   : votre application reçoit les événements ») : coller l'adresse, cocher les événements, essai, secret, journal.
   Publique, version anglaise, captures.
3. Fiche-chapeau « Brancher Make, n8n ou Zapier » (`brancher-make-n8n-ou-zapier`, écran `integrations`) : Recevoir
   (webhook entrant ; ou leur module HTTP avec une clé d'API, lien vers la doc API), Envoyer (en continu par les
   webhooks sortants ; à un moment précis par un connecteur API et le bloc Appel API, avec les réglages propres à ces
   outils). Elle oriente et ne recopie rien (règle « zéro redite »). Publique, version anglaise.
4. Console : un volet « Make, n8n, Zapier » dans Tools > Intégrations (logos simple-icons dans `web/public/logos/`),
   deux blocs Recevoir et Envoyer, des boutons vers les écrans et un lien vers la fiche-chapeau. e2e dans
   `web/e2e/integrations.spec.ts`.
5. `features.md` (la section Tools > Intégrations dit le volet), `npm run vitrine:aide`, `npm run aide:carte` si la
   carte bouge, tests de l'aide et de la vitrine, puis `aide:charger` après le push.

## Méthode de livraison

**En direct**, sans agent : un écran qui n'oriente que vers des écrans existants, et de la documentation ; réversible,
aucun chemin que la production emprunte, aucun invariant caché. Les critères (liens justes, fiches valides, pages
générées à jour) sont tenus par les tests existants de l'aide et de la vitrine et par un e2e du volet.

**Essai réel qui clôt le lot** : Julien branche un vrai scénario Make sur la SANDBOX, dans les deux sens : Make poste sur un webhook entrant (le contact
apparaît, ses champs attachés), et un scénario de la console pousse vers Make par le bloc Appel API (la donnée arrive
dans Make). Numéro dans `docs/prive/ESSAIS-REELS.md`.
