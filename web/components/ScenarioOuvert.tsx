'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { WorkflowBuilder } from '@/components/WorkflowBuilder';
import { getSettings, getWorkflow, grapheEditable, listEmailAccounts, type WorkflowSummary } from '@/lib/api';
import { listAgents, type AgentResume } from '@/lib/api-agent';
import { listUsers, type AdminUser } from '@/lib/api/compte';
import { listRequetes, type RequeteApi } from '@/lib/api-agent-requetes';
import { listSources } from '@/lib/api-agent-sources';
import { useT } from '@/lib/i18n';
import { Bouton } from '@/components/Bouton';
import { Squelette } from '@/components/Squelette';
import { useTestDeScenario } from '@/components/TestDeScenario';
import type { Depart } from '@/lib/partage/fenetre-scenario';

/**
 * UN SCÉNARIO OUVERT DANS LE BUILDER, où qu'il s'ouvre : la page des scénarios, ou déplié sous la liste des automations
 * Shopify et HubSpot (Julien, 2026-11-20 : « les gens ne voient pas le bouton en haut à gauche pour revenir »). Il lit ce
 * que le builder gouverne (agent de Meta, RCS, boîte d'envoi, agents IA actifs, membres, appels API) et porte le lien de
 * test d'un bloc. Chaque lecture est au mieux : un échec laisse la brique concernée grisée, défaut prudent.
 *
 * `plein` : la page des scénarios, où le builder prend la hauteur de la coquille ; sinon une hauteur fixe, dans la page.
 */
