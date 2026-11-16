# App Review, soumission 1 : les droits publicitaires (2026-11-16)

Dossier prêt à recopier dans le formulaire de Meta. Les textes destinés à Meta sont en anglais, le reste en français.
Contexte : spec `docs/superpowers/specs/2026-11-15-relance-formulaires-meta-design.md`, § « Ce que Julien fait chez
Meta ».

## Pourquoi cette soumission

Relevé du 2026-11-16 (Review, App Review) : seules `whatsapp_business_messaging`, `whatsapp_business_management` et
`public_profile` ont été accordées, le 2026-08-06. Les droits publicitaires sont restés en accès Standard : l'écran
Publicités ne marche que pour les comptes qui ont un rôle sur l'app. Cette soumission les ouvre aux clients, et elle
débloque deux autres chantiers : le vrai coût du MBA (plan `2026-11-10-cout-ia-et-mba.md`, lot B, qui attend
`business_management`) et les prérequis de `leads_retrieval` (soumission 2).

## Ce qu'on demande

| Permission | Démontrée dans la vidéo à | Pourquoi |
|---|---|---|
| `business_management` | 0:15 à 0:50 | Dépendance d'`ads_management` et de `pages_show_list` pour les jetons d'utilisateur système de l'entreprise du client (Facebook Login for Business). Meta demande de la présenter ainsi. |
| `pages_show_list` | 0:50 à 1:10 | Lister les Pages accordées pour que le client choisisse celle qui porte ses pubs. |
| `pages_read_engagement` | 0:50 à 1:10 | Lire le nom et les informations de la Page choisie (dépendance de `pages_manage_ads`). |
| `ads_read` | 1:10 à 1:25, puis 2:30 à 2:50 | État du compte publicitaire (actif, moyen de paiement), statut des pubs, entonnoir (dépense, impressions, clics). |
| `ads_management` | 1:25 à 2:30 | Créer la campagne, l'ensemble de pubs, la création et la pub, en pause ; publier ; mettre en pause. |
| `pages_manage_ads` | 1:25 à 2:30 | La pub est publiée au nom de la Page du client. |

⚠️ **Ne pas ajouter** `leads_retrieval` ni `pages_manage_metadata` : sans fonctionnalité à montrer, elles seraient
refusées, et un refus ralentit la soumission suivante. Elles partent dans la soumission 2.

⚠️ **`instagram_basic` n'est pas demandée.** Nos pubs laissent Meta choisir les emplacements, Instagram compris, par le
compte Instagram de la Page. Si Meta la réclame à la revue, on l'ajoute à la soumission 2 plutôt que d'improviser.

## Avant de tourner (une fois)

1. **Ajouter les permissions à la demande** : Use cases, « Create & manage ads with Marketing API », Customize, puis
   « Request advanced access » sur chacune des cinq permissions publicitaires. Elles rejoignent
   `business_management` dans Review, App Review, « New requests ». Ne cliquer « Next » qu'avec la vidéo prête.
2. **Vérifier les réglages de l'app** (App settings, Basic) : icône, URL de la politique de confidentialité, URL des
   instructions de suppression des données, catégorie. La revue les relit aussi.
3. **Un compte de test pour le relecteur** : une adresse e-mail dédiée (pas Google), un mot de passe, un espace en
   Entreprise posé par `/ops`, SANS numéro WhatsApp réel. Les identifiants vont dans le formulaire de Meta, JAMAIS dans
   ce dépôt (il est public).
4. **La console en anglais** pour la vidéo : le relecteur doit lire ce qu'il voit.
5. **Déconnecter les publicités de l'espace qui sert au tournage** (bouton « Disconnect » de l'écran Ads) : la vidéo
   doit montrer la connexion complète, fenêtre de Meta comprise. Vérifier avant qu'aucune pub ne diffuse dessus.
6. **Un petit budget prévu** : la vidéo publie une pub réelle (5 € sur une journée suffit), puis la met en pause. Elle
   alimente aussi le compteur des 500 appels du palier « Marketing API Access Tier ».

## Le script de la vidéo (environ 3 minutes, sans son)

Tourner comme pour les vidéos d'aide : lentement, une seconde de pause avant chaque clic, sans parler. Claude ajoute
ensuite les légendes anglaises (en gras ci-dessous) et découpe. 1080p au moins.

