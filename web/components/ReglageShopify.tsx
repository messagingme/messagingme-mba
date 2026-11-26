'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n';
import { cardCls } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { useConfirmation } from '@/components/Confirmation';
import { routeInconnue } from '@/lib/canaux-services';
import { couperShopify, lireShopify, reglerPauseShopify, type EtatShopifyVue } from '@/lib/api-shopify';
import { LigneShopify } from '@/components/LigneShopify';
import { ShopifyBrancher } from '@/components/ShopifyBrancher';
import { ShopifyImport } from '@/components/ShopifyImport';
import { ShopifyRattrapage } from '@/components/ShopifyRattrapage';
import { ShopifyEtiquettes } from '@/components/ShopifyEtiquettes';
import { ShopifySegments } from '@/components/ShopifySegments';

/**
 * TOOLS > INTÉGRATIONS > SHOPIFY : brancher la boutique, la débrancher, importer ses clients abonnés, rattraper ses
 * commandes passées (segments Shopify enrichis, lot 5 ; 24 mois en Pro, lot 7a), synchroniser les étiquettes de ses clients (lot 6b)
 * et suivre ses segments (lot 6c). Sans boutique, le mode opératoire chez Shopify puis les clés (`ShopifyBrancher`). Ses
 * messages sont des automations, réglées sur leur page (Scénario > Automation > Shopify). Claude Code fait la même chose
 * par la skill `shopify` du plugin : les deux passent par la même gestion côté serveur.
 *
 * LA CARTE BRANCHÉE (Julien, 2026-11-26, « cet écran est illisible ») : le nom de la boutique en grand, et en face
 * « Débrancher » (branchée) ou « Rebrancher » (débranchée) ; puis une ligne par geste, son bouton dans la même colonne
 * (`LigneShopify`), et sous chacun la date de sa dernière fois. Plus de texte sur les automations, d'interrupteur de pause,
 * de chiffres des paniers ni des 30 derniers jours, ni de lien vers la page des apps. La pause ne se pose plus nulle part
 * (seule cette carte la posait) : une boutique mise EN PAUSE avant la refonte garde la ligne qui le dit, avec « Reprendre ».
 *
 * 🔴 UNE INTÉGRATION NEUVE NE S'AFFICHE PAS AVANT SON API, comme Salesforce : tant que la route n'existe pas (404 du
 * routeur), la carte n'est pas rendue.
 *
 * ⚠️ ADMIN SEULEMENT : la carte ne vit que dans la page des administrateurs, et ses routes sont sous `g.admin`.
 */

