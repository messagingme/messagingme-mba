# Le message de passage à un humain gardé en base (2026-11-26)

**But.** Le choix du message que l'agent de Meta écrit au client quand il passe la main (« Rédigé par l'agent »,
« Notre texte », texte standard) tient d'un jour sur l'autre, quel que soit le mode du passage de main.

**La cause, mesurée chez MUTAC.** Meta CACHE le bloc `handoff` de ses réglages tant que `enabled` vaut `false` :
« Rédigé par l'agent » choisi à 08:22 (heure de Paris, hors horaires, passage éteint) est accepté sans erreur et absent
de la relecture faite aussitôt ; à 08:30 le balayage des heures ouvrées rallume le passage, et le bloc reparaît avec
`DEFAULT`. Le balayage lit « absent », réécrit, et la fusion des réglages (`ecrireReglages`) n'a plus rien à préserver :
le choix est perdu chaque nuit. Le correctif du 2026-11-25 (`DEFAULT` posé sous l'existant) supposait que Meta relit
un bloc dès que `message_selection` est posé ; c'est faux quand `enabled` vaut `false`.

## Méthode de livraison

**Implémenteur par lot, une relecture du diff.** Le chemin est emprunté par la production (chaque écriture des
réglages de l'agent de Meta, toutes les 5 minutes par le balayage) et porte un invariant invisible (la fusion qui ne
doit rien effacer) ; les critères sont testables, mais le dernier mot revient à une mesure chez Meta : l'essai réel
chez MUTAC (dernière section) clôt le lot.

## Tâches

1. **Migration `0328_mba_handoff_message.sql`** : `tenant_settings.mba_handoff_message jsonb`, nullable, sans défaut.
   `migration=avant` : le code neuf l'écrit, l'ancien ne la nomme pas (lecture en `select *`).
2. **Store** : `get` rend `mbaHandoffMessage` (lu par `safeParse`, `null` si absent ou illisible) ;
   `setMbaHandoffMessage(tenantId, choix)`.
3. **Écriture chez Meta** : le choix en base passe SOUS ce que Meta rend et sous le patch (à la place du `DEFAULT`
   constant). Ordre : `DEFAULT` < base < Meta < patch. Le balayage et le changement de mode le portent donc à chaque
   bascule.
4. **Route `PATCH .../settings`** : un choix de message s'enregistre en base AVANT l'écriture chez Meta.
5. **Lecture** : `GET .../status` et la réponse du `PATCH` complètent un bloc caché par le choix en base, sans
   `enabled` (l'écran ne lit que le choix et le texte).

## Tests

- Le balayage d'un espace dont Meta cache le bloc réécrit le choix en base, pas `DEFAULT` (vu tomber sans le
  correctif).
- La route enregistre le choix puis écrit le bloc complet ; un choix refusé (400) n'écrit rien en base.
- Le statut d'un bloc caché rend le choix en base ; un bloc visible rend ce que Meta dit.
- Le store : lecture d'une valeur illisible = `null`.

## Déploiement

`migration=avant`, puis relecture en base de la colonne. Aucune route neuve, aucun écran touché.

## Essai réel qui clôt

MUTAC : après 18:00, le statut montre « Rédigé par l'agent » (bloc caché, choix en base) ; le lendemain après 08:30,
le bloc relu chez Meta vaut `enabled: true, message_selection: AGENT`.
