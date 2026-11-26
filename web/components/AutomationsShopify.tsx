'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { cardCls, inputClsAuto } from '@/lib/ui';
import { formatDate } from '@/lib/day';
import { Bouton } from '@/components/Bouton';
import { Toggle } from '@/components/Toggle';
import { CaseAttestationShopify } from '@/components/ShopifyBrancher';
import { Squelette } from '@/components/Squelette';
import { TemplateBodyText } from '@/components/WhatsAppPreview';
import { routeInconnue } from '@/lib/canaux-services';
import { listAgents, type AgentResume } from '@/lib/api-agent';
import { ScenarioDeLAutomation } from '@/components/ScenarioOuvert';
import { clicSurPlace } from '@/lib/ouvrir-sur-place';
import {
  attesterShopify, lireShopify, reglerLigneShopify, type ApercuLigneShopify, type AttestationShopify, type AvertissementLigneShopify,
  type EtatShopifyVue, type LigneShopifyVue,
} from '@/lib/api-shopify';
import {
  AUTOMATIONS_SHOPIFY, DELAI_PANIER_DEFAUT, DELAIS_PROPOSES, LIBELLES_AUTOMATIONS, LIGNE_PANIER_AGENT, LIGNES_DU_PANIER, autreRelanceDuPanier,
  type AutomationShopify,
} from '@/lib/partage/shopify-messages';
import { delaiEnClair, etatDeLAutomation, type EtatAutomation } from '@/lib/shopify-lignes';

/**
 * LES AUTOMATIONS SHOPIFY, LE CORPS DE SCÉNARIO > AUTOMATION > SHOPIFY (menu « Scénario », lot 5, puis sa page au lot 7) :
 * une ligne par événement, son interrupteur, son état, le délai du panier, et son scénario, où se règle le message (le
 * premier bloc, verrouillé). Le premier allumage crée le scénario et l'ouvre dans le builder ; éteindre arrête ses
 * parcours.
 *
 * Sur sa propre page, elle dit chaque cas plutôt que de disparaître : on y arrive aussi par un lien ou par l'aide, sans
 * boutique (le chemin pour la brancher), ou quand la lecture échoue. La pause et la coupure se règlent dans Tools >
 * Intégrations ; la page les dit.
 *
 * Le message en vigueur se voit au survol et au focus d'une ligne (spec 2026-11-20) : une bulle WhatsApp, ses données
 * remplacées par leurs exemples. Le libellé et l'état de la ligne mènent à son scénario ; l'interrupteur et le délai du
 * panier restent à part, leurs clics ne quittent pas la page.
 *
 * L'attestation du consentement des clients (2026-11-20) en tête : sans elle, le serveur refuse tout allumage (409, dit
 * sur la ligne) ; la retirer éteint les trois automations, d'où la confirmation. Une API qui ne la rend pas encore : pas
 * de case, rien ne change.
 */
const ETATS: Record<EtatAutomation, readonly [string, string]> = {
  a_creer: ['pas encore créée', 'not created yet'],
  eteinte: ['éteinte', 'off'],
  prete: ['prête : allumez-la pour l’envoyer', 'ready: turn it on to send it'],
  eteinte_en_validation: ['éteinte, message en validation chez Meta', 'off, message under review at Meta'],
  a_completer: ['à compléter : choisissez son message dans le scénario', 'to complete: choose its message in the scenario'],
  en_validation: ['en validation chez Meta', 'awaiting Meta’s approval'],
  refuse: ['message refusé ou bloqué par Meta : changez-le dans le scénario', 'message refused or blocked by Meta: change it in the scenario'],
  active: ['active', 'active'],
  active_nouvelle_version: ['active, nouvelle version en validation chez Meta', 'active, new version awaiting Meta’s approval'],
  meta_non_lu: ['allumée, l’état de son message chez Meta n’a pas pu être lu', 'on, its message status at Meta could not be read'],
};
const ETATS_EN_SERVICE: readonly EtatAutomation[] = ['active', 'active_nouvelle_version'];

