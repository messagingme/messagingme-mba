---
description: Le bloc Extraire du JSON d'un scénario WhatsApp : lire des valeurs dans la réponse d'un Appel API et les ranger dans des champs.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 6ea74e
publique: oui
rubrique: construire-un-scenario
rang: 17
---
# Le bloc Extraire du JSON

Lit des valeurs dans un champ JSON, la réponse d'un Appel API, et les range dans d'autres champs, une ligne par valeur.

**1. Choisir le champ JSON.** Cliquez sur le bloc, puis choisissez dans « Champ JSON à lire ».

- Seuls les champs de type JSON sont proposés. Ils se créent dans Contenu > Bibliothèque > Champs.
- Le bloc est grisé dans la palette tant qu'aucun appel n'est déclaré dans Tools > Connecteurs API.

**2. Écrire le chemin.** « Dans la réponse » : commande.statut, articles[0].nom pour le premier article,
articles[-1].nom pour le dernier ; vide, toute la réponse.

- 300 caractères au plus. Une clé ne contient ni point ni crochet.

**3. Choisir quoi prendre et où le ranger.** « Prendre » : la valeur, ou le nombre d'éléments d'une liste ; « Ranger
dans le champ » dit où.

- 20 lignes au plus ; « Ajouter une ligne » en ajoute une. Une ligne sans champ de destination est ignorée.
- Un chemin absent, ou une valeur que le type du champ refuse (un texte dans un champ nombre), vide le champ.
- Un objet ou une liste se range en JSON, vrai ou faux en true ou false.
- Un champ JSON vide ou illisible vide tous les champs de destination.

**4. Voir un exemple.** « Voir un exemple » rejoue l'Appel API du scénario avec ses valeurs d'essai : « Attacher… »
remplit le chemin de la ligne encadrée.

- Le bouton n'apparaît que si un bloc Appel API du scénario range dans ce champ ; sinon, tapez le chemin.
- Un appel autre que GET agit chez votre système : l'écran demande confirmation avant de le rejouer.
- L'exemple ne vérifie pas le type du champ : il peut montrer une valeur que le champ refusera.
- Une réponse de plus de 20 000 caractères ne s'affiche plus en exemple.

**5. Relier la suite.** Le bloc n'a qu'un point, en bas : la suite part tout de suite.

- Une Condition placée après lit les valeurs extraites. Dans une campagne, placez une Attente entre l'Appel API et ce
  bloc, après le premier template.
- Il peut suivre la sortie « Puis, sans attendre » d'un message rapide.
- Relié à rien, le parcours s'arrête là.
