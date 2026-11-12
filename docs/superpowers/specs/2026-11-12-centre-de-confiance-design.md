# Le Centre de confiance de la vitrine

Décisions de Julien, 2026-11-12 (grill en trois rondes, maquette validée « c'est top ») : une rubrique publique, au
standard des « trust centers » du marché, vers laquelle on envoie un client, son RSSI ou son DPO pour le rassurer.
Claire, précise et assez fournie. Elle dit ce que fait Meta, ce que fait Messaging Me, ce qui reste au client, et
comment on répond au RGPD et à l'AI Act au-delà de l'hébergement européen.

## Les pages

| Page | Adresse | Jumelle anglaise |
|---|---|---|
| Centre de confiance (la page riche) | `/confiance/` | `/en/trust/` |
| RGPD en détail | `/confiance/rgpd/` | `/en/trust/gdpr/` |
| AI Act en détail | `/confiance/ia/` | `/en/trust/ai-act/` |
| Sous-traitants (liste datée) | `/confiance/sous-traitants/` | `/en/trust/subprocessors/` |

Accès : une entrée « Centre de confiance » dans le menu **Ressources** de l'en-tête (bureau et téléphone), et un lien
dans le pied de page. Les anglaises se GÉNÈRENT par les dictionnaires (`scripts/vitrine/anglais/`).

## Ce que la page principale contient, dans l'ordre (maquette validée)

1. **Héros** : surtitre « Centre de confiance », titre « Vos conversations WhatsApp, protégées à chaque étape. »,
   chapeau, quatre repères : Union européenne (Scaleway, Amsterdam) ; Allemagne (contenu WhatsApp gardé par Meta en
   Allemagne, demandé à la connexion du numéro) ; ISO 27001 · SOC 2 (Meta, Cloud API) ; Cloudflare (pare-feu applicatif
   et anti-DDoS devant chaque accès). Puis un sommaire collant.
2. **Le chemin d'un message** : schéma SVG animé à cinq étapes (défilement automatique, clic qui fige, lisible sans
   JavaScript et sans animation : `prefers-reduced-motion` coupe le défilement). Étapes : (1) le client écrit,
   chiffrement Signal jusqu'à la Cloud API ; (2) Meta reçoit, contenu gardé en Allemagne 30 jours au plus, chiffré au
   repos, ISO 27001 et SOC 2 Type II ; (3) Cloudflare seule porte d'entrée, signature de chaque webhook vérifiée avant
   lecture ; (4) Messaging Me traite dans l'UE, API et console en serverless chez Scaleway à Amsterdam, réseau privé,
   base chiffrée sans adresse publique ; (5) l'IA et le CRM.
3. **Qui fait quoi** : Meta (le transport), Messaging Me (la plateforme), vous (vos usages).
4. **Certifications expliquées** : ISO 27001 (Meta, Scaleway, Cloudflare), SOC 2 Type II (Meta pour la Cloud API,
   Cloudflare). Phrase obligatoire : Messaging Me s'appuie sur des fournisseurs certifiés (jamais « Messaging Me est
   certifiée »). Les rapports SOC 2 de Meta se demandent à Meta.
