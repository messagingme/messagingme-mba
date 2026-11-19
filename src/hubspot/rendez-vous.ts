import { estDu } from '../automation/avant-date';
import { texteDe } from '../lib/erreur';
import { journaliser } from '../lib/journal';
import type { Fonction } from '../offres/offres';
import type { EvenementDeLigne, IssueLigneHubspot } from './circuit';
import type { ConfigRdv, LigneHubspot } from './lignes';
import { origineHubspot } from './origine';

/**
 * LE BALAYAGE DES RENDEZ-VOUS HUBSPOT (menu « Scénario », lot 6b, tâche 2 ; spec § 2.2, § 5.5). Il vit dans l'API, comme la
 * relance des paniers, parce que l'envoi public n'existe que là ; le balayage du worker ne sert plus que le rayon général
 * (lot 6a). Pour chaque ligne de rendez-vous allumée : les contacts dont la propriété date importée de HubSpot tombe dans la
 * fenêtre grossière (`contactsDusPourDate`, la requête du déclencheur de date, la ligne étant une automation), l'échéance
 * jugée par la MÊME règle (`estDu` : pas encore, trop tard, déjà tiré pour cette date), puis le circuit de la ligne, son tir
 * posé avec la date pour marqueur. Chaque copie de l'API balaie : le claim du tir et la clé d'idempotence (l'origine)
 * empêchent deux rappels, comme la réclamation des paniers.
 */

export interface DepsRendezVous {
  /** Le magasin des lignes, ENTIER (ses méthodes lisent `this`). */
  lignes: {
    tenantsAvecRendezVous(): Promise<string[]>;
    rendezVousAllumes(tenantId: string): Promise<LigneHubspot[]>;
  };
  /** Le magasin des automations, ENTIER : la fenêtre grossière et le tir déjà posé. */
  declencheurs: {
    contactsDusPourDate(
      tenantId: string, automationId: string, fieldKey: string, borneBasse: string, borneHaute: string,
    ): Promise<Array<{ waId: string; valeur: string; dejaTirePour: string | null }>>;
  };
  /** « Automations HubSpot » de Tools > Intégrations (`lireChoixHubspot(t).automations`), relue à chaque passage. */
  automationsBranchees(tenantId: string): Promise<boolean>;
  /** L'offre de l'espace : `crm` relie HubSpot. */
  fonctions(tenantId: string): Promise<ReadonlySet<Fonction>>;
  /** Fuseau de l'espace : une date sans fuseau est une heure murale. */
  timeZone(tenantId: string): Promise<string>;
  /** Le circuit d'une ligne (`servirLigneHubspot`). */
  servir(tenantId: string, e: EvenementDeLigne): Promise<IssueLigneHubspot>;
  /** La fenêtre de rattrapage après le moment prévu (`AUTOMATION_DATE_TOLERANCE_MINUTES`). */
  toleranceMinutes: number;
  now?: () => number;
}

/** Marge de la fenêtre SQL, de chaque côté : le tri se fait sur du texte ISO (voir `contactsDusPourDate`). */
const MARGE_MS = 24 * 60 * 60 * 1000;
/** Un wa_id qui est un numéro : un template part vers un numéro, jamais vers un identifiant de Meta seul. */
const NUMERO = /^\d{6,15}$/;

/** Un passage ; rend le nombre de rappels partis. Une ligne en panne n'empêche pas les autres. */
export async function balayerRendezVous(d: DepsRendezVous): Promise<number> {
  const now = d.now ?? (() => Date.now());
  let partis = 0;
  for (const tenantId of await d.lignes.tenantsAvecRendezVous()) {
    try {
      if (!(await d.automationsBranchees(tenantId)) || !(await d.fonctions(tenantId)).has('crm')) continue;
      const timeZone = await d.timeZone(tenantId);
      for (const ligne of await d.lignes.rendezVousAllumes(tenantId)) {
        try {
          partis += await servirLaLigne(d, tenantId, ligne, ligne.config as ConfigRdv, timeZone, now());
        } catch (err) {
          journaliser('error', 'hubspot_rdv_ligne_en_panne', { tenantId, ligne: ligne.id, erreur: texteDe(err) });
        }
      }
    } catch (err) {
      journaliser('error', 'hubspot_rdv_espace_en_panne', { tenantId, erreur: texteDe(err) });
    }
  }
  return partis;
}

async function servirLaLigne(
  d: DepsRendezVous, tenantId: string, ligne: LigneHubspot, cfg: ConfigRdv, timeZone: string, t: number,
): Promise<number> {
  // L'échéance tombe maintenant, à un jour près : `maintenant + délai` pour « avant », `maintenant - délai` pour « après ».
  const centre = t + (cfg.sens === 'apres' ? -1 : 1) * cfg.delaiMinutes * 60_000;
  const candidats = await d.declencheurs.contactsDusPourDate(
    tenantId, ligne.id, cfg.fieldKey, new Date(centre - MARGE_MS).toISOString(), new Date(centre + MARGE_MS).toISOString(),
  );
  let partis = 0;
  for (const c of candidats) {
    const r = estDu({
      valeur: c.valeur, offsetMinutes: cfg.delaiMinutes, sens: cfg.sens, now: t, toleranceMinutes: d.toleranceMinutes, timeZone,
      dejaTirePour: c.dejaTirePour,
    });
    if (!r.du || !NUMERO.test(c.waId)) continue;
    const origine = origineHubspot({ famille: 'rdv', ligne: ligne.id, contact: c.waId, champ: cfg.fieldKey, date: c.valeur });
    if (origine === null) {
      journaliser('warn', 'hubspot_rdv_origine_illisible', { tenantId, ligne: ligne.id });
      continue;
    }
    const issue = await d.servir(tenantId, { ligne, telephone: `+${c.waId}`, waId: c.waId, origine, marqueur: c.valeur });
    if (issue === 'envoye') partis += 1;
  }
  return partis;
}
