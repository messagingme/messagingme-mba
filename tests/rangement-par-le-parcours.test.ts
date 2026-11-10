import { describe, expect, it } from 'vitest';
import { creerRangementParLesParcours, rangerParLesParcours } from '../src/webhooks/rangement-par-le-parcours';
import { formulaireDuJeton, jetonDeFormulaire, rangementDuBloc, valeurEnTexte } from '../web/lib/partage/rangement-formulaire';
import { extractInbound } from '../src/webhooks/inbound';
import type { WorkflowGraph } from '../src/workflow/graph';
import type { EntrantRattache } from '../src/webhooks/rattachement';

/**
 * 🔴 LE BLOC FORMULAIRE EN ATTENTE RANGE CE QU'IL CITE (Julien, 2026-11-10). Un formulaire du Business Manager n'a aucun
 * rangement : sans le bloc, ses réponses ne vont nulle part. Et un bloc qui ne range rien laisse tout au formulaire,
 * comme avant.
 */
/** Le jeton du formulaire `f1`, tel que le bloc l'envoie et que Meta le renvoie dans la réponse. */
const JETON = jetonDeFormulaire('33611', 'f1', 1);

function graphe(data: Record<string, unknown>, type = 'flow'): WorkflowGraph {
  return { nodes: [{ id: 'n1', type: type as 'flow', position: { x: 0, y: 0 }, data: { flowId: 'f1', ...data } }], edges: [] };
}

function monter(g: WorkflowGraph | null, run: { currentNode: string | null } | null = { currentNode: 'n1' }) {
  const ecrits: Array<{ cle: string; valeur: string }> = [];
  const parcours = creerRangementParLesParcours({
    trouverEnAttente: async () => (run ? { workflowId: 'wf1', currentNode: run.currentNode, grapheFige: null } : null),
    graphe: async () => g,
    ecrire: async (_t, _w, cle, valeur) => { ecrits.push({ cle, valeur }); },
  });
  return { parcours, ecrits };
}

describe('le rangement par le bloc Formulaire en attente', () => {
  it('écrit chaque élément cité dans son champ, et rend les clés citées', async () => {
    const { parcours, ecrits } = monter(graphe({ flowId: 'f1', rangement: { prenom_bm: 'prenom', ville: 'ville_contact' } }));
    const cles = await parcours.ranger('t1', '33611', { flow_token: JETON, prenom_bm: 'Marc', ville: 'Lyon', autre: 'x' });
    expect(ecrits).toEqual([{ cle: 'prenom', valeur: 'Marc' }, { cle: 'ville_contact', valeur: 'Lyon' }]);
    expect([...cles]).toEqual(['prenom_bm', 'ville']);
  });

  it('« ne pas enregistrer » (champ vide) n’écrit rien mais garde la clé au bloc', async () => {
    const { parcours, ecrits } = monter(graphe({ rangement: { mail: '' } }));
    const cles = await parcours.ranger('t1', '33611', { flow_token: JETON, mail: 'a@b.fr' });
    expect(ecrits).toEqual([]);
    expect([...cles]).toEqual(['mail']);
  });

  it('un élément absent de la réponse n’est ni écrit ni retiré au formulaire', async () => {
    const { parcours, ecrits } = monter(graphe({ rangement: { mail: 'email' } }));
    expect([...(await parcours.ranger('t1', '33611', { flow_token: JETON, nom: 'X' }))]).toEqual([]);
    expect(ecrits).toEqual([]);
  });

  it('🔴 un bloc SANS rangement ne fait rien : tout reste au réglage du formulaire, comme avant', async () => {
    const { parcours, ecrits } = monter(graphe({ flowId: 'f1' }));
    expect((await parcours.ranger('t1', '33611', { flow_token: JETON, nom: 'X' })).size).toBe(0);
    expect(ecrits).toEqual([]);
  });

  it('aucun parcours en attente, ou en attente ailleurs que sur un Formulaire : rien', async () => {
    expect((await monter(graphe({ rangement: { nom: 'prenom' } }), null).parcours.ranger('t1', 'w', { flow_token: JETON, nom: 'X' })).size).toBe(0);
    expect((await monter(graphe({ rangement: { nom: 'prenom' } }, 'question')).parcours.ranger('t1', 'w', { flow_token: JETON, nom: 'X' })).size).toBe(0);
    expect((await monter(graphe({ rangement: { nom: 'prenom' } }), { currentNode: 'n9' }).parcours.ranger('t1', 'w', { flow_token: JETON, nom: 'X' })).size).toBe(0);
  });

  it('une écriture en échec n’arrête pas les autres, et la clé reste au bloc', async () => {
    const ecrits: string[] = [];
    const parcours = creerRangementParLesParcours({
      trouverEnAttente: async () => ({ workflowId: 'wf1', currentNode: 'n1', grapheFige: graphe({ rangement: { a: 'champ_a', b: 'champ_b' } }) }),
      graphe: async () => null,
      ecrire: async (_t, _w, cle) => { if (cle === 'champ_a') throw new Error('base'); ecrits.push(cle); },
    });
    const cles = await parcours.ranger('t1', 'w', { flow_token: JETON, a: '1', b: '2' });
    expect(ecrits).toEqual(['champ_b']);
    expect([...cles]).toEqual(['a', 'b']);
  });

  it('🔴 la réponse à un AUTRE formulaire, ou sans jeton qui nomme celui du bloc, n’est pas rangée par le bloc', async () => {
    // Les clés de nos formulaires sont des mots courants : le formulaire d'une campagne rempli pendant l'attente aurait
    // été rangé selon ce bloc (relecture du 2026-11-10). Il reste au réglage de SON formulaire.
    const { parcours, ecrits } = monter(graphe({ rangement: { email: 'email_pro' } }));
    expect((await parcours.ranger('t1', '33611', { email: 'a@b.fr', flow_token: jetonDeFormulaire('33611', 'autre', 1) })).size).toBe(0);
    expect((await parcours.ranger('t1', '33611', { email: 'a@b.fr', flow_token: '33611-1' })).size).toBe(0);
    expect((await parcours.ranger('t1', '33611', { email: 'a@b.fr' })).size).toBe(0);
    expect(ecrits).toEqual([]);
  });

  it('le jeton nomme le formulaire, et rien d’autre', () => {
    expect(formulaireDuJeton(jetonDeFormulaire('33611', '1835918317399586', 1731234567890))).toBe('1835918317399586');
    expect(formulaireDuJeton('33611-1731234567890')).toBeNull();
    expect(formulaireDuJeton('x~')).toBeNull();
    expect(formulaireDuJeton(42)).toBeNull();
  });

  it('le graphe figé du parcours prime sur le graphe enregistré', async () => {
    const ecrits: string[] = [];
    const parcours = creerRangementParLesParcours({
      trouverEnAttente: async () => ({ workflowId: 'wf1', currentNode: 'n1', grapheFige: graphe({ rangement: { a: 'fige' } }) }),
      graphe: async () => graphe({ rangement: { a: 'enregistre' } }),
      ecrire: async (_t, _w, cle) => { ecrits.push(cle); },
    });
    await parcours.ranger('t1', 'w', { flow_token: JETON, a: '1' });
    expect(ecrits).toEqual(['fige']);
  });
});