/** `siAbsente` : ce que montre le volet de Tools > Intégrations quand l'instance n'a pas Shopify (route absente). */
export function ReglageShopify({ tenantId, siAbsente = null }: { tenantId: string; siAbsente?: ReactNode }) {
  const t = useT();
  const confirmer = useConfirmation();
  const [vue, setVue] = useState<EtatShopifyVue | null>(null);
  const [lecture, setLecture] = useState<'en_cours' | 'ok' | 'absente' | 'echec'>('en_cours');
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null);
  const [importOuvert, setImportOuvert] = useState(false);
  const [rebrancherOuvert, setRebrancherOuvert] = useState(false);
  /**
   * Les étiquettes et les segments partagent UNE synchronisation : un geste de l'une qui la lance fait relire l'autre
   * (« Synchroniser maintenant » liste les segments, le choix des segments lance la lecture des étiquettes).
   */
  const [synchroLancee, setSynchroLancee] = useState(0);
  const synchroPartie = useCallback(() => setSynchroLancee((n) => n + 1), []);

  const recharger = useCallback(() => lireShopify(tenantId)
    .then((v) => { setVue(v); setLecture(v ? 'ok' : 'absente'); })
    .catch((e: unknown) => setLecture(routeInconnue(e) ? 'absente' : 'echec')), [tenantId]);

  useEffect(() => { void recharger(); }, [recharger]);
  // La page d'aide publique renvoie ici par `#integration-shopify` ; la carte n'existe qu'après sa propre lecture.
  useEffect(() => {
    if (lecture !== 'en_cours' && window.location.hash === '#integration-shopify') document.getElementById('integration-shopify')?.scrollIntoView();
  }, [lecture]);

  /** Un geste de la carte : la carte se relit et dit ce qui s'est passé, ou l'erreur du serveur. */
  const geste = async (faire: () => Promise<unknown>, reussi: string, echec: string): Promise<void> => {
    setEnCours(true);
    setMessage(null);
    try {
      await faire();
      setMessage({ genre: 'ok', texte: reussi });
      await recharger();
    } catch (e: unknown) {
      setMessage({ genre: 'erreur', texte: e instanceof Error ? e.message : echec });
    } finally {
      setEnCours(false);
    }
  };

  const debrancher = async (): Promise<void> => {
    if (!(await confirmer({
      titre: t('Débrancher la boutique Shopify', 'Disconnect the Shopify store'),
      message: t(
        'Plus aucun message de commande ne partira. Vos contacts, leurs commandes et leurs étiquettes restent. Vous pourrez la rebrancher ici.',
        'No order message will go out anymore. Your contacts, their orders and their tags stay. You can reconnect it here.',
      ),
      confirmer: t('Débrancher', 'Disconnect'),
    }))) return;
    await geste(() => couperShopify(tenantId), t('Boutique débranchée : plus aucun message ne part.', 'Store disconnected: no message goes out anymore.'), t('Débranchement impossible', 'Unable to disconnect'));
  };

  const fini = async (bilan: string): Promise<void> => {
    setImportOuvert(false);
    setMessage({ genre: 'ok', texte: bilan });
    await recharger();
  };
  /** Branchée ; `avertissement` : l'attestation n'a pas pu être enregistrée, la carte le dit à la place du succès. */
  const branchee = async (texte: string, avertissement?: string): Promise<void> => {
    setRebrancherOuvert(false);
    setMessage(avertissement ? { genre: 'erreur', texte: avertissement } : { genre: 'ok', texte });
    await recharger();
  };

  if (lecture === 'en_cours') return null;
  if (lecture === 'absente') return siAbsente;
  const b = vue?.boutique ?? null;
  const branche = b?.etat === 'connectee';
  const derniere = b?.dernierEvenementLe ? new Date(b.dernierEvenementLe).toLocaleString() : null;

  return (
    <section id="integration-shopify" className={cardCls} data-testid="integration-shopify">
      <h3 className="text-sm font-semibold text-ink-900">Shopify</h3>
      {lecture === 'echec' && <p className="mt-1 text-sm text-danger">{t('La lecture a échoué : rechargez la page.', 'The read failed: reload the page.')}</p>}
      {lecture === 'ok' && b === null && (
        <>
          <p className="mt-1 text-sm text-ink-500" data-testid="integration-shopify-vide">
            {t(
              'Vos clients reçoivent sur WhatsApp la confirmation de leur commande, son expédition, et une relance s’ils abandonnent leur panier.',
              'Your customers get on WhatsApp their order confirmation, its shipping, and a reminder if they abandon their checkout.',
            )}
          </p>
          <ShopifyBrancher tenantId={tenantId} onBranche={(a) => branchee(t('Boutique branchée : allumez maintenant ses automations dans Scénario > Automation > Shopify.', 'Store connected: now turn its automations on in Scenario > Automation > Shopify.'), a)} />
        </>
      )}
      {b !== null && (
        <div className="mt-2 space-y-4 text-sm">
          <LigneShopify
            grand testid="integration-shopify-entete"
            libelle={<span data-testid="integration-shopify-nom">{b.nom ?? b.domaine}</span>}
            detail={(
              <p className={branche ? 'text-ink-500' : 'text-danger'} data-testid="integration-shopify-etat">
                {branche
                  ? t(`Branchée · ${b.domaine}`, `Connected · ${b.domaine}`)
                  : t(`Débranchée : plus aucun message ne part · ${b.domaine}`, `Disconnected: no message goes out anymore · ${b.domaine}`)}
                {derniere && ` · ${t(`dernier événement le ${derniere}`, `last event on ${derniere}`)}`}
              </p>
            )}
            bouton={branche ? (
              <Bouton type="button" taille="petite" variante="secondaire" className="w-full" onClick={() => void debrancher()} disabled={enCours} enCours={enCours} data-testid="integration-shopify-debrancher">
                {t('Débrancher', 'Disconnect')}
              </Bouton>
            ) : (
              <Bouton type="button" taille="petite" variante="secondaire" className="w-full" onClick={() => setRebrancherOuvert((o) => !o)} data-testid="integration-shopify-rebrancher">
                {t('Rebrancher', 'Reconnect')}
              </Bouton>
            )}
          />
          {!branche && b.origine === 'claude_code' && (
            <p className="text-ink-500">
              {t(
                'Branchée par Claude Code : rebranchez-la depuis Claude Code, ou ici avec les clés de son app.',
                'Connected by Claude Code: reconnect it from Claude Code, or here with its app’s keys.',
              )}
            </p>
          )}
          {!branche && rebrancherOuvert && (
            <ShopifyBrancher tenantId={tenantId} rebrancher onBranche={(a) => branchee(t('Boutique rebranchée.', 'Store reconnected.'), a)} />
          )}
          {/* Une pause posée avant la refonte : elle se dit, et se reprend sans question. */}
          {branche && b.pauseLe !== null && (
            <LigneShopify
              testid="integration-shopify-pause"
              libelle={t(`En pause depuis le ${new Date(b.pauseLe).toLocaleString()} : rien ne part.`, `Paused since ${new Date(b.pauseLe).toLocaleString()}: nothing goes out.`)}
              bouton={(
                <Bouton
                  type="button" taille="petite" variante="secondaire" className="w-full" disabled={enCours} data-testid="integration-shopify-reprendre"
                  onClick={() => void geste(() => reglerPauseShopify(tenantId, false), t('Boutique reprise : ses automations repartent.', 'Store resumed: its automations go out again.'), t('Réglage impossible', 'Unable to save'))}
                >
                  {t('Reprendre', 'Resume')}
                </Bouton>
              )}
            />
          )}
          {branche && (
            <LigneShopify
              testid="integration-shopify-import"
              libelle={t('Vos clients abonnés à votre marketing dans Shopify peuvent entrer dans vos contacts.', 'Your customers subscribed to your marketing in Shopify can join your contacts.')}
              bouton={(
                <Bouton type="button" taille="petite" variante="secondaire" className="w-full" onClick={() => setImportOuvert(true)} data-testid="integration-shopify-importer">
                  {t('Importer', 'Import')}
                </Bouton>
              )}
            />
          )}
          {/* Le rattrapage des commandes passées (segments Shopify enrichis, lot 5 ; 24 mois en Pro, lot 7a). */}
          {branche && <ShopifyRattrapage tenantId={tenantId} onLance={(texte) => setMessage({ genre: 'ok', texte })} />}
          {/* Les étiquettes des clients (lot 6b) et les segments (lot 6c), une même synchronisation. */}
          {branche && <ShopifyEtiquettes tenantId={tenantId} onMessage={setMessage} relire={synchroLancee} onSynchro={synchroPartie} />}
          {branche && <ShopifySegments tenantId={tenantId} onMessage={setMessage} relire={synchroLancee} onSynchro={synchroPartie} />}
        </div>
      )}
      {message && <p className={`mt-3 text-sm ${message.genre === 'ok' ? 'text-ink-900' : 'text-danger'}`} data-testid="integration-shopify-message">{message.texte}</p>}
      {importOuvert && <ShopifyImport tenantId={tenantId} onClose={() => setImportOuvert(false)} onFini={fini} />}
    </section>
  );
}
