import type { Page } from '@playwright/test';
import { CHAMPS_DEMO, OFFRE_PRO, type Locale } from './donnees-demo';

/**
 * L'AGENT IA DE LA DÉMONSTRATION, pour les cinq fiches de l'agent IA (« Construire un agent IA » et ses quatre fiches
 * par sujet, 2026-11-19). Un conseiller de « Votre marque », inventé ; ses réponses, ses fiches, ses outils et ses
 * essais sont simulés ici, la console est la vraie. Les formes de réponse sont celles des e2e `web/e2e/agents-*.spec.ts`.
 */
export const AG = 'ag-demo';
export const WF_RDV = 'wf-rdv';
export const WF_BIENVENUE = 'wf-bienvenue';
export const RQ = 'rq-commande';
export const SRC = 'src-boutique';

/**
 * Le catalogue des outils maison, recopié de celui du serveur (`OUTILS_MAISON`) : les titres et les descriptions que
 * « Toujours là » affiche sont les vrais.
 */
export const CATALOGUE_OUTILS: Array<{ handler: string; nomDefaut: string; titre: Record<Locale, string>; description: Record<Locale, string>; nePasUtiliser: Record<Locale, string>; risk: string; params: unknown[] }> = [
  {"handler":"terminer","nomDefaut":"mba_terminer","titre":{"fr":"Terminer par une règle d’arrêt","en":"Finish through a stop rule"},"description":{"fr":"À appeler quand la conversation a atteint un de ses aboutissements, c’est-à-dire une des règles d’arrêt réglées dans cet outil. Rend la main au scénario par la sortie choisie.","en":"Call when the conversation has reached one of its outcomes, that is one of the stop rules set in this tool. Hands back to the scenario through the chosen output."},"nePasUtiliser":{"fr":"Ne pas appeler pour passer la main à un humain : il y a un outil pour ça.","en":"Do not call to hand over to a human: there is a dedicated tool."},"risk":"read","params":[{"name":"sortie","edition":"derive_des_sorties"}]},
  {"handler":"escalader","nomDefaut":"mba_escalader_humain","titre":{"fr":"Passer la main à un humain","en":"Hand over to a human"},"description":{"fr":"À appeler dès que la demande sort du périmètre, ou que le contact le demande. La conversation arrive dans l’inbox.","en":"Call as soon as the request is out of scope, or the contact asks for it. The conversation lands in the inbox."},"nePasUtiliser":{"fr":"Ne pas appeler par prudence sur une question à laquelle les sources répondent.","en":"Do not call out of caution on a question the sources answer."},"risk":"write","params":[]},
  {"handler":"marquer_urgent","nomDefaut":"mba_marquer_urgent","titre":{"fr":"Marquer la conversation urgente","en":"Mark the conversation as urgent"},"description":{"fr":"À appeler quand la demande du contact presse vraiment : un problème qui le bloque, une réclamation, un délai qui expire. La conversation apparaît dans le dossier « Urgent » de l’équipe ; tu continues de lui répondre.","en":"Call when the contact’s request is truly pressing: a blocking problem, a complaint, a deadline about to expire. The conversation shows up in the team’s “Urgent” folder; you keep answering them."},"nePasUtiliser":{"fr":"Ne pas l’appeler pour une simple demande d’information.","en":"Do not call it for a mere request for information."},"risk":"write","params":[]},
  {"handler":"chercher_connaissance","nomDefaut":"mba_chercher_connaissance","titre":{"fr":"Chercher dans la base de connaissance","en":"Search the knowledge base"},"description":{"fr":"À appeler AVANT de répondre à toute question de fond. Rend les fiches qui traitent le sujet, ou rien.","en":"Call BEFORE answering any substantive question. Returns the entries covering the topic, or nothing."},"nePasUtiliser":{"fr":"Ne pas répondre de mémoire quand cet outil ne rend rien.","en":"Do not answer from memory when this tool returns nothing."},"risk":"read","params":[{"name":"requete","edition":"aucune"}]},
  {"handler":"lire_contact","nomDefaut":"mba_lire_contact","titre":{"fr":"Lire la fiche du contact","en":"Read the contact record"},"description":{"fr":"Rend ce que l’on sait déjà du contact : son nom, ses champs, et ce que la dernière analyse de ses conversations a constaté (intention, sentiment, satisfaction et urgence sur 10, résolue ou non, sujet), avec son résumé s’il existe. Aucun identifiant à fournir.","en":"Returns what is already known about the contact: name, custom fields, and what the latest analysis of their conversations found (intent, sentiment, satisfaction and urgency out of 10, resolved or not, topic), with its summary if any. No identifier to provide."},"nePasUtiliser":{"fr":"Ne rend jamais la fiche de quelqu’un d’autre : inutile de le demander.","en":"Never returns anyone else’s record: no point asking."},"risk":"read","params":[]},
  {"handler":"poser_tag","nomDefaut":"mba_poser_tag","titre":{"fr":"Poser un tag sur le contact","en":"Tag the contact"},"description":{"fr":"Pose sur le contact le tag prévu pour cet outil, pour le retrouver ensuite dans le mini-CRM ou déclencher une automation.","en":"Sets the tag planned for this tool on the contact, to find them later in the mini-CRM or trigger an automation."},"nePasUtiliser":{"fr":"Ne pas l’appeler tant que la situation qui justifie ce tag n’est pas arrivée.","en":"Do not call it until the situation that warrants this tag has happened."},"risk":"write","params":[]},
  {"handler":"ecrire_variable","nomDefaut":"mba_ecrire_variable","titre":{"fr":"Enregistrer une information sur le contact","en":"Record information about the contact"},"description":{"fr":"Enregistre sur la fiche du contact l’information prévue pour cet outil, pour qu’un bloc plus loin dans le scénario la réutilise.","en":"Records on the contact record the information planned for this tool, so a later block in the scenario can reuse it."},"nePasUtiliser":{"fr":"Ne pas l’appeler tant que le contact n’a pas donné cette information.","en":"Do not call it until the contact has given this information."},"risk":"write","params":[{"name":"valeur","edition":"aucune"}]},
  {"handler":"envoyer_bloc","nomDefaut":"mba_envoyer_bloc","titre":{"fr":"Envoyer un bloc de votre scénario","en":"Send a block from your scenario"},"description":{"fr":"Envoie au contact le bloc prévu pour cet outil : une photo, un message, un modèle. Tu gardes la main ensuite.","en":"Sends the contact the block planned for this tool: a photo, a message, a template. You keep the floor afterwards."},"nePasUtiliser":{"fr":"Ne pas appeler pour dire ce qu’un message écrit dirait aussi bien.","en":"Do not call for something a written message would say just as well."},"risk":"irreversible","params":[]},
  {"handler":"lancer_scenario","nomDefaut":"mba_lancer_scenario","titre":{"fr":"Lancer un scénario","en":"Start a scenario"},"description":{"fr":"Lance le scénario prévu pour cet outil : il prend la conversation et tu te retires. N’écris rien à côté, c’est le scénario qui parle au contact.","en":"Starts the scenario planned for this tool: it takes over the conversation and you step back. Write nothing alongside, the scenario talks to the contact."},"nePasUtiliser":{"fr":"Ne pas l’appeler tant que le contact n’a pas exprimé le besoin que ce scénario traite.","en":"Do not call it until the contact has expressed the need this scenario handles."},"risk":"irreversible","params":[]},
  {"handler":"declencher_action","nomDefaut":"mba_declencher_action","titre":{"fr":"Déclencher une action","en":"Trigger an action"},"description":{"fr":"Déclenche l’action prévue pour cet outil vers l’application de l’entreprise, avec les informations recueillies auprès du contact. Tu continues la conversation ensuite.","en":"Triggers the action planned for this tool towards the business’s application, with the information collected from the contact. You carry on the conversation afterwards."},"nePasUtiliser":{"fr":"Ne pas l’appeler tant que le contact n’a pas clairement exprimé cette demande.","en":"Do not call it until the contact has clearly expressed this request."},"risk":"write","params":[]},
  {"handler":"enchainer","nomDefaut":"mba_enchainer","titre":{"fr":"Enchaîner des étapes","en":"Chain steps"},"description":{"fr":"Exécute dans l’ordre les étapes prévues pour cet outil : recueillir des informations sur le contact, puis agir (étiquette, message, scénario, passage à l’équipe).","en":"Runs the steps planned for this tool in order: collect information about the contact, then act (tag, message, scenario, handover to the team)."},"nePasUtiliser":{"fr":"Ne pas l’appeler tant que le contact n’est pas dans la situation que cet outil traite.","en":"Do not call it until the contact is in the situation this tool handles."},"risk":"write","params":[]},
  {"handler":"qualifier_transferer","nomDefaut":"mba_qualifier_transferer","titre":{"fr":"Qualifier et transférer","en":"Qualify and hand over"},"description":{"fr":"Recueille les informations prévues sur le contact, puis passe la conversation à l’équipe, dans le dossier « À traiter ».","en":"Collects the planned information about the contact, then hands the conversation over to the team, in the “To handle” folder."},"nePasUtiliser":{"fr":"Ne pas l’appeler par prudence sur une question à laquelle les sources répondent.","en":"Do not call it out of caution on a question the sources answer."},"risk":"write","params":[]},
];

