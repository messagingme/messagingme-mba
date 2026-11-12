import { describe, it, expect } from 'vitest';
import { buildWorkflowRuntime } from '../src/workflow/wiring';
import type { WorkflowExecutorDeps } from '../src/workflow/executor';
import { offresToutOuvert, filiereApiSeule } from './gardes';

/**
 * LE BLOC « ENVOYER AU MBA », VRAI CÂBLAGE (`confierAuMbaParLeBloc`, `src/workflow/wiring.ts`) : ce qu'il transmet à
 * l'agent de Meta (2026-11-12).
 *
 * Mesuré sur MUTAC, routage des modèles vers Messaging Me : le message du client que NOUS avons reçu, transmis à
 * l'agent par un événement, échoue chez Meta, alors que la question suivante lui arrive directement et qu'il y répond.
 * Un scénario qui dit « posez-nous votre question » puis passe la main ne doit donc rien transmettre : le dernier
 * message est le nôtre. Seul un message du client resté sans réponse part (`saisieSansReponse`).
 */
function cablage(saisieSansReponse: string | null) {
  const transmis: string[] = [];
  const inerte = {} as never;
  const { executor } = buildWorkflowRuntime({
    pool: inerte, queue: { enqueue: async () => {} }, dryRun: true, repo: inerte, contactStore: inerte,
    inboxStore: {
      saisieSansReponse: async () => saisieSansReponse,
      // L'ancienne lecture rendait toujours le dernier message du client, même déjà répondu : elle ne doit plus servir.
      derniereSaisieDuContact: async () => 'Vous avez une question',
    } as never,
    settingsStore: inerte,
    workflowStore: { designation: async () => null } as never,
    metaCredentials: inerte, metaFactory: inerte, rcsProvider: 'fake', emailTemplates: inerte,
    emailResolver: inerte, numeroDeLEspace: async () => null, runStore: inerte,
    fil: { envoyerAuMba: async (_t: string, _w: string, o: { contenu: string }) => { transmis.push(o.contenu); return 'confie'; } } as never,
    offres: offresToutOuvert,
    prevenirEquipe: async () => {},
    application: filiereApiSeule,
    magasinObjets: null, connecteurHubspot: null,
  });
  const { confierAuMbaParLeBloc } = Reflect.get(executor, 'deps') as WorkflowExecutorDeps;
  return { confierAuMbaParLeBloc, transmis };
}

describe('le bloc « Envoyer au MBA » ne transmet que le message du client resté sans réponse', () => {
  it('🔴 le scénario a parlé après le client (« posez-nous votre question ») : rien n’est transmis', async () => {
    const { confierAuMbaParLeBloc, transmis } = cablage(null);
    await confierAuMbaParLeBloc('t1', '33612345678', 'wf1');
    expect(transmis).toEqual(['']);
  });

  it('le client a écrit en dernier : son message est transmis, pour que l’agent y réponde', async () => {
    const { confierAuMbaParLeBloc, transmis } = cablage('Avez-vous une carence ?');
    await confierAuMbaParLeBloc('t1', '33612345678', 'wf1');
    expect(transmis).toEqual(['Avez-vous une carence ?']);
  });
});
