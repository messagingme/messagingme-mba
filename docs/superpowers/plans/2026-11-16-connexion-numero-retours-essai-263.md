# Les retours de l'essai 263 sur la connexion du numéro : plan

Julien, le 2026-11-16, en faisant l'essai 263 dans la console (formule Pro, ligne de crédit, numéro fourni). Choix
tranchés par AskUserQuestion le même jour.

## Méthode de livraison

**En direct**, sans agent, puis UNE relecture indépendante en fin de lot : des écrans et des textes de la console, réversibles,
sur peu de fichiers ; seule la lecture de l'erreur de la fenêtre de Meta touche un chemin de la connexion, et elle ne fait
qu'ajouter un message. **Essai réel qui clôt le lot** : Julien refait l'écran « Connecter WhatsApp » (formule Pro, option
payée, numéro fourni) et la fenêtre de Meta sur son portefeuille récent, qui rend l'erreur #2388386.

## Ce qui change

1. **« Quelle solution pour payer vos messages Meta ? »** (`web/components/QuiRegleMeta.tsx`) : chaque choix sur UNE ligne,
   sa carte à gauche, son bouton à droite ; la carte du moyen de paiement en haut, la ligne de crédit dessous.
2. **L'option payée** (même écran) : une confirmation nette (« Votre option ligne de crédit est active »), puis l'étape
   suivante en titre, « Quel numéro voulez-vous connecter ? », avec ses deux choix ; le choix de la carte n'est plus
   proposé à côté.
3. **Le code du numéro fourni** (`web/components/ParcoursNumero.tsx`) : l'encadré du code remonte juste sous le numéro,
   en grand et en couleur, titré « Le code s'affichera ici », qui pulse pendant l'attente ; l'étape 4 dit « dans
   l'encadré ci-dessus ».
4. **Les mots de la fenêtre de Meta** (`web/lib/partage/etapes-numero-fourni.ts`, source unique de la page, de Claude et
   de la vitrine) : « Appel téléphonique » (« Phone call » si la fenêtre est en anglais), surtout pas « Message texte ».
5. **L'erreur #2388386** : un portefeuille Meta Business non vérifié a au plus deux numéros enregistrés. Une entrée du
   dépannage (`scripts/vitrine/depannage-textes.ts`, console et Claude) avec ses trois sorties (créer un autre
   portefeuille dans la fenêtre de Meta, retirer un numéro inutilisé dans le Gestionnaire WhatsApp, faire vérifier
   l'entreprise puis demander plus de numéros) ; et la page de connexion lit l'erreur que la fenêtre renvoie en se
   fermant (`web/lib/message-es.ts`, événement `CANCEL` avec `error_id`) pour afficher cette aide directement.

6. **Le code d'avant, à la réouverture de la fenêtre** (même écran, retour de Julien pendant le lot) : « Ouvrir la fenêtre
   de Meta » vide l'encadré, et seul un code reçu DEPUIS s'affiche (comparé par sa date de réception chez nous, jamais à
   l'horloge du poste).

## Tests

`web/lib/message-es.test.ts` (l'erreur lue, origine ancrée, rien d'autre), les e2e des deux écrans (`qui-regle-meta`,
`connecter-whatsapp`), les tests de parité des étapes (`tests/etapes-numero-fourni.test.ts`, MCP, vitrine), le
dépannage (`tests/vitrine-*`). Suite racine et `web/` entières, lint, typecheck, avant le push.

## Mise en ligne

La console part au push (Vercel), la vitrine aussi ; aucune route neuve, aucun déploiement de l'API sauf si un texte
partagé change ce que dit Claude (alors déploiement `migration=aucune`, approuvé par Julien), puis `aide:charger` si une
fiche bouge.