/** Les avertissements de la relance avec agent IA (spec 2026-11-20, § 5.3) : rien n'est bloqué, la ligne le dit. */
const AVERTISSEMENTS: Record<AvertissementLigneShopify, readonly [string, string]> = {
  bouton_absent: [
    'Le bouton « Vous avez une question ? » ne mène plus à l’agent IA : reliez-le dans le scénario.',
    'The “Have a question?” button no longer leads to the AI agent: connect it in the scenario.',
  ],
  agent_inactif: [
    'Son agent IA n’est plus actif : les questions iront à votre équipe. Choisissez un agent actif.',
    'Its AI agent is no longer active: questions will go to your team. Choose an active agent.',
  ],
  modele_en_attente: [
    'Son message attend la validation de Meta : aucun panier n’est relancé d’ici là.',
    'Its message is awaiting Meta’s approval: no checkout is reminded until then.',
  ],
  modele_refuse: [
    'Meta a refusé son message : aucun panier n’est relancé. Changez-le dans le scénario, ou rallumez la relance normale.',
    'Meta refused its message: no checkout is reminded. Change it in the scenario, or turn the regular reminder back on.',
  ],
};

/**
 * LE CHOIX DE L'AGENT DE LA RELANCE AVEC AGENT IA (Julien, 2026-11-20) : demandé à l'allumage, parmi les agents ACTIFS, et
 * modifiable une fois allumée. Sans agent actif, l'écran dit d'en créer un.
 */
