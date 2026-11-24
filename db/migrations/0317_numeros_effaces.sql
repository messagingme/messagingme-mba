-- 0317_numeros_effaces.sql : la trace des numeros des fiches effacees (segments Shopify enrichis, lot 5b, plan
-- docs/superpowers/plans/2026-11-24-segments-shopify-lot-5b-fiches-acheteurs.md). Decision de Julien du 2026-11-24 :
-- « un contact supprime n est JAMAIS recree par le rattrapage ».
--
-- numeros_effaces : une ligne par numero d une fiche purgee (purgeMany : la console, l API publique, delete_contacts, le
--   premier 131026, customers/redact), STOP ou non : l EMPREINTE du numero dans l espace (le meme HMAC que refus_effaces,
--   cle derivee d ENCRYPTION_KEY, 64 caracteres hexadecimaux ; jamais le numero en clair) et la date de la DERNIERE purge.
--   A la difference de refus_effaces, elle ne fait renaitre personne en STOP et aucune creation de fiche ne la consomme :
--   seul le rattrapage des commandes la lit, pour ne jamais recreer la fiche d une commande payee avant l effacement.
--   Gardee 90 jours (RETENTION_NUMEROS_EFFACES_JOURS : la fenetre du rattrapage, 60 jours, plus une marge), effacee par
--   le balayage de retention du worker (purgerNumerosEffaces), comme la liste de refus.
--
-- BLOQUANTE : purgeMany l ecrit dans SA transaction ; absente, TOUTE purge echouerait en 42P01 (la suppression d une
-- fiche depuis la console ou l API, customers/redact, le job du premier 131026). Poussee SEULE, appliquee AVANT le code
-- qui l ecrit (migration=avant, dans son propre deploiement). L ancien code ne la nomme pas. Table neuve : seule sa cle
-- etrangere vers tenants prend un verrou, bref ; 5 s d attente au plus.
set local lock_timeout = '5s';

create table if not exists numeros_effaces (
  tenant_id uuid not null references tenants(id) on delete cascade,
  empreinte text not null constraint numeros_effaces_empreinte_check check (empreinte ~ '^[0-9a-f]{64}$'),
  efface_le timestamptz not null default now(),
  primary key (tenant_id, empreinte)
);

-- Le balayage de retention efface par date, tous espaces : sans cet index, il parcourrait toute la table chaque jour.
create index if not exists numeros_effaces_efface_le on numeros_effaces (efface_le);