| Temps | Geste | Légende |
|---|---|---|
| 0:00 | Ouvrir `console.messagingme.app`, se connecter avec un compte de l'espace. | **Messaging Me: a WhatsApp console for businesses. The business logs in to its workspace.** |
| 0:08 | Menu « Ads ». L'écran montre « Connect my ads ». | **The Ads screen creates Meta ads whose button opens a WhatsApp conversation with the business.** |
| 0:15 | Cliquer « Connect my ads ». La fenêtre de Meta s'ouvre. | **Facebook Login for Business opens.** |
| 0:20 | Dans la fenêtre : choisir l'entreprise, cocher le compte publicitaire, cocher la Page. Laisser les permissions affichées à l'écran deux secondes. | **The business selects its ad account and its Page, and grants the permissions.** |
| 0:45 | Valider. Retour à la console. | **Messaging Me receives a system user token for this business (business_management).** |
| 0:50 | La liste « Ad account » et la liste « Facebook Page » montrent les noms. Choisir, « Save ». | **The granted Pages are listed (pages_show_list) and the chosen Page is read (pages_read_engagement).** |
| 1:10 | Le bandeau « Ready to deliver: account active, payment method in place ». | **Messaging Me reads the ad account status before letting the business create an ad (ads_read).** |
| 1:25 | « Create an ad ». Remplir : image, texte, titre, bouton « Send WhatsApp message », message prérempli, budget total 5 €, dates sur un jour, pays France, âge, case « no special ad category », réponse par un scénario. | **The business writes the ad. Budget and end date are mandatory: they cap the spend.** |
| 2:05 | « Create (paused) ». La pub apparaît dans la liste, en pause. | **The campaign, ad set, creative and ad are created at Meta, paused, on behalf of the Page (ads_management, pages_manage_ads).** |
| 2:12 | « Open in Meta Ads Manager » : la campagne y est, en pause. Revenir. | **The same campaign in Meta Ads Manager.** |
| 2:20 | « Publish ». La confirmation annonce la dépense maximale et les dates. Confirmer. | **Publishing requires an explicit confirmation of the maximum spend (ads_management).** |
| 2:30 | Le statut de la pub, puis l'entonnoir d'une pub plus ancienne : dépense, impressions, clics, prospects. | **Messaging Me reads delivery status and performance every 15 minutes (ads_read).** |
| 2:50 | « Pause » sur la pub publiée. Le statut passe en pause. | **The business can pause the ad at any time (ads_management).** |

L'entonnoir à 2:30 doit montrer de vrais chiffres : prendre une pub déjà diffusée. S'il n'en existe aucune, tourner
cette séquence quelques jours après la publication de 2:20.

## Les textes pour Meta (un par permission)

Même vidéo pour les six. Chaque texte cite ses minutes.

### business_management

> Messaging Me is a WhatsApp Business console used by businesses to run Click-to-WhatsApp ads on their own ad accounts.
> Businesses connect through Facebook Login for Business, which issues a system user access token for their business.
> We request business_management as a dependency of ads_management and pages_show_list for this system user token: it
> lets Messaging Me access the ad account and Page that the business assigned during login. We do not read or modify
> any other business asset. Shown in the screencast from 0:15 to 0:50.

### pages_show_list

> After Facebook Login for Business, Messaging Me lists the Pages the business granted, so that the business picks the
> Page that will run its Click-to-WhatsApp ads. Only the Page names and IDs are read and displayed. Shown from 0:50 to
> 1:10.

### pages_read_engagement

> Messaging Me reads the name and basic information of the Page chosen by the business, to display it in the console
> and to use it as the identity of the ads. It is also required by pages_manage_ads. We do not read posts, comments or
> followers. Shown from 0:50 to 1:10.

### ads_read

> Messaging Me reads the status of the business's ad account (active, payment method in place) before allowing ad
> creation, so that a business never creates an ad that cannot deliver. It then reads the delivery status of each ad it
> created and its performance (spend, impressions, reach, clicks), every 15 minutes, to show the business a funnel from
> impressions to WhatsApp conversations. Shown from 1:10 to 1:25 and from 2:30 to 2:50.

### ads_management

> Messaging Me creates Click-to-WhatsApp ads on the business's own ad account: a campaign, an ad set, a creative and an
> ad, always created paused. The business publishes the ad from the console after an explicit confirmation of the
> maximum spend and dates, and can pause it at any time. Spend is always on the business's ad account; Messaging Me never
> pays for or resells ads. Shown from 1:25 to 2:30 and at 2:50.

### pages_manage_ads

> The Click-to-WhatsApp ads created by Messaging Me run on behalf of the Page chosen by the business, and the ad's
> button opens a WhatsApp conversation with that business. pages_manage_ads lets Messaging Me create these ads for the
> Page. Shown from 1:25 to 2:30.

## Les instructions pour le relecteur (champ « developer instructions »)

> 1. Go to https://console.messagingme.app and log in with the test account below (e-mail and password, not Google).
> 2. Open "Ads" in the left menu.
> 3. Click "Connect my ads" and complete Facebook Login for Business with a Facebook account that has an ad account and
>    a Page. Choose the ad account and the Page, then "Save".
> 4. Click "Create an ad", fill in the form and click "Create (paused)": the ad is created paused at Meta. Publishing spends real
>    money on the ad account, so the screencast shows that step.
>
> Test account: [e-mail], [password] (saisis dans le formulaire de Meta, jamais ici).

## Après l'envoi

- Meta annonce une décision sous une semaine. Un refus arrive avec une raison par permission : me la recopier telle
  quelle, on répond à la raison, pas à côté.
- Accordée : rien à déployer pour les Publicités (le code ne change pas). Pour le coût du MBA, le lot B attend encore
  l'ajout de `business_management` à la configuration d'Embedded Signup et la reconnexion des clients.
- Puis la soumission 2 (`leads_retrieval`, `pages_manage_metadata`), après le lot 1 et la création de pub à formulaire.

Sources : [Meta, revue d'une solution Business Management (dépendance de business_management, flux de connexion à
montrer)](https://developers.secure.facebook.com/docs/business-management-apis/2tier-bm-solution/pre-app-review-development),
[Meta, autorisation de l'API Marketing](https://developers.facebook.com/docs/marketing-api/get-started/authorization),
[Meta, guide de soumission](https://developers.facebook.com/docs/app-review/submission-guide).
