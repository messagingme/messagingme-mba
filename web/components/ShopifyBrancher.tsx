'use client';

import { useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { BoutonCopier } from '@/components/doc-api/elements';
import { CaptureAuSurvol } from '@/components/CaptureAuSurvol';
import { attesterShopify, brancherShopify } from '@/lib/api-shopify';
import { routeInconnue } from '@/lib/canaux-services';
import { TEXTE_ATTESTATION_SHOPIFY } from '@/lib/partage/shopify-messages';

/**
 * BRANCHER UNE BOUTIQUE DEPUIS LA CONSOLE (conception 2026-10-22) : le mode opératoire chez Shopify, puis les clés.
 * Pour le client payant qui n'utilise pas Claude Code : aucune app publique, il crée la sienne sur le tableau de bord
 * développeur de Shopify (aucune app « personnalisée » ne se crée plus dans l'admin depuis le 2026-01-01). Les gestes
 * sont ceux mesurés avec Julien sur l'app d'essai « Messaging Me essai sans CLI ».
 *
 * 🔴 L'ADRESSE DE L'APP EST `/shopify/console/`, pas `/shopify/installe/` : Shopify l'ouvre après « Install », et
 * celle de Claude Code dit « revenez dans Claude Code ».
 */

/** Les droits de l'app, ceux de `shopify.app.toml` (la skill du plugin) : la même app, créée sans la CLI. */
export const DROITS_SHOPIFY = 'read_customers,read_orders,read_checkouts,read_fulfillments';

/**
 * LA CASE DE L'ATTESTATION (Julien, 2026-11-20) : le marchand atteste que les clients de sa boutique consentent à recevoir
 * ses messages WhatsApp. Le texte est celui que le serveur historise, dans la langue de la console, affiché tel quel.
 */
export function CaseAttestationShopify({ coche, onChange, disabled, testid }: {
  coche: boolean;
  onChange: (coche: boolean) => void;
  disabled?: boolean;
  testid: string;
}) {
  const { locale } = useLocale();
  return (
    <label className="flex items-start gap-2 text-sm text-ink-900">
      <input type="checkbox" className="mt-0.5" checked={coche} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
      <span>{TEXTE_ATTESTATION_SHOPIFY[locale]}</span>
    </label>
  );
}

export function ShopifyBrancher({ tenantId, rebrancher = false, onBranche }: {
  tenantId: string;
  /** Une boutique déjà branchée ou coupée : seules les clés sont redemandées, repliées, le mode opératoire à portée. */
  rebrancher?: boolean;
  /** `avertissement` : la boutique est branchée, mais l'attestation n'a pas pu être enregistrée (à dire au marchand). */
  onBranche: (avertissement?: string) => Promise<void>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const adresse = locale === 'en' ? 'https://app.messagingme.fr/en/shopify/console/' : 'https://app.messagingme.fr/shopify/console/';
  const [boutique, setBoutique] = useState('');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [atteste, setAtteste] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const brancher = async (): Promise<void> => {
    setEnCours(true);
    setErreur(null);
    try {
      // Le corps du branchement est validé strictement par le serveur : l'attestation part à côté, une fois branchée.
      await brancherShopify(tenantId, { boutique: boutique.trim(), clientId: clientId.trim(), secret: secret.trim() });
      setSecret('');
      let avertissement: string | undefined;
      try {
        await attesterShopify(tenantId, true, locale);
      } catch (e: unknown) {
        // Une API sans la route (console publiée avant elle) : rien à dire. Une autre panne ne défait pas le branchement.
        if (!routeInconnue(e)) {
          const raison = e instanceof Error ? e.message : t('erreur inconnue', 'unknown error');
          avertissement = t(
            `Boutique branchée, mais votre attestation n’a pas pu être enregistrée (${raison}) : cochez-la dans Scénario > Automation > Shopify.`,
            `Store connected, but your confirmation could not be saved (${raison}): tick it in Scenario > Automation > Shopify.`,
          );
        }
      }
      await onBranche(avertissement);
    } catch (e: unknown) {
      setErreur(e instanceof Error ? e.message : t('Branchement impossible', 'Unable to connect'));
    } finally {
      setEnCours(false);
    }
  };

  const ligneCopiable = (texte: string, quoi: string, testid: string) => (
    <span className="mt-1 flex items-center gap-2">
      <code className="min-w-0 break-all rounded-controle bg-ink-50 px-2 py-1 text-xs text-ink-900">{texte}</code>
      <BoutonCopier texte={texte} quoi={quoi} testid={testid} />
    </span>
  );

  const modeOperatoire = (
    <ol className="list-decimal space-y-3 pl-5 text-ink-900" data-testid="shopify-mode-operatoire">
      <li>
        {t(
          'Ouvrez le tableau de bord développeur de Shopify, connecté avec le compte qui gère votre boutique, puis Apps > Create app > Create app manually.',
          'Open the Shopify developer dashboard, signed in with the account that manages your store, then Apps > Create app > Create app manually.',
        )}{' '}
        <a href="https://dev.shopify.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">dev.shopify.com</a>
        {' · '}
        <CaptureAuSurvol
          src="/aide/shopify/1-creer-l-app.webp" testid="shopify-capture-creer"
          alt={t('Apps, puis Create app, puis Create app manually', 'Apps, then Create app, then Create app manually')}
        />
      </li>
      <li>
        {t('Dans le formulaire', 'In the form')}{' · '}
        <CaptureAuSurvol
          src="/aide/shopify/2-formulaire.webp" testid="shopify-capture-formulaire"
          alt={t('Le formulaire de l’app, ses quatre champs numérotés', 'The app form, its four numbered fields')}
        />
        <span className="mt-1 block">{t('1. App name : écrivez « Messaging Me ».', '1. App name: type “Messaging Me”.')}</span>
        <span className="mt-1 block">{t('2. App URL : collez cette adresse.', '2. App URL: paste this address.')}</span>
        {ligneCopiable(adresse, t('Adresse de l’app', 'App URL'), 'shopify-copier-adresse')}
        <span className="mt-1 block">{t('3. Décochez « Embed app in Shopify admin ».', '3. Untick “Embed app in Shopify admin”.')}</span>
        <span className="mt-1 block">
          {t(
            '4. Scopes : appuyez sur « Select from list » et cochez read_customers, read_orders, read_checkouts et read_fulfillments (ou collez la liste dans le champ).',
            '4. Scopes: click “Select from list” and tick read_customers, read_orders, read_checkouts and read_fulfillments (or paste the list in the field).',
          )}
        </span>
        {ligneCopiable(DROITS_SHOPIFY, t('Droits de l’app', 'App scopes'), 'shopify-copier-droits')}
        <span className="mt-1 block text-ink-500">{t('Laissez le reste tel quel, appuyez sur Create app en haut à droite, puis Release.', 'Leave the rest as it is, click Create app at the top right, then Release.')}</span>
      </li>
      <li>
        {t(
          'Installez l’app : menu « ⋯ » de sa ligne > Install app, choisissez votre boutique, puis Install. « This app hasn’t been reviewed » est normal : c’est votre app.',
          'Install the app: its row’s “⋯” menu > Install app, pick your store, then Install. “This app hasn’t been reviewed” is expected: it is your own app.',
        )}
      </li>
      <li>
        {t(
          'Dans Apps, cliquez sur l’app Messaging Me : le Client ID et le Client secret sont dans le cadre Credentials, à droite. Copiez-les, puis collez-les ci-dessous.',
          'In Apps, click the Messaging Me app: the Client ID and the Client secret are in the Credentials box, on the right. Copy them, then paste them below.',
        )}{' '}
        <CaptureAuSurvol
          src="/aide/shopify/3-cles-de-l-app.webp" testid="shopify-capture-cles"
          alt={t('La page de l’app, cadre Credentials', 'The app page, Credentials box')}
        />
      </li>
    </ol>
  );

  const formulaire = (
    <>
      {rebrancher ? (
        <details>
          <summary className="cursor-pointer text-brand-600">{t('Recréer l’app chez Shopify', 'Create the app again at Shopify')}</summary>
          <div className="mt-2">{modeOperatoire}</div>
        </details>
      ) : (
        <div>
          <p className="font-medium text-ink-900">{t('Étape 1, chez Shopify (5 minutes)', 'Step 1, at Shopify (5 minutes)')}</p>
          <div className="mt-2">{modeOperatoire}</div>
        </div>
      )}
      <div>
        <p className="font-medium text-ink-900">{rebrancher ? t('Rebrancher la boutique', 'Reconnect the store') : t('Étape 2, ici', 'Step 2, here')}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <label className="block text-sm text-ink-900">
            {t('Boutique', 'Store')}
            <input
              data-testid="shopify-boutique" value={boutique} onChange={(e) => setBoutique(e.target.value)}
              placeholder="ma-boutique.myshopify.com" autoComplete="off" className={`${inputCls} mt-1`}
            />
          </label>
          <label className="block text-sm text-ink-900">
            Client ID
            <input data-testid="shopify-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-sm text-ink-900">
            Client secret
            <input
              type="password" autoComplete="new-password" data-testid="shopify-secret"
              value={secret} onChange={(e) => setSecret(e.target.value)} className={`${inputCls} mt-1`}
            />
          </label>
        </div>
        <div className="mt-3" data-testid="shopify-attestation">
          <CaseAttestationShopify coche={atteste} onChange={setAtteste} disabled={enCours} testid="shopify-attestation-case" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Bouton
            type="button" onClick={() => void brancher()} enCours={enCours}
            disabled={enCours || !atteste || !boutique.trim() || !clientId.trim() || !secret.trim()} data-testid="shopify-brancher-valider"
          >
            {t('Brancher la boutique', 'Connect the store')}
          </Bouton>
          {!atteste && (
            <span className="text-ink-500" data-testid="shopify-attestation-raison">
              {t('Cochez l’attestation pour brancher la boutique.', 'Tick the confirmation to connect the store.')}
            </span>
          )}
        </div>
        {erreur && <p className="mt-2 text-danger" data-testid="shopify-brancher-erreur">{erreur}</p>}
      </div>
    </>
  );

  if (rebrancher) {
    return (
      <details className="mt-2 text-sm" data-testid="shopify-rebrancher">
        <summary className="cursor-pointer text-brand-600">{t('Rebrancher la boutique (nouvelles clés, ou événements à réabonner)', 'Reconnect the store (new keys, or events to subscribe again)')}</summary>
        <div className="mt-3 space-y-4" data-testid="shopify-brancher">{formulaire}</div>
      </details>
    );
  }

  return (
    <div className="mt-2 space-y-4 text-sm" data-testid="shopify-brancher">
      {formulaire}
      {!rebrancher && (
        <p className="text-ink-500">
          {t(
            'Vous utilisez Claude Code ? Avec le plugin Messaging Me, demandez « branche ma boutique Shopify » : il crée et installe l’app pour vous.',
            'Using Claude Code? With the Messaging Me plugin, ask “connect my Shopify store”: it creates and installs the app for you.',
          )}
        </p>
      )}
    </div>
  );
}
