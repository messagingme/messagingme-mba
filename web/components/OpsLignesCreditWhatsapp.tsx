'use client';

import { useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { inputCls, inputClsAuto } from '@/lib/ui';
import { Bouton } from '@/components/Bouton';
import { downloadCsv, toCsv } from '@/lib/csv';
import {
  lireEnvoisDuMoisOps, lireLignesCreditOps, poserLigneCreditOps, type LigneCreditOps, type NumeroCreditOps, type PageEnvoisOps,
  type ProvisionCreditOps, type VueCreditOps,
} from '@/lib/api';

/**
 * LES NUMÉROS D'UN ESPACE SUR LA LIGNE DU CRÉDIT WHATSAPP (plan du Crédit WhatsApp, tâche 8), dans la fenêtre de l'offre
 * de `/ops`. Les numéros de l'espace sont listés, chacun avec son geste : plus d'identifiant Meta à taper (Julien, le
 * 2026-11-02 : « ça sert à quoi identifiant Meta du numéro ? »). Le serveur refuse encore ce que la garde ne saurait pas
 * compter (360dialog, coexistence, délié) ; l'écran le dit avant le clic. Une ligne couvre tout le compte WhatsApp de son
 * numéro (Meta attache la ligne au compte) : un autre numéro du même compte est montré « couvert », un numéro dont le
 * compte est sur la ligne d'un autre espace « refusé », comme la garde les lit (relecture du lot D). Une Entreprise est
 * illimitée : son montant du mois est à facturer, son solde ne bouge pas. La section se masque quand l'API n'a pas encore
 * la route.
 *
 * Les places de l'option (lot 4a, décision de Julien du 2026-11-03) : hors Entreprise, une pose consomme des places payées
 * pour tout le compte du numéro, et le serveur refuse sans elles ; un essai se FORCE, case cochée, et sa ligne reste
 * `'ops'`, signée, hors des places.
 *
 * Les envois se lisent PAR JOUR (Julien, 2026-11-20 : la liste des 50 derniers envois devenait illisible dès quelques
 * dizaines par jour). Le détail, message par message, se télécharge en CSV pour un mois, page par page : aucune réponse
 * du serveur ne porte un mois entier.
 */
export function OpsLignesCreditWhatsapp({ jeton, tenantId, entreprise }: { jeton: string; tenantId: string; entreprise: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  // Des euros au centime, à la française en français (« 0,52 € »), comme le reste de `/ops`.
  const euros = (microEur: number): string => (microEur / 1_000_000).toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR' });
  const [vue, setVue] = useState<VueCreditOps | null>(null);
  const [absente, setAbsente] = useState(false);
  const [note, setNote] = useState('');
  const [forcer, setForcer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Le mois de Paris en cours, 'AAAA-MM' (la locale suédoise écrit les dates en ISO).
  const [moisExport, setMoisExport] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 7));
  const [exportEnCours, setExportEnCours] = useState(false);

  useEffect(() => {
    let vivant = true;
    lireLignesCreditOps(jeton, tenantId)
      .then((r) => { if (vivant) setVue(r); })
      .catch(() => { if (vivant) setAbsente(true); });
    return () => { vivant = false; };
  }, [jeton, tenantId]);


  /** Toutes les pages du mois, puis un CSV : l'heure de Paris, la catégorie, le pays, le montant, l'état, et l'envoi chez Meta. */
  async function exporter() {
    setExportEnCours(true);
    setMsg(null);
    try {
      const envois: ProvisionCreditOps[] = [];
      let apres: PageEnvoisOps['suivant'] = null;
      do {
        const page: PageEnvoisOps = await lireEnvoisDuMoisOps(jeton, tenantId, moisExport, apres);
        envois.push(...page.envois);
        apres = page.suivant;
      } while (apres !== null);
      if (envois.length === 0) {
        setMsg({ kind: 'err', text: t(`Aucun envoi en ${moisExport}.`, `No send in ${moisExport}.`) });
        return;
      }
      const aParis = (iso: string | null) => (iso === null ? '' : new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }));
      downloadCsv(`envois-whatsapp-${moisExport}-${tenantId}.csv`, toCsv(
        ['envoi (Paris)', 'categorie', 'pays', 'montant HT (EUR)', 'etat', 'illimite', 'livre le (Paris)', 'numero (id Meta)', 'wamid'],
        envois.map((e) => [
          aParis(e.creeLe), e.categorie, e.pays, (e.montantMicroEur / 1_000_000).toFixed(6), e.etat, e.illimite === true ? 'oui' : 'non',
          aParis(e.livreLe), e.phoneNumberId, e.wamid,
        ]),
      ));
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : t('Export impossible', 'Export failed') });
    } finally {
      setExportEnCours(false);
    }
  }

  async function geste(phoneNumberId: string, poser: boolean) {
    setEnvoi(true);
    setMsg(null);
    try {
      setVue(await poserLigneCreditOps(jeton, tenantId, phoneNumberId, poser, note.trim(), forcer && !entreprise));
      setNote('');
      setForcer(false);
      setMsg({ kind: 'ok', text: poser ? t('Numéro posé sur la ligne.', 'Number put on the line.') : t('Numéro retiré de la ligne.', 'Number removed from the line.') });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : t('Geste impossible', 'Action failed') });
    } finally {
      setEnvoi(false);
    }
  }

  if (absente || vue === null) return null;
  const lignes = Array.isArray(vue.lignes) ? vue.lignes : [];
  const numeros = Array.isArray(vue.numeros) ? vue.numeros : [];
  const jours = Array.isArray(vue.envoisParJour) ? vue.envoisParJour : [];
  // Un numéro qui n'est plus dans l'espace (déconnecté) mais dont la ligne court encore : il doit pouvoir se retirer.
  const lignesOrphelines = lignes.filter((l) => !numeros.some((n) => n.phoneNumberId === l.phoneNumberId));

  return (
    <div className="grid gap-2 border-t border-ink-100 pt-4" data-testid="ligne-credit">
      <p className="font-medium text-ink-900">{t('Ligne de crédit : numéros sur la ligne', 'Credit line: numbers on the line')}</p>
      <p className="text-xs text-ink-500">
        {t(
          'Un numéro sur la ligne : ses messages sont payés par notre ligne de crédit, au prix de la grille de Meta, puis refacturés à l’espace (débités de sa ligne de crédit en Pro et Business, facturés au contrat en Entreprise). La ligne couvre tout le compte WhatsApp du numéro.',
          'A number on the line: its messages are paid by our credit line, at Meta’s rate card price, then billed back to the workspace (taken from its credit line on Pro and Business, invoiced per contract on Enterprise). The line covers the number’s whole WhatsApp account.',
        )}
      </p>

      {numeros.length === 0 && lignesOrphelines.length === 0 ? (
        <p className="text-xs text-ink-500">{t('Aucun numéro WhatsApp dans cet espace.', 'No WhatsApp number in this workspace.')}</p>
      ) : (
        <ul className="grid gap-1" data-testid="ligne-credit-numeros">
          {numeros.map((n) => (
            <Numero key={n.phoneNumberId} n={n} ligne={lignes.find((l) => l.phoneNumberId === n.phoneNumberId) ?? null}
              actif={!envoi} onGeste={(poser) => { void geste(n.phoneNumberId, poser); }} />
          ))}
          {lignesOrphelines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 text-xs text-ink-700">
              <span>{t(`Numéro sorti de l’espace (${l.phoneNumberId}), encore sur la ligne`, `Number no longer in the workspace (${l.phoneNumberId}), still on the line`)}</span>
              <Bouton variante="secondaire" taille="petite" disabled={envoi} onClick={() => { void geste(l.phoneNumberId, false); }} data-testid="ligne-credit-retirer">
                {t('Retirer', 'Remove')}
              </Bouton>
            </li>
          ))}
        </ul>
      )}

      <label className="grid gap-1">
        <span className="text-xs font-medium text-ink-500">{t('Note (facultative) : pourquoi poser ou retirer ce numéro', 'Note (optional): why put on or remove this number')}</span>
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-testid="ligne-credit-note" />
      </label>

      {!entreprise && vue.places !== undefined && (
        <>
          <p className="text-xs text-ink-700" data-testid="ligne-credit-places">
            {t(
              `Places de l’option : ${vue.places.payees} payée${vue.places.payees > 1 ? 's' : ''}, ${vue.places.couverts} numéro${vue.places.couverts > 1 ? 's' : ''} couvert${vue.places.couverts > 1 ? 's' : ''} par ses lignes. Une pose consomme une place par numéro du compte WhatsApp.`,
              `Option places: ${vue.places.payees} paid, ${vue.places.couverts} number${vue.places.couverts > 1 ? 's' : ''} covered by its lines. A pose takes one place per number of the WhatsApp account.`,
            )}
          </p>
          <label className="flex items-start gap-2 text-xs text-ink-700">
            <input type="checkbox" className="mt-0.5" checked={forcer} onChange={(e) => setForcer(e.target.checked)} data-testid="ligne-credit-forcer" />
            <span>{t('Forcer la pose (un essai, sans place payée) : la ligne est posée à la main, hors des places, et la note le dit.', 'Force the pose (a test, without a paid place): the line is set by hand, outside the places, and the note says so.')}</span>
          </label>
        </>
      )}

      {entreprise ? (
        <p className="text-xs text-ink-700" data-testid="ligne-credit-illimite-mois">
          {t(
            `Illimité (Entreprise) : ${euros(vue.consommationDuMoisMicroEur ?? 0)} HT de messages ce mois, à facturer au contrat. Son solde ne bouge pas.`,
            `Unlimited (Enterprise): ${euros(vue.consommationDuMoisMicroEur ?? 0)} excl. VAT of messages this month, invoiced per contract. Its balance does not move.`,
          )}
        </p>
      ) : vue.soldeMicroEur !== undefined && (
        <p className="text-xs text-ink-700" data-testid="ligne-credit-solde">
          {t(`Solde : ${euros(vue.soldeMicroEur)} HT`, `Balance: ${euros(vue.soldeMicroEur)} excl. VAT`)}
        </p>
      )}
      {vue.envoisParJour !== undefined && (
        <div className="grid gap-2" data-testid="ligne-credit-envois">
          <p className="text-xs font-medium text-ink-500">{t('Envois par jour, ce mois et le précédent', 'Sends per day, this month and the previous one')}</p>
          {jours.length === 0 ? (
            <p className="text-xs text-ink-500">{t('Aucun envoi facturé sur ces deux mois.', 'No billed send over these two months.')}</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs text-ink-700" data-testid="ligne-credit-jours">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-ink-500">
                    <th className="font-medium">{t('Jour', 'Day')}</th>
                    <th className="text-right font-medium">{t('Messages', 'Messages')}</th>
                    <th className="pl-3 font-medium">{t('Catégories', 'Categories')}</th>
                    <th className="text-right font-medium">{t('Montant HT', 'Amount excl. VAT')}</th>
                  </tr>
                </thead>
                <tbody>
                  {jours.map((j) => (
                    <tr key={j.jour}>
                      <td>{new Date(`${j.jour}T12:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</td>
                      <td className="text-right">{j.messages}</td>
                      <td className="pl-3 text-ink-500">{Object.entries(j.parCategorie).map(([c, n]) => `${c} ${n}`).join(' · ')}</td>
                      <td className="text-right">{euros(j.montantMicroEur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input type="month" className={inputClsAuto} value={moisExport} onChange={(e) => setMoisExport(e.target.value)} data-testid="ligne-credit-export-mois" />
            <Bouton variante="secondaire" taille="petite" disabled={exportEnCours || !/^\d{4}-\d{2}$/.test(moisExport)} onClick={() => { void exporter(); }} data-testid="ligne-credit-export">
              {exportEnCours ? t('Export en cours…', 'Exporting…') : t('Télécharger le détail du mois (CSV)', 'Download the month’s detail (CSV)')}
            </Bouton>
          </div>
        </div>
      )}
      {msg && (
        <p data-testid="ligne-credit-message" className={`rounded-controle px-3 py-2 text-xs ${msg.kind === 'ok' ? 'bg-succes-50 text-succes-700' : 'bg-danger-50 text-danger-700'}`}>{msg.text}</p>
      )}
    </div>
  );
}

/** Un numéro de l'espace et son geste : poser, retirer, ou la raison qui l'empêche. */
function Numero({ n, ligne, actif, onGeste }: { n: NumeroCreditOps; ligne: LigneCreditOps | null; actif: boolean; onGeste: (poser: boolean) => void }) {
  const t = useT();
  const motif = n.refus === '360dialog'
    ? t('chez 360dialog : facturé par 360dialog', 'with 360dialog: billed by 360dialog')
    : n.refus === 'coexistence'
      ? t('en coexistence : l’application WhatsApp Business envoie sans nous', 'in coexistence: the WhatsApp Business app sends without us')
      : n.refus === 'delie'
        ? t('délié : il n’envoie plus rien', 'unlinked: it no longer sends anything')
        : null;
  const raison = motif === null || n.refus === 'delie' ? motif : `${motif}, ${t('ne passe pas sur la ligne', 'cannot go on the line')}`;
  const arretee = ` · ${t('envois arrêtés', 'sends stopped')}`;
  const couvert = n.couverture === 'ligne' || n.couverture === 'compte';
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-controle border border-ink-100 px-3 py-2 text-xs" data-testid={`ligne-credit-numero-${n.phoneNumberId}`}>
      <span className="text-ink-900">
        <span className="font-medium">{n.numero ?? n.phoneNumberId}</span>
        {n.nom && <span className="text-ink-500"> · {n.nom}</span>}
        <span className="block text-ink-500">
          {n.couverture === 'ligne' && ligne
            ? `${t('sur la ligne', 'on the line')} · ${ligne.origine === 'ops' ? t('posé à la main', 'set by hand') : t('option', 'option')}${ligne.arreteeLe !== null ? arretee : ''}`
            : n.couverture === 'compte'
              ? `${t('couvert : même compte WhatsApp qu’un numéro sur la ligne', 'covered: same WhatsApp account as a number on the line')}${n.arretee === true ? arretee : ''}`
              : n.couverture === 'autre_espace'
                ? t('refusé : son compte WhatsApp est sur la ligne d’un autre espace', 'refused: its WhatsApp account is on another workspace’s line')
                : raison ?? t('pas sur la ligne', 'not on the line')}
        </span>
        {/* Couvert malgré ce qui l'empêcherait d'être posé (par son compte, ou posé avant) : l'écran le dit encore. */}
        {couvert && motif !== null && <span className="block text-danger-700" data-testid="ligne-credit-alerte">{motif}</span>}
      </span>
      {n.couverture === 'ligne' ? (
        <Bouton variante="secondaire" taille="petite" disabled={!actif} onClick={() => onGeste(false)} data-testid="ligne-credit-retirer">
          {t('Retirer', 'Remove')}
        </Bouton>
      ) : n.couverture === null && raison === null ? (
        <Bouton taille="petite" disabled={!actif} onClick={() => onGeste(true)} data-testid="ligne-credit-poser">
          {t('Poser sur la ligne', 'Put on the line')}
        </Bouton>
      ) : null}
    </li>
  );
}
