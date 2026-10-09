# Industrial demand and factory selection

All 18 factory outputs pass through one shared assessment in [industryDemand.js](../src/simulation/industryDemand.js). Equal treatment means identical scoring rules; factory counts reflect the town's demand.

## Customers and purchases

[industryDemand.json](../src/data/industryDemand.json) defines daily household baskets, business operating supplies, civic supplies and maintenance for buildings, roads and owned vehicles. Profiles are simulation parameters, not calibrated real-world consumption estimates. Household requests have a daily basket budget; combined requests from one owner respect its available wallet, and public requests protect the operating reserve. Ordinary goods retain the existing retail shopping mechanism.

At each industry day, available commodities are purchased through the economy ledger and consumed from seller inventory. Unfulfilled requests remain shortages; they do not become free stock or unauthorized purchases. Public supply purchases appear in public expenditure, firms book operating inputs, and household purchases appear in consumption. Factory recipe inputs use paid inventory trades. Food processing preserves the next day's primary food requirement; crude oil is imported by the refinery account when affordable.

Physical public-service demand remains in the forecast when the protected wallet cannot fund it. The board records the unfunded quantity separately, and Council evidence reports the funding gap. This does not permit automatic spending below reserve.

State-operated factories can receive a bounded operating float for their measured input bill from treasury procurement, after protecting reserve. Private plants pay through their own accounts. This supplies an existing operation; construction still needs the normal Council/developer decision and financing path.

Construction demand is a rolling average of actual material draws, corrected by refunds. Funded construction has already consumed its initial bill, so pending-project materials are not debited twice. External demand comes from paid export history over the configured window. No prospective export-contract market or guaranteed future buyer is implied.

## Forecast and score

The forecast horizon is conservative factory construction time from `buildtime.json`, plus seven buffer days by default. Stock, current usable production, confirmed supply and pending production after completion contribute to coverage. Temporary shortages before a pending plant completes remain visible.

Input requirements propagate from final consumers through the recipe graph. Existing final-product stock offsets replacement production. Shared suppliers receive combined demand once, and recipe cycles fail explicitly. Food and crude appear as resource/import prerequisites rather than factory types.

The shared normalized score weights are:

| Term | Default weight | Evidence |
|---|---:|---|
| Shortage | 40% | Uncovered forecast consumption and pre-completion shortage |
| Impact | 20% | Customer/service affected, such as health or maintenance |
| Dependency | 15% | Share of demand from downstream production |
| Import benefit | 15% | Difference between current import and local commodity prices |
| Persistence | 10% | Unmet-demand age, capped at 14 days |

The import benefit is a price signal, not a net-profit guarantee. Existing developer financing and viability gates still apply. Warehouse capacity and catalogue order do not influence ranking; equal scores use stock cover and a stable product identifier.

## Remedies and authority

| Remedy | Meaning |
|---|---|
| Covered | Current forecast supply is sufficient |
| Await capacity | A funded project covers the forecast |
| Bridge imports | Supply will arrive, but current stock cannot bridge completion |
| Restore output | Existing capacity needs staff/training, inputs, capital or power |
| Expand capacity | Productive installed capacity is insufficient |
| Build factory | No installed producer covers the measured gap |

Usable production is constrained by staffing, capital, electricity, finite input stock and purchasing cash. A shared stock pool prevents several factories claiming the same available inputs. Pending capacity estimates use conservative lot dimensions and type floors; staffing and successful completion are not guaranteed.

The growth planner prefers a legal floor upgrade for a productive constrained plant where available. Expansion beyond floor headroom can still need a new campus. Restoration evidence names its blockers for the Council; it does not automatically recruit, train, buy supplies or build public infrastructure. Treasury owns factory/trade proposals; Land & Housing owns floor/wing proposals. Private developers retain their own acceptance, finance and site checks.

The automatic factory picker returns no product when demand is covered. Foreign-investment factory offers use the same ranking and capacity gaps, with no default steelworks fallback. A deliberately typed player request remains available. The Council still chooses its motions; a high score does not force a live model to act.

## Inspection and verification

Open **Trade** in the right panel for the complete product table. Row tooltips contain demand sources, prerequisites and reasons. Council reports include a compact five-row actionable shortlist, including restoration and bridging cases. Shortage age advances through daily simulation updates, never by opening reports.

`npm run test:industry-demand` runs pure assessment cases and a seed-1337 browser integration check. The 800-day controlled forecast rotates measured demand through every product without rendering, traffic or provider calls; it is not an 800-day autonomous city soak. The browser check covers real payments, inventory conservation, public reserve protection, save/restore, project rollback and the Trade table.
