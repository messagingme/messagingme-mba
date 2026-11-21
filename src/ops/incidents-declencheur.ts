import { journaliser } from '../lib/journal';

/**
 * LE RÉVEIL DE LA TÂCHE CLOUD QUI ANALYSE UN INCIDENT (plan 2026-11-21, lot 3). Une tâche Claude Code dans le cloud
 * (claude.ai) a une adresse de déclenchement et un jeton qui ne sait QUE la déclencher. Le texte envoyé (65 536
 * caractères au plus) lui arrive comme un bloc de données ; sa consigne vit dans le dépôt privé `messagingme-incidents`
 * (`CONSIGNE.md`).
 *
 * 🔴 UNE SEULE TENTATIVE. Le déclencheur n'a pas de clé d'idempotence : chaque appel accepté crée une session, donc
 * rejouer sur un délai dépassé pourrait en créer deux. Un échec se journalise ; l'incident reste en base, lisible.
 * Il ne bloque ni ne lève jamais : il part sans être attendu, comme la capture.
 */

export type Declencheur = (charge: Record<string, unknown>) => void;

/** La version de l'API de déclenchement que la documentation donne pour cet appel. */
const VERSION_API = '2026-10-21';
const DELAI_MS = 10_000;

export function creerDeclencheur(deps: { url: string; token: string; fetch?: typeof fetch }): Declencheur {
  if (deps.url === '' || deps.token === '') return () => {};
  const f = deps.fetch ?? fetch;
  return (charge) => {
    void (async () => {
      const res = await f(deps.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${deps.token}`, 'anthropic-version': VERSION_API, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: JSON.stringify(charge).slice(0, 65_536) }),
        signal: AbortSignal.timeout(DELAI_MS),
      });
      if (!res.ok) journaliser('warn', 'incident_declencheur_refuse', { statut: res.status, id: charge.id });
    })().catch((err: unknown) => journaliser('warn', 'incident_declencheur_echec', { id: charge.id, err }));
  };
}
