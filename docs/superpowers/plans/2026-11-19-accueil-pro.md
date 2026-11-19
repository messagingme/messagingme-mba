# Plan : l'accueil d'un nouveau compte Pro (2026-11-19)

Cadrage : [la spec du même jour](../specs/2026-11-19-accueil-pro-design.md). Une fenêtre de bienvenue au-dessus de
l'Accueil, « Faire le tour » (bulles sur la vraie console) ou quatre raccourcis, qui revient jusqu'à un choix, pour
tout nouveau membre d'un espace qui a la console, jamais pour un compte déjà en service le jour de la livraison.

## Méthode de livraison

**En direct**, sans agent, avec UNE relecture indépendante en fin de lot, parce que le changement est isolé et
réversible : une colonne nullable ajoutée, une route qui n'écrit qu'une date sur le compte de la personne connectée, un
composant d'affichage. Aucun envoi, aucun chiffre affiché, aucun chemin chaud ne passe par là. Les critères visuels (la
fenêtre, les bulles) ne se jugent qu'à l'œil, ce qui écarte feature-loop. **L'essai réel qui clôt la feature** : un
espace Pro neuf (essai de 14 jours), sa première connexion, la fenêtre, le tour jusqu'au bout ; une seconde connexion où
elle ne revient plus ; un membre invité dans cet espace qui la voit à son tour, sans les raccourcis d'administrateur ; et
un compte Pro existant qui ne la voit pas.

## Tâches

1. **Migration `0303_accueil_console.sql`** (le numéro se relit par `npm run migrations` au moment d'écrire) :
   `alter table users add column if not exists accueil_choisi_le timestamptz`, puis `update users set
   accueil_choisi_le = now() where accueil_choisi_le is null` dans la même migration : tout compte existant est réputé
   avoir choisi (« seulement les nouveaux »). Un compte créé après la migration naît `null`. Part en `migration=avant`
   (le code neuf lit la colonne ; l'ancien l'ignore et survit). Relecture en base après : colonne, type, nullabilité,
   aucune ligne `null` au moment de la migration.
2. **API** : `GET /tenants/:tenantId/me` rend en plus `accueilAFaire: true` quand la colonne du compte est `null` (posé
   seulement vrai, comme `exploitation`) ; jamais pour la session d'observation de `/ops`. Nouvelle route
   `POST /tenants/:tenantId/moi/accueil` (module `tenant`, garde requise, corps vide `.strict()`), qui pose
   `accueil_choisi_le = now()` sur le compte de la session (`req.auth.userId` ET `tenant_id = espaceVerifie(req)`),
   idempotente. Le store qui sert `getById` porte la lecture ; aucun nouveau store.
3. **Console, la fenêtre** (`web/components/AccueilBienvenue.tsx`), montée par la coquille sur l'Accueil seulement,
   quand `me.accueilAFaire` et que l'offre ouvre la console : « Bienvenue », « Faire le tour », puis les raccourcis
   « Connecter mon numéro » (s'il n'y a pas de numéro, et pour un administrateur), « Lancer une campagne », « Construire
   un agent IA » (création, onglet « Construire en parlant »), « Brancher un outil » (Tools > Intégrations, pour un
   administrateur), et « Ne plus afficher ». Chacun de ces gestes appelle la route de la tâche 2 AVANT de naviguer ;
   fermer la fenêtre par la croix ou Échap ne la marque pas : elle revient à la connexion suivante.
4. **Console, la visite** (`web/components/VisiteConsole.tsx`, sans dépendance) : une bulle ancrée sur un élément par
   son `data-testid` (barre : Accueil, Inbox, Campagnes, AI Agent, Tools ; le bouton d'aide), « Suivant », « Précédent »,
   « Quitter », la position recalculée au redimensionnement ; une zone absente (repliée, verrouillée par l'offre) est
   sautée, jamais pointée dans le vide. Textes FR et EN, une phrase chacun, vouvoiement.
5. **Le retour par l'aide** : une entrée « Faire le tour » dans le panneau d'aide de la console relance la visite pour
   tout compte, sans toucher à la colonne.
6. **Aide** : une étape dans `me-reperer-dans-la-console.md` (« Faire le tour »), sa capture, sa version anglaise,
   `vitrine:aide`. `features.md` : un paragraphe sous l'Accueil (empreintes des fiches qui citent la section à relire).

## Tests

- Unitaires : `/me` rend `accueilAFaire` pour un compte `null` et pas pour un compte marqué ni pour l'observation ops ;
  la route de marquage écrit le compte de la session et RIEN d'autre (un autre compte du même espace, un compte d'un
  autre espace restent intacts), 401 sans session, 400 sur un corps non vide.
- `tests/scope-tenant.test.ts` couvre la route d'office (module `tenant`) ; auto-attaque lancée en local.
- Intégration (CI) : la migration sur un `users` peuplé laisse zéro `null`, un insert neuf naît `null`.
- e2e console : la fenêtre s'ouvre sur un compte `accueilAFaire`, un raccourci appelle la route puis navigue, la croix
  n'appelle rien, la visite saute une zone absente, un membre non administrateur ne voit ni le numéro ni les outils.

## Déploiement

Migration `avant` (`gh workflow run deploy-scaleway.yml -f migration=avant`), puis l'API ; la console part au push mais
tolère l'absence du champ (`accueilAFaire` absent = rien à montrer), donc aucune fenêtre ouverte sur une route manquante.
Puis `aide:charger` pour la fiche retouchée, et l'essai réel ci-dessus.
