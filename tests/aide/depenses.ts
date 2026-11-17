import type { BudgetAssistantDeps, DepenseStore } from '../../src/assistant/budget';

/**
 * Le compteur de dépense en mémoire, avec la sémantique de `PgDepenseStore` : `reserver` vérifie et inscrit dans le
 * même pas (le `where` de l'upsert, relu sous le verrou de la ligne), `ajouter` ne descend jamais sous zéro. Chaque
 * mouvement est gardé, pour qu'un test lise ce qui a été réservé puis soldé.
 */
export class DepensesMemoire implements DepenseStore {
  total: number;
  readonly mouvements: number[] = [];

  constructor(depart = 0) {
    this.total = depart;
  }

  async lire(): Promise<number> {
    return this.total;
  }

  async ajouter(_tenantId: string, _mois: string, microEuros: number): Promise<void> {
    const montant = Math.round(microEuros);
    if (montant === 0) return;
    this.mouvements.push(montant);
    this.total = Math.max(0, this.total + montant);
  }

  async reserver(_tenantId: string, _mois: string, microEuros: number, plafondMicro: number): Promise<boolean> {
    if (this.total >= plafondMicro) return false;
    this.mouvements.push(microEuros);
    this.total += microEuros;
    return true;
  }
}

/** L'enveloppe de 2 € des assistants, au taux 1 (un dollar vaut un million de micro-euros), sur ce compteur. */
export function budgetEnMemoire(depenses: DepenseStore = new DepensesMemoire()): BudgetAssistantDeps {
  return { depenses, plafondEuros: 2, tauxEurParDollar: 1 };
}
