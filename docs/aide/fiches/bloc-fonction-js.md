---
description: Le bloc Fonction JS d'un scénario WhatsApp : transformer un champ par quelques lignes de JavaScript, l'essayer, et ranger le résultat.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: a3025d
publique: oui
rubrique: construire-un-scenario
rang: 12
---
# Le bloc Fonction JS

Transforme la valeur d'un champ par quelques lignes de JavaScript et range le résultat dans un autre, souvent juste après
un Appel API.

**1. Choisir le champ à transformer.** Cliquez sur le bloc, puis choisissez dans « Champ à transformer » : un champ du
contact, ou « Maintenant ».

- « Maintenant » donne la date et l'heure du passage à l'heure UTC, par exemple 2026-11-17T09:30:00.000Z.
- La valeur arrive toujours en texte : un champ vide donne un texte vide.

**2. Écrire la transformation.** Seulement l'intérieur de la fonction : la valeur arrive dans valeur, et return rend
le résultat.

- Sans return, le résultat est vide.
- 4 000 caractères au plus. La fonction a 200 ms et 8 Mo pour tourner, et aucun accès au réseau.
- Un objet ou une liste rendu devient du JSON ; le reste, du texte.

**3. L'essayer.** Tapez une valeur dans « Essayer avec cette valeur », puis « Essayer ».

- L'essai tourne avec les mêmes limites que le scénario.

**4. Choisir où ranger le résultat.** « Où ranger le résultat » : un champ existant, ou « Nouveau champ ».

- Un nouveau champ est créé en texte ; son type se change dans Contenu > Bibliothèque > Champs, sauf en JSON.
- Si la fonction échoue (erreur, délai, mémoire, code trop long), le champ est vidé et le parcours continue :
  branchez une Condition « ce champ est vide ».
- Vers un champ JSON, le résultat doit être un JSON valide de 16 Ko au plus, sinon le champ est vidé.

**5. Relier la suite.** Le bloc n'a qu'un point, en bas : la suite part tout de suite.

- Une Condition placée après lit le résultat, sauf dans une campagne ou derrière « Puis, sans attendre » : elle lit
  alors l'ancienne valeur.
- Il peut suivre la sortie « Puis, sans attendre » d'un message rapide.
- Relié à rien, le parcours s'arrête là.
