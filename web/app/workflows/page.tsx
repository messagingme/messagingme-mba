'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { ScenarioOuvert } from '@/components/ScenarioOuvert';
import { useTestDeScenario } from '@/components/TestDeScenario';
import type { Session } from '@/lib/session';
import { listWorkflows, createWorkflow, getWorkflow, deleteWorkflow, updateWorkflow, duplicateWorkflow, grapheEditable, type WorkflowSummary } from '@/lib/api';
import { Modale } from '@/components/Modale';
import { useT, useLocale } from '@/lib/i18n';
import { formatDate, hourMin } from '@/lib/day';
import { Bouton } from '@/components/Bouton';
import { IntroPage, TitrePage } from '@/components/TitrePage';
import { useConfirmation } from '@/components/Confirmation';
import { VoileMenu } from '@/components/Flottant';
import { Squelette } from '@/components/Squelette';
import { erreurDeChargement } from '@/lib/http';
import { BarreDossiers, comptesDesOnglets, DeplacerVers, dossierCommun, useDossiers } from '@/components/BarreDossiers';
import { ranger, SANS_DOSSIER } from '@/lib/api/dossiers';
import type { Depart } from '@/lib/partage/fenetre-scenario';

export default function WorkflowsPage() {
  // Suspense : useSearchParams (deep-link ?open=) exige une frontière Suspense au build (Next 15).
  return (
    <AppShell active="workflows" fullBleed>
      {(session) => (
        <Suspense fallback={null}>
          <WorkflowsInner session={session} />
        </Suspense>
      )}
    </AppShell>
  );
}

