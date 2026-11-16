'use client';

import { useState } from 'react';
import type { UserFieldDef } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { champsEcrivables } from '@/lib/fields';
import { testerRequeteEnregistree } from '@/lib/api-agent-requetes';
import { ApiError } from '@/lib/http';
import { ArbreJson } from '@/components/ArbreJson';
import { useConfirmation } from '@/components/Confirmation';
import { Bouton } from '@/components/Bouton';
import { Icone } from '@/components/Icone';
import { MAX_LIGNES_EXTRACTION, valeurExtraite, type LigneExtraction, type MesureExtraction } from '@/lib/partage/extraire-json';
import type { RFNode } from '@/lib/workflow-canevas';

const cls = 'w-full rounded-controle border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100';

/** Les lignes telles que le graphe les porte, même incomplètes : l'écran garde ce que la personne a commencé. */
function lignesBrutes(data: Record<string, unknown>): LigneExtraction[] {
  const brutes = Array.isArray(data.lignes) ? data.lignes : [];
  return brutes.flatMap((b): LigneExtraction[] => {
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return [];
    const o = b as Record<string, unknown>;
    return [{
      chemin: typeof o.chemin === 'string' ? o.chemin : '',
      mesure: o.mesure === 'nombre' ? 'nombre' : 'valeur',
      champCible: typeof o.champCible === 'string' ? o.champCible : '',
    }];
  });
}

/**
 * Le panneau du bloc « Extraire du JSON » (plan `docs/superpowers/plans/2026-11-11-champ-json-lot-2.md`) : un champ
 * JSON à lire, puis des lignes « chemin -> champ ». « Voir un exemple » rejoue l'Appel API du scénario qui range dans ce
 * champ, avec ses valeurs d'essai : un clic dans la réponse écrit le chemin de la ligne active, et chaque ligne montre ce
 * qu'elle extrairait.
 */
