# Champ JSON : ranger la réponse d'un appel API, puis l'exploiter (2026-11-11)

Demande de Julien : le bloc « Appel API » d'un scénario doit pouvoir garder le retour de l'appel sans passer par
Tools > Connecteurs API pour déclarer ce qu'il faut lire. Le retour se range BRUT dans un champ du contact, et un bloc
d'extraction vient y chercher les valeurs ensuite. Cadrage fait en quatre rondes de questions, chaque point ci-dessous
est une décision de Julien.

## Ce qui existe (origin/main au 2026-11-11)

- Le bloc « Appel API » (`kind: 'appelHttp'`, `src/workflow/engine.ts`) désigne une requête de la bibliothèque et UN
  champ cible facultatif. Sans champ, il pousse (corps non lu).
- Avec champ, il lit les « champs de réponse » de la requête (`outputPaths`) : un seul chemin donne la valeur nue,
  plusieurs donnent l'objet en texte JSON (`valeurPourChamp`, `src/workflow/appel-http.ts`). Un échec vide le champ.
- Le résolveur HTTP sait déjà lire la réponse ENTIÈRE (`lecture: { nature: 'entier' }`, relais du MBA) : JSON parsé,
  sinon le texte tel quel, corps vide = `null` (`src/agent/resolvers/http.ts`, étape 9ter).
- Types de champ : `text`, `number`, `date`, `datetime`, `boolean`, `url` (`USER_FIELD_KINDS`,
  `web/lib/partage/champs.ts`, contrainte `user_fields_type_check`). Une valeur saisie est plafonnée à 1 000
  caractères (`validateFieldValue`) ; l'écriture d'un scénario (`setField` -> `mergeFieldsByPhone`) ne valide rien.
- Le bloc « Fonction JS » lit un champ et en écrit un autre, dans un bac à sable.
- L'agent IA ne lit les champs que par son outil `mba_lire_contact`, jamais à chaque tour.

## Décisions

### Lot 1 : le type JSON et le rangement brut

1. **Nouveau type de champ `json`.** Il se choisit à la création et ne se change plus : ni vers `json`, ni depuis
   `json` (refus à la modification du champ).
2. **Le type du champ cible décide de la lecture du bloc « Appel API ».** Champ `json` : la réponse entière, sans le
   filtre `outputPaths`. Tout autre type : le comportement d'aujourd'hui, inchangé. Aucun scénario existant ne bouge.
3. **Le filtre du connecteur ne borne plus le scénario.** `outputPaths` reste la frontière de l'agent IA seulement. Un
   connecteur qui ne sert qu'à des scénarios n'a pas à en déclarer (la route l'accepte déjà).
4. **Plafond : 16 Ko** (16 384 octets UTF-8 de la valeur sérialisée). Au-delà : traité comme un échec, champ vidé,
   raison au journal des appels. Jamais tronqué : un JSON coupé est un JSON cassé.
5. **Une réponse qui n'est pas du JSON** (texte, HTML) se range comme une CHAÎNE JSON (`"OK"`). Un corps vide se range
   `null`. Un champ `json` contient donc toujours un JSON valide.
6. **Un échec vide le champ**, comme aujourd'hui.
7. **Où le champ est visible** : la fiche contact (lecture seule, mis en forme), l'API publique et le MCP (lecture,
   `create_field` accepte `json`), l'agent IA par `mba_lire_contact`, les conditions, les variables de message
   (`{{champ}}` rend le JSON brut).
8. **Conditions sur un champ `json`** : « est vide », « n'est pas vide », « contient » (recherche dans le texte brut).
   Pas d'égalité ni de comparaison : c'est le travail du bloc d'extraction.
9. **Qui écrit un champ `json`** : le bloc « Appel API », le bloc « Fonction JS » (sortie qui n'est pas un JSON valide
   de 16 Ko au plus = champ vidé), l'API publique et le MCP (refus explicite si invalide ou trop gros). **Personne
   d'autre** : ni la saisie dans la fiche, ni l'import CSV, ni le mapping d'un webhook entrant, d'un WhatsApp Flow ou
   de HubSpot. Ces chemins ne proposent pas un champ `json` comme cible.

### Lot 2 : le bloc « Extraire du JSON »

10. Un bloc qui lit un champ `json` et range des valeurs dans d'autres champs, en lignes « chemin -> champ ».
11. **On désigne une valeur par un clic** sur un exemple : la réponse de l'appel amont (le bloc « Appel API » qui
    alimente ce champ), rejouée avec les valeurs d'essai du connecteur. Aucune donnée d'un vrai contact à l'écran.
    Sans bloc amont, saisie libre du chemin.
12. **Chemins** : `commande.statut`, une position `commandes[0]`, le dernier `commandes[-1]`, le nombre d'éléments
    d'une liste, une sous-partie rangée dans un autre champ `json`.
13. **Un chemin absent vide son champ cible.** Une valeur qui ne passe pas le type du champ cible (texte dans un
    champ nombre) aussi.
14. Le bloc n'est annoncé (`features.md`, fiche d'aide, vitrine) qu'avec ce lot : sans lui, le champ `json` ne sert
    qu'à qui écrit du JavaScript.

## Risques connus

- Un `{{champ}}` JSON dans un message peut dépasser la longueur d'un message WhatsApp. Julien l'a accepté ; l'envoi
  échoue alors comme tout message trop long.
- La réponse non filtrée d'un système tiers peut atteindre le fournisseur du modèle si l'agent lit la fiche. Choix
  assumé : c'est le client qui choisit de ranger la réponse entière.
- Un champ `json` alourdit `contacts.fields`, relu à chaque étape de scénario. Le plafond de 16 Ko le borne.

## Essai réel

Un connecteur vers une API publique de démonstration sans clé, qui rend un objet avec une liste, sur un espace de
test. Lot 1 : un scénario déclenché depuis un vrai téléphone range la réponse dans un champ `json`, relu dans la fiche,
puis une condition « contient » choisit la branche. Lot 2 : le même scénario extrait un statut et le nombre d'éléments
dans deux champs, et un message les cite.
