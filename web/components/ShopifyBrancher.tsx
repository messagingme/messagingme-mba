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

/**
 * Les droits de l'app, ceux de `shopify.app.toml` (la skill du plugin) : la même app, créée sans la CLI. `read_products`
 * depuis le 2026-11-24 : le rattrapage des commandes en a besoin (le produit d'une ligne, par l'API), et la lecture des
 * collections. `read_all_orders` depuis le lot 6a des segments : le rattrapage sur 24 mois en Pro s'en sert (lot 7a) ; sans
 * approbation de Shopify pour une app de l'organisation du marchand, et à retirer si Shopify refuse la version.
 */
export const DROITS_SHOPIFY = 'read_customers,read_orders,read_checkouts,read_fulfillments,read_products,read_all_orders';

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

/**
 * LA BULLE DU CHAMP « BOUTIQUE » (Julien, 2026-11-20) : le marchand ne sait pas s'il faut le nom interne ou l'adresse
 * publique de son site. Le serveur n'accepte que le premier (`domaineShopify`). En CSS seul, comme `CaptureAuSurvol`.
 */
function BulleBoutique() {
  const t = useT();
  return (
    <span className="group relative inline-flex" data-testid="shopify-boutique-bulle">
      <button type="button" aria-label={t('Quel nom de boutique ?', 'Which store name?')} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-ink-300 text-[10px] font-semibold text-ink-500">
        ?
      </button>
      <span
        id="shopify-boutique-aide" role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-20 mt-1 w-80 max-w-[80vw] rounded-carte border border-ink-200 bg-white p-3 text-xs leading-snug text-ink-900 opacity-0 shadow-mm-md transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {t(
          'Le nom interne de votre boutique chez Shopify, en .myshopify.com (par exemple votre-boutique.myshopify.com), et non l’adresse publique de votre site (comme www.votre-marque.fr).',
          'Your store’s internal Shopify name, ending in .myshopify.com (for example your-store.myshopify.com), not your website’s public address (like www.your-brand.com).',
        )}
        <span className="mt-2 block text-ink-500">
          {t(
            'Vous le lisez dans l’adresse de l’admin Shopify : admin.shopify.com/store/votre-boutique (ce nom seul suffit, l’adresse entière aussi), ou dans Paramètres > Domaines.',
            'You can read it in the Shopify admin address: admin.shopify.com/store/your-store (the name alone is enough, so is the full address), or in Settings > Domains.',
          )}
        </span>
      </span>
    </span>
  );
}

