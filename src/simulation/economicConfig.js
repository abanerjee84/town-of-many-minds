/**
 * Economic parameters live in one place so policy and simulation code do not
 * grow their own, incompatible magic numbers. Rates are annual unless a
 * property explicitly says otherwise.
 */
export const ECON = Object.freeze({
  tax: Object.freeze({ income: 0.18, sales: 0.08, property: 0.03, corporate: 0.16 }),
  wages: Object.freeze({ minimumAnnual: 18000, pensionAnnual: 18000 }),
  consumption: Object.freeze({ propensity: 0.72, dailyMinimum: 4 }),
  business: Object.freeze({
    startupCash: 250000,
    // Long-horizon PPP capital: utilities, resource capacity and civic shells
    // can keep a successful town growing while the public treasury protects
    // its operating runway. The developer still pays real project costs and
    // can run out; this is a regional capital pool, not free money.
    developerCash: 12000000,
    contractorCash: 250000,
    retailOpeningInventory: 240,
    depreciationRate: 0.04,
    // A proprietor's own borrowing room, as a multiple of the firm's equity.
    // Zero capital means zero posts advertised — the owner cannot fund a hire.
    ownerCredit: 1.5,
    // A private developer needs this much unmet retail capacity before it
    // commissions a shop of its own accord (people per unlet customer seat).
    developerDemandPerSeat: 90,
    // ...and keeps this much back in hand rather than spending it all.
    developerReserve: 150000
  }),
  construction: Object.freeze({
    labour: 0.35,
    domesticMaterials: 0.35,
    contractorMargin: 0.15,
    importedInputs: 0.1,
    feesTaxes: 0.05,
    relocationShare: 0.08,
    demolitionShare: 0.04
  }),
  property: Object.freeze({
    landWeight: 0.75,
    qualityPerBudgetTier: 0.12,
    annualRentYield: 0.045
  }),
  credit: Object.freeze({
    businessRate: 0.065,
    governmentBondRate: 0.05,
    businessLimitMultiple: 1.5,
    bondMaturityDays: 365,
    /**
     * Multiple of the contractual rate charged once a loan is in arrears.
     *
     * Arrears has to cost something. A missed payment used to be terminal — the
     * `status !== 'current'` guard skipped the loan for ever — so a single bad
     * day converted a loan into permanent, unrecoverable, interest-free credit.
     * At 2x, defaulting is worse than paying, which is the only arrangement in
     * which a rational borrower pays.
     */
    arrearsPenalty: 2
  }),
  /**
   * Phase 1 of banking: household deposit accounts, and nothing else. A
   * household splits its money between the wallet it spends from and savings it
   * holds at the bank; the bank owes every household the balance of its savings.
   *
   * Interest is deliberately ZERO here. Paying it means the bank creates credit
   * rather than moving existing money, which changes the economy's money
   * conservation invariant and belongs with lending, in the phase after this.
   * Loans, credit limits and the rate that moves with a credit rating are all
   * Phase 2; this phase only has to make savings real.
   */
  banking: Object.freeze({
    // Share of a newly arrived citizen's opening cash banked on day one, so a
    // household has a savings position from the start and "can I afford this?"
    // is a real question immediately. Goes through a real transfer, because the
    // bank has to actually receive the money.
    openingSavingsShare: 0.4,
    // Cash a household keeps in the wallet to cover day-to-day spending. Only
    // the surplus above this is swept into savings at the day boundary, so
    // nobody starves their own spending to build a savings balance.
    liquidFloor: 400,
    // Share of the surplus above the floor that is banked each day. Below 1 so
    // a household banks steadily rather than all at once on one lucky day.
    savingsRate: 0.6
  }),
  government: Object.freeze({
    fixedDailySpend: 420,
    perResidentDailySpend: 6,
    warningRunwayDays: 7,
    operatingRunwayDays: 30,
    // Reserve motions are allowed to be repeated by the LLM or a player.
    // The target makes that operation idempotent instead of moving another
    // percentage of the remaining treasury on every call.
    reserveTargetShare: 0.25,
    // Reserve building must not consume the cash needed for normal operations.
    reserveOperatingFloor: 250000
  })
});

export const SECTOR = Object.freeze({
  HOUSEHOLD: 'household',
  BUSINESS: 'business',
  GOVERNMENT: 'government',
  BANK: 'bank',
  EXTERNAL: 'external',
  DEVELOPER: 'developer',
  RESERVE: 'reserve'
});

export const TRANSACTION_CATEGORIES = Object.freeze([
  'wage', 'purchase', 'rent', 'income_tax', 'sales_tax', 'property_tax',
  'corporate_tax', 'permit_fee', 'private_investment', 'public_investment',
  'acquisition_compensation', 'relocation_support', 'subsidy', 'welfare',
  'government_procurement', 'government_payroll', 'loan', 'loan_repayment',
  'interest', 'import', 'export', 'bond_issue', 'bond_interest',
  'bond_repayment', 'reserve_allocation', 'project_reversal', 'owner_distribution',
  'immigration_capital_inflow', 'emigration_capital_outflow',
  'inheritance', 'pension', 'dividend', 'reserve_transfer',
  // Banking. Moving cash between a household's wallet and its savings at the
  // bank is a real transfer between two accounts, so it goes through the ledger
  // like any other — but it is NOT income, expenditure or investment, and
  // folding it into an existing category would corrupt that category's totals.
  'deposit', 'withdrawal',
  // A departing citizen's unclaimed wallet cash leaving the town with them.
  'estate_settlement'
]);

export const PUBLIC_PROJECT_TYPES = Object.freeze(new Set([
  'road', 'roadup', 'bridge', 'footway', 'park', 'plaza', 'parking', 'civic',
  'utility', 'resource', 'clear', 'rezone', 'upzone', 'annex', 'district',
  'school', 'hospital', 'stadium', 'museum', 'library', 'zoo', 'amphitheatre'
]));

export const PRIVATE_PROJECT_TYPES = Object.freeze(new Set([
  'house', 'shop', 'office', 'factory', 'mall', 'hotel', 'tower', 'renovate',
  'tierup', 'upgrade', 'wing', 'archetype'
]));
