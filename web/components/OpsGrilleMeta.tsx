'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useT, type Locale } from '@/lib/i18n';
import { inputCls } from '@/lib/ui';
import { ApiError, lireGrilleMetaOps, type GrilleMetaOps, type TarifGrilleOps } from '@/lib/api';

/**
 * LA GRILLE DE META EN VIGUEUR, PRIX PAR PRIX, DANS `/ops` (demandée par Julien le 2026-11-02 : « je vois toujours pas la
 * grille des prix Meta dans ops »). Un marché par ligne, une catégorie par colonne : le prix client (commission globale
 * comprise, calculé par le serveur avec la formule de la garde) et, dessous, le tarif de Meta. Une recherche par pays
 * trouve aussi le marché régional qui le contient (la Belgique est dans « Reste de l'Europe de l'Ouest »), et le pays
 * nommé qui partage son indicatif avec un territoire (Guernesey, au +44, est facturé comme le Royaume-Uni). Seul le tarif
 * de base est montré : les paliers de volume ne sont pas chargés. Sans la route (une API plus ancienne), la carte le dit.
 */
const CATEGORIES: ReadonlyArray<{ cle: TarifGrilleOps['categorie']; fr: string; en: string }> = [
  { cle: 'marketing', fr: 'Marketing', en: 'Marketing' },
  { cle: 'utility', fr: 'Utilitaire', en: 'Utility' },
  { cle: 'authentication', fr: 'Authentification', en: 'Authentication' },
  { cle: 'authentication_international', fr: 'Authentification internationale', en: 'International authentication' },
  { cle: 'service', fr: 'Service', en: 'Service' },
];

/** Les marchés régionaux de Meta, en français ; un pays nommé prend le nom que lui donne le navigateur. */
const REGIONS_FR: Readonly<Record<string, string>> = {
  north_america: 'Amérique du Nord',
  rest_of_africa: 'Reste de l’Afrique',
  rest_of_asia_pacific: 'Reste de l’Asie-Pacifique',
  rest_of_central_eastern_europe: 'Reste de l’Europe centrale et orientale',
  rest_of_western_europe: 'Reste de l’Europe de l’Ouest',
  rest_of_latin_america: 'Reste de l’Amérique latine',
  rest_of_middle_east: 'Reste du Moyen-Orient',
  other: 'Autres pays',
};