export function ShopifyBrancher({ tenantId, rebrancher = false, onBranche }: {
  tenantId: string;
  /** Une boutique débranchée, ouverte par « Rebrancher » : seules les clés sont redemandées, le mode opératoire à portée. */
  rebrancher?: boolean;
  /** `avertissement` : la boutique est branchée, mais l'attestation n'a pas pu être enregistrée (à dire au marchand). */
  onBranche: (avertissement?: string) => Promise<void>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const adresse = locale === 'en' ? 'https://app.messagingme.fr/en/shopify/console/' : 'https://app.messagingme.fr/shopify/console/';
  // Les captures montrent l'écran de Shopify dans la langue de la console (Julien, 2026-11-20).
  const captures = locale === 'en' ? '/aide/shopify' : '/aide/shopify/fr';
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
          'Ouvrez le tableau de bord développeur de Shopify, connecté avec le compte qui gère votre boutique, puis Applis > Créer une appli > Créer l’appli manuellement.',
          'Open the Shopify developer dashboard, signed in with the account that manages your store, then Apps > Create app > Create app manually.',
        )}{' '}
        <a href="https://dev.shopify.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">dev.shopify.com</a>
        {' · '}
        <CaptureAuSurvol
          src={`${captures}/1-creer-l-app.webp`} testid="shopify-capture-creer"
          alt={t('Applis, puis Créer une appli, puis Créer l’appli manuellement', 'Apps, then Create app, then Create app manually')}
        />
      </li>
      <li>
        {t('Dans le formulaire', 'In the form')}{' · '}
        <CaptureAuSurvol
          src={`${captures}/2-formulaire.webp`} testid="shopify-capture-formulaire"
          alt={t('Le formulaire de l’appli, ses cinq repères numérotés', 'The app form, its four numbered fields')}
        />
        <span className="mt-1 block">{t('1. Nom de l’appli : écrivez « Messaging Me ».', '1. App name: type “Messaging Me”.')}</span>
        <span className="mt-1 block">{t('2. URL de l’appli : collez cette adresse.', '2. App URL: paste this address.')}</span>
        {ligneCopiable(adresse, t('Adresse de l’appli', 'App URL'), 'shopify-copier-adresse')}
        <span className="mt-1 block">{t('3. Décochez « Intégrer l’appli dans l’interface administrateur Shopify ».', '3. Untick “Embed app in Shopify admin”.')}</span>
        <span className="mt-1 block">
          {t(
            '4. Portées : appuyez sur « Sélectionner dans la liste » et cochez read_customers, read_orders, read_checkouts, read_fulfillments, read_products et read_all_orders (ou collez la liste dans le champ). Si Shopify refuse la version à cause de read_all_orders, retirez-le : seul le rattrapage au-delà de 60 jours en a besoin.',
            '4. Scopes: click “Select from list” and tick read_customers, read_orders, read_checkouts, read_fulfillments, read_products and read_all_orders (or paste the list in the field). If Shopify refuses the version because of read_all_orders, remove it: only the catch-up beyond 60 days needs it.',
          )}
        </span>
        {ligneCopiable(DROITS_SHOPIFY, t('Droits de l’appli', 'App scopes'), 'shopify-copier-droits')}
        <span className="mt-1 block">
          {t(
            '5. Laissez le reste tel quel et appuyez sur Créer une appli, en haut à droite. La fenêtre « Publication de la version » s’ouvre : appuyez sur Publier.',
            'Leave the rest as it is, click Create app at the top right, then Release.',
          )}
          {/* Les écrans de publication et d'installation n'existent qu'en français (Julien, 2026-11-20). */}
          {locale !== 'en' && (
            <>
              {' '}
              <CaptureAuSurvol src={`${captures}/4-publier.webp`} testid="shopify-capture-publier" alt="La fenêtre « Publication de la version », bouton Publier" />
            </>
          )}
        </span>
      </li>
      <li>
        {t(
          'Installez l’appli : dans Applis, menu « ⋮ » de sa ligne > Installer l’appli, choisissez votre boutique, puis Installer. « Cette appli n’a pas été examinée » est normal : c’est la vôtre.',
          'Install the app: its row’s “⋯” menu > Install app, pick your store, then Install. “This app hasn’t been reviewed” is expected: it is your own app.',
        )}
        {locale !== 'en' && (
          <>
            {' '}
            <CaptureAuSurvol src={`${captures}/5-installer.webp`} testid="shopify-capture-installer" alt="Le menu « ⋮ » de la ligne de l’appli, Installer l’appli" />
            {' · '}
            <CaptureAuSurvol src={`${captures}/6-installer-confirmer.webp`} testid="shopify-capture-installer-confirmer" alt="L’écran « Installer l’application », l’avertissement et le bouton Installer" />
          </>
        )}
      </li>
      <li>
        {t(
          'Dans Applis, cliquez sur l’appli Messaging Me : l’ID client et le secret client sont dans le cadre Identifiants, à droite. Copiez-les, puis collez-les ci-dessous.',
          'In Apps, click the Messaging Me app: the Client ID and the Client secret are in the Credentials box, on the right. Copy them, then paste them below.',
        )}{' '}
        <CaptureAuSurvol
          src={`${captures}/3-cles-de-l-app.webp`} testid="shopify-capture-cles"
          alt={t('La page de l’appli, cadre Identifiants', 'The app page, Credentials box')}
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
          <div className="block text-sm text-ink-900">
            <span className="flex items-center gap-1">
              <label htmlFor="shopify-boutique">{t('Boutique', 'Store')}</label>
              <BulleBoutique />
            </span>
            <input
              id="shopify-boutique" data-testid="shopify-boutique" value={boutique} onChange={(e) => setBoutique(e.target.value)}
              placeholder="votre-boutique.myshopify.com" autoComplete="off" aria-describedby="shopify-boutique-aide" className={`${inputCls} mt-1`}
            />
          </div>
          <label className="block text-sm text-ink-900">
            {t('ID client', 'Client ID')}
            <input data-testid="shopify-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-sm text-ink-900">
            {t('Secret client', 'Client secret')}
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

  // Rebrancher : le bouton « Rebrancher » de la carte ouvre directement les clés (Julien, 2026-11-26).
  if (rebrancher) {
    return <div className="space-y-4 text-sm" data-testid="shopify-brancher">{formulaire}</div>;
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
