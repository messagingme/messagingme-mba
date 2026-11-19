import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { auteurOps, type PreHandler } from '../auth/middleware';
import type { DuplicationScenario, IssueApercuDuplication, IssueDuplication } from '../ops/duplication/service';
import { estUuid } from './scope';

/** Au plus 20 cases par sorte : un scénario désigne rarement plus de quelques dépendances. */
const ids = z.array(z.string().uuid()).max(20);
const templatesCoches = z.array(z.object({
  nom: z.string().regex(/^[a-z0-9_]{1,512}$/),
  langue: z.string().regex(/^[A-Za-z_]{2,15}$/),
})).max(20);
const flowsCoches = z.array(z.string().regex(/^\d{1,30}$/)).max(20);
const corpsApercu = z.object({ source: z.string(), scenarioId: z.string(), destination: z.string() });
const corpsDuplication = corpsApercu.extend({
  empreinte: z.string().regex(/^[0-9a-f]{64}$/),
  dupliquer: z.object({
    agents: ids,
    requetes: ids,
    modelesEmail: ids,
    templates: templatesCoches.optional(),
    flows: flowsCoches.optional(),
  }).optional(),
});

const INCONNU = { error: 'espace ou scénario inconnu' };
const META_ILLISIBLE = 'les templates de l’espace de destination n’ont pas pu être lus chez Meta : réessayez dans un instant';
const JETON_INVALIDE = 'le jeton WhatsApp de l’espace de destination est invalide : reconnectez son numéro, puis relancez l’aperçu';
const META_REFUSE = 'Meta refuse la lecture des templates de l’espace de destination : vérifiez que son compte WhatsApp est relié à notre application, puis relancez l’aperçu';

type RefusLectureMeta = Extract<IssueApercuDuplication['issue'], 'meta_illisible' | 'jeton_invalide' | 'meta_refuse'>;

function refusMeta(issue: RefusLectureMeta) {
  return { error: issue === 'jeton_invalide' ? JETON_INVALIDE : issue === 'meta_refuse' ? META_REFUSE : META_ILLISIBLE };
}

function estRefusMeta(issue: IssueApercuDuplication['issue'] | IssueDuplication['issue']): issue is RefusLectureMeta {
  return issue === 'meta_illisible' || issue === 'jeton_invalide' || issue === 'meta_refuse';
}

/** Le corps validé, ou `null` une fois la réponse envoyée. */
function lireCorps<C extends z.infer<typeof corpsApercu>>(lu: z.ZodSafeParseResult<C>, reply: FastifyReply): C | null {
  if (!lu.success) {
    void reply.code(400).send({ error: 'corps invalide : source, scenarioId et destination sont requis' });
    return null;
  }
  if (!estUuid(lu.data.source) || !estUuid(lu.data.scenarioId) || !estUuid(lu.data.destination)) {
    void reply.code(404).send(INCONNU);
    return null;
  }
  return lu.data;
}

/**
 * Adaptateur HTTP de la duplication entre espaces. L'autorité, Zod, les UUID et la traduction des issues en HTTP
 * restent ici ; l'assemblage, le verrou et l'ordre Meta -> base appartiennent à `DuplicationScenario`.
 */
export function registerOpsDuplication(app: FastifyInstance, duplication: DuplicationScenario, garde: PreHandler): void {
  const opts = { preHandler: garde };

  app.get('/ops/duplication/espaces', opts, async (_req, reply) => {
    const resultat = await duplication.espaces();
    if (resultat.issue === 'ok') return reply.code(200).send({ espaces: resultat.espaces });
    return reply.code(422).send({ error: 'les espaces n’ont pas pu être lus : réessayez' });
  });

  app.get('/ops/duplication/espaces/:tenantId/scenarios', opts, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    if (!estUuid(tenantId)) return reply.code(404).send({ error: 'espace inconnu' });
    const resultat = await duplication.scenarios(tenantId);
    if (resultat.issue === 'ok') return reply.code(200).send({ scenarios: resultat.scenarios });
    return reply.code(422).send({ error: 'les scénarios n’ont pas pu être lus : réessayez' });
  });

  app.post('/ops/duplication/apercu', opts, async (req, reply) => {
    const corps = lireCorps(corpsApercu.safeParse(req.body), reply);
    if (corps === null) return reply;
    const resultat = await duplication.apercu(corps);
    if (resultat.issue === 'ok') return reply.code(200).send({ apercu: resultat.apercu });
    if (resultat.issue === 'inconnu') return reply.code(404).send(INCONNU);
    if (estRefusMeta(resultat.issue)) return reply.code(422).send(refusMeta(resultat.issue));
    return reply.code(422).send({ error: 'l’aperçu n’a pas pu être calculé : réessayez' });
  });

  app.post('/ops/duplication', opts, async (req, reply) => {
    const corps = lireCorps(corpsDuplication.safeParse(req.body), reply);
    if (corps === null) return reply;
    const resultat = await duplication.dupliquer({ ...corps, auteur: auteurOps(req) });
    switch (resultat.issue) {
      case 'ok': return reply.code(201).send(resultat.copie);
      case 'inconnu': return reply.code(404).send(INCONNU);
      case 'meta_illisible':
      case 'jeton_invalide':
      case 'meta_refuse': return reply.code(422).send(refusMeta(resultat.issue));
      case 'verrou_impossible': return reply.code(422).send({ error: 'la duplication n’a pas pu commencer : réessayez dans un instant' });
      case 'verrou_occupe': return reply.code(409).send({ error: 'une duplication vers cet espace est déjà en cours' });
      case 'empreinte_perimee': return reply.code(409).send({ error: 'le scénario ou l’espace de destination a changé : relancez l’aperçu' });
      case 'choix_invalides': return reply.code(400).send({ error: 'une dépendance cochée n’est pas désignée par ce scénario' });
      case 'bloquee': return reply.code(422).send({ error: 'la duplication est bloquée', blocages: resultat.blocages });
      case 'arret_meta': return reply.code(422).send({
        error: `la duplication s’est arrêtée chez Meta : ${resultat.refus}. Rien n’a été écrit dans l’espace ; ce qui a déjà été créé chez Meta y reste`,
        crees: resultat.crees,
        champsCrees: resultat.champsCrees,
      });
      case 'ecriture_apres_meta': return reply.code(422).send({
        error: 'la duplication n’a pas pu s’écrire dans l’espace : ce qui a été créé chez Meta y reste, relancez l’aperçu',
        crees: resultat.crees,
      });
      case 'impossible': return reply.code(422).send({
        error: 'la duplication n’a pas pu aller au bout : rien n’a été écrit, relancez l’aperçu',
      });
    }
  });
}