function nomDePays(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale === 'en' ? 'en' : 'fr'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function prix(microEur: number, locale: Locale): string {
  return `${(microEur / 1_000_000).toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} €`;
}

/** Une recherche sans accents ni casse : « belgique » trouve « Belgique ». */
function plat(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

interface LigneMarche {
  cle: string;
  nom: string;
  /** Les pays d'un marché régional, ou les territoires au même indicatif qu'un pays nommé par Meta, nommés. */
  pays: string[];
  region: boolean;
  tarifs: Partial<Record<TarifGrilleOps['categorie'], TarifGrilleOps>>;
}

export function OpsGrilleMeta({ token }: { token: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [donnees, setDonnees] = useState<GrilleMetaOps | null | undefined>(undefined);
  // 404 : l'API n'a pas encore la route ; autre chose : une lecture en échec, dite comme telle.
  const [absente, setAbsente] = useState(false);
  const [recherche, setRecherche] = useState('');

  useEffect(() => {
    let vivant = true;
    lireGrilleMetaOps(token)
      .then((r) => { if (vivant) setDonnees(r); })
      .catch((e: unknown) => { if (vivant) { setAbsente(e instanceof ApiError && e.status === 404); setDonnees(null); } });
    return () => { vivant = false; };
  }, [token]);

  const lignes = useMemo<LigneMarche[]>(() => {
    if (!donnees || donnees.grille === null) return [];
    const parMarche = new Map<string, LigneMarche>();
    for (const m of donnees.marches) {
      const region = !/^[A-Z]{2}$/.test(m.cle);
      parMarche.set(m.cle, {
        cle: m.cle,
        nom: region ? (locale === 'en' ? m.nom : (REGIONS_FR[m.cle] ?? m.nom)) : nomDePays(m.cle, locale),
        // Un pays nommé ne liste que ses territoires au même indicatif (le Royaume-Uni : Guernesey, Jersey, île de Man).
        pays: m.pays.filter((p) => p !== m.cle).map((p) => nomDePays(p, locale)).sort((a, b) => a.localeCompare(b, locale)),
        region,
        tarifs: {},
      });
    }
    // Seul le tarif de base (palier 0) : c'est celui de la garde.
    for (const tarif of donnees.tarifs) {
      const l = parMarche.get(tarif.marche);
      if (l && tarif.palier === 0) l.tarifs[tarif.categorie] = tarif;
    }
    const avecTarifs = [...parMarche.values()].filter((l) => Object.keys(l.tarifs).length > 0);
    // La France d'abord (le prix qu'on relit le plus), puis les pays nommés par ordre alphabétique, les marchés régionaux
    // ensuite, « Autres pays » en dernier.
    const rang = (l: LigneMarche): number => (l.cle === 'FR' ? -1 : l.cle === 'other' ? 2 : l.region ? 1 : 0);
    return avecTarifs.sort((a, b) => rang(a) - rang(b) || a.nom.localeCompare(b.nom, locale));
  }, [donnees, locale]);

  const visibles = useMemo(() => {
    const q = plat(recherche.trim());
    if (q === '') return lignes;
    return lignes.filter((l) => plat(l.nom).includes(q) || l.pays.some((p) => plat(p).includes(q)));
  }, [lignes, recherche]);

  if (donnees === undefined) return null;
  if (donnees === null) {
    return absente ? (
      <p className="mt-4 text-xs text-ink-500" data-testid="ops-grille-meta-prix-absente">
        {t('Le détail des prix est indisponible sur cette instance : l’API n’a pas encore la route.', 'Price details are unavailable on this instance: the API does not have the route yet.')}
      </p>
    ) : (
      <p className="mt-4 text-xs text-danger-700" data-testid="ops-grille-meta-prix-erreur">
        {t('Le détail des prix n’a pas pu être lu. Rechargez la page.', 'Price details could not be read. Reload the page.')}
      </p>
    );
  }
  if (donnees.grille === null) return null;

  return (
    <div className="mt-5" data-testid="ops-grille-meta-prix">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs text-ink-500">
          {t(
            `Prix d’un message, commission de ${donnees.commissionPct} % comprise, et dessous le tarif de Meta. Une Entreprise à commission négociée paie la sienne. Un pays absent de la liste est facturé au tarif « Autres pays ». Une authentification se provisionne au plus cher de ses deux tarifs, puis l’accusé de Meta la ramène au tarif facturé.`,
            `Price of a message, ${donnees.commissionPct}% commission included, and below it Meta’s rate. An Enterprise with a negotiated commission pays its own. A country missing from the list is billed at the “Other” rate. An authentication is reserved at the higher of its two rates, then Meta’s receipt brings it back to the billed rate.`,
          )}
        </p>
        <label className="grid gap-1">
          <span className="text-xs font-medium text-ink-900">{t('Chercher un pays', 'Find a country')}</span>
          <input
            className={`${inputCls} w-56`} value={recherche} onChange={(e) => setRecherche(e.target.value)}
            placeholder={t('par exemple : Belgique', 'for example: Belgium')} data-testid="ops-grille-meta-recherche"
          />
        </label>
      </div>
      <div className="mt-3 max-h-[28rem] overflow-auto rounded-carte border border-ink-200">
        <table className="w-full min-w-[760px] text-sm" data-testid="ops-grille-meta-table">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
              <th className="px-4 py-3 font-medium">{t('Pays ou marché', 'Country or market')}</th>
              {CATEGORIES.map((c) => (
                <th key={c.cle} className="px-3 py-3 text-right font-medium">{t(c.fr, c.en)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.map((l) => (
              <tr key={l.cle} className="border-b border-ink-100 last:border-0" data-testid={`ops-grille-meta-${l.cle}`}>
                <td className="px-4 py-2 align-top">
                  <div className="font-medium text-ink-900">{l.nom}</div>
                  {l.pays.length > 0 && <div className="mt-0.5 max-w-xs text-xs text-ink-500">{l.pays.join(', ')}</div>}
                </td>
                {CATEGORIES.map((c) => {
                  const tarif = l.tarifs[c.cle];
                  return (
                    <td key={c.cle} className="px-3 py-2 text-right align-top tabular-nums" data-categorie={c.cle}>
                      {tarif ? (
                        <>
                          <div className="text-ink-900" data-prix="client">{prix(tarif.clientMicroEur, locale)}</div>
                          <div className="text-xs text-ink-500" data-prix="meta">{t('Meta', 'Meta')} {prix(tarif.metaMicroEur, locale)}</div>
                        </>
                      ) : (
                        <span className="text-xs text-ink-500">{t('sans objet', 'n/a')}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={CATEGORIES.length + 1} className="px-4 py-3 text-xs text-ink-500">
                  {t('Aucun marché ne correspond à cette recherche. Un pays absent de la grille est facturé au tarif « Autres pays ».', 'No market matches this search. A country missing from the rate card is billed at the “Other” rate.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