/** Les modèles proposables, du moins cher au plus cher, au tarif d'une formule Pro (euros par million de jetons). */
export const MODELES_DEMO = [
  { id: 'zai/glm-4.7-flash', nom: 'GLM 4.7 Flash', prixEntree: 0.0708, prixSortie: 0.4048 },
  { id: 'mistral/mistral-small', nom: 'Mistral Small', prixEntree: 0.1012, prixSortie: 0.3036 },
  { id: 'google/gemini-2.5-flash-lite', nom: 'Gemini 2.5 Flash Lite', prixEntree: 0.1012, prixSortie: 0.4048 },
  { id: 'google/gemini-2.5-flash', nom: 'Gemini 2.5 Flash', prixEntree: 0.3036, prixSortie: 2.53 },
  { id: 'openai/gpt-4.1-mini', nom: 'GPT-4.1 mini', prixEntree: 0.4048, prixSortie: 1.6192 },
  { id: 'zai/glm-4.7', nom: 'GLM 4.7', prixEntree: 0.6072, prixSortie: 2.2264 },
  { id: 'anthropic/claude-haiku-4.5', nom: 'Claude Haiku 4.5', prixEntree: 1.012, prixSortie: 5.06 },
  { id: 'google/gemini-2.5-pro', nom: 'Gemini 2.5 Pro', prixEntree: 1.265, prixSortie: 10.12 },
  { id: 'anthropic/claude-sonnet-4.5', nom: 'Claude Sonnet 4.5', prixEntree: 3.036, prixSortie: 15.18 },
];