function WorkflowsInner({ session }: { session: Session }) {
  const t = useT();
  const confirmer = useConfirmation();
  const { locale } = useLocale();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<WorkflowSummary | null>(null);
  const router = useRouter();
  // Les départs du scénario ouvert (`GET /workflows/:id`) ; `null` : un scénario neuf, ou une API qui ne les rend pas.
  const [departs, setDeparts] = useState<Depart[] | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * LES SCÉNARIOS COCHÉS, pour l'action groupée.
   *
   * 🔴 DEMANDÉ PAR JULIEN LE 2026-09-14 : « il faut que je puisse sélectionner plusieurs scénarios avec des
   * petites cases à cocher à côté et que je puisse appliquer une bulk action (pour l'instant "supprimer"
   * juste) ». Supprimer dix scénarios d'essai demandait dix ouvertures de menu et dix confirmations.
   *
   * ⚠️ UN `Set` RECOPIÉ À CHAQUE CHANGEMENT, jamais muté en place : muter garderait la même référence et
   * React ne rendrait rien, ce qui donnerait une case qui ne se coche qu'une fois sur deux.
   */
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  // Menu « 3 points » ouvert (id de la ligne) + renommage en cours.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<WorkflowSummary | null>(null);
  const [renameVal, setRenameVal] = useState('');
  /**
   * LES DOSSIERS (décision de Julien du 2026-10-13) : la barre filtre la liste, et « Déplacer vers… » range une ligne ou
   * une sélection. La liste des scénarios ne change pas : le rangement vient de la route des dossiers.
   */
  const dossiers = useDossiers(session.tenantId, 'scenario');
  const admin = session.role === 'admin';
  const visibles = dossiers.filtrer(workflows, (w) => w.id);
  /** Les scénarios à déplacer, quand la fenêtre « Déplacer vers… » est ouverte. */
  const [aDeplacer, setADeplacer] = useState<string[] | null>(null);
  const rangeable = admin && dossiers.disponible;
  // Date + heure de création (fuseau Paris). Vide/invalide (objet transitoire juste après création) -> '-'.
  const createdLabel = (iso: string): string =>
    iso && !Number.isNaN(Date.parse(iso)) ? `${formatDate(iso, locale)} ${hourMin(iso, locale)}` : '-';
  const searchParams = useSearchParams();
  const deepLinkId = searchParams.get('open');
  const deepLinkApplied = useRef(false);
  /** Le lien de test d'un scénario de la liste (son menu « Tester le scénario »). */
  const test = useTestDeScenario(session.tenantId);

  const load = useCallback(async () => {
    setError(null);
    try {
      setWorkflows((await listWorkflows(session.tenantId)).workflows);
    } catch (err) {
      setError(erreurDeChargement(err, t));
    } finally {
      setLoading(false);
    }
  }, [session.tenantId, t]);

  useEffect(() => { void load(); }, [load]);

  // Deep-link ?open=<id> (depuis Contenu > Blocs, un e-mail, une automation Shopify) : ouvre le scénario une fois la liste
  // chargée, une seule fois (pas de ré-ouverture après un retour manuel à la liste). 🔴 Un scénario d'automation (rayon
  // Shopify, menu « Scénario », lot 5) n'est pas dans la liste du Builder : il s'ouvre par son identifiant, que la route lit
  // quel que soit son rayon. Un identifiant inconnu le dit (« Ouverture impossible »), comme un scénario supprimé.
  useEffect(() => {
    if (deepLinkApplied.current || !deepLinkId || editing || loading) return;
    deepLinkApplied.current = true;
    void open({ id: deepLinkId });
  }, [deepLinkId, editing, loading]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const res = await createWorkflow(session.tenantId, name);
      setNewName('');
      setEditing({ id: res.id, name: res.name, graph: res.graph, createdAt: '', updatedAt: '' });
      setDeparts(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Création impossible', 'Unable to create'));
    }
  }
  /** Ouvre un scénario par son identifiant : la route rend son graphe, quel que soit son rayon. */
  async function open(w: Pick<WorkflowSummary, 'id'>) {
    setError(null);
    try {
      const { workflow, departs: lus } = await getWorkflow(session.tenantId, w.id);
      setEditing(workflow);
      setDeparts(lus ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Ouverture impossible', 'Unable to open'));
    }
  }
  /**
   * SUPPRIME TOUS LES SCÉNARIOS COCHÉS.
   *
   * ⚠️ UN PAR UN, EN SÉRIE, ET PAS EN PARALLÈLE. Il n'existe pas de route de suppression groupée : dix
   * appels simultanés sur un plafond de débit partagé avec toute la console se feraient refuser au milieu,
   * et l'écran annoncerait un échec sur des scénarios pourtant supprimés.
   *
   * ⚠️ ON S'ARRÊTE À LA PREMIÈRE ERREUR et on recharge : la liste dit alors exactement ce qui reste, plutôt
   * que de laisser croire que tout est parti.
   */
  async function removeSelection() {
    const ids = [...selection];
    if (ids.length === 0) return;
    const noms = workflows.filter((w) => selection.has(w.id)).map((w) => w.name);
    // 🔴 LA CONFIRMATION NOMME CE QU'ELLE DÉTRUIT, comme la suppression unitaire : « Supprimer 7 éléments ? »
    // ne permet pas de vérifier qu'on n'a pas coché une ligne de trop.
    const liste = noms.slice(0, 5).join(', ') + (noms.length > 5 ? `, … (+${noms.length - 5})` : '');
    if (!(await confirmer({ titre: t('Supprimer les scénarios', 'Delete the scenarios'), message: t(
      `Supprimer ${ids.length} scénario(s) ? ${liste}`,
      `Delete ${ids.length} scenario(s)? ${liste}`,
    ), confirmer: t('Supprimer', 'Delete') }))) return;
    setError(null);
    setBusy(true);
    try {
      for (const id of ids) await deleteWorkflow(session.tenantId, id);
      setSelection(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Suppression impossible', 'Unable to delete'));
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function remove(w: WorkflowSummary) {
    setMenuFor(null);
    if (!(await confirmer({ titre: t('Supprimer le scénario', 'Delete the scenario'), message: t(`Supprimer le scénario « ${w.name} » ?`, `Delete the scenario "${w.name}"?`), confirmer: t('Supprimer', 'Delete') }))) return;
    setError(null);
    setBusy(true);
    try {
      await deleteWorkflow(session.tenantId, w.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Suppression impossible', 'Unable to delete'));
    } finally {
      setBusy(false);
    }
  }
  /** « Tester le scénario » (menu de la ligne) : le lien de test du module partagé (`useTestDeScenario`). */
  async function openTest(w: WorkflowSummary) {
    setMenuFor(null);
    setError(null);
    await test.tester(w);
  }

  async function duplicate(w: WorkflowSummary) {
    setMenuFor(null);
    setError(null);
    setBusy(true);
    try {
      const copie = await duplicateWorkflow(session.tenantId, w.id);
      // La copie suit l'original dans son dossier. Un échec ici la laisse « Sans dossier » : rien de perdu.
      const dossier = dossiers.vue.rangement[w.id];
      if (dossier) await ranger(session.tenantId, 'scenario', [copie.id], dossier).catch(() => 0);
      await Promise.all([load(), dossiers.recharger()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Duplication impossible', 'Unable to duplicate'));
    } finally {
      setBusy(false);
    }
  }
  /** Range les scénarios de la fenêtre « Déplacer vers… » dans un dossier, ou dans « Sans dossier ». */
  async function deplacer(dossierId: string | null) {
    const ids = aDeplacer ?? [];
    setADeplacer(null);
    if (ids.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      await ranger(session.tenantId, 'scenario', ids, dossierId);
      setSelection(new Set());
      await dossiers.recharger();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Déplacement impossible', 'Unable to move'));
    } finally {
      setBusy(false);
    }
  }
  function startRename(w: WorkflowSummary) {
    setMenuFor(null);
    setRenaming(w);
    setRenameVal(w.name);
  }
  async function submitRename() {
    if (busy || !renaming) return;
    const name = renameVal.trim();
    if (name === '' || name === renaming.name) { setRenaming(null); return; }
    setError(null);
    setBusy(true);
    try {
      await updateWorkflow(session.tenantId, renaming.id, { name });
      setRenaming(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Renommage impossible', 'Unable to rename'));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <ScenarioOuvert
        plein tenantId={session.tenantId} workflow={editing} departs={departs}
        entete={(
          <>
            <div className="flex items-center justify-between">
              {/* Un scénario d'automation revient à sa page (spec 2026-11-20 § 4.4) : le rayon se lit sur le scénario, jamais dans
                  l'adresse, que les e2e figent à `/workflows?open=<id>`. */}
              {editing.rayon === 'shopify' || editing.rayon === 'hubspot' ? (
                <button
                  onClick={() => router.push(editing.rayon === 'shopify' ? '/automations/shopify' : '/automations/hubspot')}
                  className="text-sm text-brand-600 hover:underline" data-testid="workflow-retour"
                >
                  ← {editing.rayon === 'shopify'
                    ? t('Retour aux automations Shopify', 'Back to Shopify automations')
                    : t('Retour aux automations HubSpot', 'Back to HubSpot automations')}
                </button>
              ) : (
                <button onClick={() => { setEditing(null); void load(); }} className="text-sm text-brand-600 hover:underline" data-testid="workflow-retour">← {t('Retour aux scénarios', 'Back to scenarios')}</button>
              )}
              <TitrePage>{editing.name}</TitrePage>
            </div>
            {error && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
          </>
        )}
      />
    );
  }

  // ⚠️ `max-w-liste` ET NON `3xl` (demandé par Julien le 2026-09-14, même raison que l'écran MBA le
  // 2026-09-10) : la liste porte quatre colonnes plus une case à cocher, et une ligne de scénario au nom
  // long y passait à la ligne dans une colonne étroite au milieu d'un écran vide.
  // 🔴 `w-full` : dans la colonne flex de la coquille pleine largeur, `mx-auto` SANS largeur rétrécissait le
  // bloc à son contenu (environ 600 px, mesuré sur les captures du 2026-09-25). La largeur demandée ci-dessus
  // n'était donc jamais atteinte.
  return (
    <div className="mx-auto w-full max-w-liste space-y-6 p-4 sm:p-6 lg:h-full lg:overflow-y-auto">
      <div>
        <TitrePage>{t('Scénarios', 'Scenarios')}</TitrePage>
        <IntroPage>{t('Des blocs enchaînés (étiquette, template, formulaire, inbox), joués pour chaque contact d’une campagne ou d’une automation.', 'Chained blocks (tag, template, form, inbox), played for each contact of a campaign or an automation.')}</IntroPage>
      </div>
      {error && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}

      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void create(); }}
          data-testid="workflow-nouveau-nom"
          placeholder={t('Nom du scénario…', 'Scenario name…')}
          className="flex-1 rounded-controle border border-ink-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <Bouton onClick={create} disabled={newName.trim() === ''}>{t('Créer un scénario', 'Create a scenario')}</Bouton>
      </div>

      {dossiers.disponible && (
        <BarreDossiers
          tenantId={session.tenantId} type="scenario" admin={admin} vue={dossiers.vue} onglet={dossiers.onglet}
          comptes={comptesDesOnglets(workflows, (w) => w.id, dossiers.vue)}
          // Changer d'onglet vide la sélection : on ne garde pas cochées des lignes qu'on ne voit plus.
          onChoisir={(o) => { dossiers.setOnglet(o); setSelection(new Set()); }}
          onChange={dossiers.recharger}
        />
      )}

      <div className="overflow-hidden rounded-carte border border-ink-200 bg-white">
        <div className="border-b border-ink-100 px-5 py-3 text-sm font-semibold text-ink-900">{t('Scénarios', 'Scenarios')} ({visibles.length})</div>
        {loading ? (
          <Squelette forme="lignes" className="px-5 py-6" />
        ) : workflows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-500">{t('Aucun scénario : créez-en un ci-dessus.', 'No scenarios yet: create one above.')}</p>
        ) : visibles.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-500" data-testid="workflows-dossier-vide">{dossiers.onglet === SANS_DOSSIER
            ? t('Tous vos scénarios sont rangés dans un dossier.', 'All your scenarios are in a folder.')
            : t('Aucun scénario dans ce dossier : « Déplacer vers… », dans le menu ⋯ d’un scénario, l’y range.', 'No scenario in this folder: “Move to…”, in a scenario’s ⋯ menu, puts it here.')}</p>
        ) : (
          <>
          {/*
            🔴 LA BARRE N'APPARAÎT QUE QUAND QUELQUE CHOSE EST COCHÉ. Un bouton « Supprimer » toujours
            visible et grisé occuperait la place et ferait chercher pourquoi il ne réagit pas ; ici, il
            n'existe que lorsqu'il a un objet.
          */}
          {selection.size > 0 && (
            <div className="mb-3 flex items-center justify-between rounded-controle bg-ink-50 px-4 py-2" data-testid="workflows-barre-selection">
              <span className="text-sm text-ink-900">
                {selection.size === 1
                  ? t('1 scénario sélectionné', '1 scenario selected')
                  : t(`${selection.size} scénarios sélectionnés`, `${selection.size} scenarios selected`)}
              </span>
              <div className="flex items-center gap-3">
                <button onClick={() => setSelection(new Set())} className="text-sm text-ink-500 hover:text-ink-900">
                  {t('Annuler', 'Cancel')}
                </button>
                {rangeable && (
                  <Bouton variante="secondaire" taille="petite" disabled={busy} data-testid="workflows-deplacer-selection" onClick={() => setADeplacer([...selection])}>
                    {t('Déplacer vers…', 'Move to…')}
                  </Bouton>
                )}
                <button
                  onClick={() => { void removeSelection(); }}
                  disabled={busy}
                  data-testid="workflows-supprimer-selection"
                  className="rounded-controle bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {t('Supprimer', 'Delete')}
                </button>
              </div>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
                <th className="w-10 px-3 py-2">
                  {/* ⚠️ « Tout cocher » porte sur la LISTE AFFICHÉE, ce qui est la seule promesse tenable :
                      une liste filtrée un jour ne devrait pas cocher ce qu'elle ne montre pas. */}
                  <input
                    type="checkbox"
                    aria-label={t('Tout sélectionner', 'Select all')}
                    data-testid="workflows-tout-cocher"
                    checked={visibles.length > 0 && selection.size === visibles.length}
                    onChange={(e) => setSelection(e.target.checked ? new Set(visibles.map((w) => w.id)) : new Set())}
                  />
                </th>
                <th className="px-5 py-2 font-medium">{t('Nom', 'Name')}</th>
                <th className="px-5 py-2 font-medium">{t('Blocs', 'Blocks')}</th>
                <th className="px-5 py-2 font-medium">{t('Créé le', 'Created')}</th>
                <th className="px-5 py-2 text-right font-medium">{t('Actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((w, i) => (
                <tr key={w.id} className="border-b border-ink-50 last:border-0">
                  <td className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={t(`Sélectionner ${w.name}`, `Select ${w.name}`)}
                      data-testid={`workflow-cocher-${w.id}`}
                      checked={selection.has(w.id)}
                      onChange={() => setSelection((s) => {
                        // Une COPIE, jamais une mutation : muter garderait la même référence et React ne
                        // rendrait rien.
                        const suivant = new Set(s);
                        if (suivant.has(w.id)) suivant.delete(w.id); else suivant.add(w.id);
                        return suivant;
                      })}
                    />
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => open(w)} className="font-medium text-brand-600 hover:underline">{w.name}</button>
                    {w.code && <div className="font-mono text-xs text-ink-500" title={t('Code public (API)', 'Public code (API)')}>{w.code}</div>}
                    {/* Un brouillon en attente se voit DEPUIS LA LISTE : sans ça, un scénario modifié mais
                        jamais publié aurait l'air en ligne, et c'est précisément l'erreur que le bouton
                        « Publier » peut faire commettre. */}
                    {(w.hasDraft ?? Boolean(w.draftGraph)) && (
                      <div className="mt-0.5 inline-block rounded-controle bg-alerte-100 px-1.5 py-0.5 text-xs font-medium text-alerte-800" data-testid={`workflow-brouillon-${w.id}`}>
                        {t('brouillon non publié', 'unpublished draft')}
                      </div>
                    )}
                  </td>
                  {/* Le nombre de blocs de ce que l'auteur ÉDITE (brouillon s'il existe) : la liste sert à
                      retrouver son travail, pas à auditer la production. */}
                  <td className="px-5 py-3 text-ink-500">{w.nodeCount ?? grapheEditable(w).nodes.length}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-ink-500">{createdLabel(w.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => open(w)} className="font-medium text-brand-600 hover:text-brand-700">{t('Ouvrir', 'Open')}</button>
                      <div className="relative">
                        <button
                          onClick={() => setMenuFor((m) => (m === w.id ? null : w.id))}
                          disabled={busy}
                          className="rounded-controle px-1.5 py-0.5 text-lg leading-none text-ink-500 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-50"
                          aria-label={t('Plus d’actions', 'More actions')}
                          data-testid={`workflow-menu-${w.id}`}
                        >
                          ⋯
                        </button>
                        {menuFor === w.id && (
                          <>
                            <VoileMenu z="z-10" onClose={() => setMenuFor(null)} />
                            {/*
                              🔴 LE MENU S'OUVRE VERS LE HAUT SUR LES DERNIÈRES LIGNES (2026-09-14). Julien :
                              « quand je clique sur les 3 petits points, sur le dernier scénario, la fenêtre
                              s'ouvre vers le bas donc on ne voit rien ». Le menu fait cinq entrées, soit
                              environ quatre lignes de tableau : les DEUX dernières suffisent à le couvrir.

                              ⚠️ Et seulement si la liste est assez longue : sur trois scénarios, ouvrir vers
                              le haut ferait sortir le menu par le haut du tableau, ce qui déplace le défaut
                              au lieu de le corriger.
                            */}
                            <div className={`absolute right-0 z-20 w-44 overflow-hidden rounded-controle border border-ink-200 bg-white py-1 text-left text-sm shadow-mm-md ${
                              visibles.length > 3 && i >= visibles.length - 2 ? 'bottom-full mb-1' : 'mt-1'
                            }`}>
                              <button onClick={() => { void openTest(w); }} data-testid={`workflow-test-${w.id}`} className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Tester le scénario', 'Test scenario')}</button>
                              <button onClick={() => startRename(w)} className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Renommer', 'Rename')}</button>
                              <button onClick={() => duplicate(w)} className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Dupliquer', 'Duplicate')}</button>
                              {rangeable && (
                                <button onClick={() => { setMenuFor(null); setADeplacer([w.id]); }} data-testid={`workflow-deplacer-${w.id}`} className="block w-full px-4 py-2 text-left hover:bg-ink-50">{t('Déplacer vers…', 'Move to…')}</button>
                              )}
                              <div className="my-1 border-t border-ink-100" />
                              <button onClick={() => remove(w)} className="block w-full px-4 py-2 text-left text-danger hover:bg-danger-50">{t('Supprimer', 'Delete')}</button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>

      {test.erreur && <p className="mx-auto mt-3 w-full max-w-liste rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{test.erreur}</p>}
      {test.panneau}

      {aDeplacer && (
        <DeplacerVers
          dossiers={dossiers.vue.dossiers} combien={aDeplacer.length} actuel={dossierCommun(aDeplacer, dossiers.vue)}
          onChoisir={(d) => { void deplacer(d); }} onClose={() => setADeplacer(null)}
        />
      )}

      {renaming && (
        <Modale titre={t('Renommer le scénario', 'Rename scenario')} taille="petite" onClose={() => setRenaming(null)}>
          <input
            autoFocus
            value={renameVal}
            onChange={(e) => setRenameVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submitRename(); if (e.key === 'Escape') setRenaming(null); }}
            className="mt-4 w-full rounded-controle border border-ink-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            placeholder={t('Nom du scénario', 'Scenario name')}
            data-testid="workflow-rename-input"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setRenaming(null)} disabled={busy} className="rounded-controle px-3 py-2 text-sm text-ink-500 hover:text-ink-900 disabled:opacity-50">{t('Annuler', 'Cancel')}</button>
            <Bouton onClick={() => void submitRename()} disabled={busy || renameVal.trim() === ''}>{t('Renommer', 'Rename')}</Bouton>
          </div>
        </Modale>
      )}
    </div>
  );
}
