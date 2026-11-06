import { classifyWaId } from '../crm/identity';
import type { IssueEcritureChamp } from '../crm/hubspot-service';
import { NOM_PROPRIETE_HUBSPOT, cleChampHubspot } from './champs';

/**
 * UN SCÉNARIO ÉCRIT UN CHAMP HUBSPOT DU CONTACT (cadrage `~/mm-hubspot/docs/2026-11-06-remontee-champs-cadrage.md`,
 * validé par Julien le 2026-11-06). Les champs choisis descendent de HubSpot sur la fiche (`hs_contact_<p>`) ; quand un
 * PARCOURS en écrit un (bloc champ, action « poser un champ », Question, Appel API, Fonction JS, « vider un champ »), la
 * valeur remonte D'ABORD dans HubSpot, ENSUITE sur la fiche, pour que les deux restent égaux.
 *
 * 🔴 L'INVARIANT : LE MIROIR N'EST ÉCRIT QU'APRÈS HUBSPOT. Un refus de HubSpot (format, valeur hors liste, accès retiré,
 * panne) laisse la fiche telle quelle, et le motif part au journal des échecs de scénario ; le parcours continue. La
 * fiche s'écrit SEULE quand il n'y a pas de miroir à tenir (`fiche_seule` : champ retiré de la liste, espace sans
 * portail, connecteur pas encore à jour, contact absent de HubSpot ou sans numéro, décision de Julien du 2026-11-06).
 *
 * Ce qui ne remonte JAMAIS : les champs de transaction (`hs_deal_*`) et les calculés (`hs_calc_*`), décision de Julien ;
 * et une valeur VIDE venue d'une écriture (`setField`) : un Appel API ou une Fonction JS qui échoue vide son champ cible,
 * et cette panne ne doit pas effacer la propriété dans HubSpot. Seul « vider un champ » (`clearField`) vide HubSpot.
 */

const PREFIXE_CONTACT = cleChampHubspot('contact', '');

/** La propriété HubSpot du contact qu'une clé de fiche reflète, ou `null` (une clé ordinaire, de transaction, calculée). */
export function proprieteContactDe(cle: string): string | null {
  if (!cle.startsWith(PREFIXE_CONTACT)) return null;
  const propriete = cle.slice(PREFIXE_CONTACT.length);
  return NOM_PROPRIETE_HUBSPOT.test(propriete) ? propriete : null;
}

/** Les deux écritures de fiche d'un parcours, telles que l'exécuteur les reçoit. */
export interface EcrituresDeFiche {
  setField(tenantId: string, waId: string, key: string, value: string): Promise<void>;
  clearField(tenantId: string, waId: string, key: string): Promise<void>;
}

export interface RemonteeDeps {
  /** Écrit la propriété dans HubSpot (`ecrireChampContactHubspot`). Ne lève pas. */
  ecrire(corps: { tenantId: string; e164: string; propriete: string; valeur: string }): Promise<IssueEcritureChamp>;
  /** Le journal des échecs de scénario (`workflow_advance_failures`), au mieux : il ne fait jamais échouer le parcours. */
  journaliser(e: { tenantId: string; waId: string; erreur: string }): Promise<void>;
}

/**
 * Les écritures de fiche d'un parcours, avec la remontée des champs HubSpot du contact. `deps` nul (aucun connecteur
 * configuré) : les écritures d'origine, telles quelles.
 */
export function avecRemonteeHubspot(fiche: EcrituresDeFiche, deps: RemonteeDeps | null): EcrituresDeFiche {
  if (deps === null) return fiche;
  /** Rend `true` si la fiche doit s'écrire (HubSpot a la valeur, ou il n'y a plus de miroir). */
  const remonter = async (tenantId: string, waId: string, key: string, propriete: string, valeur: string): Promise<boolean> => {
    const e164 = classifyWaId(waId).phoneE164;
    let issue: IssueEcritureChamp;
    try {
      // Sans numéro, aucun contact HubSpot ne lui répond : comme un contact absent de HubSpot, la fiche s'écrit seule.
      issue = e164 === undefined ? { issue: 'fiche_seule' } : await deps.ecrire({ tenantId, e164, propriete, valeur });
    } catch {
      // `ecrire` ne lève pas ; une faute de câblage ne doit pas écrire le miroir pour autant.
      issue = { issue: 'echec', motif: 'HubSpot injoignable' };
    }
    if (issue.issue !== 'echec') return true;
    // Ni la valeur ni le motif (qui peut la citer) dans le journal du serveur : seulement le champ.
    // eslint-disable-next-line no-console
    console.warn(`workflow: champ « ${key} » NON écrit dans HubSpot pour ${waId} (${tenantId}), la fiche n’est pas modifiée`);
    await deps.journaliser({ tenantId, waId, erreur: `Champ « ${key} » non écrit : ${issue.motif}. La fiche n’a pas été modifiée.` }).catch(() => {});
    return false;
  };
  return {
    setField: async (tenantId, waId, key, value) => {
      const propriete = proprieteContactDe(key);
      if (propriete !== null && value.trim() !== '' && !(await remonter(tenantId, waId, key, propriete, value))) return;
      await fiche.setField(tenantId, waId, key, value);
    },
    clearField: async (tenantId, waId, key) => {
      const propriete = proprieteContactDe(key);
      if (propriete !== null && !(await remonter(tenantId, waId, key, propriete, ''))) return;
      await fiche.clearField(tenantId, waId, key);
    },
  };
}
