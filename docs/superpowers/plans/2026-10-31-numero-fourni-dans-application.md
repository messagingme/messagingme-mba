# Le numéro fourni dans l'application WhatsApp Business : la 4e question (2026-10-31)

Décision de Julien du 2026-10-31, posée d'abord sur la vitrine (`scripts/vitrine/tunnel-textes.ts`) : sans compte Meta
Business ni application, une 4e question, « Avez-vous un numéro pour votre entreprise ? ». Oui : télécharger
l'application avec son numéro, comme avant. Non : « nous vous fournissons le numéro », et il va DANS l'application
(« Dans l'application »), puis la fenêtre de Meta le relie en coexistence. Avec l'application déjà là, on la garde et
aucun numéro n'est proposé.

🔴 Ses mots sur l'attente : un numéro tout neuf sera souvent refusé en coexistence les premiers jours, « mais quoi qu'il
arrive dès le début il peut répondre aux clients et c'est une affaire de quelques jours pour pouvoir envoyer des
messages sortants ». Aucun chiffre de jours.

Faisable sans rien de neuf côté Meta : le pont des codes capte l'appel de vérification de l'application sur un numéro de
la réserve (mesuré le 2026-10-21), et la coexistence est acceptée tant qu'aucun numéro n'est connecté.

## Tâches

1. Un mode de lien `fourni_application` (`src/auth/token.ts`, `web/lib/lien-numero.ts`) : obtenir ou payer le numéro,
   créer le compte de l'application avec lui (`ETAPES_COMPTE_FOURNI`, le code sur la page), puis « Garder mon
   application WhatsApp Business » (la fenêtre de Meta en coexistence). Les routes ne lisent pas le mode : seule la page.
2. `start_whatsapp_connection` et `watch_whatsapp_connection` : le mode, sa consigne et ses suites (le code se saisit
   dans l'application, puis la coexistence ; revenir plus tard en mode `coexistence` si Meta refuse le numéro).
3. Console : la 4e question après « Non » à l'application (`ParcoursNumero`, `web/lib/questions-numero.ts`), l'issue
   « nous vous fournissons le numéro » qui ouvre le parcours `fourni_application` ; la variante survit au retour de
   Stripe, au rechargement et au retour plus tard (mémoire du navigateur, par espace).
4. Plugin : la 4e question et ce chemin dans la skill `mise-en-service`, la FAQ, le README ; version montée.
5. `tests/questions-numero-vitrine.test.ts` étendu à la 4e question et à l'issue `fourni` ; e2e de la console.

Ordre : la vitrine de la session « Tunnel » d'abord (le test de parité lit ses textes), puis ce lot, le déploiement de
l'API (le mode neuf est servi par les outils MCP), puis la publication du plugin.

## Méthode de livraison

**Implémenteur par lot + une relecture indépendante du diff**, parce que le chemin est celui que la production emprunte
pour brancher un numéro payé (paiement Stripe, numéro de la réserve, fenêtre de Meta), avec des reprises invisibles
dans `ParcoursNumero` (retour de Stripe, rechargement, lien de Claude) qu'un test ne voit qu'en partie. Les critères
mécaniques (mêmes questions que la vitrine, mode accepté et suivi par les outils, noms de code de la skill connus) se
tiennent par des tests.

Essai réel qui clôt la feature : un espace neuf, « Non » au compte, à l'application et au numéro, depuis la console puis
depuis Claude : le numéro fourni s'affiche, le compte de l'application se crée avec lui (le code sur la page), puis la
fenêtre de Meta en coexistence ; noter si Meta refuse ce numéro neuf et avec quel message (essai réel 198).
