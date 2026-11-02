import { describe, it, expect } from 'vitest';
import { compilerRecette, decompilerGraphe, cleTemplateRecette, type ReferencesResolues } from '../src/workflow/recette-graphe';
import { empreinteRecette, type Etape } from '../src/workflow/recette';
import { parseGraph, type WorkflowGraph } from '../src/workflow/graph';
import { actionOf } from '../src/workflow/engine';
import { ouvertureApi } from '../src/workflow/ouverture-api';

const AGENT = '7f6b1c2e-1d2a-4b3c-8d4e-5f6a7b8c9d0e';
const AGENT_INACTIF = '11111111-2222-4333-8444-555555555555';
const humain: Etape = { humain: {} };

const refs = (): ReferencesResolues => ({
  templates: new Map([
    [cleTemplateRecette('relance_devis', 'fr'), {
      etat: 'approuve' as const,
      boutons: [{ type: 'QUICK_REPLY', text: 'Oui' }, { type: 'QUICK_REPLY', text: 'Plus tard' }, { type: 'URL', text: 'Site', url: 'https://exemple.fr' }],
      variables: 1,
      indices: [{ position: 1, source: { type: 'field' as const, key: 'prenom' } }],
    }],
    [cleTemplateRecette('info', 'fr'), { etat: 'approuve' as const, boutons: [], variables: 0, indices: [] }],
    [cleTemplateRecette('deux_vars', 'fr'), {
      etat: 'approuve' as const, boutons: [], variables: 2, indices: [{ position: 1, source: { type: 'field' as const, key: 'prenom' } }],
    }],
    [cleTemplateRecette('en_revue', 'fr'), { etat: 'non_approuve' as const, statut: 'PENDING' }],
    [cleTemplateRecette('casse', 'fr'), { etat: 'non_envoyable' as const, raison: 'en-tête texte à variable' }],
  ]),
  agents: new Map([
    [AGENT, { actif: true, label: 'Conseiller', sorties: [{ code: 'devis', label: 'Veut un devis' }] }],
    [AGENT_INACTIF, { actif: false, label: 'Ancien', sorties: [] }],
  ]),
  champs: new Set(['prenom', 'ville']),
});

/** La recette de référence : un template à deux réponses rapides, un message à fichier, un agent, l'équipe. */
const complete = (): Etape => ({
  template: { nom: 'relance_devis', langue: 'fr', variables: { 1: { champ: 'prenom' } } },
  boutons: [
    { texte: 'Oui', suite: { agent: { agent_id: AGENT } } },
    {
      texte: 'Plus tard',
      suite: {
        message: { texte: 'Voici la brochure', fichier: { url: 'https://exemple.fr/brochure.pdf' } },
        reponses: [{ texte: 'Merci', suite: humain }, { texte: 'Rappel', suite: { message: { texte: 'Je vous rappelle.' } } }],
        autre_reponse: humain,
      },
    },
  ],
  autre_reponse: humain,
});

const compile = (e: Etape, precedent: WorkflowGraph | null = null): WorkflowGraph => {
  const r = compilerRecette(e, refs(), precedent);
  if (!r.ok) throw new Error(`compilation refusée : ${r.message}`);
  return r.valeur;
};
const refusDe = (e: Etape) => {
  const r = compilerRecette(e, refs(), null);
  if (r.ok) throw new Error('attendu : un refus');
  return r;
};
const suivant = (g: WorkflowGraph, source: string, handle?: string) =>
  g.nodes.find((n) => n.id === g.edges.find((x) => x.source === source && x.sourceHandle === handle)?.target);

