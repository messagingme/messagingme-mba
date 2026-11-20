'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import {
  attesterShopify, lireShopify, reglerLigneShopify, type ApercuLigneShopify, type AttestationShopify, type EtatShopifyVue,
} from '@/lib/api-shopify';
import {
  DELAI_PANIER_DEFAUT, DELAIS_PROPOSES, EVENEMENTS_SHOPIFY, LIBELLES_EVENEMENTS, type EvenementShopify,
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
  const router = useRouter();
  /** `lecture` jusqu'à la première réponse ; `panne` si elle échoue ou ne se lit pas (une API sans la route comprise). */
  const [vue, setVue] = useState<EtatShopifyVue | 'lecture' | 'panne'>('lecture');
  const [enCours, setEnCours] = useState<EvenementShopify | null>(null);
  /** L'erreur d'un réglage, dite sur la ligne de son interrupteur (un allumage sans attestation : 409). */
  const [erreur, setErreur] = useState<{ evenement: EvenementShopify; texte: string } | null>(null);

  const recharger = useCallback(() => lireShopify(tenantId).then((v) => setVue(v ?? 'panne')).catch(() => setVue('panne')), [tenantId]);
  useEffect(() => { void recharger(); }, [recharger]);

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

  const regler = async (e: EvenementShopify, corps: { actif: boolean; delaiMinutes?: number }): Promise<void> => {
    setEnCours(e);
    setErreur(null);
    const premierAllumage = corps.actif && !vue.lignes.some((l) => l.evenement === e);
    try {
      const r = await reglerLigneShopify(tenantId, e, corps);
      // Le premier allumage crée le scénario et l'OUVRE dans le builder (spec § 2.1) : son premier bloc attend son message.
      const workflowId = (r?.ligne as { workflowId?: unknown } | null | undefined)?.workflowId;
      if (premierAllumage && typeof workflowId === 'string') {
        router.push(`/workflows?open=${encodeURIComponent(workflowId)}`);
        return;
      }
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
          {t('Boutique coupée : rien ne part. Rebranchez-la dans ', 'Store cut: nothing goes out. Reconnect it in ')}
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
            {EVENEMENTS_SHOPIFY.map((e) => {
              const l = vue.lignes.find((x) => x.evenement === e);
              const etat = etatDeLAutomation(l);
              const allumee = l?.actif === true;
              const nom = t(...LIBELLES_EVENEMENTS[e]);
              return (
                <li key={e} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-testid={`automations-shopify-${e}`}>
                  <Toggle
                    checked={allumee} onChange={() => void regler(e, { actif: !allumee })} disabled={enCours !== null}
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
                  {e === 'checkout_abandoned' && l !== undefined && (
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
                      data-testid={`automations-shopify-ouvrir-${e}`}
                    >
                      {t('Ouvrir le scénario', 'Open the scenario')}
                    </Link>
                  )}
                  {erreur?.evenement === e && (
                    <p className="basis-full text-sm text-danger" data-testid="automations-shopify-erreur">{erreur.texte}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
