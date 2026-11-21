import { journaliser } from '../lib/journal';

/**
 * LES INCIDENTS DE SANTÉ (plan 2026-11-21, lot 1) : chaque alerte de santé ou de charge fige l'état du système au moment
 * où elle part. Sans cela, l'analyse se fait après coup, quand la file s'est vidée et que les verrous sont relâchés, et
 * elle devine (vécu le 2026-11-21 : il a fallu reconstituer 10:33 et 10:53 depuis `pgboss.job`).
 *
 * 🔴 TROIS RÈGLES. La capture ne retarde ni n'empêche JAMAIS l'alerte : elle part après l'envoi, sans être attendue, et
 * son échec se journalise. Elle ne fait que LIRE. Elle ne garde aucune donnée personnelle ni aucun texte de requête SQL
 * (une requête peut porter un numéro ou un message) : des noms de files, des durées, des comptes.
 * Le plafond d'une capture par signal et par demi-heure est celui des alertes elles-mêmes, qui ne repartent pas plus
 * souvent (`DELAI_ENTRE_ALERTES_MS`, `RELANCE_ALERTE_MS`).
 */

/** La limite du texte qu'accepte le déclencheur de la tâche cloud qui analyse l'incident (lot 3). */
export const TAILLE_MAX_INSTANTANE = 65_536;

export type Instantane = Record<string, unknown>;

/** Une alerte qui suit une autre de moins d'une minute reprend son instantané au lieu de relire la base. */
export const PARTAGE_INSTANTANE_MS = 60_000;

export interface IncidentsStore {
  ouvrir(i: { source: 'sante' | 'charge'; signal: string; etat: 'orange' | 'rouge' | 'alerte'; texte: string; instantane: Instantane | null }): Promise<number>;
  /** Clôt le dernier incident ouvert du signal, s'il y en a un. */
  clore(signal: string, instantane: Instantane | null): Promise<void>;
}

/**
 * Borne l'instantané en taille : les listes les plus longues sont raccourcies de moitié jusqu'à tenir, puis, si ça ne
 * suffit pas, il est remplacé par sa seule mention de troncature. Pur, testé.
 */
export function bornerInstantane(i: Instantane, max = TAILLE_MAX_INSTANTANE): Instantane {
  let courant: Instantane = i;
  for (let tour = 0; tour < 12 && JSON.stringify(courant).length > max; tour++) {
    const listes = Object.entries(courant).filter(([, v]) => Array.isArray(v) && v.length > 1) as Array<[string, unknown[]]>;
    if (listes.length === 0) break;
    const [cle, plusLongue] = listes.reduce((a, b) => (JSON.stringify(b[1]).length > JSON.stringify(a[1]).length ? b : a));
    courant = { ...courant, [cle]: plusLongue.slice(0, Math.ceil(plusLongue.length / 2)), tronque: true };
  }
  return JSON.stringify(courant).length > max ? { tronque: true, raison: 'instantané trop gros, même raccourci' } : courant;
}

/**
 * La capture d'un incident, lancée sans être attendue : rien ne remonte à l'appelant. `lire` rend l'instantané ; s'il
 * échoue, l'incident s'inscrit quand même, sans instantané, pour que l'alerte ait sa trace.
 */
export function creerCapture(deps: { store: IncidentsStore; lire: () => Promise<Instantane>; maintenant?: () => number }) {
  const maintenant = deps.maintenant ?? (() => Date.now());
  // 🔴 UN SEUL INSTANTANÉ PAR MINUTE, partagé : cinq files en retard au même passage déclenchent cinq alertes, donc
  // cinq captures, qui liraient cinq fois la base au pire moment (relecture du lot 1). La lecture en vol ou récente
  // sert toutes les alertes de la minute.
  let courante: { depuis: number; lecture: Promise<Instantane | null> } | null = null;
  const lireSansEchec = (): Promise<Instantane | null> => {
    const t = maintenant();
    if (courante && t - courante.depuis < PARTAGE_INSTANTANE_MS) return courante.lecture;
    const lecture = (async () => {
      try {
        return bornerInstantane(await deps.lire());
      } catch (err) {
        journaliser('warn', 'incident_instantane_illisible', { err });
        return null;
      }
    })();
    courante = { depuis: t, lecture };
    return lecture;
  };
  return {
    ouvrir(source: 'sante' | 'charge', signal: string, etat: 'orange' | 'rouge' | 'alerte', texte: string): void {
      void (async () => {
        const instantane = await lireSansEchec();
        await deps.store.ouvrir({ source, signal, etat, texte: texte.slice(0, 2000), instantane });
      })().catch((err: unknown) => journaliser('warn', 'incident_non_inscrit', { signal, err }));
    },
    clore(signal: string): void {
      void (async () => {
        await deps.store.clore(signal, await lireSansEchec());
      })().catch((err: unknown) => journaliser('warn', 'incident_non_clos', { signal, err }));
    },
  };
}

export type CaptureIncidents = ReturnType<typeof creerCapture>;