5. **Chiffrement** : en transit (Signal côté WhatsApp, TLS et HSTS partout, base en TLS vérifié) ; au repos (base
   chiffrée, secrets des clients en AES-256-GCM : jetons Meta, mots de passe SMTP, clés d'IA, secrets d'intégration et
   de second facteur ; mots de passe en scrypt ; clés d'API conservées en empreinte).
6. **Accès** : trois rôles (admin, manager, agent), configuration réservée à l'admin ; second facteur (application
   d'authentification et codes de secours), exigeable des admins ; **SSO d'entreprise sur demande** ; journal d'audit
   daté et signé de son auteur, exportable ; exploitation interne nominative avec second facteur obligatoire ;
   cloisonnement entre espaces vérifié à chaque version par un test qui appelle chaque route avec la session d'un autre
   espace.
7. **Exploitation** : à chaque version, tests unitaires, d'intégration et de bout en bout, audit des dépendances qui
   bloque une faille haute ou critique, analyse de l'image, analyse de code hebdomadaire (CodeQL), recherche de secrets,
   et plus de 2 000 sondes d'attaque jouées contre chaque route ; conteneurs sans privilèges ; supervision et alertes en
   continu ; sauvegardes quotidiennes chiffrées, gardées 7 jours au plus ; protection contre les appels vers des
   adresses internes (SSRF) ; plafonds de débit.
8. **RGPD** (résumé, lien vers la page) ; **AI Act** (résumé, lien) ; **Sous-traitants** (aperçu, lien).
9. **Documents sur demande** : contrat de sous-traitance (article 28) ; mesures techniques et organisationnelles ;
   questionnaire de sécurité rempli ; rapports de Meta, Scaleway et Cloudflare (on indique la démarche). Bouton vers
   `/contact/`, et l'adresse contact@messagingme.fr pour la sécurité et les données personnelles.

## La page RGPD

Rôles (le client est responsable de traitement ; Messaging Me est sous-traitant, contrat article 28 en annexe des
conditions d'utilisation ; Meta est sous-traitant ultérieur pour la Cloud API, selon ses Meta Hosting Terms) ;
hébergement dans l'UE et transferts (Meta et certains fournisseurs de modèles sont hors UE : Data Privacy Framework ou
clauses contractuelles types) ; **tableau des durées** :

| Donnée | Durée |
|---|---|
| Conversations | 90 jours par défaut, réglable par l'espace |
| Événements techniques | 30 jours |
| Journal d'audit | 2 ans |
| Désinscriptions (STOP) | 3 ans, pour ne plus jamais écrire à qui a dit stop |
| Sauvegardes | 7 jours au plus |
| Contenu chez Meta (Cloud API) | 30 jours au plus |

Consentement et STOP (garde vérifiée avant chaque envoi) ; droits des personnes (effacement d'un contact, export par
l'API) ; violation de données notifiée au client sous 48 heures ; ni vente ni partage, aucun entraînement de modèle sur
les données des clients ; contact contact@messagingme.fr.

## La page AI Act

Rôle (Messaging Me fournit l'agent IA, le client le déploie ; usage prévu, la relation client, à risque limité) ;
transparence (la plateforme ajoute elle-même la mention d'IA dans la conversation) ; supervision humaine (escalade vers
un humain, reprise dans la boîte de réception, actions et appels d'outils journalisés) ; garde-fous (données du client
délimitées dans les consignes, outils en liste fermée, sorties validées, crédit plafonné) ; données (aucune donnée des
clients pour entraîner les modèles) ; **deux routes** : par défaut une passerelle IA vers les modèles du catalogue
(Mistral, Gemini, GPT, Claude) ; pour les espaces Entreprise, des modèles hébergés en Europe (Scaleway, Mistral),
**sur demande**.

## La page Sous-traitants

Tableau daté (« à jour au 12 novembre 2026 ») : fournisseur, rôle, pays, garantie. Le partenaire de facturation WhatsApp
n'est JAMAIS nommé : « Partenaire de facturation WhatsApp agréé par Meta, Espagne (UE) ». La liste exacte est à
valider par Julien avant publication.

## Contraintes

- Aucun tiret cadratin ni demi-cadratin. Vouvoiement. Jamais « UChat ». Jamais « bientôt ».
- Ne rien affirmer de faux : jamais « certifiée » pour nous, jamais « hébergé en France », jamais « sauvegardes hors
  site », jamais « test d'intrusion », jamais « filtrage des données personnelles par l'IA ». Les manques ne s'écrivent
  pas (choix de Julien), sauf le SSO dit « sur demande ».
- Décisions de Julien prises en connaissance de cause : la console est dite « serverless chez Scaleway » alors qu'elle
  est encore chez Vercel à la publication (migration à faire, `todo.md`) ; la route IA européenne est dite « sur
  demande » et se construit au premier client qui la demande.
- Une vérification avant publication : le réglage « zéro conservation » de la passerelle IA (l'audit du 3 novembre le
  dit jamais vérifié) ; tant qu'il ne l'est pas, la page ne dit pas « sans conservation », seulement « aucun
  entraînement ».