/** Les mots de la démonstration, par langue : rien de français sur une capture anglaise. */
export const TEXTES = {
  fr: {
    agent: 'Conseiller boutique', autre: 'Accueil SAV', nom: 'Léa',
    ton: 'Vouvoiement, phrases courtes, pas d’emoji. Chaleureux sans en faire trop.',
    personnalite: 'Une vendeuse de la boutique, qui connaît la collection et aime conseiller.',
    mention: 'Vous échangez avec un assistant automatique.',
    objectif: 'Répondre aux questions sur la collection, les tailles et les commandes, puis proposer un rendez-vous en boutique.',
    transferts: 'Dès qu’on parle d’un remboursement, d’un article abîmé, ou si le contact s’énerve.',
    sorties: [{ code: 'hors_sujet', label: 'La demande sort complètement du sujet' }],
    site: 'https://votre-marque.test',
    scenarioRdv: 'Prise de rendez-vous', scenarioBienvenue: 'Bienvenue',
  },
  en: {
    agent: 'Store advisor', autre: 'After-sales desk', nom: 'Lea',
    ton: 'Formal, short sentences, no emoji. Warm without overdoing it.',
    personnalite: 'A shop assistant who knows the collection and enjoys giving advice.',
    mention: 'You are chatting with an automated assistant.',
    objectif: 'Answer questions about the collection, sizes and orders, then offer an appointment in store.',
    transferts: 'As soon as a refund or a damaged item comes up, or if the contact gets upset.',
    sorties: [{ code: 'off_topic', label: 'The request is completely off topic' }],
    site: 'https://your-brand.test',
    scenarioRdv: 'Book an appointment', scenarioBienvenue: 'Welcome',
  },
} as const;

