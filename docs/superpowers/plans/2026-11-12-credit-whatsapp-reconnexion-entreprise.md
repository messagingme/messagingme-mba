# Reconnecter sans carte chez Meta le numéro d'une Entreprise (Crédit WhatsApp)

**Le problème.** Une Entreprise dont le numéro a été connecté en direct (sa carte chez Meta) avant que la fenêtre du
partenaire existe ne peut pas passer sur la ligne : le partenaire ne voit pas son compte WhatsApp (mesuré le 2026-11-12 sur
celui de MUTAC : `500`, erreur Graph 100/33), donc sa ligne ne peut pas s'y attacher et la pose de `/ops` est refusée. Le
serveur rouvre pourtant la fenêtre du partenaire à l'unique numéro d'un espace qui a droit à la ligne (`seReconnecte`,
Entreprise comprise), et la fin de la connexion pose la ligne, l'attache vérifiée (V3, plan
`2026-11-12-credit-whatsapp-attache-par-l-api.md`). Il ne manque que l'écran : le bouton de la reconnexion n'existe que dans
l'onglet Crédit WhatsApp d'une formule Pro ou Business avec l'option, onglet qu'une Entreprise sans ligne ne voit pas, et
le lien de Claude refuse un espace qui a déjà un numéro. Décision de Julien du 2026-11-12 : « Oui, fais le bouton ».

## Tâches

- [ ] **La carte « Qui paie vos messages à Meta ? »** de Connecter WhatsApp (`QuiRegleMeta`), un numéro connecté, une
  Entreprise sans ligne (`a_prendre`) dont le serveur rouvre la fenêtre (`fenetrePartenaire`) : la phrase de la
  reconnexion et, pour un administrateur, « Reconnecter mon numéro sans carte chez Meta », qui ouvre la fenêtre de Meta par
  la solution du partenaire (`parLaLigne`) ; la fin de la connexion relit l'état de la ligne. Sans fenêtre (numéro en
  coexistence, déjà sur une ligne, rien de configuré), « sur demande », comme avant. La page passe à la carte sa
  connexion aussi quand un numéro est connecté. (Connecter WhatsApp est réservée aux administrateurs : écran `accueil`.)
- [ ] Tests e2e (`web/e2e/qui-regle-meta.spec.ts`) : le texte, le bouton, les options de `FB.login` (la solution), la fin
  envoyée par la ligne et l'état relu ; la fenêtre fermée ; les cas Pro d'avant inchangés.

## Ordre de déploiement

La console seule (Vercel, au push), aucune route neuve : la configuration de la connexion et la fin de l'Embedded Signup
existent et sont en production depuis le 2026-11-11.

## Méthode de livraison

**En direct, sans agent, puis une relecture du lot**, parce que le changement est isolé (un composant et sa page),
réversible au push suivant, et que ses critères se vérifient par des tests e2e ; le chemin serveur qu'il ouvre (la
reconnexion, la pose et l'attache) est déjà en production et testé.

**Essai réel** : sur l'espace MUTAC (son compte WhatsApp, connecté en direct le 2026-11-09, est dans l'essai 257 de
`docs/prive/ESSAIS-REELS.md`), cliquer
« Reconnecter mon numéro sans carte chez Meta », choisir dans la fenêtre de Meta le même compte et le même numéro, puis
relire chez le partenaire que sa ligne est attachée (`creditLineAdded: true`), voir la carte dire « Vos messages sont payés
par votre Crédit WhatsApp. », et vérifier que l'agent de Meta de MUTAC répond toujours.
