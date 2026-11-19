'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { cardCls, inputClsAuto } from '@/lib/ui';
import { Toggle } from '@/components/Toggle';
import { routeInconnue } from '@/lib/canaux-services';
import { lireShopify, reglerLigneShopify, type EtatShopifyVue } from '@/lib/api-shopify';
import {
  DELAI_PANIER_DEFAUT, DELAIS_PROPOSES, EVENEMENTS_SHOPIFY, LIBELLES_EVENEMENTS, type EvenementShopify,
} from '@/lib/partage/shopify-messages';
import { delaiEnClair, etatDeLAutomation, type EtatAutomation } from '@/lib/shopify-lignes';

/**
 * LES AUTOMATIONS SHOPIFY, EN TÊTE DE L'ÉCRAN AUTOMATION (menu « Scénario », lot 5, appel A8) : une ligne par événement,
 * son interrupteur, son état, le délai du panier, et son scénario, où se règle le message (le premier bloc, verrouillé).
 * Le premier allumage crée le scénario et l'ouvre dans le builder ; éteindre arrête ses parcours.
 *
 * Visible avec une boutique, et rien sinon : ni pour un rôle qui ne lit pas la carte (une route d'administrateur), ni
 * quand l'API ne connaît pas la route. La pause et la coupure se règlent dans Tools > Intégrations ; la section les dit.
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
  const [vue, setVue] = useState<EtatShopifyVue | null>(null);
  const [enCours, setEnCours] = useState<EvenementShopify | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Une panne de lecture (un manager, une API d'avant le connecteur, Meta) cache la section : la carte d'Intégrations,
  // elle, dit l'erreur à l'administrateur.
  const recharger = useCallback(() => lireShopify(tenantId).then(setVue).catch(() => setVue(null)), [tenantId]);
  useEffect(() => { void recharger(); }, [recharger]);

  const b = vue?.boutique ?? null;
  if (vue === null || b === null) return null;

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
      <h2 className="text-sm font-semibold text-ink-900">{t('Shopify', 'Shopify')}</h2>
      <p className="mt-1 max-w-prose text-sm text-ink-500">
        {t(
          'Les messages de votre boutique. Chacun est un scénario : son premier bloc est le message envoyé, la suite répond au client.',
          'Your store’s messages. Each one is a scenario: its first block is the message sent, the rest answers the customer.',
        )}
      </p>
      {b.etat === 'coupee' ? (
        <p className="mt-2 text-sm text-ink-900" data-testid="automations-shopify-coupee">
          {t('Boutique coupée : rien ne part. Rebranchez-la dans ', 'Store cut: nothing goes out. Reconnect it in ')}
          <Link href="/integrations#integration-shopify" className="text-brand-600 hover:underline">{t('Tools > Intégrations', 'Tools > Integrations')}</Link>.
        </p>
      ) : (
        <>
          {b.pauseLe !== null && (
            <p className="mt-2 text-sm text-ink-900" data-testid="automations-shopify-pause">
              {t('Boutique en pause : rien ne part. Reprenez-la dans ', 'Store paused: nothing goes out. Resume it in ')}
              <Link href="/integrations#integration-shopify" className="text-brand-600 hover:underline">{t('Tools > Intégrations', 'Tools > Integrations')}</Link>.
            </p>
          )}
          <ul className="mt-3 divide-y divide-ink-100 rounded-controle border border-ink-200">
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
        </>
      )}
      {erreur && <p className="mt-2 text-sm text-danger" data-testid="automations-shopify-erreur">{erreur}</p>}
    </section>
  );
}