/** La fiche de l'agent, telle que le serveur la rend (`AgentComplet`). `vide` : l'agent qui vient de naître. */
export function agentDemo(locale: Locale, o: { vide?: boolean; status?: string } = {}): Record<string, unknown> {
  const l = TEXTES[locale];
  return {
    id: AG, label: l.agent, status: o.status ?? 'draft', mentionIa: l.mention, modele: 'google/gemini-2.5-flash',
    maxTours: 20, maxAppelsOutils: 60, budgetMicroEur: 100_000_000, inactiviteMinutes: 30, contactInconnu: 'lecture_seule',
    contenu: o.vide
      ? { nom: '', objectif: '', ton: '', personnalite: '', reglesTransfert: '', sorties: [] }
      : { nom: l.nom, objectif: l.objectif, ton: l.ton, personnalite: l.personnalite, reglesTransfert: l.transferts, sorties: [...l.sorties] },
    ficheVersion: 3,
  };
}

/** Un outil maison posé, au format de la route (`OutilAgent`). */
export function outilMaison(handler: string, locale: Locale, o: Record<string, unknown> = {}): Record<string, unknown> {
  const m = CATALOGUE_OUTILS.find((x) => x.handler === handler)!;
  return {
    id: `o-${handler}`, origin: 'mba', sourceId: null, requestId: null, name: m.nomDefaut, title: m.titre[locale],
    description: m.description[locale], nePasUtiliser: m.nePasUtiliser[locale], gestes: [], nature: 'pousse', outputPaths: [],
    params: [], binding: { handler }, risk: m.risk, actif: true, activeLe: '2026-11-12T09:00:00.000Z', autonome: false,
    autonomeLe: null, inappelable: null,
    expose: { name: m.nomDefaut, description: m.description[locale], parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } },
    ...o,
  };
}

/** Ce que le faux serveur rend, modifiable d'une capture à l'autre (les écritures le mettent à jour). */
export interface EtatDemo {
  locale: Locale;
  agent: Record<string, unknown>;
  liste?: unknown[];
  repondeurAgentId?: string | null;
  credit?: Record<string, unknown>;
  manques?: unknown[];
  avertissements?: unknown[];
  messagesTenus?: number | null;
  entretien?: { messages: Array<{ role: 'user' | 'assistant'; content: string }>; auteurs?: Array<string | null>; manquants?: string[] };
  reponseEntretien?: Record<string, unknown>;
  pieceJointe?: Record<string, unknown>;
  suggestion?: string | null;
  fiches?: unknown[];
  apercu?: Record<string, unknown>;
  document?: Record<string, unknown>;
  outils?: Array<Record<string, unknown>>;
  offrables?: unknown[];
  scenarios?: unknown[];
  blocs?: unknown[];
  champs?: unknown[];
  tags?: unknown[];
  requetes?: unknown[];
  sources?: unknown[];
  adresses?: unknown[];
  consommation?: Record<string, unknown> | null;
  essai?: Record<string, unknown>;
  essais?: unknown[];
  historique?: unknown[];
}

/**
 * Le faux serveur de l'écran des agents. Posé AVANT `communs(page)`, qui répond à l'offre et au compte et laisse le
 * reste venir ici.
 */