describe('rangerParLesParcours sur les entrants du lot', () => {
  const nfm = (from: string, id: string, field = 'messages') => ({
    entry: [{ changes: [{ field, value: {
      metadata: { phone_number_id: 'pn1' },
      messages: [{ id, from, type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', response_json: JSON.stringify({ nom: 'Marc', flow_token: JETON }) } } }],
    } }] }],
  });
  const entrants = (payload: unknown, tenantId: string | null = 't1'): EntrantRattache[] =>
    extractInbound(payload).map((message) => ({ message, tenantId }));

  it('rend, par wamid, les clés rangées par le bloc', async () => {
    const { parcours } = monter(graphe({ rangement: { nom: 'prenom' } }));
    const out = await rangerParLesParcours(entrants(nfm('33611', 'wamid.1')), parcours);
    expect([...(out.get('wamid.1') ?? [])]).toEqual(['nom']);
  });

  it('ni un numéro inconnu, ni un standby (aucun parcours n’y avance) ne rangent', async () => {
    const { parcours, ecrits } = monter(graphe({ rangement: { nom: 'prenom' } }));
    expect((await rangerParLesParcours(entrants(nfm('33611', 'wamid.1'), null), parcours)).size).toBe(0);
    expect((await rangerParLesParcours(entrants(nfm('33611', 'wamid.2', 'standby')), parcours)).size).toBe(0);
    expect(ecrits).toEqual([]);
  });

  it('une panne sur un message le laisse au formulaire, sans lever', async () => {
    const parcours = { ranger: async () => { throw new Error('base'); } };
    await expect(rangerParLesParcours(entrants(nfm('33611', 'wamid.1')), parcours)).resolves.toEqual(new Map());
  });
});

describe('la lecture du rangement d’un bloc et des valeurs reçues', () => {
  it('écarte ce qui n’est pas un rangement lisible, sans deviner', () => {
    expect(rangementDuBloc({})).toEqual({});
    expect(rangementDuBloc({ rangement: ['x'] })).toEqual({});
    expect(rangementDuBloc({ rangement: { ok: ' prenom ', vide: '', '_ref': 'x', flow_token: 'y', 'a b': 'c', num: 3, pt: 'a.b', '@x': 'y' } }))
      .toEqual({ ok: 'prenom', vide: '' });
  });

  it('met chaque forme de réponse en texte', () => {
    expect(valeurEnTexte('Marc')).toBe('Marc');
    expect(valeurEnTexte('  ')).toBeNull();
    expect(valeurEnTexte(true)).toBe('true');
    expect(valeurEnTexte(false)).toBe('false');
    expect(valeurEnTexte(3)).toBe('3');
    expect(valeurEnTexte(['a', 'b', ''])).toBe('a, b');
    expect(valeurEnTexte([])).toBeNull();
    expect(valeurEnTexte({ a: 1 })).toBeNull();
    expect(valeurEnTexte(null)).toBeNull();
  });

  it('l’entrant garde la réponse COMPLÈTE du formulaire, au-delà des 2 000 caractères de son payload', () => {
    const long = 'x'.repeat(3000);
    const payload = { entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: 'pn1' },
      messages: [{ id: 'w1', from: '336', type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: JSON.stringify({ texte: long }) } } }],
    } }] }] };
    const [m] = extractInbound(payload);
    expect(m?.reponseFormulaire).toEqual({ texte: long });
    expect(m?.buttonPayload?.length).toBe(2000);
  });
});
