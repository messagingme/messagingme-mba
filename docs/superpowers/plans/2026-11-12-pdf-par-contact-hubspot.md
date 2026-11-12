# Plan : un PDF propre à chaque contact, venu de HubSpot, en document WhatsApp

Cadrage et décisions de Julien : `docs/superpowers/specs/2026-11-12-pdf-par-contact-hubspot-design.md` (lot 0 mesuré le
même jour). Ce plan couvre les lots mba (A, B1, B2) ; le lot C (connecteur) a son plan dans `~/mm-hubspot` une fois ses
portées mesurées.

## Choix techniques (tranchés ici)

- **Le document se range par NUMÉRO, pas par fiche** : la route du workflow reçoit souvent un lead que mba ne connaît
  pas encore (la fiche naît dans la transaction de la campagne). Table `documents_contact (tenant_id, wa_id, code,
  nom, taille, empreinte, cree_le)`, clé d'objet `tenants/<t>/documents/<wa_id>/<code>.pdf` : la purge d'un contact
  efface son préfixe, la suppression d'un espace est déjà couverte par `tenants/<t>/`.
- **Pas de nouveau type de champ** : le champ `hs_calc_document` est un texte qui porte le code `doc_…`. À l'envoi, le
  code n'est accepté que s'il appartient à CET espace et à CE numéro ; sinon, refus.
- **La source d'en-tête est un indice de position 0** dans `template_param_hints` (même table, même store, même écran
  que les variables), seulement `{ type: 'field' }`, seulement sur un modèle à en-tête DOCUMENT.
- **Seul un scénario envoie un en-tête variable.** Campagne, Inbox, API publique, MCP et action « Envoyer un modèle » de
  HubSpot préparent l'en-tête une fois pour tous (campagne) ou n'ont pas la fiche : un modèle à en-tête variable y est
  REFUSÉ, message clair. Sinon le fichier d'exemple du modèle (un devis témoin) partirait à tout le monde.

## Lot A : la table, la purge, l'effacement à 30 jours

1. Migration `0291_documents_contact.sql` (numéro relu par `npm run migrations` au moment d'écrire) : la table, sa clé
   `(tenant_id, code)`, un index `(tenant_id, wa_id)` pour la purge, un index `(cree_le)` pour le balayage.
2. Purge RGPD (`PgContactStore.purgeMany`) : efface les lignes du numéro dans la même transaction ; APRÈS le commit,
   `effacerPrefixe(tenants/<t>/documents/<wa_id>/)`. Un échec du bucket est journalisé, la purge en base tient.
3. Balayage : une étape `documents` dans `retentionSweep` (`src/worker.ts`) : au-delà de 30 jours, l'objet, la ligne,
   et le champ de fiche qui porte ce code.
4. 🔴 La purge NOMME la table : migration poussée SEULE et appliquée (`migration=avant`) AVANT le code (règle du dépôt).

## Lot B1 : recevoir et recopier le PDF

1. `CALCULES_HUBSPOT` gagne `document` (contrat avec le connecteur : une adresse `https` ou `''`), déclaré en texte.
2. (Relecture du lot A) La recopie qui retrouve un code par son empreinte n'accepte qu'une ligne vivante (`wa_id is not
   null`) de MOINS de 30 jours : une ligne plus vieille peut voir son objet effacé par le balayage entre deux requêtes.
3. Un module `src/documents/recopie.ts` : télécharge l'adresse par `fetchPublic`, en binaire et borné (16 Mo, 10 s, sur
   le modèle de `telechargerEntete`), vérifie la signature `%PDF-`, dédoublonne par empreinte, dépose, rend le code.
   Il entre dans l'inventaire de `tests/lib-adresse-privee.test.ts`.
4. Les routes `/hubspot/workflow/scenario`, `/transaction` et `/hubspot/deal-stage` recopient AVANT `champsDeFiche` :
   l'adresse reçue devient le code ; un échec (refus, trop gros, pas un PDF) RETIRE le champ et journalise la cause,
   jamais l'adresse (elle est signée).
5. Décision 3 dans `garderLancement` : si le modèle d'ouverture du scénario a une source d'en-tête et que le champ visé
   sera vide, l'action rend `document_absent`, que l'historique du workflow HubSpot affiche.

## Lot B2 : l'en-tête qui vient de la fiche

1. API des modèles (`src/http/templates.ts`, `src/templates/gestion.ts`) : accepter l'indice de position 0 aux
   conditions ci-dessus, le refuser ailleurs (400 lisible).
2. Console (`web/components/TemplateForm.tsx`) : sous un en-tête Document, le choix « le fichier du modèle » ou « un
   champ de la fiche » (sélecteur des champs, comme une variable).
3. Envoi par le bloc modèle (`src/workflow/envois-bloc.ts`) : indice 0 présent, on lit le code sur la fiche, le document
   (espace et numéro vérifiés), on le dépose chez Meta par `TemplateMediaPreparer` (usage `fichier`, adresse `doc:<code>`
   pour la mémoire des dépôts), envoyé par identifiant avec son nom d'origine. Absent ou effacé : le bloc échoue avec sa
   raison au journal des échecs de scénario, rien ne part.
4. Les refus des autres chemins : `lancerEnvoiPublic`, création de campagne, Inbox, catalogue de la carte HubSpot.

## Rayon de souffle

- `template_param_hints` est lu par la carte HubSpot (`listerParEspace`), l'aperçu Inbox, l'action transaction et le
  bloc : chacun doit IGNORER la position 0 dans sa résolution des variables (`resolveHintParams` compte les positions).
- La mémoire `medias_meta` a une clé par adresse : `doc:<code>` ne doit jamais rencontrer une adresse de médiathèque.
- La purge et le balayage écrivent dans le bucket : un `effacerPrefixe` mal formé effacerait la médiathèque de l'espace
  (test sur la clé exacte).

## Tests

Chaque mécanisme vérifié dans les deux sens : recopie (PDF, pas PDF, trop gros, adresse interne, doublon), code d'un
autre numéro ou d'un autre espace refusé à l'envoi, position 0 ignorée par les résolutions de variables, refus des
chemins non-scénario, purge (base et préfixe exact), balayage à 30 jours, `document_absent`. Intégration : la purge
réelle relit la table vide.

## Méthode de livraison

Implémenteur par lot et revue humaine du diff : envoi de messages, migration nommée par la purge RGPD, fichier personnel
recopié chez nous ; une relecture indépendante par lot avant son déploiement. L'essai réel qui clôt la feature : sur le
portail de MUTAC, l'e-mail avec le devis puis le passage à l'étape 2 font arriver le devis en document sur le WhatsApp de
Julien, à son nom ; le même passage sans e-mail ne fait rien partir et l'historique du workflow le dit.

## Déploiement

A seul (`migration=avant`), puis B1 et B2 ensemble (API ; console après l'API, elle appelle la source d'en-tête), puis
le connecteur (lot C). Rien ne part tant que le connecteur n'envoie pas `document`.