export async function simulerAgent(page: Page, etat: EtatDemo): Promise<void> {
  let n = 0;
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const methode = req.method();
    const chemin = new URL(req.url()).pathname.replace('/api/backend', '').replace(/^\/tenants\/[^/]+/, '');
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    const corps = (methode === 'GET' || methode === 'DELETE' ? null : req.postDataJSON()) as Record<string, unknown> | null;
    const a = `/agents/${AG}`;

    if (chemin === '/agents/solde') return json(etat.credit ?? { soldeMicroEur: 18_400_000 });
    if (chemin === '/agents/modeles') return json({ modeles: MODELES_DEMO });
    if (chemin === `${a}/manques`) return json({ manques: etat.manques ?? [], avertissements: etat.avertissements ?? [] });
    if (chemin === `${a}/messages`) return json(etat.messagesTenus == null ? {} : { messages: etat.messagesTenus, jours: 30 });
    if (chemin === `${a}/setup/suggestions`) return json({ connaissanceUrl: etat.suggestion ?? null });
    if (chemin === `${a}/setup/piece-jointe`) return json(etat.pieceJointe ?? { fiches: 0, titres: [], nature: 'texte', plafond: 40 }, 201);
    if (chemin === `${a}/setup`) {
      const e = etat.entretien ?? { messages: [] };
      const couverture = { manquants: e.manquants ?? [], total: 10, pointOuvert: null };
      if (methode === 'GET') return json({ messages: e.messages, auteurs: e.auteurs ?? e.messages.map(() => null), couverture });
      return json(etat.reponseEntretien ?? { message: '', proposition: null, changements: [], couverture });
    }
    if (chemin === `${a}/knowledge/apercu`) return json(etat.apercu ?? {});
    if (chemin === `${a}/knowledge/document`) return json(etat.document ?? {});
    if (chemin.startsWith(`${a}/knowledge`)) return json({ fiches: etat.fiches ?? [] });
    if (chemin === `${a}/tools/offrables`) return json({ outils: etat.offrables ?? [] });
    const surOutil = new RegExp(`^${a}/tools/([^/]+)(/[a-z]+)?$`).exec(chemin);
    if (surOutil && methode !== 'GET') {
      const o = (etat.outils ?? []).find((x) => x.id === surOutil[1]);
      if (o && surOutil[2] === '/activation') o.actif = corps?.valeur === true;
      else if (o && surOutil[2] === '/autonomie') o.autonome = corps?.valeur === true;
      return json({ outil: o ?? {} });
    }
    if (chemin === `${a}/tools`) {
      if (methode === 'GET') return json({ outils: etat.outils ?? [], catalogue: CATALOGUE_OUTILS });
      const handler = String(corps?.handler);
      const cree = { ...outilMaison(handler, etat.locale), id: `n${++n}`, actif: false, binding: { ...((corps?.cible ?? {}) as object), handler } };
      (etat.outils ??= []).push(cree);
      return json({ outil: cree }, 201);
    }
    if (chemin === `${a}/consommation`) return json({ consommation: etat.consommation ?? null });
    if (chemin === `${a}/tests`) return json({ essais: etat.essais ?? [] });
    if (chemin === `${a}/test`) return json(etat.essai ?? { texte: null, sortie: null, appels: [], usage: { tokensIn: 0, tokensOut: 0, coutMicroEur: 0 } });
    if (chemin === a) {
      if (methode === 'PATCH') Object.assign(etat.agent, corps ?? {});
      return json({ agent: etat.agent });
    }
    if (chemin === '/agents') {
      const liste = etat.liste ?? [{ id: AG, label: etat.agent.label, status: etat.agent.status, sorties: [], modele: etat.agent.modele }];
      return json({ agents: liste, repondeurAgentId: etat.repondeurAgentId ?? null });
    }
    if (chemin === '/historique') return json({ lignes: etat.historique ?? [], tronquee: false });
    if (chemin === '/workflows') return json({ workflows: etat.scenarios ?? [] });
    if (chemin.startsWith('/mba-outils/blocs')) return json({ blocs: etat.blocs ?? [] });
    if (chemin === '/user-fields') return json({ fields: etat.champs ?? CHAMPS_DEMO });
    if (chemin === '/tags') return json({ tags: etat.tags ?? [] });
    if (chemin.startsWith('/agent-requetes')) return json({ requetes: etat.requetes ?? [], champs: [], catalogue: { fiche: [], systeme: [], entetesReserves: [] } });
    if (chemin.startsWith('/agent-sources')) return json({ sources: etat.sources ?? [] });
    if (chemin === '/evenements/adresses') return json({ adresses: etat.adresses ?? [] });
    return json({});
  });
}

/**
 * L'offre Business : l'assistant « Construire en parlant » en fait partie (les assistants de configuration). Posée APRÈS
 * `communs(page)`, qui répond la formule Pro, elle prime.
 */
export async function offreBusiness(page: Page): Promise<void> {
  const business = { ...OFFRE_PRO, offre: 'business', fonctions: OFFRE_PRO.grille.business.fonctions, limites: OFFRE_PRO.grille.business.limites };
  await page.route('**/api/backend/tenants/*/offre', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(business) }));
}
