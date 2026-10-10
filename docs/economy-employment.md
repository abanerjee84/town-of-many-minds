# Economy, employment and production

Factory selection now uses a shared demand assessment across all products. See [industrial demand](industry-demand.md) for customer profiles, paid consumption, supply-chain forecasting, pending capacity and remedies.

## Who pays and who decides

The government, households, private businesses, developer, contractor, bank and foreign investors have separate economic roles. `EconomySystem.transfer()` records named movements between accounts; treasury growth is not inferred from a single state's project price.

The founding treasury is $1,000,000. The base operating floor is $250,000, with runway and reserve rules in `economyRules.json`. A public request can fail a financing quote even when cash is positive because spending would break the protected reserve.

Council instructions create public mandates or private opportunities according to project type and owner. Private housing, shops, offices and factories require developer acceptance based on demand, finance, project capacity and site eligibility. The recommendation is considered immediately; rejection is a recorded outcome, not a delayed implied commitment. Developers also seek work on their independent review cadence.

Public schools, clinics, hospitals and other civic facilities are public outcomes. Some public mandates can use developer-funded/PPP arrangements when the existing finance path permits them. This does not turn a public-service choice into an independently chosen private actor. `DEVELOP_HOUSING program=social_housing` is an explicit public housing programme; ordinary housing is not automatically a treasury purchase.

## Treasury inflows and outflows

Revenue includes income, sales, property and corporate taxes; permit fees; business licences; land leases; utility fees; collected transit fares; tourism occupancy tax; and configured foreign-project tax flows. Trade, foreign investment and bonds have their own ledger categories and recipient accounts. Capital raised by a bond is not recurring operating revenue.

Expenditure includes public payroll, basic operations, welfare and pensions, funded public work, schemes and subsidies, public fleet procurement/upkeep, and debt service. Construction bills split labour, domestic materials, contractor margin, imports and fees. Not every project visible in the town is paid from treasury.

`SLASH_SPENDING` changes eligible public spending policy. It does not generate a matching income transfer. Compare the fiscal flow report and account ledger when interpreting a treasury movement. Snapshots, capital flows and daily operating totals describe different periods and categories.

`BOND_ISSUE` provides a Council-authorized finance action with interest and maturity obligations. Bank/business credit remains distinct from government bonds. Reserve safety and essential remedial finance are checked before optional work; a resolved finance prerequisite must not leave a permanent bond directive.

## Jobs, vacancies and training

Unemployment is a labour-force measure, not total residents minus total building capacity. Children, other non-working life stages and unsuitable qualifications do not all become employable simply because a desk exists.

The employment pipeline uses local matching, education/job requirements, retraining, business hiring, public/site/civic staffing and explicit workforce-training schemes. Wage affordability and employer arrears can prevent hiring into physically available capacity. Inspect the Employment and Staff evidence for jobless residents, private vacancies, site/civic gaps and training eligibility.

`HIRE_WORKERS` first matches qualified idle locals through the employer staffing pass, then backstops remaining fundable vacancies with housed newcomers. Resource crews are paid by the contractor operator; its cash and cumulative wage commitments govern their recruitment, rather than the town's public reserve. Lost site output produces staffing evidence before more generating capacity is considered; unfunded payroll or missing credentials/housing remains explicit. A partial hiring success still reports unresolved primary-resource gaps.

`HIRE_WORKERS` addresses a fundable unfilled staffing gap. It cannot solve unemployment when all eligible posts are filled. Unemployment remedies can include viable offices, industrial production, needed public services, subsidies or `workforce_training`. `OPEN_SHOP` is appropriate only when there is unmet retail demand; repeatedly opening shops into a saturated market is not a general employment policy.

Offices create service-sector desks and business activity. Government offices supply public staff capacity. Civic operations, utilities, food/resource sites, tourism and foreign projects create other work channels. Empty capacity and staffed operating capacity are deliberately separate statistics.

## Factories and commodity chains

There are 18 declared factory types and 19 storehouse commodities in the current industry catalogue. See the generated [factory/recipe tables](reference/catalogues.md#factories-and-input-recipes) for every type and input. Crude oil is an imported raw input, not a phantom local producer.

Production is capacity-scaled. The industry code derives rated output from the building's capacity relative to its configured reference. Daily operation then gates that rating on staff utilization, utilities, working capital, input inventory and payroll state, with bounded seeded variation. An empty or payroll-arrears works cannot operate simply because it has many floors.

The same capacity scale feeds input draw, working capital, revenue and inspector output. Food processors draw from primary food reserves; refineries draw crude through the priced import path. Advanced production consumes named upstream goods rather than inventing a second isolated stock pool.

Industrial priority compares all producible outputs using stock fill, zero-stock emergencies, cover, downstream consumption and existing capacity. A low cement store must not default to sawmill merely because lumber appears first. An explicit typed factory request still undergoes its own placement and private viability checks.

Prices are deterministic functions of town signals within the configured bounds. Commodity scarcity moves buy/sell prices, while construction uses eligible housing/congestion/fiscal terms. Storehouse sparklines show bounded recent day-level price observations; they are not a financial-market price forecast.

## Foreign investment and tourism

`SOLICIT_FDI` opens the foreign-investment offer process. `APPROVE_CONCESSION` chooses an eligible offer. Configured investors and industrial-park, logistics, transit and utility projects use the normal site, construction, finance and staffing paths. Offers have cadence/expiry and active-project limits; commitments, inflows, taxes and repatriation are recorded separately.

Hotels and resorts are private commercial lodging. Room capacity, appeal, demand and occupancy determine booking/revenue evidence. Occupancy tax contributes to municipal revenue. Tourism visitors are measured separately from residential beds; current tourism accounting is a simplified aggregate model, not a promise of one rendered visitor agent per room.

Sources: [economy](../src/simulation/economy.js), [industry](../src/simulation/industry.js), [foreign investment](../src/simulation/foreignInvestment.js), [economic rules](../src/data/economyRules.json), and [agency regression](../scripts/_agency_boundary_check.mjs).
