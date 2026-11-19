# Copier le lien d'une invitation

Constat de Julien (2026-11-19) : un invité dont la messagerie bloque l'e-mail d'invitation reste bloqué. Rien ne permet
de lui faire passer le lien autrement : il n'existe qu'en empreinte en base (`auth_tokens.token_hash`), et réinviter la
même adresse rend 409 tant que la ligne « Invité » existe.

Décision de Julien (2026-11-19, « oui, avec la garde ») : un bouton « Copier le lien » sur chaque ligne « Invité » de
Compte et équipe, qui fabrique un lien neuf, AVEC une garde, parce que la page de l'invitation laisse choisir un mot de
passe à une adresse qui n'en a pas, et ce mot de passe est écrit sur l'IDENTITÉ, partagée par tous les espaces de la
personne. Sans garde, un admin qui copie le lien d'une personne connectée par Google ailleurs choisirait son mot de passe
et entrerait dans ses autres espaces.

## Méthode de livraison

**En direct, un lot, une relecture indépendante à la fin** : le chemin d'acceptation d'une invitation est un chemin de
production qui porte une frontière d'isolation (l'identité partagée entre espaces), donc le diff se relit ; mais le lot
est petit (une colonne, une route, une branche de refus, un bouton) et ses critères se prouvent par des tests.
L'essai réel qui clôt est écrit en fin de plan.

## Le lot

1. **Migration 0301** : `auth_tokens.partage boolean not null default false`. Part en `migration=avant` : le code neuf
   l'écrit et la lit, l'ancien l'ignore.
2. **`PgAuthTokenStore.remplacerInvitation(tenantId, userId, ttl)`**, en une transaction : la ligne du compte verrouillée
   et exigée invitée, de l'espace, non révoquée (sinon `null`) ; les jetons d'invitation vivants du compte annulés ; un
   jeton neuf marqué `partage`.
3. **`POST /tenants/:tenantId/users/:userId/lien-invitation`** (admins, comme tout le module) : rend `{ lien }`, 404 sur
   un compte qui n'est pas une invitation en attente de l'espace, journal `utilisateur.lien_invitation`.
4. **La garde, dans `accepterInvitation`** : un jeton `partage` ne pose pas de mot de passe sur une identité qui a un
   AUTRE compte, ouvert ou en attente (statut `lien_partage`, tout annulé, jeton intact). Google et le mot de passe
   actuel restent ouverts. La route rend 409 `lien_partage`, la page le dit.
5. **Console** : le bouton sur les lignes « Invité » non révoquées ; le lien copié dans le presse-papiers, et affiché en
   clair si la copie échoue (Safari après un appel réseau).

Risque restant, accepté par Julien : pour une adresse sans aucun compte, l'admin qui garde le lien peut choisir le mot de
passe de l'identité lui-même. Aujourd'hui il n'ouvre que son propre espace ; mais si la personne rejoint ou crée plus tard
un autre espace avec la même adresse (par Google, ou par le mot de passe actuel qu'elle ne connaît pas), ce mot de passe
l'ouvre aussi, jusqu'à une réinitialisation par e-mail. Le fermer : qu'un lien copié ne choisisse jamais de mot de passe.

## Tests

- route : 200 et lien bien formé, 404 hors espace ou compte actif, journal écrit ;
- store (intégration) : anciens jetons annulés, jeton neuf `partage`, `null` pour un compte actif ou révoqué ; garde :
  refus avec un autre compte (jeton intact), acceptation sans autre compte, Google non concerné ;
- console : le bouton n'apparaît que sur une invitation en attente.

## Essai réel qui clôt

Sur la production, inviter une adresse de test, « Copier le lien », ouvrir le lien dans une fenêtre privée, accepter :
le membre passe « Actif ». Puis inviter une adresse qui a déjà un compte Google ailleurs, copier, tenter un mot de
passe : refus, et Google accepte.
