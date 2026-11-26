import { createHmac, hkdfSync } from 'node:crypto';
import { config } from '../config';

/**
 * 🔴 LA LISTE DE REFUS DES FICHES EFFACÉES (lot 13, domaine 5, livraison B ; décision de Julien du 2026-10-09). La purge
 * anonymise le numéro d'une fiche : recréée avec le même numéro, elle repartait sans son STOP. À l'effacement d'une fiche
 * en STOP, la purge garde une EMPREINTE de chacun de ses identifiants (`refus_effaces`, migration 0226) ; une fiche
 * recréée avec l'un d'eux naît en STOP, avec la date d'origine, et l'entrée est consommée : le refus revit sur la fiche.
 *
 * Un HMAC et pas un simple hachage : un numéro se devine (une dizaine de chiffres), son empreinte simple se renverse en
 * quelques minutes. La clé est dérivée d'`ENCRYPTION_KEY` (HKDF, libellé propre) et ne vit jamais en base. ⚠️ Changer
 * `ENCRYPTION_KEY` rend les empreintes existantes introuvables : la liste repartirait vide.
 */
const CLE = Buffer.from(hkdfSync('sha256', Buffer.from(config.ENCRYPTION_KEY, 'utf8'), Buffer.alloc(0), 'messagingme/refus-effaces/v1', 32));

/**
 * L'empreinte d'un identifiant DANS un espace : le même numéro dans deux espaces donne deux empreintes, et un numéro ne
 * se confond jamais avec un BSUID qui aurait les mêmes caractères.
 */
export function empreinteRefus(tenantId: string, cle: { tel: string } | { bsuid: string }): string {
  const ident = 'tel' in cle ? `tel:${cle.tel}` : `bsuid:${cle.bsuid}`;
  return createHmac('sha256', CLE).update(`${tenantId}\n${ident}`).digest('hex');
}

/**
 * Les empreintes d'une fiche, pour ses identifiants présents. Un numéro anonymisé (`anon:…`) n'en a pas : il ne désigne
 * plus personne.
 */
export function empreintesDeLaFiche(tenantId: string, fiche: { phoneE164?: string | null; bsuid?: string | null }): string[] {
  const out: string[] = [];
  if (fiche.phoneE164 && !fiche.phoneE164.startsWith('anon:')) out.push(empreinteRefus(tenantId, { tel: fiche.phoneE164 }));
  if (fiche.bsuid) out.push(empreinteRefus(tenantId, { bsuid: fiche.bsuid }));
  return out;
}

/** La durée de la liste : trois ans depuis le STOP le plus récent (le minimum que la CNIL recommande). */
export const RETENTION_REFUS_ANS = 3;

/** La source écrite sur une fiche qui naît en STOP par la liste : le canal d'origine du STOP est parti avec la purge. */
export const SOURCE_LISTE_DE_REFUS = 'liste_de_refus';

/**
 * 🔴 LA TRACE DES NUMÉROS EFFACÉS (`numeros_effaces`, migration 0317 ; segments Shopify enrichis, lot 5b, décision de
 * Julien du 2026-11-24 : « un contact supprimé n'est JAMAIS recréé par le rattrapage »). Chaque purge garde, pour toute
 * fiche qui avait un numéro, son EMPREINTE (`empreinteRefus`, jamais le numéro en clair) et la date de l'effacement. À la
 * différence de la liste de refus, elle ne fait renaître personne en STOP et aucune création ne la consomme : seul le
 * rattrapage des commandes la lit, pour ne jamais recréer la fiche d'une commande payée avant l'effacement.
 *
 * Sa durée : la fenêtre la plus longue du rattrapage (24 mois depuis le lot 7a, `FENETRE_LONGUE_MOIS`) plus une marge.
 * Une commande que le rattrapage peut lire a été créée dans cette fenêtre : une trace plus vieille ne protège plus rien.
 * 🔴 Les deux constantes restent ordonnées (`tests/numeros-effaces.test.ts`) : une fenêtre qui s'allonge allonge
 * celle-ci. ⚠️ Une fiche supprimée avant la migration 0317 (2026-11-24) n'a pas de trace : le rattrapage peut la recréer.
 */
export const RETENTION_NUMEROS_EFFACES_JOURS = 760;
