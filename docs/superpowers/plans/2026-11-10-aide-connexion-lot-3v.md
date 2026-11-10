# Lot 3v de l'aide à la connexion : l'arbre du Crédit WhatsApp en libre-service

**But :** que la console vende le Crédit WhatsApp comme le serveur le permet depuis V1 (l'option se prend dès le début
de l'essai Pro), et que la personne qui a payé l'option choisisse « Votre numéro, ou le nôtre ? », le nôtre passant
aussi par la fenêtre du partenaire. Découpage de 3v validé par Julien le 2026-11-10 : la session du crédit porte le
serveur (V1 et V2 en production), celle-ci l'arbre.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md),
« Décisions de Julien (2026-11-10) » points 1 à 3 ; le contrat d'état de l'essai, au plan du crédit
[2026-11-10-credit-whatsapp-vente-libre-service.md](2026-11-10-credit-whatsapp-vente-libre-service.md).

## Méthode de livraison

Implémenteur (cette session) puis une relecture indépendante du diff, parce que la carte « Crédit WhatsApp » ouvre un
paiement Stripe et la fenêtre du partenaire, que la règle de la prise doit rester celle du serveur (sinon un écran vend
ce que le serveur refuse) et que le numéro fourni par la fenêtre ne doit jamais partir en `fourni_application`. Les
gardes (unitaires, e2e) sont vues rouges par mutation.

**Essai réel :** sur un espace Pro de TEST dans ses 14 jours, à l'ouverture de la vente : « Prendre l'option » se paie,
puis « Votre numéro, ou le nôtre ? » ; « Le nôtre » attribue le numéro fourni et ouvre la fenêtre du partenaire, sans
carte chez Meta ; l'onglet Crédit WhatsApp ne propose plus de démarrer la formule Pro.

## Deux livraisons

**3v-1, la console, maintenant.** Elle décide sur l'état que rend le serveur, donc elle est juste avant comme après
l'ouverture de la vente (hors vente, la carte reste grisée, « sur demande »). C'est le premier préalable au prix (V4 du
plan du crédit).

**3v-2, au moment du prix.** La vitrine, la skill, les consignes de Claude, la fiche et la FAQ disent aujourd'hui « sur
demande » ; ce sont des textes fixes, qui ne lisent pas l'état. Ils changent le jour où Julien pose le prix, dans un
commit préparé d'avance : la branche du crédit dans l'arbre, « Votre numéro, ou le nôtre ? » et la phrase validée, et
le lien de Claude (`/brancher`) qui ouvre la fenêtre du partenaire au numéro fourni.

## 3v-1 : ce qui change

1. `web/lib/api-credit-whatsapp.ts` : la vue lit `option.prisePossible` ; absent (une API d'avant V1), il vaut
   `formulePayee`.
2. L'onglet Crédit WhatsApp (`OptionDuCredit`) : `attend` lit `prisePossible` ; « Prendre l'option » ne paraît que si
   `prisePossible`, `disponible` et aucune option vivante. « Démarrer la formule Pro maintenant » disparaît : un Pro en
   essai prend l'option directement.
3. La carte « Crédit WhatsApp » (`QuiRegleMeta`) : sans `DemarrerPro` ; l'état `essai` dit sa raison par offre (un
   Business en essai : l'option s'ouvre quand sa formule est confirmée ; un Pro en retard : la phrase de
   `formule_en_retard`).
4. « Votre numéro, ou le nôtre ? » (`QUESTION_LIGNE_NUMERO`, `questions-numero.ts`) quand la fenêtre du partenaire est
   ouverte : « Mon numéro » dit la phrase validée de Julien, puis « Connecter sans carte chez Meta » ; « Un numéro de
   chez vous » ouvre le parcours du numéro fourni (`ParcoursNumero`, `fourni`) avec `parLaLigne` : la fenêtre s'ouvre
   avec la solution du partenaire et la fin passe par la ligne, jamais `fourni_application`.
5. L'en-tête de `BandeauLigneCredit.tsx` (jaune 5 de la relecture de V2) et les commentaires d'avant V1.

## Tests attendus

- `web/lib/api-credit-whatsapp.test.ts` : `prisePossible` lu, et repli sur `formulePayee` sans lui.
- `web/e2e/offre-credit-whatsapp.spec.ts` : un Pro en essai voit « Prendre l'option » et jamais « Démarrer » ; un
  Business en essai lit sa raison ; un Pro en retard aussi.
- `web/e2e/qui-regle-meta.spec.ts` : `essai` par offre ; « Votre numéro, ou le nôtre ? » ; « Un numéro de chez vous »
  ouvre la fenêtre avec la solution et finit par la ligne (le corps de `completer` porte `parLaLigne`).
- La suite racine entière (parité, inventaires), la suite de la console, tsc, lint, sondes d'attaque.

## Ordre de déploiement

3v-1 : la console seule, par Vercel ; l'API rend `prisePossible` depuis V1 (en production). Rien côté serveur.
3v-2 : avant le prix, après accord de Julien sur le jour.
