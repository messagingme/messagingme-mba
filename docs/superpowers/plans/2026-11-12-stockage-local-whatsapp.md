# Le contenu WhatsApp stocké en Allemagne, pour chaque numéro neuf

Décision de Julien, 2026-11-12 : à chaque connexion d'un numéro, demander à Meta le stockage local de la Cloud API,
pour que le contenu des messages (texte, médias) ne soit gardé que dans l'Union européenne. Seuls les numéros
NEUFS sont concernés : les numéros déjà connectés restent tels quels (choix de Julien, pas de coupure).

## Ce que Meta permet (lu le 2026-11-12)

- `POST /{phone_number_id}/settings` avec `storage_configuration: { status: "IN_COUNTRY_STORAGE_ENABLED",
  data_localization_region: "DE" }`, API v21 et plus (nous sommes en v25). Uniquement sur un numéro NON enregistré,
  donc juste AVANT `/register`.
- L'Allemagne est le seul pays de l'Union dans la liste (la Suisse et le Royaume-Uni n'en sont pas).
- Le contenu peut être traité ailleurs pendant 60 minutes au plus (90 pour MM Lite), puis n'est gardé qu'en
  Allemagne. Le carnet de contacts de Meta (numéros des fiches contact partagées) n'est pas couvert.
- Un numéro en coexistence (application WhatsApp Business) n'est jamais `/register` chez nous : il n'est pas couvert.
  Un compte 360dialog non plus (son enregistrement passe par 360dialog).

## Tâches

1. `MetaEmbeddedSignupClient.register`, seule source de l'appel `/register` : pose le stockage local juste avant,
   si une région est configurée. Un refus de Meta est journalisé (`stockage_local_refuse`) et n'empêche PAS
   l'enregistrement (choix de Julien : la connexion n'est jamais bloquée).
2. `META_STOCKAGE_LOCAL` (défaut `DE`, vide = désactivé, deux lettres sinon) : le levier si Meta cassait la
   connexion sur ce réglage, sans déployer de code.
3. Câblage : le client d'inscription de `src/index.ts` reçoit la région.
4. Tests : l'ordre (`settings` puis `register`), le corps exact, le refus qui laisse passer l'enregistrement, la
   région vide qui n'appelle rien, la configuration qui refuse une valeur malformée.
5. Doc : `documentation.md`, `docs/ARCHITECTURE-CIBLE.md` et la page « Architecture de sécurité » (Claude Docs).

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que la connexion d'un numéro est un chemin que la
production emprunte, et que le réglage est irréversible pour un numéro enregistré (il faudrait le désenregistrer).
Un seul lot, relu une fois. Essai réel qui clôt la feature : à la prochaine connexion d'un numéro neuf en
production, lire `GET /{phone_number_id}/settings` et voir `IN_COUNTRY_STORAGE_ENABLED` avec `DE`, et l'absence de
`stockage_local_refuse` dans les journaux de l'API.

## Déploiement

API seule, aucune migration (`migration=aucune`), aucune variable à poser (le défaut vaut `DE`).
