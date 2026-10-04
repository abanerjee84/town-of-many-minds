import rules from '../data/economyRules.json' with { type: 'json' };

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

/**
 * Economic parameters live in one place so policy and simulation code do not
 * grow their own, incompatible magic numbers. Rates are annual unless a
 * property explicitly says otherwise.
 */
export const ECON = deepFreeze({ ...rules });

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
  // Opening capitalization is the explicit settlement that makes the
  // configured day-one treasury a post-founding balance. It is not revenue,
  // spending, or GDP; it only reconciles the opening balance after founding
  // fleet/assets have been booked.
  'opening_capitalization',
  'inheritance', 'pension', 'dividend', 'reserve_transfer',
  // External capital and concession flows are separate from ordinary private
  // investment so the treasury and KPI ledgers can attribute FDI outcomes.
  'foreign_tax', 'foreign_investment',
  // Municipal own-source revenue. These are distinct from broad taxes so
  // the Council can see whether transit, tourism, private land use, and
  // metered utilities are paying for the services they consume.
  'transit_fare', 'business_license', 'land_lease', 'tourism_tax', 'utility_fee',
  // Banking. Moving cash between a household's wallet and its savings at the
  // bank is a real transfer between two accounts, so it goes through the ledger
  // like any other — but it is NOT income, expenditure or investment, and
  // folding it into an existing category would corrupt that category's totals.
  'deposit', 'withdrawal',
  // A departing citizen's unclaimed wallet cash leaving the town with them.
  'estate_settlement'
]);

const projectFinance = rules.projectFinance || {};

export const PUBLIC_PROJECT_TYPES = Object.freeze(new Set(projectFinance.publicTypes || [
  'road', 'roadup', 'bridge', 'footway', 'park', 'plaza', 'parking', 'civic',
  'utility', 'resource', 'clear', 'rezone', 'upzone', 'annex', 'district',
  'school', 'hospital', 'stadium', 'museum', 'library', 'zoo', 'amphitheatre'
]));

export const PRIVATE_PROJECT_TYPES = Object.freeze(new Set(projectFinance.privateTypes || [
  'house', 'shop', 'office', 'factory', 'mall', 'hotel', 'resort', 'tower', 'renovate',
  'tierup', 'upgrade', 'wing', 'archetype'
]));

export const PUBLIC_PROGRAM_TYPES = Object.freeze(new Set(projectFinance.publicPrograms || ['social_housing']));
export const PRIVATE_OPPORTUNITY_EXPIRY_DAYS = Math.max(1, Number(projectFinance.privateOpportunityExpiryDays) || 14);
export const PRIVATE_OPPORTUNITY_LIMIT = Math.max(1, Number(projectFinance.privateOpportunityLimit) || 8);
