-- 0271_automations_accord_marketing.sql : l attestation de l accord marketing d une automation (lot 3b du plan mm-hubspot
-- docs/2026-11-02-champs-hubspot-et-accord-plan.md, decision 8 ; cadrage du meme jour, decisions 6 et B validees par Julien).
--
-- La case « J atteste avoir l accord marketing des contacts que cette automation touche » du formulaire des automations.
-- Cochee, elle est conservee avec QUI l a cochee et QUAND, et a chaque declenchement le runner ecrit l accord sur la fiche
-- (source automation:<id>). Trois colonnes, toutes posees par le SERVEUR depuis la session, jamais lues du corps :
--   accord_marketing_par    l utilisateur qui a coche (users.id), sans cle etrangere : la trace survit au compte
--   accord_marketing_email  son adresse au moment de cocher, pour savoir qui c etait si le compte disparait
--   accord_marketing_le     quand ; NULL = automation non attestee (c est la colonne que le code lit)
-- Le CHECK refuse un « qui » sans « quand » : une attestation sans date ne se lirait comme rien, en silence.
-- Les automations sans formulaire (webhook entrant, chaine, publicite, widget) n ecrivent jamais ces colonnes : nulles.
--
-- A appliquer AVANT le code : le code neuf les ecrit et les lit (listEnabled, chemin chaud). L ancien code y survit : il
-- ne les nomme pas (liste de colonnes explicite), elles sont nulles sans defaut (ajoutees sans reecrire la table), et le
-- CHECK est vrai sur chaque ligne existante. La table est petite, mais lue a chaque message entrant : au-dela de 5 s
-- d attente d un verrou, la migration echoue et se rejoue (tout est idempotent).
set local lock_timeout = '5s';

alter table automations add column if not exists accord_marketing_par uuid;
alter table automations add column if not exists accord_marketing_email text;
alter table automations add column if not exists accord_marketing_le timestamptz;

alter table automations drop constraint if exists automations_accord_marketing_chk;
alter table automations add constraint automations_accord_marketing_chk
  check ((accord_marketing_par is null and accord_marketing_email is null) or accord_marketing_le is not null);
