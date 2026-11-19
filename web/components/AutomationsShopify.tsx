'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { cardCls, inputClsAuto } from '@/lib/ui';
import { Toggle } from '@/components/Toggle';
import { Squelette } from '@/components/Squelette';
import { routeInconnue } from '@/lib/canaux-services';
import { lireShopify, reglerLigneShopify, type EtatShopifyVue } from '@/lib/api-shopify';
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
 */
const ETATS: Record<EtatAutomation, readonly [string, string]> = {
  a_creer: ['pas encore créée', 'not created yet'],
  eteinte: ['éteinte', 'off'],
  a_completer: ['à compléter : choisissez son message dans le scénario', 'to complete: choose its message in the scenario'],
  en_validation: ['en validation chez Meta', 'awaiting Meta’s approval'],
  refuse: ['message refusé ou bloqué par Meta : changez-le dans le scénario', 'message refused or blocked by Meta: change it in the scenario'],
  active: ['active', 'active'],
  active_nouvelle_version: ['active, nouvelle version en validation chez Meta', 'active, new version awaiting Meta’s approval'],
  meta_non_lu: ['allumée, l’état de son message chez Meta n’a pas pu être lu', 'on, its message status at Meta could not be read'],
};
const ETATS_EN_SERVICE: readonly EtatAutomation[] = ['active', 'active_nouvelle_version'];

export function AutomationsShopify({ tenantId }: { tenantId: string }) {
  const t = useT();
  const router = useRouter();
  /** `lecture` jusqu'à la première réponse ; `panne` si elle échoue ou ne se lit pas (une API sans la route comprise). */
  const [vue, setVue] = useState<EtatShopifyVue | 'lecture' | 'panne'>('lecture');
  const [enCours, setEnCours] = useState<EvenementShopify | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

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
      setErreur(routeInconnue(err)
        ? t('La console est plus récente que l’API : réessayez dans quelques minutes.', 'The console is newer than the API: try again in a few minutes.')
        : err instanceof Error ? err.message : t('Réglage impossible', 'Unable to save'));
    } finally {
      setEnCours(null);
    }
  };

  const delaiPanier = b.delaiPanierMinutes ?? DELAI_PANIER_DEFAUT;
  // Un délai réglé par Claude Code hors des propositions (90 min) reste choisi, à sa place.
  const delais = DELAIS_PROPOSES.includes(delaiPanier) ? DELAIS_PROPOSES : [...DELAIS_PROPOSES, delaiPanier].sort((x, y) => x - y);

  return (
    <section className={cardCls} data-testid="automations-shopify">
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
                  <span className="font-medium text-ink-900">{nom}</span>
                  <span className={ETATS_EN_SERVICE.includes(etat) ? 'text-succes-700' : 'text-ink-500'} data-testid={`automations-shopify-etat-${e}`}>
                    {t(...ETATS[etat])}
                  </span>
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
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {erreur && <p className="mt-2 text-sm text-danger" data-testid="automations-shopify-erreur">{erreur}</p>}
    </section>
  );
}
