---
ecran: email-templates
source_section: E-mail (menu Tools > SMTP email, menu Contenu > Modèles d'email)
source_empreinte: ad27cd
---
# Envoyer un e-mail depuis un scénario

L'e-mail est le troisième canal, et il est **réservé aux scénarios** : il n'existe ni campagne e-mail ni
inbox e-mail. Un bloc de scénario envoie un message à l'adresse portée par la fiche du contact. Cela se
prépare en deux endroits.

**Connecter votre boîte**, d'abord, depuis le menu Tools, « SMTP email ». Vous y
déclarez une ou plusieurs boîtes : nom d'affichage, serveur, port, identifiant, mot de passe, adresse
d'expéditeur, nom d'expéditeur, adresse de réponse. Le mot de passe est chiffré chez nous et **jamais
réaffiché** : à l'édition, un champ laissé vide veut dire « inchangé ». Un bouton **« Tester »** envoie un
vrai message à l'adresse de votre choix, et c'est le seul moyen de savoir qu'un mot de passe d'application
est bon avant qu'un client n'en fasse les frais.

**Écrire vos modèles**, ensuite, dans Contenu > Modèles d'email : un nom, un sujet, un corps, au choix en
**texte simple** ou en **HTML brut** si vous collez un message préparé ailleurs. En HTML, l'aperçu sous le
code montre le rendu du mail, à chaque frappe ; les variables y restent écrites `{{prenom}}`,
elles prennent leur valeur à l'envoi. Le sujet et le corps
acceptent des variables, insérées par le même bouton « Variable » que les modèles WhatsApp et les messages
RCS, avec la même liste de champs de base et de champs à vous. Vous ne recopiez jamais un nom de variable à
la main.

**Dans le scénario**, le bloc « Envoi de mail » envoie depuis cette boîte, avec ces modèles : son mode d'emploi
est dans sa fiche, « Le bloc Envoi de mail ».
