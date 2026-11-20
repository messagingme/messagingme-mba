---
description: Le bloc Condition d'un scénario WhatsApp : les conditions, leurs types, les familles et leurs sorties, et les pièges des valeurs vides.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: 6ea74e
publique: oui
rubrique: construire-un-scenario
rang: 7
---
# Le bloc Condition

Aiguille le contact selon son état : ses étiquettes, ses champs, son consentement, le jour ou l'heure.

**1. Ajouter une condition.** Cliquez sur le bloc, puis « Ajouter une condition » et choisissez son type : champ,
dernière analyse (quand elle est proposée), étiquette, jour, heures d'ouverture, heure, coordonnées ou consentement.

- Un champ texte ou nombre, ou une langue, laissé vide ne retient rien : la condition est toujours vraie. Une
  étiquette, des jours ou des pays laissés vides ne retiennent personne : elle est toujours fausse.
- « est exactement » respecte les majuscules, « contient » non. Une étiquette se compare lettre pour lettre,
  majuscules comprises.
- Un champ nombre vide n'est jamais comparé : ni plus grand, ni plus petit, ni égal.
- Jour, heure et heures d'ouverture suivent le fuseau de votre espace.

**2. Combiner plusieurs conditions.** Dès deux conditions, choisissez : « toutes les conditions sont vraies » ou « au
moins une condition est vraie ».

**3. Lire les champs Système.** Dans la liste des champs, sous « Système » : le dernier message reçu, la langue détectée
et le pays de l'indicatif.

- Le pays vient du numéro du contact : sans numéro, aucun pays ne le retient. Les départements d'outre-mer ont leur
  propre indicatif, à cocher en plus de la France.
- Une langue jamais détectée compte comme vide.
- « Dernier message reçu » est la date de son dernier message, réactions exclues.

**4. Ajouter des familles.** « Ajouter une famille » crée une autre branche, avec son nom et ses conditions.

- 10 familles au plus.
- Le contact suit la première famille vraie, de haut en bas ; si aucune ne l'est, il part sur « Sinon ».
- « Monter » et « Descendre » changent l'ordre sans décrocher les flèches. Retirer une famille retire sa flèche.

**5. Relier chaque sortie.** Une sortie par famille, à son nom, puis « Sinon ».

- Une sortie reliée à rien arrête le parcours, sans aucun avertissement.
- Un contact dont la fiche ne peut pas être lue part sur « Sinon ».
