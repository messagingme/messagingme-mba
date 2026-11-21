import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { journaliser } from '../lib/journal';

/**
 * LE RAPPORT DE LA TÂCHE CLOUD SUR UN INCIDENT (plan 2026-11-21, lot 3).
 *
 * La tâche Claude qui analyse un incident ne parle jamais à Telegram : le jeton du bot irait dans l'adresse
 * (`/bot<jeton>/`), que les secrets réseau de claude.ai ne savent pas protéger. Elle rend son rapport ICI, avec un jeton
 * dans l'en-tête `Authorization` (un secret réseau, qui n'entre jamais dans sa session), et c'est notre serveur qui
 * l'inscrit sur l'incident et l'envoie sur Telegram, avec les boutons de décision pour l'issue 2.
 *
 * 🔴 L'ADRESSE EST PUBLIQUE, LE JETON LA FERME : comparé en temps constant, AVANT toute lecture du corps ou de la base.
 * Un rapport ne s'inscrit qu'une fois par incident (`rapport_le is null`) : un rejeu ne renvoie pas de message.
 */

export const CHEMIN_RAPPORT = '/internes/incidents/:id/rapport';

export const CATEGORIES = [
  'capacite_worker', 'rafale_metier', 'voisin_bruyant', 'base', 'dependance_externe', 'plomberie', 'plateforme', 'faux_positif',
] as const;

const LIBELLES: Record<(typeof CATEGORIES)[number], string> = {
  capacite_worker: 'capacité worker', rafale_metier: 'rafale métier', voisin_bruyant: 'voisin bruyant', base: 'base',
  dependance_externe: 'dépendance externe', plomberie: 'plomberie', plateforme: 'plateforme', faux_positif: 'faux positif',
};

const ISSUES: Record<1 | 2 | 3 | 4, string> = {
  1: 'pas d’action',
  2: 'ton approbation est demandée',
  3: 'corrigé d’urgence',
  4: 'problème d’archi ou de performance, à toi d’agir',
};

export const SchemaRapport = z.object({
  categorie: z.enum(CATEGORIES),
  issue: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  rapport: z.string().trim().min(1).max(1500),
  action: z.string().trim().min(1).max(1000).optional(),
  fichier: z.string().trim().regex(/^incidents\/[A-Za-z0-9._:-]{1,180}\.md$/).optional(),
}).strict().refine((r) => r.issue !== 2 || r.action !== undefined, { message: 'une issue 2 propose une action', path: ['action'] });

export type Rapport = z.infer<typeof SchemaRapport>;

export interface IncidentsRapportRouteDeps {
  /** `INCIDENTS_RAPPORT_TOKEN`. Vide : la route n'est pas montée (`buildServer`). */
  token: string;
  incidents: {
    /** Inscrit le rapport ; rend le signal de l'incident, ou `null` s'il n'existe pas ou a déjà son rapport. */
    rapporter(id: number, r: Rapport): Promise<{ signal: string } | null>;
  };
  envoyer(texte: string, boutons?: ReadonlyArray<{ texte: string; donnee: string }>): Promise<boolean>;
}

/** Le jeton présenté est-il le bon ? En temps constant ; une longueur différente est un refus. */
export function jetonValide(entete: string | string[] | undefined, attendu: string): boolean {
  const valeur = Array.isArray(entete) ? entete[0] : entete;
  if (!valeur?.startsWith('Bearer ') || attendu === '') return false;
  const a = Buffer.from(valeur.slice(7).trim());
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Le message Telegram d'un rapport. Pur, testé. */
export function texteRapport(id: number, signal: string, r: Rapport): string {
  return [
    `Incident ${id} (${signal}) : ${LIBELLES[r.categorie]}, issue ${r.issue}, ${ISSUES[r.issue]}.`,
    r.rapport,
    ...(r.action ? [`Action proposée : ${r.action}`] : []),
    ...(r.fichier ? [`Rapport complet : messagingme-incidents/${r.fichier}`] : []),
  ].join('\n\n');
}

export function registerIncidentsRapport(app: FastifyInstance, deps: IncidentsRapportRouteDeps): void {
  app.post(CHEMIN_RAPPORT, {
    // 🔴 Le jeton avant le corps et avant la base.
    preHandler: async (req, reply) => {
      if (!jetonValide(req.headers.authorization, deps.token)) return reply.code(401).send({ error: 'jeton invalide' });
    },
  }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: 'identifiant invalide' });
    const lu = SchemaRapport.safeParse(req.body);
    if (!lu.success) return reply.code(400).send({ error: 'rapport invalide', details: lu.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const incident = await deps.incidents.rapporter(id, lu.data);
    if (incident === null) return reply.code(409).send({ error: 'incident inconnu, ou rapport déjà rendu' });
    const boutons = lu.data.issue === 2
      ? [
          { texte: '✅ Approuver', donnee: `incident:${id}:approuve` },
          { texte: '❌ Refuser', donnee: `incident:${id}:refuse` },
          { texte: '⏸ Plus tard', donnee: `incident:${id}:plus_tard` },
        ]
      : undefined;
    const parti = await deps.envoyer(texteRapport(id, incident.signal, lu.data), boutons);
    if (!parti) journaliser('warn', 'incident_rapport_non_envoye', { id });
    return reply.code(200).send({ ok: true, telegram: parti });
  });
}
