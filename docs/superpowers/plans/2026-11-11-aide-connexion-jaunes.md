# Les jaunes du chantier « aide à la connexion du numéro »

**But :** fermer, en attendant les rushes de Julien, les jaunes que les relectures des lots 3b à 4b ont laissés au
backlog et qui ne dépendent ni des rushes ni du prix (« Oui, vas-y », Julien, 2026-11-11).

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md) ;
la liste vient de `todo.md` (sections des lots 4b, 4a-2, 3v-1, 3b et 3c).

## Méthode de livraison

En direct, une relecture indépendante du diff : des retouches séparées, réversibles, chacune tenue par un test (un e2e
pour la console). La console et la vitrine partent par Vercel au push ; la consigne de `get_setup_state` demande le
déploiement de l'API, sans migration ; le plugin ne change pas.

**Essai réel :** sur Connecter WhatsApp, la fenêtre du partenaire ouverte, les autres voies ne se cliquent plus, et « Le
mien » montre ses conditions chez Meta ; sur un téléphone, `/demarrer/` n'affiche les étapes qu'une fois.

## Ce qui change

1. **Changer de voie, une fenêtre de Meta ouverte** (lot 3v-1) : `QuiRegleMeta` ferme « Je mets un moyen de paiement… »
   et les deux réponses de « Votre numéro, ou le nôtre ? » tant qu'une fenêtre est ouverte, par la voie de la carte
   (`occupe`, que la page tient de son parcours) ou par une voie de la ligne (`surOccupe` de `ParcoursNumero` et du
   bouton du partenaire). La connexion en cours n'est plus démontée.
2. **Les conditions de « Le mien »** (lot 4a-3) : l'encadré « Avant de commencer, chez Meta » (`EncadreChezMeta`, sorti
   de `ParcoursNumero`) avec `PREREQUIS_LIGNE` et le numéro avec son téléphone (`NUMERO_LIGNE_MIEN`).
3. **« Payer Meta » quand la carte est à régler** (lot 4b) : `get_setup_state` rend `aide` aussi avec
   `carte_meta_a_regler`, et sa description le dit (le plugin n'a pas à changer).
4. **Le guide « Pièges de Meta »** (lot 4a-3) : le moyen de paiement chez Meta « sauf avec le Crédit WhatsApp », et sa
   doc publique régénérée (`npm run doc:md`).
5. **Le titre des modèles WhatsApp** (lot 4a-2) : sous 60 caractères avec son suffixe.
6. **Les étapes du tunnel une seule fois** (lots 3b et 3c) : un bloc par issue, le titre et la demande de chaque offre
   marqués `data-offre`, que `site.css` masque pour l'autre offre (environ 51 Ko de moins par page).
7. **La capture de l'encadré chez Meta** (lot 4a-3) : l'étape 2 de « Connecter mon numéro WhatsApp », refaite.

Restent au backlog : les modes op C, D et E et les films (rushes de Julien), « Meta facture directement » des cas d'usage
(3v-2, le jour du prix), Codex (à mesurer sur Codex).

## Ordre de déploiement

1. Le push : la console et la vitrine par Vercel.
2. L'API, pour la description et la règle de `get_setup_state`.