export function ScenarioOuvert({ tenantId, workflow, departs, entete, plein = false }: {
  tenantId: string;
  workflow: WorkflowSummary;
  departs: Depart[] | null;
  entete: ReactNode;
  plein?: boolean;
}) {
  // MBA actif chez le tenant ? Gouverne l'activation des blocs MBA (grisés sinon) dans le builder. Défaut prudent : false.
  const [mbaEnabled, setMbaEnabled] = useState(false);
  const [rcsEnabled, setRcsEnabled] = useState(false);
  // Au moins une boîte SMTP connectée ? Gouverne le bloc « Envoi de mail » (grisé sinon), même doctrine que RCS.
  // Dérivé de `listEmailAccounts` (pas de `getSettings`, contrairement à rcsEnabled) : contrairement à l'agent
  // RCS, une boîte email n'a pas de réglage tenant dédié, sa seule preuve d'existence est la liste elle-même.
  const [emailEnabled, setEmailEnabled] = useState(false);
  // Agents IA ACTIFS : gouverne la brique « Agent IA » (grisée tant que la liste est vide) et alimente son
  // sélecteur. `null` tant que la lecture n'a pas abouti, pour ne pas affirmer qu'un agent a disparu.
  const [agents, setAgents] = useState<AgentResume[] | null>(null);
  /**
   * Les MEMBRES de l'équipe, pour le sélecteur du bloc « passer à un humain ».
   *
   * ⚠️ Les comptes RÉVOQUÉS et les invitations EN ATTENTE sont retirés : affecter une conversation à
   * quelqu'un qui ne peut pas se connecter la rendrait invisible de tous les autres, ce qui est exactement
   * la conversation qu'on ne veut pas perdre. Le serveur refuse de toute façon, mais proposer un nom qu'il
   * refusera est une invitation à l'échec.
   */
  const [membres, setMembres] = useState<AdminUser[] | null>(null);
  /** Les appels de Tools > Connecteurs API : ils GATENT le bloc « Appel API » et alimentent son sélecteur. */
  const [requetes, setRequetes] = useState<Array<RequeteApi & { systeme?: string }> | null>(null);
  const test = useTestDeScenario(tenantId);

  useEffect(() => {
    void getSettings(tenantId).then((s) => { setMbaEnabled(s.mbaEnabled); setRcsEnabled(s.rcsEnabled === true); }).catch(() => {});
    void listEmailAccounts(tenantId).then((r) => setEmailEnabled(r.accounts.length > 0)).catch(() => {});
    void listAgents(tenantId).then(setAgents).catch(() => {});
    // Échec silencieux comme pour les agents : le sélecteur s'affiche vide, l'éditeur reste utilisable.
    void listUsers(tenantId)
      .then((r) => setMembres(r.users.filter((u) => !u.disabled && !u.pending)))
      .catch(() => {});
    /**
     * Chaque appel porte le NOM DE SON SYSTÈME (2026-11-11) : deux appels de même nom et de même chemin, l'un vers
     * l'essai et l'autre vers la production, étaient indiscernables dans le bloc « Appel API ». Systèmes illisibles :
     * la liste reste, sans le nom.
     */
    void Promise.all([listRequetes(tenantId), listSources(tenantId).catch(() => [])])
      .then(([r, sources]) => setRequetes(r.requetes.map((q) => ({ ...q, systeme: sources.find((s) => s.id === q.sourceId)?.label }))))
      .catch(() => {});
  }, [tenantId]);

  /**
   * ⚠️ STABLE (seconde passe de revue finale, 2026-09-16). Le constructeur mémoïse la valeur du contexte que TOUS ses
   * blocs consomment ; une flèche écrite en ligne dans le JSX changeait d'identité à chaque rendu, ce qui rendait cette
   * mémoïsation inerte et faisait re-rendre le canevas entier. Les deux moitiés doivent tenir.
   */
  const { tester } = test;
  const ouvrirTestDepuisBloc = useCallback((nodeId: string) => {
    void tester(workflow, nodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow]);

  return (
    <div className={plein ? 'flex flex-col gap-3 p-3 lg:h-full' : 'flex flex-col gap-3'} data-testid="scenario-ouvert">
      {entete}
      {test.erreur && <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700">{test.erreur}</p>}
      <div className={plein ? 'min-h-0 flex-1' : 'flex h-[80vh] min-h-[480px] flex-col'}>
        {/* L'éditeur ouvre le BROUILLON s'il y en a un (lot 7) : c'est le travail en cours de l'auteur, pas
            forcément ce qui tourne. `brouillonInitial` allume le bouton « Publier » dès l'ouverture. */}
        <WorkflowBuilder
          key={workflow.id} tenantId={tenantId} workflowId={workflow.id} initialGraph={grapheEditable(workflow)}
          brouillonInitial={Boolean(workflow.draftGraph)} publieLe={workflow.publishedAt ?? null} mbaEnabled={mbaEnabled}
          rcsEnabled={rcsEnabled} emailEnabled={emailEnabled} agents={agents} membres={membres} requetes={requetes}
          onTesterBloc={ouvrirTestDepuisBloc} departs={departs ?? undefined} {...(workflow.rayon ? { rayon: workflow.rayon } : {})}
        />
      </div>
      {test.panneau}
    </div>
  );
}

/**
 * LE SCÉNARIO D'UNE AUTOMATION, DÉPLIÉ SOUS SA LISTE (Shopify et HubSpot, Julien, 2026-11-20) : ouvert par son identifiant
 * (la route le rend quel que soit son rayon), avec son nom et « Fermer », qui le replie. Une seule automation dépliée à la
 * fois : l'appelant passe la clé de celle qu'il montre.
 */
export function ScenarioDeLAutomation({ tenantId, workflowId, onFermer }: {
  tenantId: string;
  workflowId: string;
  onFermer: () => void;
}) {
  const t = useT();
  const [lu, setLu] = useState<{ workflow: WorkflowSummary; departs: Depart[] | null } | 'lecture' | string>('lecture');
  useEffect(() => {
    let vivant = true;
    setLu('lecture');
    getWorkflow(tenantId, workflowId)
      .then((r) => { if (vivant) setLu({ workflow: r.workflow, departs: r.departs ?? null }); })
      .catch((err: unknown) => { if (vivant) setLu(err instanceof Error ? err.message : t('Ouverture impossible', 'Unable to open')); });
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, workflowId]);

  // Le scénario lu, l'écran y descend et le titre prend le focus : sous une longue liste, ou sur un petit écran, le clic
  // semblerait sinon ne rien faire (la plainte d'origine : « les gens ne voient pas »).
  const titre = useRef<HTMLHeadingElement>(null);
  const charge = typeof lu === 'object';
  useEffect(() => {
    if (!charge) return;
    titre.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    titre.current?.focus({ preventScroll: true });
  }, [charge]);

  const fermer = (
    <Bouton type="button" variante="secondaire" taille="petite" onClick={onFermer} data-testid="scenario-ouvert-fermer">
      {t('Fermer', 'Close')}
    </Bouton>
  );
  if (lu === 'lecture') return <div className="mt-4"><Squelette forme="lignes" /></div>;
  if (typeof lu === 'string') {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700" data-testid="scenario-ouvert-erreur">
        {lu}{fermer}
      </div>
    );
  }
  return (
    <div className="mt-4">
      <ScenarioOuvert
        tenantId={tenantId} workflow={lu.workflow} departs={lu.departs}
        entete={(
          <div className="flex items-center justify-between gap-3">
            <h2 ref={titre} tabIndex={-1} className="scroll-mt-4 text-base font-semibold text-ink-900 outline-none" data-testid="scenario-ouvert-nom">{lu.workflow.name}</h2>
            {fermer}
          </div>
        )}
      />
    </div>
  );
}
