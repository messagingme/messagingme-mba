-- 0266 : l'Entreprise illimitee, lot A (spec docs/superpowers/specs/2026-11-02-entreprise-illimitee-design.md, plan
-- docs/superpowers/plans/2026-11-02-entreprise-illimitee.md).
--
-- Decision de Julien du 2026-11-02 : en Entreprise, le Credit WhatsApp est illimite, facture au contrat, et son solde ne
-- bouge jamais. Chaque message reste provisionne, pour la facture du mois, mais une provision illimitee ne touche pas le
-- solde : ni a la prise, ni quand elle est rendue, ni quand elle est corrigee. Le solde vaut donc : mouvements moins
-- provisions non rendues et non illimitees. Un espace qui quitte l'Entreprise retrouve son solde d'avant, sans dette.
--
-- L'interrupteur tenants.entreprise_open_bar_whatsapp n'est plus ni lu ni ecrit : toute Entreprise est illimitee. La
-- colonne reste, l'ancien code la lit pendant le deploiement ; une migration posterieure la retirera.
--
-- A appliquer AVANT le code : le code neuf ecrit la colonne. L'ancien code y survit : il ne la nomme pas, et elle a un
-- defaut constant (ajoutee sans reecrire la table). La table n'a encore aucune ligne en production (2026-11-02).
set local lock_timeout = '5s';

alter table credit_whatsapp_provisions add column if not exists illimite boolean not null default false;
