# Shopify : l'attestation du consentement des clients

**Décision de Julien, 2026-11-20** (elle remplace celle du 2026-10-26, « aucune question au marchand ») : une case que le
marchand coche au branchement de sa boutique, par laquelle il atteste que ses clients consentent à recevoir ses messages
WhatsApp ; elle est historisée et il en porte la responsabilité.

- **Portée** : les trois automations (Meta demande l'accord pour tout message envoyé en premier). Sans case cochée,
  aucune ne s'allume, ni depuis la console ni depuis Claude Code.
- **Existantes** : rien n'est coupé ; l'écran Automation > Shopify demande la case, et tout NOUVEL allumage l'exige.
- **Texte** (mot pour mot, historisé) : « J'atteste que les clients de ma boutique ont accepté de recevoir de ma part des
  messages WhatsApp (confirmation et suivi de commande, relance de panier), et j'en assume la responsabilité. » En
  anglais pour une console en anglais ; le serveur choisit le texte selon la langue reçue, jamais un texte du client.
- **Retirer** la case (décocher) éteint les trois automations : elles ne pourraient plus s'allumer. Appel du constructeur.
- **Chaque envoi** continue d'écrire la fiche consentante (source `shopify:<boutique>`) ; un STOP reste un STOP.

## Méthode de livraison

**Implémenteur par lot + revue humaine du diff**, parce que le lot bloque un chemin que la production emprunte
(l'allumage des automations) et pose une migration lue par ce chemin : le serveur par moi, la console par un agent en
parallèle (fichiers disjoints), puis UNE relecture indépendante. L'essai réel qui clôt : sur Messaging Me demo, la case
demandée en tête d'Automation > Shopify, un allumage refusé sans elle puis accepté après, la ligne d'historique relue en
base (qui, quand, texte), et depuis Claude Code un allumage qui demande l'attestation au marchand.

## Tâches

1. **Migration 0305** `shopify_attestations` (historique en ajout seul ; l'état en vigueur est la dernière ligne).
   Appliquée AVANT le code (`migration=avant`).
2. **Serveur** :
   - `PgShopifyStore.attester(tenantId, {domaine, coche, texte, par, origine})` (l'e-mail se lit en base depuis `users`,
     scopé à l'espace) et `attestation(tenantId)` (la dernière ligne).
   - `src/shopify/lignes-gestion.ts` : `reglerAttestation(deps, tenantId, {coche, langue, origine}, par)` (boutique
     branchée exigée ; décocher éteint les lignes allumées) ; `reglerLigne` refuse d'allumer (409,
     `PHRASE_ATTESTATION_REQUISE`) sans attestation en vigueur.
   - `etatShopify` rend `attestation` (cochée, le, email, texte) ; route `POST .../integrations/shopify/attestation`
     (`{ coche, langue }`, Zod strict) ; le branchement console accepte `attestation: true` et l'enregistre.
   - MCP : `connect_shopify` et `set_shopify_message` acceptent `customers_consent_attested` (vrai : l'attestation est
     enregistrée, origine `claude_code`) ; le refus dit à Claude de poser la question au marchand ; `get_shopify_state`
     rend `customers_consent_attested`.
   - Tests : store (faux), refus d'allumer, décocher éteint, route, MCP.
3. **Console** (agent) : la case au branchement (`ShopifyBrancher`, requise pour brancher), le bandeau en tête
   d'Automation > Shopify (case, qui et quand une fois cochée, décocher avec confirmation), lecture défensive de
   `attestation`, e2e.
4. **Doc** : `features.md` (empreinte de la fiche), fiche `brancher-ma-boutique-shopify` FR et EN, skill `shopify`
   (+ version du plugin), `documentation.md`, journal.

## Déploiement

`migration=avant` (la table neuve, lue par l'allumage), puis l'API ; la console, publiée au push, lit `attestation`
défensivement : avant l'API, la case ne s'affiche pas et rien ne change.
