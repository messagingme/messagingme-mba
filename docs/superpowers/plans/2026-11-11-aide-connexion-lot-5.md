# Lot 5 de l'aide à la connexion : les e-mails renvoient vers les pages

**But :** un e-mail du produit qui demande un geste mène aussi à la page publique qui le montre pas à pas ; la relance
du numéro mène au guide, et au dépannage.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md),
« Lot 5 : les e-mails ».

## Méthode de livraison

En direct, une relecture indépendante du diff : ce sont des e-mails qui partent aux clients, donc un chemin de
production, mais le changement est additif (une ligne sous le bouton, un bouton repointé) et réversible au déploiement
suivant, et ses critères sont mécaniques : chaque adresse est une page du site et figure au plan du site, le rendu texte
et HTML porte la ligne, un e-mail sans page d'aide rend exactement comme avant.

**Essai réel :** l'aperçu de `/ops` de `relance_numero` (le bouton mène au guide, la ligne au dépannage) et d'un e-mail
de la table, puis un envoi réel sur un espace de test, ouvert dans Gmail sur un téléphone.

## Ce qui change

1. **Le gabarit** : un modèle du catalogue (`src/emails-produit/catalogue.ts`) peut porter `aide`, une ligne sous le
   bouton : une phrase et un lien vers une page publique, par langue, rendue en HTML et en texte
   (`src/emails-produit/rendu.ts`, `renderBrandedEmail`). Elle vient du code, pas de `/ops`, qui ne garde que le sujet,
   le corps et le bouton : elle reste sous un texte réécrit dans `/ops`.
2. **`relance_numero`** : son bouton mène au guide, sa ligne au dépannage ; sa phrase garde les deux entrées (la console,
   ou Claude). 🔴 **Avant le déploiement, lire dans `/ops` si `relance_numero` a un texte réécrit** : il garderait son
   bouton vers la console (rayon de souffle de la spec).
3. **La table**, e-mail par e-mail. Les adresses viennent de `web/lib/partage/aide-connexion.ts`, vérifiées sur le site
   par `tests/aide-connexion-adresses.test.ts` ; seules des pages publiques. Cinq fiches y entrent (agent IA, bulle,
   Inbox, offre, Shopify), et `AIDE_POURQUOI_PAIEMENT` y prend le nom de sa page, `AIDE_PAYER_META`.

| E-mail | La page qui l'aide |
|---|---|
| `relance_numero` | le bouton : le guide ; la ligne : le dépannage |
| `bienvenue`, `numero_libere` | le guide : la première étape, ou la suivante, est un numéro |
| `application_numero_coupe`, `application_premiers_geles`, `application_appareil_retire`, `application_en_sommeil` | Garder mon application WhatsApp Business |
| `relance_repondeur` | Construire un agent IA |
| `relance_silence` | Poser une bulle WhatsApp sur mon site |
| `transfert_equipe` | Répondre à un client dans l'Inbox |
| `credit_whatsapp_bas`, `credit_whatsapp_epuise`, `ligne_credit_disponible`, `ligne_credit_sur_demande`, `option_wa_arretee`, `option_wa_sans_droit` | Payer Meta (la carte, ou le Crédit WhatsApp) |
| `limite_modeles_80`, `limite_modeles_100`, `limite_contacts_80`, `limite_contacts_100`, `limite_contacts_depassee`, `limite_contacts_pro_80`, `limite_contacts_pro_100`, `espace_plein_entrant`, `shopify_limite_contacts`, `transfert_equipe_free`, `pro_suite_numero` | Choisir mon offre |
| `shopify_message_actif`, `shopify_modele_refuse` | Brancher ma boutique Shopify |
| `credit_epuise`, `credit_bas`, `numero_suspendu_fin`, `numero_suspendu_impaye`, `numero_rappel_liberation`, `paiement_refuse_numero`, `paiement_refuse_pro`, `paiement_refuse_option_wa`, `recap_semaine`, `shopify_demande_donnees` | aucune : le Crédit IA et l'abonnement du numéro fourni n'ont pas de page publique, la carte d'un paiement refusé est celle de Messaging Me (« Payer Meta » montre celle chez Meta), le récapitulatif et la demande de données ne demandent aucun geste guidé |

4. **Les gardes** : chaque adresse d'aide d'un e-mail est une page du site, au plan du site ; la table couvre chaque
   modèle du catalogue (un modèle ajouté sans décision fait échouer le test) ; un modèle sans `aide` rend à l'octet comme
   avant.
5. **Sans « Business Agent » sous le logo** (décision de Julien du 2026-11-11, vue en chemin) : les e-mails du produit
   passent `sousTitre: null`, comme l'e-mail d'inscription ; c'est le nom du produit de Meta, que la console configure
   sans le porter. Le gabarit garde son défaut pour les autres e-mails (l'invitation d'équipe).

## Ordre de déploiement

1. Julien lit dans `/ops` si `relance_numero` a un texte réécrit (sinon, rien à faire).
2. Le push, puis l'API (les e-mails partent du worker et de l'API : le déploiement Scaleway couvre les deux).
