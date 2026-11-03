-- 0275 : les jaunes de la relecture du lot E (la regularisation) et du lot D du Credit WhatsApp (plan
-- docs/superpowers/plans/2026-11-03-credit-whatsapp-fiabilite.md).
--
-- - credit_whatsapp_provisions.tranche_regularisee : la demi-heure (secondes Unix) sous laquelle une regularisation a
--   compte la provision. Elle n'en change plus : une livraison tardive ne la recompte pas dans un autre jour (ce qui la
--   faisait payer par nous), et un accuse arrive apres cette regularisation ne la rend ni ne la corrige plus (l'ecart de
--   son jour porte deja ce que Meta a facture pour elle, un second retour l'offrait au client).
-- - credit_whatsapp_provisions.commission_pct : la commission avec laquelle la provision a ete chiffree. La regularisation
--   chiffre les volumes de Meta du jour avec elle, pas avec celle du moment ou la passe tourne.
-- - deux index sur lignes_credit_whatsapp, (waba_id) et (phone_number_id) : la garde lit la ligne d'un numero par son
--   numero OU par son compte WhatsApp depuis le lot D, retiree comprise, et un `or` ne s'indexe que si ses deux bras le
--   sont (l'index unique existant est partiel, sur les seules lignes en cours, il ne sert pas ce filtre).
--
-- A appliquer AVANT le code : le code neuf ecrit les deux colonnes. L'ancien code y survit : elles sont nullables, sans
-- defaut, et il ne les nomme pas. Les deux tables sont petites (2026-11-03 : quelques lignes).
set local lock_timeout = '5s';

alter table credit_whatsapp_provisions add column if not exists tranche_regularisee bigint;
alter table credit_whatsapp_provisions add column if not exists commission_pct smallint;
alter table credit_whatsapp_provisions drop constraint if exists credit_whatsapp_provisions_commission_pct_chk;
alter table credit_whatsapp_provisions add constraint credit_whatsapp_provisions_commission_pct_chk
  check (commission_pct is null or commission_pct between 0 and 100);

create index if not exists lignes_credit_whatsapp_waba_idx on lignes_credit_whatsapp (waba_id);
create index if not exists lignes_credit_whatsapp_numero_idx on lignes_credit_whatsapp (phone_number_id);
