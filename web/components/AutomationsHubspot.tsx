'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { cardCls, inputCls, inputClsAuto } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { Icone } from '@/components/Icone';
import { Toggle } from '@/components/Toggle';
import { Squelette } from '@/components/Squelette';
import { useConfirmation } from '@/components/Confirmation';
import { routeInconnue } from '@/lib/canaux-services';
import { listHubspotDealStages, listUserFields, updateWorkflow, type HubspotDealPipeline, type UserFieldDef } from '@/lib/api';
import {
  creerLigneHubspot, lireLignesHubspot, reglerLigneHubspot, scenarioDeLaLigneCreee, supprimerLigneHubspot,
  type CreationLigneHubspot, type EtatLignesHubspot, type FamilleHubspot, type LigneHubspotVue, type SensRendezVous,
} from '@/lib/api-hubspot-lignes';
import {
  champsRendezVous, etapesAuChoix, etatDeLaLigne, libelleDeLaLigne, MINUTES_PAR_UNITE, type EtatLigneHubspot, type UniteDelai,
} from '@/lib/hubspot-lignes';

/**
 * LES AUTOMATIONS HUBSPOT, SOUS CELLES DE SHOPIFY DANS L'ÉCRAN AUTOMATION (menu « Scénario », lot 6c ; le lot 7 les range
 * sur leur page). Trois familles : le changement d'étape d'un deal, le rendez-vous (une date importée de HubSpot et un
 * délai), le scénario lancé par un workflow HubSpot. Chaque ligne a son interrupteur, son état et son scénario, où se
 * règle le message (le premier bloc, verrouillé) ; « Ajouter » crée la ligne éteinte avec son scénario et l'ouvre dans le
 * builder, et elle s'allume ici une fois son premier message publié (l'API refuse avant, 409).
 *
 * Visible avec un portail relié, et rien sinon : ni pour un rôle qui ne lit pas la route, ni quand l'API ne la connaît pas
 * encore (la console part au push, avant l'API), comme la section Shopify.
 */
const ETATS: Record<EtatLigneHubspot, readonly [string, string]> = {
  eteinte: ['éteinte', 'off'],
  a_completer: ['à compléter : écrivez son premier message dans le scénario', 'to complete: write its first message in the scenario'],
  en_validation: ['en validation chez Meta', 'awaiting Meta’s approval'],
  refuse: ['message refusé ou bloqué par Meta : changez-le dans le scénario', 'message refused or blocked by Meta: change it in the scenario'],
  active: ['active', 'active'],
  active_nouvelle_version: ['active, nouvelle version en validation chez Meta', 'active, new version awaiting Meta’s approval'],
  meta_non_lu: ['allumée, l’état de son message chez Meta n’a pas pu être lu', 'on, its message status at Meta could not be read'],
};
const ETATS_EN_SERVICE: readonly EtatLigneHubspot[] = ['active', 'active_nouvelle_version'];

const FAMILLES: ReadonlyArray<{
  famille: FamilleHubspot;
  titre: readonly [string, string];
  explication: readonly [string, string];
  vide: readonly [string, string];
  ajouter: readonly [string, string];
}> = [
  {
    famille: 'etape',
    titre: ['Changement d’étape d’un deal', 'Deal stage change'],
    explication: [
      'Quand un deal arrive sur l’étape, le scénario part pour le contact rattaché au deal. Les champs HubSpot importés se lisent sur sa fiche.',
      'When a deal reaches the stage, the scenario runs for the contact linked to the deal. Imported HubSpot fields are read from their record.',
    ],
    vide: ['Aucune étape réglée.', 'No stage set yet.'],
    ajouter: ['Ajouter une étape', 'Add a stage'],
  },
  {
    famille: 'rdv',
    titre: ['Rendez-vous', 'Appointment'],
    explication: ['Avant ou après une date importée de HubSpot, celle d’un rendez-vous par exemple.', 'Before or after a date imported from HubSpot, such as an appointment.'],
    vide: ['Aucun rendez-vous réglé.', 'No appointment set yet.'],
    ajouter: ['Ajouter un rendez-vous', 'Add an appointment'],
  },
  {
    famille: 'workflow',
    titre: ['Lancés par un workflow HubSpot', 'Started by a HubSpot workflow'],
    explication: [
      'Les scénarios que l’action « Lancer un scénario Messaging Me » de vos workflows HubSpot peut choisir : elle ne voit qu’eux.',
      'The scenarios the “Launch a Messaging Me scenario” action of your HubSpot workflows can pick: it only sees these.',
    ],
    vide: ['Aucun scénario.', 'No scenario yet.'],
    ajouter: ['Ajouter un scénario', 'Add a scenario'],
  },
];

