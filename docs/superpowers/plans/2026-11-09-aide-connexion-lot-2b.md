# Lot 2b de l'aide à la connexion : la langue des e-mails apprise à la création du compte

**But :** une personne qui crée son compte sur un écran en anglais reçoit ses e-mails de service en anglais, sans avoir
à basculer la langue dans la console. Aujourd'hui `identities.langue` (migration 0234, `fr` par défaut) n'est écrite que
par la bascule (`/compte`, menu du compte) : un écran en anglais (lot 2, ou `?lang=en`) laisse des e-mails en français.

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md), section « Lot 2b ».

## Méthode de livraison

Implémenteur (cette session) puis une relecture indépendante du diff, parce que le chemin touche l'inscription et
l'identité, que la production emprunte à chaque nouvel espace, et qu'il porte des invariants invisibles (`on conflict do
nothing` de l'identité, reprise d'une identité née d'une invitation). La même relecture porte la dette de la vitrine
(`77b629e5`, `76a0e2b4`). Aucune migration : la colonne existe.

**Essai réel :** Julien crée un espace par Google, avec une adresse Google JAMAIS VUE par Messaging Me (une identité qui
existe garde sa langue, par décision), depuis un navigateur en anglais sans choix mémorisé (fenêtre privée). Tout de
suite, « Mon compte », section « E-mails de Messaging Me », affiche l'anglais (elle lit `identities.langue`) ; puis
l'e-mail « bienvenue » arrive en anglais (le balayage passe toutes les 30 minutes, aux admins déjà connectés).

## Ce qui change

1. **L'identité naît dans la langue de l'écran.** `ensureIdentity` reçoit la langue (défaut `fr`) et ne l'écrit qu'à la
   naissance : `on conflict do nothing` ne change pas, une identité existante garde la sienne. `createTenantWithAdmin`
   (store et contrat `ComptesAuthDep`) la porte dans `admin.langue`.
2. **Google.** `entrerParGoogle(deps, idToken, origine, langue)` la transmet à la création, et le nom de l'espace la
   suit : « Espace de Alice » ou « Mon espace » en français, « Alice’s workspace » ou « My workspace » en anglais.
   `/auth/google` lit `langue` dans le corps (`'en'`, sinon `'fr'`, jamais un refus) ; `/oauth/consentement/google`
   aussi (`ParGoogle`, une valeur inconnue vaut `'fr'`).
3. **Le lien e-mail.** Au clic (`confirmerUneFois`), l'identité naît avec `inscriptions_attente.langue`, la langue de
   la page d'où le lien a été demandé (la confirmation n'en envoie pas). Une identité sans mot de passe ni compte ouvert
   (née d'une invitation, ou dont tous les comptes ont été supprimés) que le clic reprend la reçoit aussi : la personne
   qui prouve l'adresse en devient la seule titulaire. La même identité qui revient par Google garde la sienne.
4. **La console.** `loginWithGoogle` et `continuerAvecGoogle` envoient `langue()` de `web/lib/http.ts`, la même règle
   que l'écran (`?lang=`, puis le choix mémorisé, puis la langue du navigateur), lue au clic. L'inscription par e-mail
   envoie déjà la sienne.

**Hors du lot :** une identité existante ne change jamais de langue à la connexion (seul le choix de la personne la
change) ; l'invitation (l'identité de l'invité naît chez l'invitant, et l'e-mail d'invitation n'existe qu'en français)
va au `todo.md`.

## Tests attendus (chacun vérifié dans les deux sens)

- `tests/auth-entree-google.test.ts` : la langue passe à la création ; nom anglais et repli anglais ; `fr` sans langue.
- `tests/auth-google.test.ts`, `tests/http-oauth.test.ts` : `langue: 'en'` crée en anglais ; absente ou inconnue, `fr`,
  sans refus.
- `tests/integration/inscriptions.integration.test.ts` : le clic d'une demande `en` fait naître l'identité en `en` ; une
  identité existante garde sa langue quand un second espace se crée. `tests/integration/invitations.integration.test.ts`
  : la reprise au clic pose la langue de la demande.
- `web/lib/oauth.test.ts` et `web/lib/api/auth.test.ts` (nouveau) : le corps envoyé porte la langue de l'écran.

## Ordre de déploiement

Un seul commit. Les deux ordres sont sûrs : l'API ignore un champ qu'elle ne connaît pas, et sans champ elle écrit `fr`
comme aujourd'hui. Vercel publie la console au push ; l'API part par `deploy-scaleway.yml` avec `migration=aucune`,
après la CI lue job par job, sur l'approbation de Julien. Puis, la fiche des e-mails ayant changé, `aide:charger` sur
la machine avec l'image déployée (`DEPLOY.md`, gestes d'après), par Julien, après avoir vérifié qu'aucun pair n'a
chargé plus récent.

## La relecture

Une relecture indépendante, aucun rouge. Quatre jaunes, tous dans la doc et ce plan, corrigés dans le même commit sans
relecture propre :
- la reprise au clic vaut aussi pour une identité dont tous les comptes ont été supprimés ;
- la langue est celle de la page d'où le lien a été demandé, pas celle de la confirmation (fiche et `features.md`) ;
- `aide:charger` manquait à l'ordre de déploiement ;
- l'essai réel exige une adresse jamais vue, et se lit d'abord dans « Mon compte » ;
- en détail, le nom anglais de l'espace dans `documentation.md`.

La même relecture a porté la dette de la vitrine. `77b629e5` est sans remarque. `76a0e2b4` laisse deux jaunes, à
reprendre avec le prochain lot de la vitrine :
- **le détour par e-mail n'a pas d'image** : les écrans 2 et 3 sont la suite de Google, et la personne qui suit le
  lien (le nom de l'espace, le mot de passe) ne retrouve rien du tunnel. Une capture du détour, légendée.
- **Codex voit un encadré « non vérifié »** sur `/autoriser` (client déclaré), que le tunnel n'annonce pas. Un indice
  de trois mots sous sa ligne, ou une capture de sa variante.