function ChoixDeLAgent({ agents, actuel, libelle, disabled, onChoix, onAnnuler, testid }: {
  agents: AgentResume[];
  actuel: string | null;
  libelle: string;
  disabled: boolean;
  onChoix: (agentId: string) => void;
  onAnnuler?: () => void;
  testid: string;
}) {
  const t = useT();
  const [choisi, setChoisi] = useState<string>(actuel !== null && agents.some((a) => a.id === actuel) ? actuel : (agents[0]?.id ?? ''));
  return (
    <span className="flex flex-wrap items-center gap-2 text-ink-500" data-testid={testid}>
      {t('Agent IA', 'AI agent')}
      <select value={choisi} disabled={disabled} className={inputClsAuto} data-testid={`${testid}-liste`} onChange={(ev) => setChoisi(ev.target.value)}>
        {agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
      </select>
      <Bouton type="button" taille="petite" disabled={disabled || choisi === '' || choisi === actuel} data-testid={`${testid}-valider`} onClick={() => onChoix(choisi)}>
        {libelle}
      </Bouton>
      {onAnnuler && (
        <Bouton type="button" variante="secondaire" taille="petite" data-testid={`${testid}-annuler`} onClick={onAnnuler}>{t('Annuler', 'Cancel')}</Bouton>
      )}
    </span>
  );
}

/**
 * La bulle du message, sous le libellé de sa ligne. En CSS seul, comme `CaptureAuSurvol` : le parent porte `group`, et
 * elle ne prend pas la souris (`pointer-events-none`), sinon, ouverte, elle couvrirait la ligne suivante.
 */
function BulleDuMessage({ id, apercu, testid }: { id: string; apercu: ApercuLigneShopify; testid: string }) {
  const t = useT();
  return (
    <span
      id={id} role="tooltip" data-testid={testid}
      className="pointer-events-none invisible absolute left-0 top-full z-20 mt-1 w-72 max-w-[80vw] rounded-carte border border-ink-200 bg-[#efeae2] p-3 opacity-0 shadow-mm-md transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
    >
      <span className="block rounded-controle rounded-tl-none bg-white px-2.5 py-1.5 shadow-sm">
        <span className="block whitespace-pre-wrap break-words text-[13px] leading-snug text-ink-900">
          <TemplateBodyText body={apercu.corps} examples={apercu.exemples} />
        </span>
        {apercu.pied !== null && apercu.pied.trim() !== '' && (
          <span className="mt-1 block break-words text-[11px] leading-snug text-ink-500">{apercu.pied}</span>
        )}
      </span>
      {apercu.enValidation && (
        <span className="mt-2 block text-xs text-ink-500">{t('En validation chez Meta', 'Under review at Meta')}</span>
      )}
    </span>
  );
}

/** Le bandeau de l'attestation : la case, et une fois cochée, quand et par qui ; la décocher se confirme sur place. */
function BandeauAttestation({ tenantId, attestation, onChange }: {
  tenantId: string;
  attestation: AttestationShopify | null;
  onChange: () => Promise<void>;
}) {
  const t = useT();
  const { locale } = useLocale();
  /** La valeur en cours d'envoi, montée tout de suite dans la case ; `null` hors envoi. */
  const [envoi, setEnvoi] = useState<boolean | null>(null);
  const [retrait, setRetrait] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const attestee = attestation !== null && attestation.coche;

  const envoyer = async (coche: boolean): Promise<void> => {
    setRetrait(false);
    setEnvoi(coche);
    setErreur(null);
    try {
      await attesterShopify(tenantId, coche, locale);
      // Relire : retirer l'attestation éteint les lignes côté serveur.
      await onChange();
    } catch (e: unknown) {
      setErreur(e instanceof Error ? e.message : t('Enregistrement impossible', 'Unable to save'));
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <div
      className={`mb-3 rounded-controle border px-3 py-2 ${attestee ? 'border-ink-200' : 'border-brand-200 bg-brand-50'}`}
      data-testid="automations-shopify-attestation"
    >
      <CaseAttestationShopify
        coche={envoi ?? attestee} disabled={envoi !== null || retrait} testid="automations-shopify-attestation-case"
        onChange={(c) => { if (c) void envoyer(true); else setRetrait(true); }}
      />
      {attestee ? (
        <p className="mt-1 pl-6 text-xs text-ink-500" data-testid="automations-shopify-attestation-par">
          {t('Attestée le ', 'Confirmed on ')}{formatDate(attestation.le, locale, { day: 'numeric', month: 'long', year: 'numeric' })}
          {attestation.email ? t(` par ${attestation.email}`, ` by ${attestation.email}`) : ''}
        </p>
      ) : (
        <p className="mt-1 pl-6 text-xs text-ink-500">{t('Cochez-la pour allumer vos automations.', 'Tick it to turn your automations on.')}</p>
      )}
      {retrait && (
        <span role="group" data-testid="confirmation-en-ligne" className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
          <span className="text-xs text-ink-900">{t('Retirer l’attestation éteint vos trois automations.', 'Withdrawing the confirmation turns your three automations off.')}</span>
          <Bouton type="button" taille="petite" data-testid="confirmation-oui" onClick={() => void envoyer(false)}>{t('Confirmer', 'Confirm')}</Bouton>
          <Bouton type="button" variante="secondaire" taille="petite" data-testid="confirmation-non" onClick={() => setRetrait(false)}>{t('Annuler', 'Cancel')}</Bouton>
        </span>
      )}
      {erreur && <p className="mt-1 pl-6 text-sm text-danger" data-testid="automations-shopify-attestation-erreur">{erreur}</p>}
    </div>
  );
}

export function AutomationsShopify({ tenantId }: { tenantId: string }) {
  const t = useT();
  /** `lecture` jusqu'à la première réponse ; `panne` si elle échoue ou ne se lit pas (une API sans la route comprise). */
  const [vue, setVue] = useState<EtatShopifyVue | 'lecture' | 'panne'>('lecture');
  const [enCours, setEnCours] = useState<AutomationShopify | null>(null);
  /** L'erreur d'un réglage, dite sur la ligne de son interrupteur (un allumage sans attestation : 409). */
  const [erreur, setErreur] = useState<{ evenement: AutomationShopify; texte: string } | null>(null);
  /** La relance éteinte par l'allumage de l'autre (elles s'excluent), dite sur la ligne allumée. */
  const [remplacee, setRemplacee] = useState<{ evenement: AutomationShopify; eteinte: AutomationShopify } | null>(null);
  /** Les agents IA ACTIFS de l'espace, pour la relance avec agent ; `null` tant qu'ils ne sont pas lus. Illisibles : aucun. */
  const [agents, setAgents] = useState<AgentResume[] | null>(null);
  /** Le choix de l'agent ouvert par l'interrupteur de la relance avec agent, avant d'allumer. */
  const [choixOuvert, setChoixOuvert] = useState(false);
  /** Le scénario déplié sous la liste (2026-11-20) : un seul à la fois ; `null` replié. */
  const [ouvert, setOuvert] = useState<string | null>(null);

  const recharger = useCallback(() => lireShopify(tenantId).then((v) => setVue(v ?? 'panne')).catch(() => setVue('panne')), [tenantId]);
  useEffect(() => { void recharger(); }, [recharger]);
  useEffect(() => {
    listAgents(tenantId).then((a) => setAgents(a.filter((x) => x.status === 'active'))).catch(() => setAgents([]));
  }, [tenantId]);

  if (vue === 'lecture') return <Squelette forme="lignes" />;
  if (vue === 'panne') {
    return (
      <p className="rounded-controle bg-danger-50 px-3 py-2 text-sm text-danger-700" data-testid="automations-shopify-panne">
        {t('Vos automations Shopify n’ont pas pu être lues. Réessayez dans un instant.', 'Your Shopify automations could not be read. Try again shortly.')}
      </p>
    );
  }
  const b = vue.boutique;
  if (b === null) {
    return (
      <section className={cardCls} data-testid="automations-shopify-sans-boutique">
        <p className="text-sm text-ink-900">
          {t('Aucune boutique Shopify n’est branchée à votre espace. Branchez-la dans ', 'No Shopify store is connected to your workspace. Connect it in ')}
          <Link href="/integrations#integration-shopify" className="text-brand-600 hover:underline">{t('Tools > Intégrations', 'Tools > Integrations')}</Link>
          {t(' : ses trois automations s’allument ensuite ici.', ': its three automations are then switched on here.')}
        </p>
      </section>
    );
  }

  const regler = async (e: AutomationShopify, corps: { actif: boolean; delaiMinutes?: number; agentId?: string }): Promise<void> => {
    setEnCours(e);
    setErreur(null);
    setRemplacee(null);
    const premierAllumage = corps.actif && !vue.lignes.some((l) => l.evenement === e);
    // Les deux relances du panier s'excluent : allumer l'une éteint l'autre (Julien, 2026-11-20), et l'écran le dit.
    const autre = autreRelanceDuPanier(e);
    const autreAllumee = corps.actif && autre !== null && vue.lignes.some((l) => l.evenement === autre && l.actif);
    try {
      const r = await reglerLigneShopify(tenantId, e, corps);
      setChoixOuvert(false);
      if (autreAllumee && autre !== null) setRemplacee({ evenement: e, eteinte: autre });
      // Le premier allumage crée le scénario et le DÉPLIE sous la liste (spec § 2.1, sur place depuis le 2026-11-20) : son
      // premier bloc attend son message. Pas celui de la relance avec agent : son scénario naît complet.
      const workflowId = (r?.ligne as { workflowId?: unknown } | null | undefined)?.workflowId;
      if (premierAllumage && e !== LIGNE_PANIER_AGENT && !autreAllumee && typeof workflowId === 'string') setOuvert(workflowId);
      await recharger();
    } catch (err: unknown) {
      setErreur({
        evenement: e,
        texte: routeInconnue(err)
          ? t('La console est plus récente que l’API : réessayez dans quelques minutes.', 'The console is newer than the API: try again in a few minutes.')
          : err instanceof Error ? err.message : t('Réglage impossible', 'Unable to save'),
      });
    } finally {
      setEnCours(null);
    }
  };

  const delaiPanier = b.delaiPanierMinutes ?? DELAI_PANIER_DEFAUT;
  // Un délai réglé par Claude Code hors des propositions (90 min) reste choisi, à sa place.
  const delais = DELAIS_PROPOSES.includes(delaiPanier) ? DELAIS_PROPOSES : [...DELAIS_PROPOSES, delaiPanier].sort((x, y) => x - y);

  return (
    <section className={cardCls} data-testid="automations-shopify">
      {b.etat !== 'coupee' && vue.attestation !== 'inconnue' && (
        <BandeauAttestation tenantId={tenantId} attestation={vue.attestation} onChange={recharger} />
      )}
      {b.etat === 'coupee' ? (
        <p className="text-sm text-ink-900" data-testid="automations-shopify-coupee">
          {t('Boutique débranchée : rien ne part. Rebranchez-la dans ', 'Store disconnected: nothing goes out. Reconnect it in ')}
          <Link href="/integrations#integration-shopify" className="text-brand-600 hover:underline">{t('Tools > Intégrations', 'Tools > Integrations')}</Link>.
        </p>
      ) : (
        <div className="space-y-3">
          {b.pauseLe !== null && (
            <p className="text-sm text-ink-900" data-testid="automations-shopify-pause">
              {t('Boutique en pause : rien ne part. Reprenez-la dans ', 'Store paused: nothing goes out. Resume it in ')}
              <Link href="/integrations#integration-shopify" className="text-brand-600 hover:underline">{t('Tools > Intégrations', 'Tools > Integrations')}</Link>.
            </p>
          )}
          <ul className="divide-y divide-ink-100 rounded-controle border border-ink-200">
            {AUTOMATIONS_SHOPIFY.map((e) => {
              const l: LigneShopifyVue | undefined = vue.lignes.find((x) => x.evenement === e);
              const etat = etatDeLAutomation(l);
              const allumee = l?.actif === true;
              const nom = t(...LIBELLES_AUTOMATIONS[e]);
              const avecAgent = e === LIGNE_PANIER_AGENT;
              // Sans agent IA actif, la relance avec agent ne s'allume pas : l'interrupteur est grisé (l'éteindre reste permis).
              const sansAgent = avecAgent && !allumee && agents !== null && agents.length === 0;
              const basculer = (): void => {
                if (avecAgent && !allumee) { setChoixOuvert(true); return; }
                void regler(e, { actif: !allumee });
              };
              return (
                <li key={e} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-testid={`automations-shopify-${e}`}>
                  <Toggle
                    checked={allumee} onChange={basculer} disabled={enCours !== null || sansAgent || (avecAgent && !allumee && agents === null)}
                    libelle={nom} testid={`automations-shopify-interrupteur-${e}`}
                  />
                  {l === undefined ? (
                    <>
                      <span className="font-medium text-ink-900">{nom}</span>
                      <span className="text-ink-500" data-testid={`automations-shopify-etat-${e}`}>{t(...ETATS[etat])}</span>
                    </>
                  ) : (
                    <span className="group relative flex flex-wrap items-center">
                      <Link
                        href={`/workflows?open=${encodeURIComponent(l.workflowId)}`} className="flex flex-wrap items-center gap-3 rounded-controle"
                        onClick={(ev) => { if (clicSurPlace(ev)) setOuvert(l.workflowId); }}
                        data-testid={`automations-shopify-ligne-${e}`}
                        {...(l.apercu ? { 'aria-describedby': `automations-shopify-apercu-${e}` } : {})}
                      >
                        <span className="font-medium text-ink-900 group-hover:underline">{nom}</span>
                        <span className={ETATS_EN_SERVICE.includes(etat) ? 'text-succes-700' : 'text-ink-500'} data-testid={`automations-shopify-etat-${e}`}>
                          {t(...ETATS[etat])}
                        </span>
                      </Link>
                      {l.apercu && <BulleDuMessage id={`automations-shopify-apercu-${e}`} apercu={l.apercu} testid={`automations-shopify-apercu-${e}`} />}
                    </span>
                  )}
                  {LIGNES_DU_PANIER.includes(e) && l !== undefined && (
                    <label className="flex items-center gap-2 text-ink-500">
                      {t('Relance', 'Reminder')}
                      <select
                        value={delaiPanier} disabled={enCours !== null} className={inputClsAuto} data-testid="automations-shopify-delai"
                        onChange={(ev) => void regler(e, { actif: allumee, delaiMinutes: Number(ev.target.value) })}
                      >
                        {delais.map((m) => <option key={m} value={m}>{delaiEnClair(m)}</option>)}
                      </select>
                      {t('après la dernière modification du panier', 'after the checkout’s last change')}
                    </label>
                  )}
                  {l !== undefined && (
                    <Link
                      href={`/workflows?open=${encodeURIComponent(l.workflowId)}`} className="ml-auto text-brand-600 hover:underline"
                      onClick={(ev) => { if (clicSurPlace(ev)) setOuvert(l.workflowId); }}
                      data-testid={`automations-shopify-ouvrir-${e}`}
                    >
                      {t('Ouvrir le scénario', 'Open the scenario')}
                    </Link>
                  )}
                  {avecAgent && sansAgent && (
                    <p className="basis-full text-ink-500" data-testid="automations-shopify-sans-agent">
                      {t('Elle demande un agent IA actif, celui qui répond au bouton « Vous avez une question ? ». ', 'It needs an active AI agent, the one that answers the “Have a question?” button. ')}
                      <Link href="/agents" className="text-brand-600 hover:underline">{t('Créer un agent IA', 'Create an AI agent')}</Link>
                    </p>
                  )}
                  {avecAgent && !allumee && choixOuvert && agents !== null && agents.length > 0 && (
                    <span className="basis-full">
                      <ChoixDeLAgent
                        agents={agents} actuel={l?.agent?.id ?? null} libelle={t('Allumer', 'Turn on')} disabled={enCours !== null}
                        onChoix={(agentId) => void regler(e, { actif: true, agentId })} onAnnuler={() => setChoixOuvert(false)}
                        testid="automations-shopify-choix-agent"
                      />
                    </span>
                  )}
                  {avecAgent && allumee && agents !== null && agents.length > 0 && (
                    <span className="basis-full">
                      <ChoixDeLAgent
                        agents={agents} actuel={l?.agent?.id ?? null} libelle={t('Changer d’agent', 'Change agent')} disabled={enCours !== null}
                        onChoix={(agentId) => void regler(e, { actif: true, agentId })} testid="automations-shopify-agent"
                      />
                    </span>
                  )}
                  {avecAgent && (l?.avertissements ?? []).map((a) => (
                    <p key={a} className="basis-full text-sm text-alerte-700" data-testid={`automations-shopify-avertissement-${a}`}>{t(...AVERTISSEMENTS[a])}</p>
                  ))}
                  {remplacee?.evenement === e && (
                    <p className="basis-full text-sm text-ink-500" data-testid="automations-shopify-remplacee">
                      {t(`« ${LIBELLES_AUTOMATIONS[remplacee.eteinte][0]} » a été éteinte : un panier ne reçoit qu’une relance.`,
                        `“${LIBELLES_AUTOMATIONS[remplacee.eteinte][1]}” was turned off: a checkout gets only one reminder.`)}
                    </p>
                  )}
                  {erreur?.evenement === e && (
                    <p className="basis-full text-sm text-danger" data-testid="automations-shopify-erreur">{erreur.texte}</p>
                  )}
                </li>
              );
            })}
          </ul>
          {ouvert !== null && (
            <ScenarioDeLAutomation key={ouvert} tenantId={tenantId} workflowId={ouvert} onFermer={() => { setOuvert(null); void recharger(); }} />
          )}
        </div>
      )}
    </section>
  );
}
