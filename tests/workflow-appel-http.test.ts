import { describe, it, expect, vi } from 'vitest';
import { valeurPourChamp, creerAppelHttpScenario } from '../src/workflow/appel-http';
import { MAX_OCTETS_CHAMP_JSON } from '../src/crm/fields';
import { creerTransportConnecteurHttp } from '../src/agent/transport-connecteur-http';
import { walk } from '../src/workflow/engine';
import type { WorkflowGraph } from '../src/workflow/graph';
import { lireJetonPiece } from '../src/workflow/piece-lien';

const SECRET_PIECE = 'p'.repeat(40);

/**
 * Le bloc « Appel HTTP » d'un scénario.
 *
 * 🔴 CE QUE CE FICHIER PROTÈGE : le bloc ne DÉCRIT aucun appel, il en DÉSIGNE un. Toutes les gardes (source
 * active, filtre de sortie, variables requises, adresse interne, échéance, corps borné) vivent dans
 * `creerAppelConnecteur`, partagé avec l'agent IA et couvert par ses propres tests. Ici on vérifie ce qui est
 * PROPRE au scénario : ce qui devient la valeur d'un champ, et ce qui arrive quand l'appel échoue.
 */

describe('valeurPourChamp', () => {
  it('🔴 UN seul champ déclaré -> sa valeur NUE, pas du JSON', () => {
    // C'est le cas courant, et y ranger `{"statut":"expédiée"}` obligerait le client à écrire une condition
    // sur du JSON, ce que l'écran de condition ne sait pas faire.
    expect(valeurPourChamp({ statut: 'expédiée' })).toBe('expédiée');
    expect(valeurPourChamp({ 'livraison.jours': 3 })).toBe('3');
    expect(valeurPourChamp({ actif: false })).toBe('false');
  });

  it('plusieurs champs -> l’objet JSON, faute de pouvoir en choisir un honnêtement', () => {
    expect(valeurPourChamp({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
  });

  it('une valeur STRUCTURÉE sous un seul chemin reste du JSON', () => {
    expect(valeurPourChamp({ livraison: { date: '2026-09-11' } })).toBe('{"date":"2026-09-11"}');
  });

  it('⚠️ rien de lisible -> chaîne vide, comme un échec', () => {
    // Le scénario branche ensuite sur « le champ est vide ». Distinguer « pas reçu » de « reçu vide »
    // demanderait un second champ que personne n'a demandé.
    expect(valeurPourChamp({})).toBe('');
    expect(valeurPourChamp({ a: null })).toBe('');
    expect(valeurPourChamp(null)).toBe('');
    expect(valeurPourChamp('texte')).toBe('');
    expect(valeurPourChamp([1, 2])).toBe('');
  });
});

describe('le bloc dans le graphe', () => {
  const graphe = (data: Record<string, unknown>): WorkflowGraph => ({
    nodes: [
      { id: 'a', type: 'http', data, position: { x: 0, y: 0 } },
      { id: 'b', type: 'quick_message', data: { body: 'suite' }, position: { x: 0, y: 0 } },
    ],
    edges: [{ id: 'e', source: 'a', target: 'b' }],
  });

  it('🔴 un bloc réglé produit l’action, et le parcours CONTINUE', () => {
    // Action SYNCHRONE non bloquante, comme un tag : le walk est pur, l'exécuteur fait l'IO, et le contact
    // reçoit la suite sans attendre que le connecteur réponde à l'écran.
    const r = walk(graphe({ requestId: 'req-1', champCible: 'statut_commande' }), 'a');
    expect(r.actions.map((s) => s.action)).toContainEqual({
      kind: 'appelHttp', requestId: 'req-1', champCible: 'statut_commande',
    });
  });

  it('⚠️ un bloc SANS APPEL choisi ne fait RIEN, et ne casse pas le parcours', () => {
    // Un scénario en production ne doit pas s'arrêter parce qu'un bloc est incomplet : il ne fait rien, et
    // l'écran le montre. Même traitement qu'un bloc tag sans tag.
    for (const data of [{}, { champCible: 'x' }, { requestId: '  ', champCible: 'x' }]) {
      expect(walk(graphe(data), 'a').actions.some((s) => s.action.kind === 'appelHttp')).toBe(false);
    }
  });

  it('🔴 un appel choisi SANS champ cible est un appel qui POUSSE, pas un bloc incomplet', () => {
    // Envoyer un événement à Brevo (réponse 204, rien à ranger) : exiger un champ obligeait à garder un
    // identifiant inutile, et un appel sans réponse n'avait même rien à cocher.
    const r = walk(graphe({ requestId: 'req-1' }), 'a');
    expect(r.actions.map((s) => s.action)).toContainEqual({ kind: 'appelHttp', requestId: 'req-1', champCible: '' });
  });
});

describe('le câblage du bloc', () => {
  const deps = (over: Record<string, unknown> = {}) => {
    const {
      fetchImpl = (async () => new Response('{}')) as unknown as typeof fetch,
      verifierResolution = async () => ({ ok: true as const }),
      ...reste
    } = over as Record<string, unknown> & {
      fetchImpl?: typeof fetch;
      verifierResolution?: () => Promise<{ ok: true }>;
    };
    return {
      sources: {
      pourAppel: async () => ({
        id: 's1', kind: 'http' as const, baseUrl: 'https://api.client.fr/v1', authKind: 'none' as const,
        authHeaderName: null, authSecret: null, status: 'active' as const,
      }),
      marquerEpreuve: async () => {},
      },
      requetes: {
      parId: async () => ({
        id: 'req-1', tenantId: 't1', sourceId: 's1', label: 'Statut',
        methode: 'GET' as const, chemin: '/commandes', parametres: [], entetes: [],
        corps: { mode: 'aucun' as const }, variables: [], outputPaths: ['statut'],
        valeursTest: {}, outils: 0, updatedAt: '2026-09-11T00:00:00.000Z',
      }),
      },
      projectionContact: async () => ({ nom: 'Jean', tags: [], champs: {} }),
      // Le champ `reponse_json` est de type JSON, tout autre est un texte : la lecture d'avant.
      typeDuChamp: async (_t: string, cle: string) => (cle === 'reponse_json' ? 'json' as const : 'text' as const),
      transportHttp: creerTransportConnecteurHttp({
        fetch: fetchImpl,
        verifierResolution,
      }),
      // Aucune pièce notée par défaut : un champ ordinaire part tel quel.
      pieces: { liensPossibles: async () => [] },
      secretPiece: SECRET_PIECE,
      baseApi: 'https://api.messagingme.app',
      ...reste,
    };
  };

  it('🔴 une réponse lisible devient la valeur du champ', async () => {
    const appel = creerAppelHttpScenario(deps({
      fetchImpl: (async () => new Response('{"statut":"expédiée"}', { status: 200 })) as unknown as typeof fetch,
    }) as never);
    expect(await appel('t1', '33600000001', 'req-1', 'statut')).toEqual({ ok: true, valeur: 'expédiée' });
  });

  it('🔴 un connecteur en panne rend `ok: false` et une valeur VIDE, il ne LÈVE pas', async () => {
    // Laisser l'exception remonter arrêterait le parcours du contact au milieu, pour une panne qui ne le
    // concerne pas. L'exécuteur vide alors le champ, ce qui se teste dans une condition.
    const appel = creerAppelHttpScenario(deps({
      fetchImpl: (async () => { throw new Error('réseau'); }) as unknown as typeof fetch,
    }) as never);
    expect(await appel('t1', '33600000001', 'req-1', 'statut')).toEqual({ ok: false, valeur: '' });
  });

  it('🔴 une requête introuvable NE PART PAS sur le réseau', async () => {
    const fetchImpl = vi.fn();
    const appel = creerAppelHttpScenario(deps({
      requetes: { parId: async () => null },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }) as never);
    expect(await appel('t1', '33600000001', 'req-absente', 'statut')).toEqual({ ok: false, valeur: '' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('🔴 une source INACTIVE ne part pas non plus', async () => {
    // La garde vit dans le code partagé avec l'agent IA : ce test vérifie qu'elle s'applique AUSSI par ce
    // chemin-ci, ce qui est tout l'intérêt d'avoir extrait l'appel au lieu de le réécrire.
    const fetchImpl = vi.fn();
    const appel = creerAppelHttpScenario(deps({
      sources: {
        pourAppel: async () => ({
          id: 's1', kind: 'http' as const, baseUrl: 'https://api.client.fr/v1', authKind: 'none' as const,
          authHeaderName: null, authSecret: null, status: 'disabled' as const,
        }),
        marquerEpreuve: async () => {},
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }) as never);
    expect(await appel('t1', '33600000001', 'req-1', 'statut')).toEqual({ ok: false, valeur: '' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe('un appel qui POUSSE (bloc sans champ cible)', () => {
    // La requête ne déclare AUCUN champ de réponse : c'est le cas d'un événement Brevo, qui répond 204.
    const sansSortie = {
      requetes: {
        parId: async () => ({
          id: 'req-1', tenantId: 't1', sourceId: 's1', label: 'Événement',
          methode: 'POST' as const, chemin: '/events', parametres: [], entetes: [],
          corps: { mode: 'aucun' as const }, variables: [], outputPaths: [],
          valeursTest: {}, outils: 0, updatedAt: '2026-09-30T00:00:00.000Z',
        }),
      },
    };

    it('🔴 un 204 SANS CORPS est un succès, sans champ de réponse déclaré', async () => {
      const appel = creerAppelHttpScenario(deps({
        ...sansSortie,
        fetchImpl: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
      }) as never);
      expect(await appel('t1', '33600000001', 'req-1', '')).toEqual({ ok: true, valeur: '' });
    });

    it('🔴 la même requête en INTÈGRE reste refusée : rien à lire, et elle ne part pas', async () => {
      // L'autre sens : c'est bien le bloc sans champ qui ouvre la poussée, pas un assouplissement général.
      const fetchImpl = vi.fn();
      const appel = creerAppelHttpScenario(deps({ ...sansSortie, fetchImpl: fetchImpl as unknown as typeof fetch }) as never);
      expect(await appel('t1', '33600000001', 'req-1', 'statut')).toEqual({ ok: false, valeur: '' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('un refus du système du client (4xx) reste un échec', async () => {
      const appel = creerAppelHttpScenario(deps({
        ...sansSortie,
        fetchImpl: (async () => new Response('{"message":"bad"}', { status: 400 })) as unknown as typeof fetch,
      }) as never);
      expect(await appel('t1', '33600000001', 'req-1', '')).toEqual({ ok: false, valeur: '' });
    });
  });

  /**
   * 🔴 LA PIÈCE D'UN BLOC QUESTION (spec du 2026-11-02). Le champ ne porte qu'une mention ; c'est ICI, au moment où
   * l'appel part, que le lien vers le fichier se fabrique, et seulement si le champ porte ENCORE la mention notée. Le
   * lien ouvre une pièce d'identité : il ne doit apparaître dans aucun journal.
   */
  describe('la pièce d’un bloc Question', () => {
    const MENTION = 'Pièce reçue le 02/11/2026 à 14 h 32 (photo)';
    const MAINTENANT = new Date('2026-11-02T13:32:00.000Z');
    const envoiPiece = {
      requetes: {
        parId: async () => ({
          id: 'req-1', tenantId: 't1', sourceId: 's1', label: 'Stockage',
          methode: 'POST' as const, chemin: '/pieces', parametres: [], entetes: [],
          corps: { mode: 'json' as const, gabarit: '{"fichier": "{{piece}}"}' },
          variables: [{ nom: 'piece', type: 'string', origine: { type: 'champ', cle: 'piece_identite' } }],
          outputPaths: [], valeursTest: {}, outils: 0, updatedAt: '2026-11-02T00:00:00.000Z',
        }),
      },
      maintenant: () => MAINTENANT,
    };
    const corpsEnvoyes = () => {
      const corps: string[] = [];
      const fetchImpl = (async (_u: string, init: RequestInit) => { corps.push(String(init.body)); return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
      return { corps, fetchImpl };
    };

    it('🔴 le champ porte encore la mention notée : le lien part, signé pour cet espace et ce message, quinze minutes', async () => {
      const { corps, fetchImpl } = corpsEnvoyes();
      const appel = creerAppelHttpScenario(deps({
        ...envoiPiece, fetchImpl,
        projectionContact: async () => ({ nom: 'Jean', tags: [], champs: { piece_identite: MENTION } }),
        pieces: { liensPossibles: async () => [{ cle: 'piece_identite', metaMessageId: 'wamid.P1', mention: MENTION }] },
      }) as never);
      const espace = '11111111-2222-4333-8444-555555555555';
      expect(await appel(espace, '33600000001', 'req-1', '')).toEqual({ ok: true, valeur: '' });
      const lien = (JSON.parse(corps[0]!) as { fichier: string }).fichier;
      expect(lien.startsWith('https://api.messagingme.app/f/')).toBe(true);
      const jeton = decodeURIComponent(lien.slice('https://api.messagingme.app/f/'.length));
      expect(lireJetonPiece(jeton, SECRET_PIECE, new Date(MAINTENANT.getTime() + 15 * 60_000 - 1))).toEqual({ tenantId: espace, metaMessageId: 'wamid.P1' });
      expect(lireJetonPiece(jeton, SECRET_PIECE, new Date(MAINTENANT.getTime() + 15 * 60_000 + 1))).toBeNull();
    });

    it('🔴 le champ a été réécrit depuis : sa valeur part, aucun lien', async () => {
      const { corps, fetchImpl } = corpsEnvoyes();
      const appel = creerAppelHttpScenario(deps({
        ...envoiPiece, fetchImpl,
        projectionContact: async () => ({ nom: 'Jean', tags: [], champs: { piece_identite: 'Pièce reçue le 01/11/2026 à 09 h 00 (photo)' } }),
        pieces: { liensPossibles: async () => [{ cle: 'piece_identite', metaMessageId: 'wamid.P1', mention: MENTION }] },
      }) as never);
      await appel('t1', '33600000001', 'req-1', '');
      expect(JSON.parse(corps[0]!)).toEqual({ fichier: 'Pièce reçue le 01/11/2026 à 09 h 00 (photo)' });
    });

    it('aucun champ ne ressemble à une mention : les pièces ne sont même pas lues', async () => {
      const lues = vi.fn(async () => []);
      const { fetchImpl } = corpsEnvoyes();
      const appel = creerAppelHttpScenario(deps({
        ...envoiPiece, fetchImpl,
        projectionContact: async () => ({ nom: 'Jean', tags: [], champs: { piece_identite: 'carte d’identité' } }),
        pieces: { liensPossibles: lues },
      }) as never);
      await appel('t1', '33600000001', 'req-1', '');
      expect(lues).not.toHaveBeenCalled();
    });

    it('🔴 un appel refusé dont la variable porte le lien : le lien n’entre dans aucun journal', async () => {
      const ecrit: string[] = [];
      const avertir = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { ecrit.push(a.map(String).join(' ')); });
      const appel = creerAppelHttpScenario(deps({
        ...envoiPiece,
        fetchImpl: (async () => new Response('{"message":"bad"}', { status: 400 })) as unknown as typeof fetch,
        projectionContact: async () => ({ nom: 'Jean', tags: [], champs: { piece_identite: MENTION } }),
        pieces: { liensPossibles: async () => [{ cle: 'piece_identite', metaMessageId: 'wamid.P1', mention: MENTION }] },
        journalAppels: {
          ouvrir: async (l: unknown) => { ecrit.push(JSON.stringify(l)); return 'ligne-1'; },
          clore: async (l: unknown) => { ecrit.push(JSON.stringify(l)); },
        },
      }) as never);
      expect(await appel('t1', '33600000001', 'req-1', '')).toEqual({ ok: false, valeur: '' });
      avertir.mockRestore();
      expect(ecrit.length).toBeGreaterThan(0);
      expect(ecrit.join('\n')).not.toContain('/f/');
      expect(ecrit.join('\n')).not.toContain('wamid.P1');
    });
  });
  /**
   * 🔴 VERS UN CHAMP `json` (spec du 2026-11-11) : la réponse ENTIÈRE, sans le filtre `outputPaths` du connecteur, en
   * forme compacte. Un texte non JSON devient une chaîne JSON ; un corps vide, `null` ; au-delà de 16 Ko, un échec.
   */
  describe('vers un champ JSON', () => {
    const repond = (corps: string | null, status = 200) =>
      (async () => new Response(corps, { status })) as unknown as typeof fetch;

    it('🔴 range la réponse ENTIÈRE, même ce que le connecteur ne déclare pas', async () => {
      const appel = creerAppelHttpScenario(deps({
        fetchImpl: repond('{ "statut": "expédiée", "lignes": [ { "id": 1 } ] }'),
      }) as never);
      expect(await appel('t1', '33600000001', 'req-1', 'reponse_json'))
        .toEqual({ ok: true, valeur: '{"statut":"expédiée","lignes":[{"id":1}]}' });
      // L'autre sens : le même appel vers un champ texte garde la lecture filtrée d'avant.
      expect(await appel('t1', '33600000001', 'req-1', 'statut')).toEqual({ ok: true, valeur: 'expédiée' });
    });

    it('un connecteur SANS champ de réponse déclaré suffit', async () => {
      const appel = creerAppelHttpScenario(deps({
        requetes: { parId: async () => ({
          id: 'req-1', tenantId: 't1', sourceId: 's1', label: 'Statut', methode: 'GET' as const, chemin: '/commandes',
          parametres: [], entetes: [], corps: { mode: 'aucun' as const }, variables: [], outputPaths: [],
          valeursTest: {}, outils: 0, updatedAt: '2026-11-11T00:00:00.000Z',
        }) },
        fetchImpl: repond('[1,2,3]'),
      }) as never);
      expect(await appel('t1', '33600000001', 'req-1', 'reponse_json')).toEqual({ ok: true, valeur: '[1,2,3]' });
    });

    it('un texte qui n’est pas du JSON devient une chaîne JSON ; un corps vide, null', async () => {
      const texte = creerAppelHttpScenario(deps({ fetchImpl: repond('OK merci') }) as never);
      expect(await texte('t1', '33600000001', 'req-1', 'reponse_json')).toEqual({ ok: true, valeur: '"OK merci"' });
      const vide = creerAppelHttpScenario(deps({ fetchImpl: repond(null) }) as never);
      expect(await vide('t1', '33600000001', 'req-1', 'reponse_json')).toEqual({ ok: true, valeur: 'null' });
    });

    it('🔴 une réponse de plus de 16 Ko est un ÉCHEC (champ vidé), jamais tronquée', async () => {
      const gros = JSON.stringify({ x: 'a'.repeat(MAX_OCTETS_CHAMP_JSON) });
      const appel = creerAppelHttpScenario(deps({ fetchImpl: repond(gros) }) as never);
      expect(await appel('t1', '33600000001', 'req-1', 'reponse_json')).toEqual({ ok: false, valeur: '' });
      // Vers un champ texte, le plafond de lecture d'avant (64 Ko) laisse passer le même corps.
      expect((await appel('t1', '33600000001', 'req-1', 'statut')).ok).toBe(true);
    });

    it('🔴 un texte qui tient en 16 Ko mais pas une fois échappé est un échec aussi', async () => {
      // Chaque guillemet devient `\"` : 9 000 guillemets lus en 9 000 octets, rangés en plus de 18 000.
      const appel = creerAppelHttpScenario(deps({ fetchImpl: repond('"'.repeat(9000) + 'x') }) as never);
      expect(await appel('t1', '33600000001', 'req-1', 'reponse_json')).toEqual({ ok: false, valeur: '' });
    });

    it('le type se lit pour le champ CIBLE de cet espace', async () => {
      const vus: string[] = [];
      const appel = creerAppelHttpScenario(deps({
        typeDuChamp: async (t: string, cle: string) => { vus.push(`${t}:${cle}`); return 'json' as const; },
        fetchImpl: repond('{}'),
      }) as never);
      await appel('t1', '33600000001', 'req-1', 'reponse_json');
      expect(vus).toEqual(['t1:reponse_json']);
    });
  });
});
