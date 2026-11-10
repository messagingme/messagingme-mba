# La mémoire des fichiers déposés chez Meta (2026-11-10)

Demande de Julien après l'alerte de 19:04 : un message à image ou à document ne doit plus attendre des secondes à chaque
redémarrage du worker. Mesuré en production le même soir : lire un fichier de la médiathèque dans le bucket Scaleway
prend 1,1 à 2,3 s, jusqu'à 7,7 s, quelle que soit sa taille ; le déposer chez Meta, 0,7 à 1,1 s. Le `media id` rendu par
Meta n'est gardé que dans la mémoire du processus (`TemplateMediaPreparer`, 7 jours), perdue à chaque déploiement.

## Méthode de livraison

En direct, un implémenteur et une relecture du diff, parce que le chemin d'envoi d'une image est emprunté par la
production mais que le changement est réversible (la table vide, tout repart comme avant) et que ses critères se testent.
L'essai réel qui le clôt est décrit plus bas : deux messages à image de part et d'autre d'un redémarrage du worker.

## Tâches

1. Migration : la table `medias_meta` (espace, numéro, fournisseur, usage, empreinte de l'adresse, code de la
   médiathèque, `media id`, type, nom, date du dépôt), clé étrangère sur `tenants` en cascade (la suppression d'un espace
   l'emporte). Partie en `migration=avant`.
2. Le magasin `PgMemoireDesMedias` : lire une entrée de moins de 7 jours, noter un dépôt (et effacer les entrées de plus
   de 30 jours de l'espace), oublier un code de la médiathèque.
3. `TemplateMediaPreparer` : la mémoire du processus d'abord, la base ensuite, le dépôt enfin. Une panne de la base
   n'empêche jamais un envoi (on dépose comme avant). La clé porte l'espace, le numéro et le fournisseur.
4. La suppression d'un fichier de la médiathèque oublie ses entrées, dans sa transaction.
5. Câblage dans `src/workflow/wiring.ts` (seule instance du préparateur).

## Garde-fous

- 7 jours, comme la mémoire d'avant : un `media id` refusé par Meta après coup ne se rattrape pas.
- Pas de réveil à la publication d'un scénario : le premier envoi d'un fichier paie toujours le dépôt, une fois par
  semaine.

## Tests attendus

- Deux préparateurs partageant la même mémoire : le second ne relit ni ne redépose (le redémarrage).
- Une entrée d'un autre espace, d'un autre numéro ou d'un autre fournisseur n'est jamais reprise.
- Une mémoire en panne : l'envoi dépose quand même.
- Le magasin : le filtre d'espace sur chaque requête, l'âge de 7 jours, l'oubli à la suppression (intégration en CI).

## Essai réel

Après le déploiement, deux messages à image du scénario de LUAS de part et d'autre d'un redémarrage du worker : le
second répond en environ une seconde, et la table porte une ligne par image.
