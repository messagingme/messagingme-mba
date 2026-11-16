'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  apercuDuplicationOps, dupliquerScenarioOps, lireEspacesDuplicationOps, lireScenariosOps,
  type ApercuDuplicationOps, type EspaceDuplicationOps, type RaisonDebrancheOps, type RaisonRetraitOps, type ResultatDuplicationOps,
} from '@/lib/api/compte';
import { ApiError } from '@/lib/http';
import { useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { MbaNotice } from '@/components/MbaNotice';
import { Squelette } from '@/components/Squelette';

type Traduire = ReturnType<typeof useT>;

/**
 * L'ONGLET « DUPLIQUER » DE `/ops` (duplication d'un scénario entre espaces, lot 1 ; spec
 * `docs/superpowers/specs/2026-11-16-duplication-scenario-entre-espaces-design.md`). Trois choix (espace source,
 * scénario, espace de destination), puis le récapitulatif que l'API calcule sans rien écrire, puis la copie.
 *
 * La copie arrive inactive, en brouillon. Ce qui pointe un objet de l'espace source arrive débranché, et le récapitulatif
 * le nomme bloc par bloc. Le bouton reste grisé tant qu'un blocage existe (pas de WABA, template absent). Changer un
 * choix efface l'aperçu : la duplication ne part qu'avec l'empreinte de l'aperçu affiché, et l'API refuse (409) si l'un
 * des deux espaces a changé entre-temps.
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
        setErreurApercu(`${t('Scénarios illisibles', 'Scenarios unreadable')}${e instanceof Error && e.message ? ` : ${e.message}` : ''}`);
      });
    return () => { vivant = false; };
  }, [jeton, source, onPerdue, t]);

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

  /** Tout choix efface l'aperçu et le résultat : on ne duplique que ce qu'on vient de voir. */
  const effacer = () => { setApercu(null); setErreurApercu(null); setResultat(null); setErreurCopie(null); };
  // Le même espace re-choisi ne vide rien : la liste ne se rechargerait pas (l'effet ne dépend que d'un changement).
  const choisirSource = (v: string) => { if (v === source) return; effacer(); setSource(v); setScenarioId(''); setScenarios(null); };
  const choisirScenario = (v: string) => { effacer(); setScenarioId(v); };
  const choisirDestination = (v: string) => { effacer(); setDestination(v); };
  const relancer = () => { effacer(); setRelance((n) => n + 1); };

  const dupliquer = async () => {
    if (!apercu) return;
    setEnCours(true);
    setErreurCopie(null);
    try {
      setResultat(await dupliquerScenarioOps(jeton, { source, scenarioId, destination, empreinte: apercu.empreinte }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { onPerdue(); return; }
      setErreurCopie(e instanceof Error && e.message ? e.message : t('La duplication a échoué.', 'Duplication failed.'));
    } finally {
      setEnCours(false);
    }
  };

  if (erreur) return <MbaNotice kind="error" testid="ops-duplication-erreur">{erreur}</MbaNotice>;
  if (!espaces) return <Squelette forme="carte" />;

  const nomDestination = espaces.find((e) => e.id === destination)?.nom ?? '';
  const complet = source !== '' && scenarioId !== '' && destination !== '';
  return (
    <div className="space-y-4">
      <div className="rounded-carte border border-ink-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-ink-900">{t('Dupliquer un scénario dans un autre espace', 'Duplicate a scenario into another workspace')}</h3>
        <p className="mt-1 text-xs text-ink-500">
          {t(
            'La copie arrive inactive, en brouillon. Ce qui pointe l’espace source (aller vers, assignation, agent IA, appel API, e-mail, Flow) arrive débranché ; les champs manquants sont créés.',
            'The copy arrives inactive, as a draft. Whatever points at the source workspace (go to, assignment, AI agent, API call, email, Flow) arrives unplugged; missing fields are created.',
          )}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-medium text-ink-700">
            {t('Espace source', 'Source workspace')}
            <select className={`${inputCls} mt-1`} data-testid="ops-duplication-source" value={source} onChange={(e) => choisirSource(e.target.value)}>
              <option value="">{t('Choisir…', 'Choose…')}</option>
              {espaces.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-700">
            {t('Scénario', 'Scenario')}
            <select
              className={`${inputCls} mt-1`} data-testid="ops-duplication-scenario" value={scenarioId}
              disabled={source === '' || scenarios === null} onChange={(e) => choisirScenario(e.target.value)}
            >
              <option value="">{source !== '' && scenarios === null ? t('Chargement…', 'Loading…') : t('Choisir…', 'Choose…')}</option>
              {(scenarios ?? []).map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-700">
            {t('Espace de destination', 'Destination workspace')}
            <select className={`${inputCls} mt-1`} data-testid="ops-duplication-destination" value={destination} onChange={(e) => choisirDestination(e.target.value)}>
              <option value="">{t('Choisir…', 'Choose…')}</option>
              {espaces.filter((e) => e.id !== source).map((e) => (
                <option key={e.id} value={e.id}>{e.waba ? e.nom : `${e.nom} ${t('(sans WABA)', '(no WABA)')}`}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {erreurApercu && <MbaNotice kind="error" testid="ops-duplication-erreur-apercu">{erreurApercu}</MbaNotice>}
      {complet && !apercu && !erreurApercu && <Squelette forme="carte" />}
      {apercu && <Recapitulatif apercu={apercu} destination={nomDestination} t={t} />}

      {apercu && !resultat && (
        <div className="flex flex-wrap items-center gap-3">
          <Bouton
            data-testid="ops-duplication-bouton" enCours={enCours} disabled={apercu.blocages.length > 0 || enCours}
            onClick={() => { void dupliquer(); }}
          >
            {t('Dupliquer', 'Duplicate')}
          </Bouton>
          {erreurCopie && (
            <Bouton variante="secondaire" data-testid="ops-duplication-relancer" onClick={relancer}>{t('Relancer l’aperçu', 'Refresh the preview')}</Bouton>
          )}
        </div>
      )}
      {erreurCopie && <MbaNotice kind="error" testid="ops-duplication-erreur-copie">{erreurCopie}</MbaNotice>}
      {resultat && (
        <MbaNotice kind="success" testid="ops-duplication-resultat">
          {t(
            `Copie créée dans ${nomDestination} : « ${resultat.nom} », inactive, en brouillon. ${resultat.champsCrees.length} champ(s) créé(s), ${resultat.declencheursCopies} déclencheur(s) copié(s) éteint(s), ${resultat.debranches.length} bloc(s) à rebrancher.`,
            `Copy created in ${nomDestination}: “${resultat.nom}”, inactive, as a draft. ${resultat.champsCrees.length} field(s) created, ${resultat.declencheursCopies} trigger(s) copied switched off, ${resultat.debranches.length} block(s) to plug back in.`,
          )}
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
  }
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

function Recapitulatif({ apercu: a, destination, t }: { apercu: ApercuDuplicationOps; destination: string; t: Traduire }) {
  const reutilises = a.templates.filter((x) => !a.templatesAbsents.some((y) => y.nom === x.nom && y.langue === x.langue));
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
      {a.debranches.length > 0 && (
        <Section titre={t('Blocs qui arrivent débranchés', 'Blocks that arrive unplugged')} testid="ops-duplication-debranches">
          {a.debranches.map((d) => <li key={d.nodeId}>{d.nom} : {raisonDebranche(d.raison, t)}</li>)}
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
