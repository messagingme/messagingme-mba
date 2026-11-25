---
description: Remplir la base de connaissance d'un agent IA : votre site, un document, une fiche écrite à la main ou une pièce jointe, puis la relire.
ecran: agents
source_section: Agent IA (menu « AI Agent » > Other AI agent)
source_empreinte: f833b6
publique: oui
rubrique: parler-aux-clients
rang: 14
prerequis: construire-un-agent-ia
---
# Remplir la base de connaissance d'un agent IA

La base de connaissance est la seule chose dont votre agent IA a le droit de se servir pour répondre. Sur une question
qu'aucune fiche ne couvre, il n'invente pas : il sort par « Aucune source ». Une base vide fait donc un agent qui
transfère tout.

Vous la remplissez de quatre façons : votre site, un document, une fiche écrite à la main, ou un fichier joint à
l'assistant de construction. Tout se fait dans l'onglet « Base de connaissance » de l'agent.

**1. Lire votre site.** Carte « Lire une page de votre site » : collez une adresse, puis « Voir ce qui sera importé ».

- L'adresse d'une page lit cette page seule ; celle de votre domaine lit le site, jusqu'à cinquante pages proches de
  l'accueil.
- L'adresse que vous avez donnée à l'assistant de construction est déjà dans le champ, avec un bandeau qui le dit.
- Le site est lu une fois et découpé en fiches sur ses titres. L'agent ne le relit pas à chaque question : c'est plus
  rapide, moins cher, et une mauvaise réponse se corrige ici même.

**2. Relire l'aperçu, puis importer.** L'aperçu liste les pages lisibles et ce que chacune donnera, en fiches et en
caractères. Rien n'est écrit avant « Importer ces N pages ».

- Un site lent est lu pendant 30 secondes au plus : l'aperçu dit alors qu'il manque des pages. Un import arrêté faute
  de temps propose d'un clic « Importer les N pages restantes ».
- Quand le plafond de pages est atteint, l'aperçu le dit : importez d'abord celles-ci, puis donnez une adresse plus
  précise pour le reste. Les adresses écartées sont nommées, avec leur raison.
- Au-delà de 40 fiches pour une page, sa suite n'est pas lue, et le message de l'import le dit, page par page.
- Relire la même adresse remplace les fiches qu'elle avait produites : vos corrections sur celles-là sont perdues. Les
  autres fiches ne bougent pas.

**3. Déposer un document.** Carte « Déposer un document », « Choisir un fichier » : un PDF, un Word, un fichier texte
ou un CSV.

- Un PDF, un Word ou un texte est découpé en fiches sur ses titres. Le type se reconnaît au contenu du fichier, pas à
  son extension. 8 Mo au plus.
- Un CSV, une grille de tarifs par exemple, est découpé par lignes entières, son en-tête repris dans chaque fiche. Celui
  qu'Excel enregistre sous Windows, avec des points-virgules, passe aussi.
- Au-delà de 40 fiches, la suite du document n'est pas lue, et l'écran le dit. Redéposer le même fichier remplace les
  fiches qu'il avait produites.
- Une image ne se dépose pas ici : joignez-la à l'assistant (étape 5).

**4. Écrire une fiche à la main.** Carte « Écrire une fiche à la main » : un titre (la question ou le sujet), la
réponse telle que vous voudriez la lire, puis « Ajouter la fiche ».

- C'est le chemin le plus court pour ce qu'aucune page ne dit : un horaire d'été, une exception, une consigne.

**5. Joindre un fichier à l'assistant.** Onglet « Construire en parlant », trombone « Joindre un fichier » : un
document ou une image. Son texte est extrait, découpé en fiches, et l'assistant vous dit combien il en a ajouté.

- L'assistant est inclus dès la formule Pro.
- Sont acceptés : texte, CSV, Markdown, PDF, Word, et les images JPEG, PNG, GIF et WebP. 8 Mo par document, 5 Mo par
  image.
- Une image est lue par l'IA, qui en relève le texte : la photo d'une grille de tarifs devient des fiches.
- Un fichier sans texte lisible, un PDF scanné par exemple, est dit tel quel, et le plafond de 40 fiches, s'il mord,
  est dit dans le message.

**6. Relire et corriger les fiches.** Le tableau liste chaque fiche, sa provenance et sa taille. Cliquez sur une fiche
pour l'ouvrir : son titre et sa réponse se corrigent sur place.

- La provenance dit « Écrite à la main », « Document », ou la page lue et sa date.
- Une fiche que personne n'a touchée depuis plus de quatre-vingt-dix jours porte la pastille « À relire » : c'est la
  parade au contenu périmé.
- Une fiche fait au plus 2 000 caractères, ce que l'agent en lit : une section plus longue devient plusieurs fiches,
  « (suite 2) », « (suite 3) ». Rien n'est coupé.
- Cochez plusieurs fiches, puis « Supprimer les N fiches cochées ». Une fiche supprimée laisse son contenu dans l'onglet
  Historique, seul exemplaire qui en reste.

**Bon à savoir.** L'agent cherche dans sa base par le sens des mots autant que par les mots eux-mêmes, sans tenir compte
des accents : « c'est combien pour résilier » trouve « Conditions de sortie de contrat ». Une fiche qui ne répond pas
vraiment à la question est écartée, et l'agent sort alors par « Aucune source » plutôt que d'inventer. Une fiche toute
neuve, ou tout juste corrigée, se trouve par ses mots tout de suite, par son sens au bout d'une minute. Et la base ne
sert que si l'outil « Chercher dans la base de connaissance » est actif, dans l'onglet Outils : une base bien remplie
avec cet outil éteint fait un agent qui transfère toutes les questions de fond.
