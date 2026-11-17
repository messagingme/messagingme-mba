'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  apercuDuplicationOps, dupliquerScenarioOps, lireEspacesDuplicationOps, lireScenariosOps,
  type ApercuDuplicationOps, type CasesDuplicationOps, type CreationMetaOps, type EspaceDuplicationOps, type RaisonDebrancheOps,
  type RaisonNonRecreableOps, type RaisonOutilNonCopieOps, type RaisonRetraitOps, type ResultatDuplicationOps,
} from '@/lib/api/compte';
import { ApiError } from '@/lib/http';
import { useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { MbaNotice } from '@/components/MbaNotice';
import { Squelette } from '@/components/Squelette';

type Traduire = ReturnType<typeof useT>;

const AUCUNE_CASE: CasesDuplicationOps = { agents: [], requetes: [], modelesEmail: [], templates: [], flows: [] };

/** Les cases qui ne portent qu'un identifiant ; un template se coche par son nom et sa langue. */
type SorteCase = 'agents' | 'requetes' | 'modelesEmail' | 'flows';

/** Au plus 10 templates et Flows recréés par duplication : le serveur refuse au-delà (`PLAFOND_META`, `src/ops/duplication/meta.ts`). */
const PLAFOND_META = 10;

/**
 * L'ONGLET « DUPLIQUER » DE `/ops` (duplication d'un scénario entre espaces, lots 1 à 3 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`). Trois choix (espace source,
 * scénario, espace de destination), puis le récapitulatif que l'API calcule sans rien écrire, puis la copie.
 *
 * La copie arrive inactive, en brouillon. Ce qui pointe un objet de l'espace source arrive débranché, et le récapitulatif
 * le nomme bloc par bloc, selon les cases. Le bouton reste grisé tant qu'un blocage existe (pas de WABA, trop d'objets à
 * recréer). Changer un choix efface l'aperçu : la duplication ne part qu'avec l'empreinte de l'aperçu affiché, et l'API
 * refuse (409) si l'un des deux espaces a changé entre-temps.
 *
 * Lot 2 : une case par dépendance (agent IA, appel API, modèle d'e-mail), décochée. Cochée, la dépendance part avec le
 * scénario sous le nom que l'aperçu annonce ; un agent emporte ses outils, désactivés, et la source de ses appels, secret
 * compris (« secret copié »). Une case ne touche pas à l'aperçu : elle n'entre pas dans l'empreinte.
 *
 * Lot 3 : une case par template absent de la destination et par Flow, décochée : cochée, il est recréé chez Meta, le
 * template soumis à l'approbation. Un template à bouton Flow coche son Flow, verrouillé tant qu'il l'est. Un template qui
 * ne se recrée pas dit pourquoi, sans case. Un arrêt chez Meta liste ce qui y a déjà été créé.
 */
export function OpsDuplication({ jeton, onPerdue }: { jeton: string; onPerdue: () => void }) {
  const t = useT();
  const [espaces, setEspaces] = useState<EspaceDuplicationOps[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [source, setSource] = useState('');
  const [scenarios, setScenarios] = useState<Array<{ id: string; nom: string }> | null>(null);
  const [scenarioId, setScenarioId] = useState('');
  const [destination, setDestination] = useState('');
  const [apercu, setApercu] = useState<ApercuDuplicationOps | null>(null);
  const [erreurApercu, setErreurApercu] = useState<string | null>(null);
  const [relance, setRelance] = useState(0);
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<ResultatDuplicationOps | null>(null);
  const [erreurCopie, setErreurCopie] = useState<string | null>(null);
  // Les cases (lot 2) : ce qui part avec le scénario. Décochées par défaut, vidées à chaque nouvel aperçu.
  const [cases, setCases] = useState<CasesDuplicationOps>(AUCUNE_CASE);
  // Une erreur de chargement des scénarios survit aux autres choix : sinon la liste resterait sur « Chargement… ».
  const [erreurScenarios, setErreurScenarios] = useState<string | null>(null);
  const [relanceScenarios, setRelanceScenarios] = useState(0);
  // Ce qu'une duplication arrêtée chez Meta y a déjà créé (lot 3) : à nommer, puisque cela y reste.
  const [creesAvantArret, setCreesAvantArret] = useState<CreationMetaOps[]>([]);

  useEffect(() => {
    let vivant = true;
    lireEspacesDuplicationOps(jeton)
      .then((r) => { if (vivant) setEspaces(r.espaces); })
      .catch((e: unknown) => {
        if (!vivant) return;
        if (e instanceof ApiError && e.status === 401) { onPerdue(); return; }
        setErreur(e instanceof ApiError && e.status === 404
          ? t('La duplication n’est pas encore disponible sur cette version de l’API.', 'Duplication is not available on this API version yet.')
          : `${t('Espaces illisibles', 'Workspaces unreadable')}${e instanceof Error && e.message ? ` : ${e.message}` : ''}`);
      });
    return () => { vivant = false; };
  }, [jeton, onPerdue, t]);

  useEffect(() => {
    if (source === '') return;
    let vivant = true;
    lireScenariosOps(jeton, source)
      .then((r) => { if (vivant) setScenarios(r.scenarios); })
      .catch((e: unknown) => {
        if (!vivant) return;
        if (e instanceof ApiError && e.status === 401) { onPerdue(); return; }
        setErreurScenarios(`${t('Scénarios illisibles', 'Scenarios unreadable')}${e instanceof Error && e.message ? ` : ${e.message}` : ''}`);
      });
    return () => { vivant = false; };
  }, [jeton, source, relanceScenarios, onPerdue, t]);

  useEffect(() => {
    if (source === '' || scenarioId === '' || destination === '') return;
    let vivant = true;
    apercuDuplicationOps(jeton, { source, scenarioId, destination })
      .then((r) => { if (vivant) setApercu(r.apercu); })
      .catch((e: unknown) => {
        if (!vivant) return;
        if (e instanceof ApiError && e.status === 401) { onPerdue(); return; }
        setErreurApercu(`${t('Aperçu impossible', 'Preview failed')}${e instanceof Error && e.message ? ` : ${e.message}` : ''}`);
      });
    return () => { vivant = false; };
  }, [jeton, source, scenarioId, destination, relance, onPerdue, t]);

  /** Tout choix efface l'aperçu, ses cases et le résultat : on ne duplique que ce qu'on vient de voir. */
  const effacer = () => {
    setApercu(null); setErreurApercu(null); setResultat(null); setErreurCopie(null); setCases(AUCUNE_CASE); setCreesAvantArret([]);
  };
  // Le même espace re-choisi ne vide rien : la liste ne se rechargerait pas (l'effet ne dépend que d'un changement). Et un
  // espace déjà choisi en destination ne peut pas devenir la source : la destination se vide.
  const choisirSource = (v: string) => {
    if (v === source) return;
    effacer(); setSource(v); setScenarioId(''); setScenarios(null); setErreurScenarios(null);
    if (v === destination) setDestination('');
  };
  const choisirScenario = (v: string) => { effacer(); setScenarioId(v); };
  const choisirDestination = (v: string) => { effacer(); setDestination(v); };
  const relancer = () => { effacer(); setRelance((n) => n + 1); };
  const reessayerScenarios = () => { setErreurScenarios(null); setRelanceScenarios((n) => n + 1); };
  /** Une case ne touche pas à l'aperçu : elle n'entre pas dans l'empreinte, elle dit seulement ce qui part. */
  const basculer = (sorte: SorteCase, id: string) => setCases((c) => ({
    ...c, [sorte]: c[sorte].includes(id) ? c[sorte].filter((x) => x !== id) : [...c[sorte], id],
  }));
  const basculerTemplate = (nom: string, langue: string) => setCases((c) => ({
    ...c,
    templates: c.templates.some((x) => x.nom === nom && x.langue === langue)
      ? c.templates.filter((x) => !(x.nom === nom && x.langue === langue))
      : [...c.templates, { nom, langue }],
  }));
  // Les Flows qu'ouvrent les boutons des templates cochés : ils partent avec eux, leur case est verrouillée cochée.
  const flowsLies = new Set((apercu?.meta?.templates ?? [])
    .filter((x) => cases.templates.some((c) => c.nom === x.nom && c.langue === x.langue))
    .flatMap((x) => x.flows));

  const dupliquer = async () => {
    if (!apercu) return;
    setEnCours(true);
    setErreurCopie(null);
    setCreesAvantArret([]);
    try {
      const envoyees = { ...cases, flows: [...new Set([...cases.flows, ...flowsLies])] };
      setResultat(await dupliquerScenarioOps(jeton, { source, scenarioId, destination, empreinte: apercu.empreinte, dupliquer: envoyees }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { onPerdue(); return; }
      setErreurCopie(e instanceof Error && e.message ? e.message : t('La duplication a échoué.', 'Duplication failed.'));
      // Un arrêt chez Meta (lot 3) liste ce qui y a déjà été créé, et qui y reste.
      const corps = e instanceof ApiError && e.corps !== null && typeof e.corps === 'object' ? (e.corps as { crees?: unknown }) : {};
      if (Array.isArray(corps.crees)) setCreesAvantArret(corps.crees as CreationMetaOps[]);
    } finally {
      setEnCours(false);
    }
  };

  if (erreur) return <MbaNotice kind="error" testid="ops-duplication-erreur">{erreur}</MbaNotice>;
  if (!espaces) return <Squelette forme="carte" />;

  const nomDestination = espaces.find((e) => e.id === destination)?.nom ?? '';
  const complet = source !== '' && scenarioId !== '' && destination !== '';
  const aRecreer = cases.templates.length + new Set([...cases.flows, ...flowsLies]).size;
  const tropAMeta = aRecreer > PLAFOND_META;
  return (
    <div className="space-y-4">
      <div className="rounded-carte border border-ink-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-ink-900">{t('Dupliquer un scénario dans un autre espace', 'Duplicate a scenario into another workspace')}</h3>
        <p className="mt-1 text-xs text-ink-500">
          {t(
            'La copie arrive inactive, en brouillon. Ce qui pointe l’espace source (aller vers, assignation, agent IA, appel API, e-mail, Flow, template absent) arrive débranché, sauf ce que vous cochez ; les champs manquants sont créés.',
            'The copy arrives inactive, as a draft. Whatever points at the source workspace (go to, assignment, AI agent, API call, email, Flow, missing template) arrives unplugged, except what you check; missing fields are created.',
          )}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-ink-700">
            {t('Espace source', 'Source workspace')}
            <select
              className={`${inputCls} mt-1`} data-testid="ops-duplication-source" value={source} disabled={enCours}
              onChange={(e) => choisirSource(e.target.value)}
            >
              <option value="">{t('Choisir…', 'Choose…')}</option>
              {espaces.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-700">
            {t('Scénario', 'Scenario')}
            <select
              className={`${inputCls} mt-1`} data-testid="ops-duplication-scenario" value={scenarioId}
              disabled={enCours || source === '' || scenarios === null} onChange={(e) => choisirScenario(e.target.value)}
            >
              <option value="">{source !== '' && scenarios === null && !erreurScenarios ? t('Chargement…', 'Loading…') : t('Choisir…', 'Choose…')}</option>
              {(scenarios ?? []).map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-700">
            {t('Espace de destination', 'Destination workspace')}
            <select
              className={`${inputCls} mt-1`} data-testid="ops-duplication-destination" value={destination} disabled={enCours}
              onChange={(e) => choisirDestination(e.target.value)}
            >
              <option value="">{t('Choisir…', 'Choose…')}</option>
              {espaces.filter((e) => e.id !== source).map((e) => (
                <option key={e.id} value={e.id}>{e.waba ? e.nom : `${e.nom} ${t('(sans WABA)', '(no WABA)')}`}</option>
              ))}
            </select>
          </label>
        </div>
        {erreurScenarios && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <MbaNotice kind="error" testid="ops-duplication-erreur-scenarios">{erreurScenarios}</MbaNotice>
            <Bouton variante="secondaire" data-testid="ops-duplication-reessayer" onClick={reessayerScenarios}>{t('Réessayer', 'Retry')}</Bouton>
          </div>
        )}
      </div>

      {erreurApercu && <MbaNotice kind="error" testid="ops-duplication-erreur-apercu">{erreurApercu}</MbaNotice>}
      {complet && !apercu && !erreurApercu && <Squelette forme="carte" />}
      {apercu && (
        <Recapitulatif
          apercu={apercu} destination={nomDestination} t={t} cases={cases} basculer={basculer} basculerTemplate={basculerTemplate}
          flowsLies={flowsLies} verrouille={enCours || resultat !== null}
        />
      )}

      {apercu && !resultat && (
        <div className="flex flex-wrap items-center gap-3">
          <Bouton
            data-testid="ops-duplication-bouton" enCours={enCours} disabled={apercu.blocages.length > 0 || enCours || tropAMeta}
            onClick={() => { void dupliquer(); }}
          >
            {t('Dupliquer', 'Duplicate')}
          </Bouton>
          {tropAMeta && (
            <span className="text-xs text-ink-700" data-testid="ops-duplication-trop-a-meta">
              {t(`Au plus ${PLAFOND_META} templates et Flows à recréer par duplication : décochez-en.`, `At most ${PLAFOND_META} templates and Flows to recreate per duplication: uncheck some.`)}
            </span>
          )}
          {erreurCopie && (
            <Bouton variante="secondaire" data-testid="ops-duplication-relancer" onClick={relancer}>{t('Relancer l’aperçu', 'Refresh the preview')}</Bouton>
          )}
        </div>
      )}
      {erreurCopie && <MbaNotice kind="error" testid="ops-duplication-erreur-copie">{erreurCopie}</MbaNotice>}
      {creesAvantArret.length > 0 && (
        <MbaNotice kind="warning" testid="ops-duplication-crees-avant-arret">
          {t('Déjà créé chez Meta, et qui y reste : ', 'Already created at Meta, and kept there: ')}{creesChezMeta(creesAvantArret, t)}
        </MbaNotice>
      )}
      {resultat && (
        <MbaNotice kind="success" testid="ops-duplication-resultat">
          {t(
            `Copie créée dans ${nomDestination} : « ${resultat.nom} », inactive, en brouillon. ${resultat.champsCrees.length} champ(s) créé(s), ${resultat.declencheursCopies} déclencheur(s) copié(s) éteint(s), ${resultat.debranches.length} bloc(s) à rebrancher.`,
            `Copy created in ${nomDestination}: “${resultat.nom}”, inactive, as a draft. ${resultat.champsCrees.length} field(s) created, ${resultat.declencheursCopies} trigger(s) copied switched off, ${resultat.debranches.length} block(s) to plug back in.`,
          )}
          {copiees(resultat, t)}
          {(resultat.crees ?? []).length > 0 && t(` Recréés chez Meta : ${creesChezMeta(resultat.crees ?? [], t)}.`, ` Recreated at Meta: ${creesChezMeta(resultat.crees ?? [], t)}.`)}
        </MbaNotice>
      )}
    </div>
  );
}

function raisonDebranche(r: RaisonDebrancheOps, t: Traduire): string {
  switch (r) {
    case 'aller_a': return t('« aller vers » débranché', '“go to” unplugged');
    case 'assignation': return t('assignation retirée : la conversation ira au pot commun', 'assignment removed: the conversation goes to the shared queue');
    case 'agent': return t('agent IA débranché', 'AI agent unplugged');
    case 'appel_api': return t('appel API débranché', 'API call unplugged');
    case 'email': return t('e-mail débranché (boîte et modèle)', 'email unplugged (mailbox and template)');
    case 'flow': return t('Flow débranché', 'Flow unplugged');
    case 'template': return t('template à choisir : absent de la destination, et pas recréé', 'template to choose: missing in the destination, and not recreated');
  }
}

/** Pourquoi un template absent de la destination ne se recrée pas (lot 3). */
function raisonNonRecreable(r: RaisonNonRecreableOps, t: Traduire): string {
  switch (r) {
    case 'lecture': return t('les templates de la source n’ont pas pu être lus : relancez l’aperçu', 'the source templates could not be read: refresh the preview');
    case 'introuvable': return t('introuvable dans la WABA de la source', 'not found in the source WABA');
    case 'categorie': return t('sa catégorie (authentification) ne se recrée pas', 'its category (authentication) cannot be recreated');
    case 'boutons': return t('un bouton ne se relit pas tel quel (téléphone, code à copier, catalogue)', 'a button cannot be read back as is (phone, copy code, catalog)');
    case 'entete': return t('son en-tête ne se recrée pas', 'its header cannot be recreated');
    case 'media': return t('son média ne se relit pas chez Meta', 'its media cannot be read back from Meta');
    case 'liens': return t('un lien de suivi de la source n’a pas pu être relu', 'a tracked link of the source could not be read back');
    case 'flow': return t('le Flow de son bouton ne se recrée pas', 'the Flow of its button cannot be recreated');
  }
}

/** Ce qui a été créé chez Meta, en une liste lisible (lot 3). */
function creesChezMeta(crees: CreationMetaOps[], t: Traduire): string {
  return crees.map((c) => (c.sorte === 'template'
    ? t(`template ${c.nom} (${c.langue}), ${c.statut === 'APPROVED' ? 'approuvé' : 'en attente d’approbation'}`, `template ${c.nom} (${c.langue}), ${c.statut === 'APPROVED' ? 'approved' : 'pending approval'}`)
    : t(`Flow ${c.nom}${c.publie ? ', publié' : ', en brouillon'}`, `Flow ${c.nom}${c.publie ? ', published' : ', as a draft'}`))).join(' ; ');
}

function raisonRetrait(r: RaisonRetraitOps, t: Traduire): string {
  switch (r) {
    case 'mot_cle_pris': return t('tous ses mots-clés sont déjà pris dans la destination', 'all its keywords are already taken in the destination');
    case 'nouveau_contact_existe': return t('la destination a déjà un déclencheur « nouveau contact »', 'the destination already has a “new contact” trigger');
    case 'lie_a_la_source': return t('lié à un objet de l’espace source (webhook, HubSpot, publicité, action d’agent, lien)', 'tied to an object of the source workspace (webhook, HubSpot, ad, agent action, link)');
  }
}

function Section({ titre, testid, children }: { titre: string; testid: string; children: ReactNode }) {
  return (
    <div data-testid={testid}>
      <h4 className="text-xs font-semibold text-ink-700">{titre}</h4>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-900">{children}</ul>
    </div>
  );
}

function raisonOutil(r: RaisonOutilNonCopieOps, t: Traduire): string {
  switch (r) {
    case 'mcp': return t('outil MCP, à reconnecter dans la destination', 'MCP tool, to reconnect in the destination');
    case 'autre_scenario': return t('il vise un autre scénario de l’espace source', 'it targets another scenario of the source workspace');
    case 'cible_illisible': return t('sa cible ne se lit pas', 'its target cannot be read');
  }
}

/** Ce qui a été copié avec le scénario, en une phrase, ou rien. */
function copiees(r: ResultatDuplicationOps, t: Traduire): string {
  // Une API du lot 1 ne rend pas `dependancesCopiees` (relecture du lot 2) : rien à dire, plutôt qu'un écran planté.
  const d = r.dependancesCopiees ?? { agents: [], requetes: [], modelesEmail: [], sourcesAvecSecret: [] };
  const noms = [...d.agents, ...d.requetes, ...d.modelesEmail];
  if (noms.length === 0) return '';
  const secrets = d.sourcesAvecSecret.length > 0 ? t(` (secret copié : ${d.sourcesAvecSecret.join(', ')})`, ` (secret copied: ${d.sourcesAvecSecret.join(', ')})`) : '';
  return t(` Copiés avec lui : ${noms.join(', ')}${secrets}.`, ` Copied with it: ${noms.join(', ')}${secrets}.`);
}

/** Une case du récapitulatif : décochée par défaut, grisée pendant la copie. */
function Case({ coche, basculer, verrouille, testid, children }: {
  coche: boolean; basculer: () => void; verrouille: boolean; testid: string; children: ReactNode;
}) {
  return (
    <li className="list-none">
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" data-testid={testid} checked={coche} disabled={verrouille} onChange={basculer} />
        <span>{children}</span>
      </label>
    </li>
  );
}

/** Les requêtes qu'emportent les agents cochés : leur bloc est rebranché, cochées ou non (relecture du lot 2). */
function requetesDesAgentsCoches(a: ApercuDuplicationOps, cases: CasesDuplicationOps): Set<string> {
  return new Set((a.dependances?.agents ?? []).filter((x) => cases.agents.includes(x.id)).flatMap((x) => x.requetes ?? []));
}

function Dependances({ a, t, cases, basculer, verrouille }: {
  a: ApercuDuplicationOps; t: Traduire; cases: CasesDuplicationOps;
  basculer: (sorte: SorteCase, id: string) => void; verrouille: boolean;
}) {
  // Une API du lot 1 ne rend pas `dependances` : l'onglet se comporte alors comme au lot 1, sans case.
  const d = a.dependances ?? { agents: [], requetes: [], modelesEmail: [] };
  if (d.agents.length + d.requetes.length + d.modelesEmail.length === 0) return null;
  const nom = (n: string, copie: string) => (copie === n ? n : t(`${n} (copié sous « ${copie} »)`, `${n} (copied as “${copie}”)`));
  // Une requête qu'aucun bloc ne désigne n'a pas de case : elle part avec l'agent qui l'appelle, et se montre sous lui.
  const avecCase = d.requetes.filter((x) => x.parUnBloc !== false);
  const liees = requetesDesAgentsCoches(a, cases);
  const nomAgent = (requete: string) => d.agents.find((x) => cases.agents.includes(x.id) && (x.requetes ?? []).includes(requete))?.nomCopie ?? '';
  const champs = (cles: string[] | undefined) => ((cles ?? []).length > 0
    ? <span className="block text-xs text-ink-500" data-testid="ops-duplication-champs-dependance">{t(`Champs à créer : ${(cles ?? []).join(', ')}`, `Fields to create: ${(cles ?? []).join(', ')}`)}</span>
    : null);
  const secret = (s: boolean) => (s ? <span className="font-medium text-ink-700" data-testid="ops-duplication-secret">{t(' : secret copié', ': secret copied')}</span> : null);
  return (
    <div data-testid="ops-duplication-dependances">
      <h4 className="text-xs font-semibold text-ink-700">{t('À dupliquer avec le scénario', 'To duplicate with the scenario')}</h4>
      <p className="mt-0.5 text-xs text-ink-500">
        {t(
          'Décoché, le bloc arrive débranché. Coché, la copie le rebranche ; les champs que nomme la dépendance sont créés s’ils manquent.',
          'Unchecked, the block arrives unplugged. Checked, the copy plugs it back; the fields the dependency names are created if missing.',
        )}
      </p>
      <ul className="mt-2 space-y-2 text-sm text-ink-900">
        {d.agents.map((x) => (
          <Case key={x.id} testid={`ops-duplication-case-agent-${x.id}`} coche={cases.agents.includes(x.id)} verrouille={verrouille} basculer={() => basculer('agents', x.id)}>
            {t('Agent IA ', 'AI agent ')}{nom(x.nom, x.nomCopie)}
            {t(` : ${x.fiches} fiche(s) de connaissance, en brouillon`, `: ${x.fiches} knowledge card(s), as a draft`)}
            {x.outilsCopies.length > 0 && t(`, outils désactivés : ${x.outilsCopies.map((o) => o.nomCopie).join(', ')}`, `, tools switched off: ${x.outilsCopies.map((o) => o.nomCopie).join(', ')}`)}
            {x.outilsNonCopies.map((o) => (
              <span key={o.nom} className="block text-xs text-ink-500" data-testid="ops-duplication-outil-non-copie">
                {t(`${o.nom} ne suit pas : ${raisonOutil(o.raison, t)}`, `${o.nom} not copied: ${raisonOutil(o.raison, t)}`)}
              </span>
            ))}
            {d.requetes.filter((r) => r.parUnBloc === false && (x.requetes ?? []).includes(r.id)).map((r) => (
              <span key={r.id} className="block text-xs text-ink-500" data-testid="ops-duplication-requete-de-l-agent">
                {t('Avec lui, l’appel API ', 'With it, the API call ')}{nom(r.nom, r.nomCopie)}{t(', source ', ', source ')}{nom(r.source.nom, r.source.nomCopie)}
                {secret(r.source.secret)}
              </span>
            ))}
            {champs(x.champs)}
          </Case>
        ))}
        {avecCase.map((x) => (
          <Case
            key={x.id} testid={`ops-duplication-case-requete-${x.id}`} verrouille={verrouille || liees.has(x.id)}
            coche={cases.requetes.includes(x.id) || liees.has(x.id)} basculer={() => basculer('requetes', x.id)}
          >
            {t('Appel API ', 'API call ')}{nom(x.nom, x.nomCopie)}{t(', source ', ', source ')}{nom(x.source.nom, x.source.nomCopie)}
            {secret(x.source.secret)}
            {liees.has(x.id) && t(` : part avec l’agent ${nomAgent(x.id)}`, `: goes with the agent ${nomAgent(x.id)}`)}
            {champs(x.champs)}
          </Case>
        ))}
        {d.modelesEmail.map((x) => (
          <Case key={x.id} testid={`ops-duplication-case-modele-${x.id}`} coche={cases.modelesEmail.includes(x.id)} verrouille={verrouille} basculer={() => basculer('modelesEmail', x.id)}>
            {t('Modèle d’e-mail ', 'Email template ')}{nom(x.nom, x.nomCopie)}{t(' (la boîte d’envoi reste à choisir)', ' (the mailbox stays to choose)')}
            {champs(x.champs)}
          </Case>
        ))}
      </ul>
    </div>
  );
}

/**
 * Les templates absents et les Flows du scénario (lot 3) : une case pour ce qui se recrée chez Meta, la raison pour ce qui
 * ne se recrée pas. Un Flow qu'ouvre le bouton d'un template coché est coché et verrouillé.
 */
function ChezMeta({ a, t, cases, basculer, basculerTemplate, flowsLies, verrouille }: {
  a: ApercuDuplicationOps; t: Traduire; cases: CasesDuplicationOps; basculer: (sorte: SorteCase, id: string) => void;
  basculerTemplate: (nom: string, langue: string) => void; flowsLies: ReadonlySet<string>; verrouille: boolean;
}) {
  const templates = (a.meta?.templates ?? []).filter((x) => x.etat !== 'reutilise');
  const flows = a.meta?.flows ?? [];
  if (templates.length + flows.length === 0) return null;
  const nomFlow = (id: string) => flows.find((f) => f.id === id)?.nom ?? id;
  return (
    <div data-testid="ops-duplication-meta">
      <h4 className="text-xs font-semibold text-ink-700">{t('À recréer chez Meta', 'To recreate at Meta')}</h4>
      <p className="mt-0.5 text-xs text-ink-500">
        {t(
          'Coché, le template est recréé dans la WABA de destination et soumis à l’approbation de Meta, le Flow recréé (et publié s’il l’est dans la source). Décoché, le bloc arrive débranché. Ce qui est créé chez Meta y reste, même si la suite échoue.',
          'Checked, the template is recreated in the destination WABA and submitted to Meta’s approval, the Flow recreated (and published if it is in the source). Unchecked, the block arrives unplugged. Whatever is created at Meta stays there, even if the rest fails.',
        )}
      </p>
      <ul className="mt-2 space-y-2 text-sm text-ink-900">
        {templates.map((x) => (x.etat === 'a_recreer'
          ? (
            <Case
              key={`${x.nom}-${x.langue}`} testid={`ops-duplication-case-template-${x.nom}-${x.langue}`} verrouille={verrouille}
              coche={cases.templates.some((c) => c.nom === x.nom && c.langue === x.langue)} basculer={() => basculerTemplate(x.nom, x.langue)}
            >
              {t(`Template ${x.nom} (${x.langue}) : recréé et soumis à Meta`, `Template ${x.nom} (${x.langue}): recreated and submitted to Meta`)}
              {x.flows.length > 0 && t(`, avec le Flow ${x.flows.map(nomFlow).join(', ')}`, `, with the Flow ${x.flows.map(nomFlow).join(', ')}`)}
            </Case>
          )
          : (
            <li key={`${x.nom}-${x.langue}`} className="list-none text-ink-700" data-testid="ops-duplication-template-non-recreable">
              {t(`Template ${x.nom} (${x.langue}) : ne se recrée pas, ${raisonNonRecreable(x.raison ?? 'introuvable', t)} ; son bloc arrive débranché`, `Template ${x.nom} (${x.langue}): cannot be recreated, ${raisonNonRecreable(x.raison ?? 'introuvable', t)}; its block arrives unplugged`)}
            </li>
          )))}
        {flows.map((f) => (f.recreable
          ? (
            <Case
              key={f.id} testid={`ops-duplication-case-flow-${f.id}`} verrouille={verrouille || flowsLies.has(f.id)}
              coche={cases.flows.includes(f.id) || flowsLies.has(f.id)} basculer={() => basculer('flows', f.id)}
            >
              {t('Flow ', 'Flow ')}{f.nomCopie === f.nom ? f.nom : t(`${f.nom} (copié sous « ${f.nomCopie} »)`, `${f.nom} (copied as “${f.nomCopie}”)`)}
              {f.publie ? t(', publié', ', published') : t(', en brouillon', ', as a draft')}
              {flowsLies.has(f.id) && t(' : part avec le template qui l’ouvre', ': goes with the template that opens it')}
            </Case>
          )
          : (
            <li key={f.id} className="list-none text-ink-700" data-testid="ops-duplication-flow-non-recreable">
              {t(`Flow ${f.nom} : ne se recrée pas (ancien Flow sans écrans) ; son bloc arrive débranché`, `Flow ${f.nom}: cannot be recreated (old Flow without screens); its block arrives unplugged`)}
            </li>
          )))}
      </ul>
    </div>
  );
}

/**
 * Les blocs qui arriveront débranchés, SELON les cases : un agent, une requête ou un Flow coché rebranche ses blocs (une
 * requête qu'emporte un agent coché aussi), un template absent ni coché ni recréable débranche les siens (lot 3). Sans
 * `references` (API d'avant), la liste du serveur.
 */
function debranchesSelonLesCases(a: ApercuDuplicationOps, cases: CasesDuplicationOps, flowsLies: ReadonlySet<string>): ApercuDuplicationOps['debranches'] {
  const refs = a.references ?? [];
  const requetesLiees = requetesDesAgentsCoches(a, cases);
  const rebranche = (nodeId: string) => refs.some((r) => r.nodeId === nodeId && (
    (r.sorte === 'agent' && cases.agents.includes(r.id))
    || (r.sorte === 'requete' && (cases.requetes.includes(r.id) || requetesLiees.has(r.id)))
    || (r.sorte === 'flow' && (cases.flows.includes(r.id) || flowsLies.has(r.id)))
  ));
  const templates = (a.meta?.templates ?? [])
    .filter((x) => x.etat !== 'reutilise' && !cases.templates.some((c) => c.nom === x.nom && c.langue === x.langue))
    .flatMap((x) => x.blocs.map((b) => ({ nodeId: b.nodeId, nom: b.nom, type: 'template', raison: 'template' as const })));
  return [...a.debranches.filter((d) => !rebranche(d.nodeId)), ...templates];
}

function Recapitulatif({ apercu: a, destination, t, cases, basculer, basculerTemplate, flowsLies, verrouille }: {
  apercu: ApercuDuplicationOps; destination: string; t: Traduire; cases: CasesDuplicationOps;
  basculer: (sorte: SorteCase, id: string) => void; basculerTemplate: (nom: string, langue: string) => void;
  flowsLies: ReadonlySet<string>; verrouille: boolean;
}) {
  const reutilises = a.meta
    ? a.meta.templates.filter((x) => x.etat === 'reutilise')
    : a.templates.filter((x) => !a.templatesAbsents.some((y) => y.nom === x.nom && y.langue === x.langue));
  const debranches = debranchesSelonLesCases(a, cases, flowsLies);
  return (
    <div className="space-y-4 rounded-carte border border-ink-200 bg-white p-5" data-testid="ops-duplication-recapitulatif">
      <h3 className="text-sm font-semibold text-ink-900">
        {t(`« ${a.nomCopie} » dans ${destination}`, `“${a.nomCopie}” in ${destination}`)}
      </h3>
      {a.blocages.length > 0 && (
        <MbaNotice kind="error" testid="ops-duplication-blocages">
          {t('Duplication impossible : ', 'Duplication blocked: ')}{a.blocages.join(' ; ')}
        </MbaNotice>
      )}
      {a.signaux.length > 0 && <MbaNotice kind="warning" testid="ops-duplication-signaux">{a.signaux.join(' ; ')}</MbaNotice>}
      <Dependances a={a} t={t} cases={cases} basculer={basculer} verrouille={verrouille} />
      <ChezMeta a={a} t={t} cases={cases} basculer={basculer} basculerTemplate={basculerTemplate} flowsLies={flowsLies} verrouille={verrouille} />
      {debranches.length > 0 && (
        <Section titre={t('Blocs qui arrivent débranchés', 'Blocks that arrive unplugged')} testid="ops-duplication-debranches">
          {debranches.map((d) => <li key={d.nodeId}>{d.nom} : {raisonDebranche(d.raison, t)}</li>)}
        </Section>
      )}
      {(a.champsACreer.length > 0 || a.champsEnConflit.length > 0) && (
        <Section titre={t('Champs', 'Fields')} testid="ops-duplication-champs">
          {a.champsACreer.map((c) => <li key={c.key}>{t(`${c.label} (${c.key}, ${c.type}) : créé`, `${c.label} (${c.key}, ${c.type}): created`)}</li>)}
          {a.champsEnConflit.map((c) => (
            <li key={c.cle}>
              {t(
                `${c.cle} : ${c.typeSource} dans la source, ${c.typeDestination} dans la destination ; celui de la destination est gardé`,
                `${c.cle}: ${c.typeSource} in the source, ${c.typeDestination} in the destination; the destination’s is kept`,
              )}
            </li>
          ))}
        </Section>
      )}
      {reutilises.length > 0 && (
        <Section titre={t('Templates déjà présents dans la destination', 'Templates already in the destination')} testid="ops-duplication-templates">
          {reutilises.map((x) => <li key={`${x.nom}-${x.langue}`}>{x.nom} ({x.langue})</li>)}
        </Section>
      )}
      {(a.declencheursCopies.length > 0 || a.declencheursRetires.length > 0) && (
        <Section titre={t('Déclencheurs', 'Triggers')} testid="ops-duplication-declencheurs">
          {a.declencheursCopies.map((d, i) => <li key={`c-${i}`}>{t(`${d.nom} (${d.type}) : copié, éteint`, `${d.nom} (${d.type}): copied, switched off`)}</li>)}
          {a.motsRetires.map((m, i) => <li key={`m-${i}`}>{t(`${m.nom} : mots-clés retirés, déjà pris dans la destination : ${m.mots.join(', ')}`, `${m.nom}: keywords removed, already taken in the destination: ${m.mots.join(', ')}`)}</li>)}
          {a.declencheursRetires.map((d, i) => <li key={`r-${i}`}>{t(`${d.nom} : ne suit pas, ${raisonRetrait(d.raison, t)}`, `${d.nom}: not copied, ${raisonRetrait(d.raison, t)}`)}</li>)}
        </Section>
      )}
    </div>
  );
}
