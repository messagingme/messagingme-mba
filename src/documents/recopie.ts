import { telechargerEnteteProduction } from '../api/entete-par-url';
import { journaliser } from '../lib/journal';
import { texteDe } from '../lib/erreur';
import type { ChampsGroupes } from '../hubspot-workflow/champs';
import { CHAMP_DOCUMENT } from './store.pg';

/**
 * LA RECOPIE D'UN PDF PROPRE AU CONTACT (lot B1 du plan `docs/superpowers/plans/2026-11-12-pdf-par-contact-hubspot.md`).
 * Le connecteur HubSpot envoie, dans le calculé `document`, une adresse à COURTE VIE (fichier privé de HubSpot, ou PDF
 * d'un devis). mba la télécharge tout de suite, range le fichier, et la fiche ne reçoit que le CODE de la copie : une
 * adresse signée ne s'écrit nulle part et ne se journalise jamais.
 */

/** Ce que la recopie demande : télécharger un PDF par son adresse, puis le ranger pour ce numéro. */
export interface DepsRecopie {
  telecharger(url: string): Promise<{ octets: Buffer; mime: string } | { refus: string }>;
  deposer(e: { tenantId: string; waId: string; nom: string; octets: Buffer }): Promise<string>;
}

/**
 * Le téléchargement de production : `telechargerEnteteProduction` au format DOCUMENT porte déjà toutes les gardes d'une
 * adresse venue de l'extérieur (https, hôte public vérifié, connexion vérifiée, aucune redirection suivie, 16 Mo au plus,
 * signature `%PDF-`), et il est inventorié par `tests/lib-adresse-privee.test.ts`.
 */
export const telechargerDocumentProduction = (url: string) => telechargerEnteteProduction('DOCUMENT', url);

/**
 * Le nom d'origine du fichier, lu dans le dernier segment du chemin de l'adresse (les adresses de fichiers de HubSpot
 * le portent), sans extension doublée ; `document.pdf` quand il ne se lit pas. Il part au client comme nom du document.
 */
export function nomDuDocument(url: string): string {
  let segment = '';
  try {
    segment = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  } catch {
    segment = '';
  }
  const propre = segment.replace(/[\u0000-\u001f\\/:*?"<>|]/g, '').trim().slice(0, 120);
  if (propre === '') return 'document.pdf';
  return /\.pdf$/i.test(propre) ? propre : `${propre}.pdf`;
}

/**
 * Remplace, dans les champs reçus, l'adresse du calculé `document` par le code de la copie. Rien à faire quand le champ
 * n'est pas DÉCLARÉ dans l'espace (aucun téléchargement pour une valeur qu'on n'écrirait pas) ou quand il arrive vide.
 * Un refus ou une panne rend `''` : le champ est RETIRÉ de la fiche (décision 3 du cadrage, jamais un message « voici
 * votre devis » sur un ancien devis), la cause part au journal, jamais l'adresse.
 */
export async function recopierDocumentRecu(
  deps: DepsRecopie,
  tenantId: string,
  waId: string,
  champs: ChampsGroupes,
  declares: ReadonlyArray<{ readonly key: string }>,
): Promise<ChampsGroupes> {
  const url = champs.calcules?.document;
  if (url === undefined || url === '' || !declares.some((d) => d.key === CHAMP_DOCUMENT)) return champs;
  const avec = (valeur: string): ChampsGroupes => ({ ...champs, calcules: { ...champs.calcules, document: valeur } });
  try {
    const lu = await deps.telecharger(url);
    if ('refus' in lu) {
      journaliser('warn', 'hubspot_document_refuse', { tenantId, raison: lu.refus });
      return avec('');
    }
    return avec(await deps.deposer({ tenantId, waId, nom: nomDuDocument(url), octets: lu.octets }));
  } catch (err) {
    journaliser('error', 'hubspot_document_en_echec', { tenantId, raison: texteDe(err).slice(0, 200) });
    return avec('');
  }
}