describe('compilerRecette : le graphe que le moteur lit', () => {
  it('produit un graphe que parseGraph accepte, l’entrée en premier', () => {
    const g = compile(complete());
    expect(parseGraph(g)).not.toBeNull();
    expect(g.nodes[0]!.type).toBe('template');
  });

  it('le template : nom, langue, boutons du template approuvé, variables, et une branche par index de bouton', () => {
    const g = compile(complete());
    const t = g.nodes[0]!;
    expect(t.data).toMatchObject({ templateName: 'relance_devis', language: 'fr', variables: [{ position: 1, source: { type: 'field', key: 'prenom' } }] });
    const a = actionOf(t);
    expect(a).toMatchObject({ kind: 'sendTemplate', templateName: 'relance_devis', buttons: [{ text: 'Oui' }, { text: 'Plus tard' }, { text: 'Site' }] });
    expect(suivant(g, t.id, 'btn:0')?.type).toBe('agent');
    expect(suivant(g, t.id, 'btn:1')?.type).toBe('quick_message');
    expect(suivant(g, t.id, undefined)?.type).toBe('inbox');
    expect(g.edges.some((e) => e.source === t.id && e.sourceHandle === 'btn:2')).toBe(false);
  });

  it('le message : texte, réponses rapides dans l’ordre, fichier en `imageUrl`, branches `btn:<i>`', () => {
    const g = compile(complete());
    const m = g.nodes.find((n) => n.type === 'quick_message' && n.data.body === 'Voici la brochure')!;
    expect(actionOf(m)).toMatchObject({ kind: 'sendQuickMessage', body: 'Voici la brochure', mediaUrl: 'https://exemple.fr/brochure.pdf', buttons: [{ text: 'Merci' }, { text: 'Rappel' }] });
    expect(suivant(g, m.id, 'btn:0')?.type).toBe('inbox');
    expect(suivant(g, m.id, 'btn:1')?.data.body).toBe('Je vous rappelle.');
  });

  it('🔴 l’agent est câblé comme le répondeur : ses règles, l’escalade et le délai vers une fin silencieuse, les pannes sans arête', () => {
    const g = compile(complete());
    const a = g.nodes.find((n) => n.type === 'agent')!;
    expect(a.data).toMatchObject({ agentId: AGENT, agentLabel: 'Conseiller', sorties: [{ code: 'devis', label: 'Veut un devis' }] });
    const handles = g.edges.filter((e) => e.source === a.id).map((e) => e.sourceHandle).sort();
    expect(handles).toEqual(['sortie:devis', 'sortie:humain', 'timeout']);
    const fins = new Set(g.edges.filter((e) => e.source === a.id).map((e) => e.target));
    expect(fins.size).toBe(1);
    const fin = g.nodes.find((n) => fins.has(n.id))!;
    expect(fin.type).toBe('action');
    expect(actionOf(fin)).toBeNull();
    expect(g.edges.some((e) => e.source === fin.id)).toBe(false);
  });

  it('un message sans réponse rapide : sa « suite » est l’arête libre', () => {
    const g = compile({ message: { texte: 'Bonjour' }, suite: humain });
    expect(suivant(g, g.nodes[0]!.id, undefined)?.type).toBe('inbox');
  });

  it('les indices de la console sont recopiés dans le bloc quand la recette ne dit rien', () => {
    const g = compile({ template: { nom: 'relance_devis', langue: 'fr' }, boutons: [{ texte: 'Oui', suite: humain }, { texte: 'Plus tard', suite: humain }] });
    expect(g.nodes[0]!.data.variables).toEqual([{ position: 1, source: { type: 'field', key: 'prenom' } }]);
  });

  it('les trois sources : un champ, un texte fixe, un attribut de la fiche', () => {
    const g = compile({ template: { nom: 'deux_vars', langue: 'fr', variables: { 1: { texte: 'Bonjour' }, 2: { attribut: 'name' } } } });
    expect(g.nodes[0]!.data.variables).toEqual([
      { position: 1, source: { type: 'literal', value: 'Bonjour' } },
      { position: 2, source: { type: 'attribute', key: 'name' } },
    ]);
  });

  it('ouvertureApi lit un template d’entrée', () => {
    expect(ouvertureApi(compile(complete()))).toEqual({ ouverture: 'whatsapp_template' });
  });

  it('aucun couple de blocs à la même position', () => {
    const g = compile(complete());
    const positions = g.nodes.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('compilerRecette : les refus', () => {
  it('un template absent, en revue, ou que l’API ne sait pas envoyer', () => {
    expect(refusDe({ template: { nom: 'inconnu', langue: 'fr' } })).toMatchObject({ code: 'template_not_found', chemin: 'entree.template' });
    expect(refusDe({ template: { nom: 'en_revue', langue: 'fr' } })).toMatchObject({ code: 'template_not_approved', chemin: 'entree.template' });
    expect(refusDe({ template: { nom: 'casse', langue: 'fr' } })).toMatchObject({ code: 'unsendable_target' });
    expect(refusDe({ template: { nom: 'relance_devis', langue: 'en' } })).toMatchObject({ code: 'template_not_found' });
  });

  it('un texte de bouton presque juste : refus, avec la liste exacte des réponses rapides', () => {
    const r = refusDe({ template: { nom: 'relance_devis', langue: 'fr' }, boutons: [{ texte: 'oui', suite: humain }, { texte: 'Plus tard', suite: humain }] });
    expect(r).toMatchObject({ code: 'template_button_unknown', chemin: 'entree.boutons[0].texte' });
    expect(r.message).toContain('« Oui »');
    expect(r.message).toContain('« Plus tard »');
  });

  it('un bouton de lien n’est pas une branche', () => {
    const r = refusDe({ template: { nom: 'relance_devis', langue: 'fr' }, boutons: [{ texte: 'Oui', suite: humain }, { texte: 'Plus tard', suite: humain }, { texte: 'Site', suite: humain }] });
    expect(r).toMatchObject({ code: 'template_button_unknown', chemin: 'entree.boutons[2].texte' });
  });

  it('🔴 une réponse rapide sans branche est refusée (cliquée, elle ferait un trou de montage)', () => {
    expect(refusDe({ template: { nom: 'relance_devis', langue: 'fr' }, boutons: [{ texte: 'Oui', suite: humain }] }))
      .toMatchObject({ code: 'quick_reply_unwired', chemin: 'entree.boutons' });
    expect(refusDe({ template: { nom: 'relance_devis', langue: 'fr' } })).toMatchObject({ code: 'quick_reply_unwired' });
  });

  it('un template sans réponse rapide termine le parcours', () => {
    expect(refusDe({ template: { nom: 'info', langue: 'fr' }, autre_reponse: humain })).toMatchObject({ code: 'invalid_body', chemin: 'entree.autre_reponse' });
    expect(refusDe({ template: { nom: 'info', langue: 'fr' }, boutons: [{ texte: 'Oui', suite: humain }] })).toMatchObject({ code: 'template_button_unknown' });
    expect(compilerRecette({ template: { nom: 'info', langue: 'fr' } }, refs(), null).ok).toBe(true);
  });

  it('un agent inactif ou d’un autre espace', () => {
    expect(refusDe({ agent: { agent_id: AGENT_INACTIF } })).toMatchObject({ code: 'agent_unavailable', chemin: 'entree.agent.agent_id' });
    expect(refusDe({ agent: { agent_id: '99999999-2222-4333-8444-555555555555' } })).toMatchObject({ code: 'agent_unavailable' });
  });

  it('un champ inconnu, une variable que le template n’a pas, une variable sans source hors de l’entrée', () => {
    expect(refusDe({ template: { nom: 'deux_vars', langue: 'fr', variables: { 1: { champ: 'age' }, 2: { champ: 'ville' } } } }))
      .toMatchObject({ code: 'field_unknown', chemin: 'entree.template.variables.1' });
    expect(refusDe({ template: { nom: 'info', langue: 'fr', variables: { 1: { champ: 'ville' } } } }))
      .toMatchObject({ code: 'invalid_body', chemin: 'entree.template.variables.1' });
    // À l'entrée, `/v1/sends` remplit les variables par ses `params` : le manque est permis.
    expect(compilerRecette({ template: { nom: 'deux_vars', langue: 'fr' } }, refs(), null).ok).toBe(true);
    const imbrique: Etape = { message: { texte: 'Bonjour' }, suite: { template: { nom: 'deux_vars', langue: 'fr' } } };
    expect(refusDe(imbrique)).toMatchObject({ code: 'invalid_body', chemin: 'entree.suite.template.variables' });
  });
});

describe('decompilerGraphe et l’empreinte', () => {
  const recettes: Etape[] = [
    complete(),
    { message: { texte: 'Bonjour' }, suite: humain },
    { message: { texte: 'Un choix ?' }, reponses: [{ texte: '1', suite: humain }, { texte: '2', suite: { agent: { agent_id: AGENT } } }] },
    { template: { nom: 'info', langue: 'fr' } },
    { agent: { agent_id: AGENT } },
  ];

  it('l’aller-retour rend la recette', () => {
    for (const r of recettes) {
      const d = decompilerGraphe(compile(r));
      expect(d.ok && d.valeur).toEqual(r);
    }
  });

  it('bouger un bloc ne change pas l’empreinte, changer un texte la change', () => {
    const g = compile(complete());
    const bouge = { ...g, nodes: g.nodes.map((n) => ({ ...n, position: { x: n.position.x + 37, y: n.position.y - 11 } })) };
    const avant = decompilerGraphe(g);
    const apres = decompilerGraphe(bouge);
    if (!avant.ok || !apres.ok) throw new Error('décompilation attendue');
    expect(empreinteRecette(apres.valeur)).toBe(empreinteRecette(avant.valeur));
    const texte = { ...g, nodes: g.nodes.map((n) => (n.data.body === 'Voici la brochure' ? { ...n, data: { ...n.data, body: 'Autre texte' } } : n)) };
    const change = decompilerGraphe(texte);
    expect(change.ok && empreinteRecette(change.valeur)).not.toBe(empreinteRecette(avant.valeur));
  });

  it('un graphe que la recette ne sait pas décrire : un bloc condition, deux branches qui se rejoignent, un bloc isolé', () => {
    const g = compile({ message: { texte: 'Un choix ?' }, reponses: [{ texte: 'A', suite: humain }, { texte: 'B', suite: humain }] });
    const avecCondition: WorkflowGraph = { ...g, nodes: [...g.nodes, { id: 'c', type: 'condition', position: { x: 0, y: 900 }, data: {} }], edges: [...g.edges, { id: 'x', source: g.nodes[1]!.id, target: 'c' }] };
    expect(decompilerGraphe(avecCondition)).toMatchObject({ ok: false, code: 'scenario_not_describable' });
    const humainB = g.edges.find((e) => e.sourceHandle === 'btn:1')!.target;
    const rejoint: WorkflowGraph = { ...g, nodes: g.nodes.filter((n) => n.id !== humainB), edges: g.edges.map((e) => (e.sourceHandle === 'btn:1' ? { ...e, target: g.edges.find((x) => x.sourceHandle === 'btn:0')!.target } : e)) };
    expect(decompilerGraphe(rejoint)).toMatchObject({ ok: false, code: 'scenario_not_describable' });
    const isole: WorkflowGraph = { ...g, nodes: [...g.nodes, { id: 'seul', type: 'inbox', position: { x: 5, y: 5 }, data: {} }] };
    expect(decompilerGraphe(isole)).toMatchObject({ ok: false, code: 'scenario_not_describable' });
  });
});

describe('les identifiants au remplacement', () => {
  const avecCodes = (g: WorkflowGraph): WorkflowGraph =>
    ({ ...g, nodes: g.nodes.map((n, i) => ({ ...n, data: { ...n.data, code: `nod_abc_${String(i).padStart(26, '0')}` } })) });
  const bloc = (g: WorkflowGraph, pred: (n: WorkflowGraph['nodes'][number]) => boolean) => g.nodes.find(pred)!;

  it('🔴 un bloc dont le chemin et les sorties n’ont pas bougé garde son id et son code ; une branche renommée en reçoit un neuf', () => {
    const codes = avecCodes(compile(complete()));
    const modifiee = complete() as Extract<Etape, { template: unknown }>;
    const plusTard = modifiee.boutons![1]!.suite as Extract<Etape, { message: unknown }>;
    plusTard.reponses![1] = { texte: 'Rappelez-moi', suite: { message: { texte: 'Je vous rappelle.' } } };
    const apres = compile(modifiee, codes);
    // L'entrée et l'agent n'ont pas bougé : même id, même code. Un contact qui attend leur réponse reprend là.
    expect(apres.nodes[0]!.id).toBe(codes.nodes[0]!.id);
    expect(apres.nodes[0]!.data.code).toBe(codes.nodes[0]!.data.code);
    expect(bloc(apres, (n) => n.type === 'agent').id).toBe(bloc(codes, (n) => n.type === 'agent').id);
    // La brochure a changé de sorties : nouvel id (un clic sur l'ancienne liste ne suit pas une autre branche), même code.
    const brochureAvant = bloc(codes, (n) => n.data.body === 'Voici la brochure');
    const brochureApres = bloc(apres, (n) => n.data.body === 'Voici la brochure');
    expect(brochureApres.id).not.toBe(brochureAvant.id);
    expect(brochureApres.data.code).toBe(brochureAvant.data.code);
    // La branche renommée est un chemin neuf : nouvel id, pas de code repris.
    const rappelApres = bloc(apres, (n) => n.data.body === 'Je vous rappelle.');
    expect(rappelApres.id).not.toBe(bloc(codes, (n) => n.data.body === 'Je vous rappelle.').id);
    expect(rappelApres.data.code).toBeUndefined();
  });

  it('🔴 réordonner les réponses rapides change l’id du message : le clic d’un contact en attente arrive par position', () => {
    const avant: Etape = { message: { texte: 'Un choix ?' }, reponses: [{ texte: 'Oui', suite: humain }, { texte: 'Non', suite: { message: { texte: 'Dommage' } } }] };
    const apres: Etape = { message: { texte: 'Un choix ?' }, reponses: [{ texte: 'Non', suite: { message: { texte: 'Dommage' } } }, { texte: 'Oui', suite: humain }] };
    const g1 = avecCodes(compile(avant));
    const g2 = compile(apres, g1);
    expect(g2.nodes[0]!.id).not.toBe(g1.nodes[0]!.id);
    expect(g2.nodes[0]!.data.code).toBe(g1.nodes[0]!.data.code);
    // Les suites, elles, gardent le leur : leur chemin passe par le texte, qui n'a pas bougé.
    expect(bloc(g2, (n) => n.data.body === 'Dommage').id).toBe(bloc(g1, (n) => n.data.body === 'Dommage').id);
  });

  it('deux textes qui se ressemblent une fois concaténés ne fabriquent pas le même id', () => {
    const e: Etape = {
      message: { texte: 'Choix' },
      reponses: [{ texte: 'a/r:b', suite: { message: { texte: 'x' }, reponses: [{ texte: 'c', suite: humain }] } }, { texte: 'a', suite: { message: { texte: 'y' }, reponses: [{ texte: 'b/r:c', suite: humain }] } }],
    };
    const g = compile(e);
    expect(new Set(g.nodes.map((n) => n.id)).size).toBe(g.nodes.length);
  });
});