/** Les étapes du portail : pas encore demandées, en lecture, portail qui ne les rend pas, panne, ou lues. */
type EtapesLues = 'attente' | 'lecture' | 'non_connecte' | 'panne' | HubspotDealPipeline[];
/** Les champs de la fiche : en lecture, panne, ou lus. */
type ChampsLus = 'lecture' | 'panne' | UserFieldDef[];

export function AutomationsHubspot({ tenantId }: { tenantId: string }) {
  const t = useT();
  const router = useRouter();
  const confirmer = useConfirmation();
  /** `lecture` jusqu'à la première réponse ; `panne` si elle échoue ou ne se lit pas (une API sans la route comprise). */
  const [vue, setVue] = useState<EtatLignesHubspot | 'lecture' | 'panne'>('lecture');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  /** La famille dont le formulaire « Ajouter » est ouvert. */
  const [ajout, setAjout] = useState<FamilleHubspot | null>(null);

  // Sa page (menu « Scénario », lot 7) dit chaque état, comme celle de Shopify : la lecture, la panne, le portail absent.
  const recharger = useCallback(() => lireLignesHubspot(tenantId).then((v) => setVue(v ?? 'panne')).catch(() => setVue('panne')), [tenantId]);
  useEffect(() => { void recharger(); }, [recharger]);

  const lue = typeof vue === 'object' ? vue : null;
  const connecte = lue?.connecte === true;
  const lignes = lue?.lignes ?? [];

  // Les champs de la fiche : le libellé d'un rendez-vous, et son choix. Une lecture locale, faite dès que la section se montre.
  const [champs, setChamps] = useState<ChampsLus>('lecture');
  useEffect(() => {
    if (!connecte) return;
    let vivant = true;
    listUserFields(tenantId)
      .then((r) => { if (vivant) setChamps(Array.isArray(r?.fields) ? r.fields : []); })
      .catch(() => { if (vivant) setChamps('panne'); });
    return () => { vivant = false; };
  }, [connecte, tenantId]);

  /**
   * Les étapes du portail : un aller-retour jusqu'à HubSpot, payé seulement quand une ligne d'étape s'affiche (le nom de
   * son pipeline) ou qu'on en ajoute une, et une seule fois. ⚠️ Le garde-fou est une RÉFÉRENCE, pas l'état : l'état dans
   * les dépendances relancerait l'effet à chaque changement (le blocage décrit dans `app/automations/page.tsx`).
   */
  const [etapes, setEtapes] = useState<EtapesLues>('attente');
  const etapesDemandees = useRef(false);
  const besoinEtapes = connecte && (ajout === 'etape' || lignes.some((l) => l.famille === 'etape'));
  useEffect(() => {
    if (!besoinEtapes || etapesDemandees.current) return;
    etapesDemandees.current = true;
    setEtapes('lecture');
    listHubspotDealStages(tenantId)
      .then((r) => setEtapes(r?.connected === true ? (Array.isArray(r.pipelines) ? r.pipelines : []) : 'non_connecte'))
      .catch(() => setEtapes('panne'));
  }, [besoinEtapes, tenantId]);

  if (vue === 'lecture') return <Squelette forme="lignes" />;
  if (vue === 'panne') {
    return (
      <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700" data-testid="automations-hubspot-panne">
        {t('Vos automations HubSpot n’ont pas pu être lues. Réessayez dans un instant.', 'Your HubSpot automations could not be read. Try again shortly.')}
      </p>
    );
  }
  if (!connecte) {
    return (
      <section className={cardCls} data-testid="automations-hubspot-sans-portail">
        <p className="text-sm text-ink-900">
          {t('Aucun portail HubSpot n’est relié à votre espace. Reliez-le dans ', 'No HubSpot portal is connected to your workspace. Connect it in ')}
          <Link href="/integrations#integration-hubspot" className="text-brand-600 hover:underline">{t('Tools > Intégrations', 'Tools > Integrations')}</Link>
          {t(' : vos automations HubSpot se règlent ensuite ici.', ': your HubSpot automations are then set here.')}
        </p>
      </section>
    );
  }

  const raison = (err: unknown, repli: string): string => (routeInconnue(err)
    ? t('La console est plus récente que l’API : réessayez dans quelques minutes.', 'The console is newer than the API: try again in a few minutes.')
    : err instanceof Error ? err.message : repli);

  const geste = async (action: () => Promise<void>, repli: string): Promise<void> => {
    setOccupe(true);
    setErreur(null);
    try {
      await action();
    } catch (err: unknown) {
      setErreur(raison(err, repli));
    } finally {
      setOccupe(false);
    }
  };

  const basculer = (l: LigneHubspotVue): Promise<void> => geste(async () => {
    await reglerLigneHubspot(tenantId, l.id, { actif: !l.actif });
    await recharger();
  }, t('Réglage impossible', 'Unable to save'));

  const supprimer = async (l: LigneHubspotVue): Promise<void> => {
    const message = t(
      'Elle ne partira plus, et ses parcours en cours s’arrêtent. Son scénario n’est plus proposé nulle part.',
      'It will no longer go out, and its running journeys stop. Its scenario is no longer offered anywhere.',
    ) + (l.famille === 'workflow'
      ? t(' Les workflows HubSpot qui le lancent ne le pourront plus.', ' HubSpot workflows that launch it will no longer be able to.')
      : '');
    if (!(await confirmer({ titre: t('Supprimer cette automation HubSpot', 'Delete this HubSpot automation'), message, confirmer: t('Supprimer', 'Delete') }))) return;
    await geste(async () => {
      await supprimerLigneHubspot(tenantId, l.id);
      await recharger();
    }, t('Suppression impossible', 'Unable to delete'));
  };

  /**
   * « Ajouter » : la ligne naît éteinte avec son scénario, que le builder ouvre aussitôt (son premier bloc attend son
   * message), comme le premier allumage d'une ligne Shopify. Un scénario lancé par un workflow reçoit d'abord son nom
   * (`PATCH` du scénario) : c'est lui que l'action de HubSpot propose, et le contrat de création n'en porte pas.
   */
  const creer = (corps: CreationLigneHubspot, nom?: string): Promise<void> => geste(async () => {
    const workflowId = scenarioDeLaLigneCreee(await creerLigneHubspot(tenantId, corps));
    if (workflowId === null) {
      setAjout(null);
      await recharger();
      return;
    }
    if (nom !== undefined) {
      try {
        await updateWorkflow(tenantId, workflowId, { name: nom });
      } catch (err: unknown) {
        setAjout(null);
        await recharger();
        setErreur(t('Scénario créé, mais son nom n’a pas pu être enregistré : ', 'Scenario created, but its name could not be saved: ') + raison(err, ''));
        return;
      }
    }
    router.push(`/workflows?open=${encodeURIComponent(workflowId)}`);
  }, t('Création impossible', 'Unable to create'));

  const lus = { pipelines: Array.isArray(etapes) ? etapes : null, champs: Array.isArray(champs) ? champs : null };
  const fermer = (): void => setAjout(null);

  return (
    <section className={cardCls} data-testid="automations-hubspot">
      <h2 className="text-sm font-semibold text-ink-900">{t('HubSpot', 'HubSpot')}</h2>
      <p className="mt-1 max-w-prose text-sm text-ink-500">
        {t(
          'Les messages que HubSpot déclenche. Chacun est un scénario : son premier bloc est le message envoyé, la suite répond au client.',
          'The messages HubSpot triggers. Each one is a scenario: its first block is the message sent, the rest answers the customer.',
        )}
      </p>
      {FAMILLES.map((f) => {
        const deLaFamille = lignes.filter((l) => l.famille === f.famille);
        return (
          <div key={f.famille} className="mt-5" data-testid={`automations-hubspot-famille-${f.famille}`}>
            <h3 className="text-sm font-medium text-ink-900">{t(...f.titre)}</h3>
            <p className="mt-0.5 max-w-prose text-xs text-ink-500">{t(...f.explication)}</p>
            {deLaFamille.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500" data-testid={`automations-hubspot-vide-${f.famille}`}>{t(...f.vide)}</p>
            ) : (
              <ul className="mt-2 divide-y divide-ink-100 rounded-controle border border-ink-200">
                {deLaFamille.map((l) => {
                  const etat = etatDeLaLigne(l);
                  const libelle = libelleDeLaLigne(l, lus, t);
                  return (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-testid={`automations-hubspot-ligne-${l.id}`}>
                      <Toggle
                        checked={l.actif} onChange={() => void basculer(l)} disabled={occupe}
                        libelle={libelle} testid={`automations-hubspot-interrupteur-${l.id}`}
                      />
                      <span className="font-medium text-ink-900" data-testid={`automations-hubspot-libelle-${l.id}`}>{libelle}</span>
                      <span className={ETATS_EN_SERVICE.includes(etat) ? 'text-succes-700' : 'text-ink-500'} data-testid={`automations-hubspot-etat-${l.id}`}>
                        {t(...ETATS[etat])}
                      </span>
                      <Link
                        href={`/workflows?open=${encodeURIComponent(l.workflowId)}`} className="ml-auto text-brand-600 hover:underline"
                        data-testid={`automations-hubspot-ouvrir-${l.id}`}
                      >
                        {t('Ouvrir le scénario', 'Open the scenario')}
                      </Link>
                      <button
                        type="button" onClick={() => void supprimer(l)} disabled={occupe}
                        className="text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-50" data-testid={`automations-hubspot-supprimer-${l.id}`}
                      >
                        {t('Supprimer', 'Delete')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {ajout !== f.famille ? (
              <Bouton
                variante="secondaire" taille="petite" className="mt-2" disabled={occupe}
                onClick={() => { setErreur(null); setAjout(f.famille); }} data-testid={`automations-hubspot-ajouter-${f.famille}`}
              >
                <Icone nom="ajouter" />{t(...f.ajouter)}
              </Bouton>
            ) : f.famille === 'etape' ? (
              <AjoutEtape etapes={etapes} lignes={lignes} occupe={occupe} onCreer={(c) => void creer(c)} onAnnuler={fermer} />
            ) : f.famille === 'rdv' ? (
              <AjoutRendezVous champs={champs} occupe={occupe} onCreer={(c) => void creer(c)} onAnnuler={fermer} />
            ) : (
              <AjoutWorkflow occupe={occupe} onCreer={(nom) => void creer({ famille: 'workflow', config: {} }, nom)} onAnnuler={fermer} />
            )}
          </div>
        );
      })}
      {erreur && <p className="mt-3 text-sm text-danger" data-testid="automations-hubspot-erreur">{erreur}</p>}
    </section>
  );
}

const cadreAjout = 'mt-2 max-w-formulaire space-y-2 rounded-controle border border-ink-200 p-3';

/** Ce que chaque formulaire « Ajouter » rappelle : la suite se fait dans le builder, puis la ligne s'allume ici. */
function SuiteDansLeBuilder() {
  const t = useT();
  return (
    <p className="text-xs text-ink-500">
      {t(
        'Le scénario s’ouvre ensuite : écrivez son premier message et publiez-le, puis allumez la ligne ici.',
        'The scenario then opens: write its first message and publish it, then switch the line on here.',
      )}
    </p>
  );
}

function BoutonsAjout({ famille, pret, occupe, onCreer, onAnnuler }: {
  famille: FamilleHubspot; pret: boolean; occupe: boolean; onCreer: () => void; onAnnuler: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 pt-1">
      <Bouton taille="petite" enCours={occupe} disabled={occupe || !pret} onClick={onCreer} data-testid={`automations-hubspot-creer-${famille}`}>
        {t('Créer et ouvrir le scénario', 'Create and open the scenario')}
      </Bouton>
      <button type="button" onClick={onAnnuler} className="text-sm text-ink-500 hover:underline" data-testid={`automations-hubspot-annuler-${famille}`}>
        {t('Annuler', 'Cancel')}
      </button>
    </div>
  );
}

/** Une étape : groupée par pipeline (deux pipelines ont souvent une étape du même nom), une étape déjà réglée grisée. */
function AjoutEtape({ etapes, lignes, occupe, onCreer, onAnnuler }: {
  etapes: EtapesLues; lignes: readonly LigneHubspotVue[]; occupe: boolean;
  onCreer: (c: CreationLigneHubspot) => void; onAnnuler: () => void;
}) {
  const t = useT();
  const [cle, setCle] = useState('');
  const pipelines = Array.isArray(etapes) ? etapes : [];
  const choix = etapesAuChoix(pipelines, lignes);
  const choisie = choix.find((e) => e.cle === cle && !e.dejaReglee);
  return (
    <div className={cadreAjout} data-testid="automations-hubspot-ajout-etape">
      <label htmlFor="automations-hubspot-etape" className="block text-sm font-medium text-ink-900">{t('Étape du deal', 'Deal stage')}</label>
      {etapes === 'attente' || etapes === 'lecture' ? (
        <p className="text-xs text-ink-500">{t('Lecture des étapes du portail…', 'Reading portal stages…')}</p>
      ) : etapes === 'non_connecte' ? (
        <p className="text-xs text-alerte-700" data-testid="automations-hubspot-etape-non-connecte">
          {t('Le portail ne rend pas ses étapes : vérifiez sa connexion dans ', 'The portal does not return its stages: check its connection in ')}
          <Link href="/integrations#integration-hubspot" className="text-brand-600 hover:underline">{t('Tools > Intégrations > HubSpot', 'Tools > Integrations > HubSpot')}</Link>.
        </p>
      ) : etapes === 'panne' ? (
        <p className="text-xs text-danger-700">{t('Les étapes n’ont pas pu être lues. Réessayez dans un instant.', 'Stages could not be read. Try again shortly.')}</p>
      ) : choix.length === 0 ? (
        <p className="text-xs text-alerte-700">{t('Ce portail n’a aucune étape de deal.', 'This portal has no deal stage.')}</p>
      ) : (
        <select id="automations-hubspot-etape" value={cle} onChange={(e) => setCle(e.target.value)} className={inputCls} data-testid="automations-hubspot-etape-choix">
          <option value="">{t('Choisir une étape…', 'Choose a stage…')}</option>
          {pipelines.map((p) => (
            <optgroup key={p.id} label={p.label}>
              {choix.filter((e) => e.pipelineId === p.id).map((e) => (
                <option key={e.cle} value={e.cle} disabled={e.dejaReglee}>
                  {e.label}{e.fin ? t(' (étape de fin)', ' (closing stage)') : ''}{e.dejaReglee ? t(' (déjà réglée)', ' (already set)') : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
      <SuiteDansLeBuilder />
      <BoutonsAjout
        famille="etape" pret={choisie !== undefined} occupe={occupe} onAnnuler={onAnnuler}
        onCreer={() => {
          if (choisie) onCreer({ famille: 'etape', config: { pipelineId: choisie.pipelineId, stageId: choisie.stageId, stageLabel: choisie.label } });
        }}
      />
    </div>
  );
}

/** Un rendez-vous : un champ « date et heure » importé de HubSpot, de quel côté, et le délai. */
function AjoutRendezVous({ champs, occupe, onCreer, onAnnuler }: {
  champs: ChampsLus; occupe: boolean; onCreer: (c: CreationLigneHubspot) => void; onAnnuler: () => void;
}) {
  const t = useT();
  const [fieldKey, setFieldKey] = useState('');
  // Le délai reste le texte saisi : un nombre vide ou faux ne s'enregistre pas, sans `NaN` dans le champ.
  const [delai, setDelai] = useState('2');
  const [unite, setUnite] = useState<UniteDelai>('heures');
  const [sens, setSens] = useState<SensRendezVous>('avant');
  const proposes = Array.isArray(champs) ? champsRendezVous(champs) : [];
  const n = Number(delai);
  const pret = fieldKey !== '' && Number.isInteger(n) && n > 0;
  return (
    <div className={cadreAjout} data-testid="automations-hubspot-ajout-rdv">
      <p className="text-sm font-medium text-ink-900">{t('Quand le message part', 'When the message goes out')}</p>
      {champs === 'lecture' ? (
        <p className="text-xs text-ink-500">{t('Lecture des champs…', 'Reading fields…')}</p>
      ) : champs === 'panne' ? (
        <p className="text-xs text-danger-700">{t('Les champs n’ont pas pu être lus. Réessayez dans un instant.', 'Fields could not be read. Try again shortly.')}</p>
      ) : proposes.length === 0 ? (
        <p className="rounded-controle bg-alerte-50 px-3 py-2 text-sm text-alerte-800" data-testid="automations-hubspot-rdv-aucun-champ">
          {t(
            'Aucun champ « date et heure » importé de HubSpot : choisissez-en un parmi les champs HubSpot à importer, dans ',
            'No “date & time” field imported from HubSpot: pick one among the HubSpot fields to import, in ',
          )}
          <Link href="/integrations#integration-hubspot" className="text-brand-600 hover:underline">{t('Tools > Intégrations > HubSpot', 'Tools > Integrations > HubSpot')}</Link>.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number" min={1} value={delai} onChange={(e) => setDelai(e.target.value)} aria-label={t('Délai', 'Delay')}
            className={`${inputClsAuto} w-24`} data-testid="automations-hubspot-rdv-delai"
          />
          <select value={unite} onChange={(e) => setUnite(e.target.value as UniteDelai)} aria-label={t('Unité', 'Unit')} className={inputClsAuto} data-testid="automations-hubspot-rdv-unite">
            <option value="minutes">{t('minutes', 'minutes')}</option>
            <option value="heures">{t('heures', 'hours')}</option>
            <option value="jours">{t('jours', 'days')}</option>
          </select>
          <select value={sens} onChange={(e) => setSens(e.target.value === 'apres' ? 'apres' : 'avant')} aria-label={t('Avant ou après', 'Before or after')} className={inputClsAuto} data-testid="automations-hubspot-rdv-sens">
            <option value="avant">{t('avant', 'before')}</option>
            <option value="apres">{t('après', 'after')}</option>
          </select>
          <select value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} aria-label={t('Champ', 'Field')} className={`${inputClsAuto} flex-1`} data-testid="automations-hubspot-rdv-champ">
            <option value="">{t('Choisir un champ…', 'Pick a field…')}</option>
            {proposes.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      )}
      <p className="text-xs text-ink-500">
        {t(
          'Une date déjà passée n’envoie rien. Si le rendez-vous est déplacé, le message repart sur la nouvelle date.',
          'A date already past sends nothing. If the appointment is moved, the message goes out again on the new date.',
        )}
      </p>
      <SuiteDansLeBuilder />
      <BoutonsAjout
        famille="rdv" pret={pret} occupe={occupe} onAnnuler={onAnnuler}
        onCreer={() => { if (pret) onCreer({ famille: 'rdv', config: { fieldKey, sens, delaiMinutes: n * MINUTES_PAR_UNITE[unite] } }); }}
      />
    </div>
  );
}

/** Un scénario lancé par un workflow : son nom, que l'action « Lancer un scénario Messaging Me » propose dans HubSpot. */
function AjoutWorkflow({ occupe, onCreer, onAnnuler }: { occupe: boolean; onCreer: (nom: string) => void; onAnnuler: () => void }) {
  const t = useT();
  const [nom, setNom] = useState('');
  return (
    <div className={cadreAjout} data-testid="automations-hubspot-ajout-workflow">
      <label htmlFor="automations-hubspot-workflow-nom" className="block text-sm font-medium text-ink-900">{t('Nom du scénario', 'Scenario name')}</label>
      <input
        id="automations-hubspot-workflow-nom" value={nom} onChange={(e) => setNom(e.target.value)} maxLength={120}
        placeholder={t('Relance après devis', 'Follow-up after quote')} className={inputCls} data-testid="automations-hubspot-workflow-nom"
      />
      <p className="text-xs text-ink-500">
        {t(
          'C’est ce nom que l’action « Lancer un scénario Messaging Me » propose dans vos workflows HubSpot.',
          'This is the name the “Launch a Messaging Me scenario” action offers in your HubSpot workflows.',
        )}
      </p>
      <SuiteDansLeBuilder />
      <BoutonsAjout famille="workflow" pret={nom.trim() !== ''} occupe={occupe} onAnnuler={onAnnuler} onCreer={() => { if (nom.trim() !== '') onCreer(nom.trim()); }} />
    </div>
  );
}
