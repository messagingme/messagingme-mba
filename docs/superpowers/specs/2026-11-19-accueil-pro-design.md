# L'accueil d'un nouveau compte Pro dans la console (cadrage du 2026-11-19)

Demande de Julien, le 2026-11-19 : « une fiche de bienvenue qui s'ouvre aux premières connexions... genre voilà, on
fait un tour ? ou vous voulez tout de suite faire quelque chose : lancer une campagne, connecter un outil... ».
Décisions prises en une ronde de questions le même jour.

## Ce qui est décidé

| Question | Décision |
|---|---|
| Forme | Une **fenêtre de bienvenue** au-dessus de l'Accueil, qui se ferme d'un clic ; la console reste derrière. |
| « Faire le tour » | Une **visite guidée sur la vraie console** : une bulle pointée sur chaque zone (le menu, l'Inbox, les Campagnes, l'Agent IA, Tools, l'aide), « Suivant », cinq à huit étapes, quittable à tout moment. |
| Raccourcis « Je veux tout de suite… » | **Connecter mon numéro** (seulement si l'espace n'en a pas), **Lancer une campagne**, **Construire un agent IA** (ouvre la création, sur « Construire en parlant »), **Brancher un outil** (Tools > Intégrations). |
| Retour | **Jusqu'à un choix** : la fenêtre revient à chaque connexion tant que la personne n'a ni fait le tour, ni pris un raccourci, ni cliqué « Ne plus afficher ». Ensuite, elle se retrouve depuis le menu d'aide. |
| Qui | **Tout nouveau membre** : l'admin qui vient de prendre le Pro (essai compris) et chaque membre invité à sa première connexion. Un raccourci qu'un membre n'a pas le droit de faire (numéro, outils) ne lui est pas proposé. |
| Comptes déjà en service | **Seulement les nouveaux** : un compte Pro existant le jour de la livraison ne la voit pas surgir ; il la trouve dans le menu d'aide (« Faire le tour »). |

## Ce qui reste à trancher au plan (pas une question pour Julien)

- Où se mémorise « a fait son choix » : par PERSONNE (pas par navigateur, sinon elle revient sur chaque poste), donc
  côté serveur ; et comment « seulement les nouveaux » se pose sur les comptes existants (une date de référence, ou un
  remplissage à la migration).
- La liste des zones de la visite, et ce que chaque bulle dit (en une phrase, vouvoiement, FR et EN).
- Le parcours de la Free (sans console) n'est pas concerné : il a son tunnel et `/demarrer`.
- Le plan dit sa méthode de livraison (section obligatoire) et l'essai réel qui clôt la feature : un compte Pro neuf,
  sa première connexion, la fenêtre, le tour jusqu'au bout, puis une seconde connexion où elle ne revient plus.