export function PanneauExtraireJson({ tenantId, data, fields, blocsDuScenario, requetes, onPatch }: {
  tenantId: string;
  data: Record<string, unknown>;
  fields: UserFieldDef[];
  blocsDuScenario: RFNode[];
  /** Les appels de la bibliothèque : leur méthode dit si rejouer l'exemple ÉCRIT chez le client. */
  requetes: ReadonlyArray<{ id: string; methode: string }> | null | undefined;
  onPatch: (p: Record<string, unknown>) => void;
}) {
  const t = useT();
  const confirmer = useConfirmation();
  const source = String(data.champSource ?? '');
  const lignes = lignesBrutes(data);
  const [active, setActive] = useState(0);
  const [exemple, setExemple] = useState<unknown>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const sources = fields.filter((f) => f.type === 'json');
  const cibles = champsEcrivables(fields, t, { avecJson: true });
  // L'Appel API qui alimente la source : c'est lui qu'on rejoue pour l'exemple.
  const amont = blocsDuScenario.find((n) => n.data.wfType === 'http' && String(n.data.champCible ?? '') === source
    && String(n.data.requestId ?? '') !== '');

  const ecrire = (suivantes: LigneExtraction[]) => onPatch({ lignes: suivantes });
  const changer = (i: number, p: Partial<LigneExtraction>) => ecrire(lignes.map((l, j) => (j === i ? { ...l, ...p } : l)));

  async function voirExemple(): Promise<void> {
    if (!amont) return;
    // Un appel qui n'est pas une lecture ÉCRIT chez le client (une commande créée, un contact supprimé) : le rejouer
    // pour un exemple se confirme, comme tout geste qui a un effet ailleurs (relecture du lot 2).
    const methode = (requetes ?? []).find((r) => r.id === String(amont.data.requestId))?.methode ?? 'GET';
    if (methode !== 'GET' && !(await confirmer({
      titre: t('Rejouer cet appel', 'Replay this call'),
      message: t(
        `Cet appel (${methode}) agit chez votre système : le rejouer pour un exemple refait ce qu’il fait, avec ses valeurs d’essai. Continuer ?`,
        `This call (${methode}) acts on your system: replaying it for an example does what it does again, with its test values. Continue?`,
      ),
      confirmer: t('Rejouer', 'Replay'),
    }))) return;
    setEnCours(true);
    setErreur(null);
    try {
      const r = await testerRequeteEnregistree(tenantId, String(amont.data.requestId));
      if (!r.ok) { setErreur(r.erreur ?? t('L’appel a échoué.', 'The call failed.')); return; }
      try {
        setExemple(JSON.parse(r.apercu ?? ''));
      } catch {
        setErreur(t('La réponse de l’appel n’est pas du JSON.', 'The call’s answer is not JSON.'));
      }
    } catch (e) {
      setErreur(e instanceof ApiError ? e.message : t('L’essai n’a pas pu partir.', 'The test could not run.'));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="extraire-panneau">
      <p className="text-xs leading-relaxed text-ink-500">
        {t(
          'Lit des valeurs dans un champ JSON (la réponse d’un bloc Appel API) et les range dans d’autres champs. Un chemin absent, ou une valeur que le type du champ refuse, vide ce champ.',
          'Reads values from a JSON field (the answer of an API call block) and stores them in other fields. A missing path, or a value the field’s type refuses, empties that field.',
        )}
      </p>

      <label className="text-xs font-medium text-ink-900">{t('Champ JSON à lire', 'JSON field to read')}</label>
      <select data-testid="extraire-source" className={`${cls} bg-white`} value={source} onChange={(e) => { onPatch({ champSource: e.target.value }); setExemple(undefined); }}>
        <option value="">{t('choisir un champ JSON…', 'choose a JSON field…')}</option>
        {sources.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
      </select>
      {sources.length === 0 && (
        <p className="text-xs text-ink-500">{t('Aucun champ JSON dans cet espace : créez-en un dans Contenu > Champs.', 'No JSON field in this workspace: create one in Content > Fields.')}</p>
      )}

      {lignes.map((l, i) => {
        const apercu = exemple === undefined || (l.chemin === '' && l.mesure === 'valeur') ? null : valeurExtraite(exemple, l);
        return (
          <div key={i} className={`flex flex-col gap-1.5 rounded-controle border p-2 ${i === active ? 'border-brand-300 bg-brand-50/40' : 'border-ink-200'}`} onFocus={() => setActive(i)} data-testid={`extraire-ligne-${i}`}>
            {/* Trois intitulés en clair : « prends ceci dans la réponse, range-le dans ce champ » (Julien, 2026-11-16 :
                trois cases sans titre ne se comprenaient pas). */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-900">{t(`Ligne ${i + 1}`, `Line ${i + 1}`)}</span>
              <button type="button" className="shrink-0 text-ink-400 hover:text-danger" aria-label={t('Retirer la ligne', 'Remove the line')} onClick={() => { ecrire(lignes.filter((_, j) => j !== i)); setActive(0); }}>
                <Icone nom="supprimer" taille="petite" />
              </button>
            </div>
            <label className="text-xs text-ink-500">
              {t('Dans la réponse', 'In the answer')}
              <input
                data-testid={`extraire-chemin-${i}`} className={`${cls} mt-0.5`} value={l.chemin} placeholder={t('ex. articles[0].nom', 'e.g. items[0].name')}
                onChange={(e) => changer(i, { chemin: e.target.value })}
              />
            </label>
            <label className="text-xs text-ink-500">
              {t('Prendre', 'Take')}
              <select data-testid={`extraire-mesure-${i}`} className={`${cls} mt-0.5 bg-white`} value={l.mesure} onChange={(e) => changer(i, { mesure: e.target.value as MesureExtraction })}>
                <option value="valeur">{t('la valeur', 'the value')}</option>
                <option value="nombre">{t('le nombre d’éléments (une liste)', 'the number of items (a list)')}</option>
              </select>
            </label>
            <label className="text-xs text-ink-500">
              {t('Ranger dans le champ', 'Store in the field')}
              <select data-testid={`extraire-cible-${i}`} className={`${cls} mt-0.5 bg-white`} value={l.champCible} onChange={(e) => changer(i, { champCible: e.target.value })}>
                <option value="">{t('choisir un champ…', 'choose a field…')}</option>
                {cibles.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
              </select>
            </label>
            {apercu !== null && (
              <p className="break-all text-xs text-ink-700" data-testid={`extraire-apercu-${i}`}>→ {apercu === '' ? t('(vide)', '(empty)') : apercu}</p>
            )}
          </div>
        );
      })}
      {lignes.length < MAX_LIGNES_EXTRACTION && (
        <button type="button" data-testid="extraire-ajouter" className="inline-flex items-center gap-1 self-start text-xs text-brand-600 hover:underline"
          onClick={() => { ecrire([...lignes, { chemin: '', mesure: 'valeur', champCible: '' }]); setActive(lignes.length); }}>
          <Icone nom="ajouter" taille="petite" />{t('Ajouter une ligne', 'Add a line')}
        </button>
      )}

      {source !== '' && (amont ? (
        <div className="flex flex-col gap-1.5">
          <Bouton variante="secondaire" taille="petite" onClick={() => void voirExemple()} disabled={enCours} data-testid="extraire-exemple">
            {t('Voir un exemple', 'See an example')}
          </Bouton>
          <p className="text-xs text-ink-500">
            {t('Rejoue le bloc Appel API qui range dans ce champ, avec ses valeurs d’essai. « Attacher… » remplit « Dans la réponse » de la ligne encadrée ; une liste attachée se compte.',
              'Replays the API call block that stores into this field, with its test values. “Attach…” fills “In the answer” of the framed line; an attached list is counted.')}
          </p>
          {erreur !== null && <p className="text-xs text-danger" data-testid="extraire-erreur">{erreur}</p>}
          {exemple !== undefined && (
            <ArbreJson payload={exemple} cheminsUtilises={lignes.map((l) => l.chemin)} branchesAttachables onAttacher={(chemin, type) => {
              // Une liste attachée se COMPTE d'office ; une valeur ou un objet se prend tel quel.
              const mesure: MesureExtraction = type === 'tableau' ? 'nombre' : 'valeur';
              if (lignes.length === 0) { ecrire([{ chemin, mesure, champCible: '' }]); setActive(0); return; }
              changer(Math.min(active, lignes.length - 1), { chemin, mesure });
            }} />
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-500" data-testid="extraire-sans-amont">
          {t('Aucun bloc Appel API ne range dans ce champ : tapez le chemin (ex. commande.statut, articles[0].nom, articles[-1] pour le dernier).',
            'No API call block stores into this field: type the path (e.g. order.status, items[0].name, items[-1] for the last one).')}
        </p>
      ))}
    </div>
  );
}
