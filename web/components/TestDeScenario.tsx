'use client';

import { useState, type ReactNode } from 'react';
import { createWorkflowTestLink } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Bouton } from '@/components/Bouton';
import { Modale } from '@/components/Modale';

/**
 * LE LIEN DE TEST D'UN SCÉNARIO (Lot F), partagé par la liste du Builder et le scénario ouvert, où qu'il s'ouvre (la page
 * des scénarios, ou déplié sous les automations Shopify et HubSpot, 2026-11-20) : une seule vérité pour un écran qui porte
 * un lien envoyé à de vrais téléphones. Jeton stable + lien wa.me + QR, rendu en data-URL par la lib : aucun service
 * externe n'est appelé, un lien de test ne transite pas par un tiers.
 */
export function useTestDeScenario(tenantId: string): {
  /** Ouvre le panneau du scénario ; `nodeId` : tester à partir de ce bloc. */
  tester: (wf: { id: string; name: string }, nodeId?: string) => Promise<void>;
  /** Le panneau à rendre (la modale), `null` fermé. */
  panneau: ReactNode;
  occupe: boolean;
  erreur: string | null;
} {
  const t = useT();
  const [testing, setTesting] = useState<{
    nom: string;
    /** Le MOT à envoyer : le jeton seul, ou `jeton.<identifiant du bloc>` quand on teste à partir d'un bloc. */
    mot: string;
    /** Le lien wa.me pré-rempli avec ce mot. `null` = aucun numéro WhatsApp connecté. */
    lien: string | null;
    qr: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function tester(wf: { id: string; name: string }, nodeId?: string): Promise<void> {
    setErreur(null);
    setOccupe(true);
    setCopied(false);
    try {
      const link = await createWorkflowTestLink(tenantId, wf.id);
      // 🔴 L'IDENTIFIANT DU BLOC EST COLLÉ TEL QUEL, sans aucune transformation. Le serveur compare par
      // ÉGALITÉ (`lireJetonDeTest`, côté `src/`). Normaliser ici (retirer les tirets, tronquer) créerait un
      // invariant partagé de part et d'autre d'une frontière que ce dépôt interdit de franchir (aucun fichier
      // de `web/` n'importe `src/`), donc recopié à la main des deux côtés, donc voué à diverger en silence.
      const mot = nodeId ? `${link.token}.${nodeId}` : link.token;
      // ⚠️ ON RÉÉCRIT LE PARAMÈTRE `text` DU LIEN RENDU PAR LE SERVEUR, on ne refabrique pas l'adresse : le
      // format de `wa.me` (le numéro sans `+` ni espaces) vit dans `src/lib/wa-me.ts` et doit y rester.
      //
      // ⚠️ MAIS L'ENCODAGE DU TEXTE, LUI, EST CELUI DU NAVIGATEUR, PAS LE NÔTRE (précisé en revue finale) :
      // `searchParams.set` puis `toString()` RE-SÉRIALISENT toute la requête, donc `encodeTexteWaMe`
      // (`src/lib/wa-me.ts`) est contourné, pas réutilisé. Les deux diffèrent sur `!'()*` et sur l'espace.
      // Sans conséquence ici, et c'est mesurable : le mot vaut `test-` + 8 caractères Crockford, plus un
      // identifiant de bloc dont les espaces ont déjà été retirés. Si un jour ce mot pouvait porter autre
      // chose, c'est cette ligne qu'il faudrait reprendre, pas le module serveur.
      let lien = link.link;
      if (lien !== null && nodeId) {
        const u = new URL(lien);
        u.searchParams.set('text', mot);
        lien = u.toString();
      }
      let qr: string | null = null;
      if (lien) {
        const QRCode = (await import('qrcode')).default;
        qr = await QRCode.toDataURL(lien, { width: 220, margin: 1 });
      }
      setTesting({ nom: wf.name, mot, lien, qr });
    } catch (err) {
      setErreur(err instanceof Error ? err.message : t('Lien de test indisponible', 'Test link unavailable'));
    } finally {
      setOccupe(false);
    }
  }

  const panneau = testing && (
    <Modale
      titre={`${t('Tester « ', 'Test "')}${testing.nom}${t(' »', '"')}`}
      taille="petite"
      testId="workflow-test-panel"
      onClose={() => setTesting(null)}
    >
      <p className="mt-1 text-sm text-ink-500">
        {t(
          'Scannez ce QR code avec votre téléphone, ou ouvrez le lien : WhatsApp s’ouvre avec le mot déjà écrit, appuyez sur Envoyer et le scénario démarre sur votre numéro.',
          'Scan this QR code with your phone, or open the link: WhatsApp opens with the word already typed, press Send and the scenario starts on your number.',
        )}
      </p>
      {/* ⚠️ AUCUN AVERTISSEMENT SUR LES ÉTAPES SAUTÉES, et c'est une DÉCISION, pas un oubli. Julien, le
          2026-09-16 : « si on saute des étapes parce que la personne a décidé de tester qu'un bout du
          scénario, et bien tant pis ! il ne se passe rien ». Un bandeau a été ajouté ici puis RETIRÉ le
          jour même, quand la revue finale a montré qu'il inversait cette décision en silence. */}

      {testing.lien ? (
        <>
          {testing.qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={testing.qr} alt={t('QR code du lien de test', 'Test link QR code')} className="mx-auto my-4 h-[220px] w-[220px] rounded-controle border border-ink-200" />
          )}
          <div className="flex items-center gap-2">
            <input readOnly value={testing.lien} data-testid="workflow-test-lien" className="w-full rounded-controle border border-ink-300 bg-ink-50 px-3 py-1.5 text-xs text-ink-500" />
            <Bouton variante="secondaire" taille="petite"
              onClick={() => { void navigator.clipboard.writeText(testing.lien ?? '').then(() => setCopied(true)); }}
              className="shrink-0"
            >
              {copied ? t('Copié', 'Copied') : t('Copier', 'Copy')}
            </Bouton>
          </div>
        </>
      ) : (
        <p className="my-4 rounded-controle border border-alerte-300 bg-alerte-50 px-3 py-2 text-xs text-alerte-800">
          {t(
            'Aucun numéro WhatsApp connecté : envoyez le mot ci-dessous à votre numéro professionnel pour lancer le test.',
            'No WhatsApp number connected: send the word below to your business number to start the test.',
          )}
        </p>
      )}

      <p className="mt-3 text-xs text-ink-500">
        {t('Mot à envoyer : ', 'Word to send: ')}
        <code data-testid="workflow-test-mot" className="rounded-controle bg-ink-100 px-1.5 py-0.5 font-mono text-ink-900">{testing.mot}</code>
      </p>
      <p className="mt-2 text-xs text-ink-500">
        {t(
          'Ce lien est permanent pour ce scénario. Un essai se comporte comme une vraie conversation : il compte dans les statistiques et l’analyse, et l’agent de Meta peut reprendre la main à la fin. Le numéro qui teste apparaît comme un contact du mini-CRM, comme n’importe quel numéro qui écrit.',
          'This link is permanent for this scenario. A test behaves like a real conversation: it counts in statistics and analysis, and the Meta agent may take over at the end. The testing number appears as a mini-CRM contact, like any number that writes in.',
        )}
      </p>
      <div className="mt-5 flex justify-end">
        <Bouton onClick={() => setTesting(null)}>{t('Fermer', 'Close')}</Bouton>
      </div>
    </Modale>
  );

  return { tester, panneau, occupe, erreur };
}
