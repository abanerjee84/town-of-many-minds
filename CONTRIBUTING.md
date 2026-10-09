# Contributing

Start with the [architecture](docs/architecture.md), [configuration](docs/configuration.md), and [kit contracts](docs/kits.md). The [SRS](BuildContracts/SRS.md) records requirements; [TODO](BuildContracts/TODO.md) records finished work and remaining failures.

1. Describe the observed behaviour and the intended change. Include the seed, game day, settings, provider/model, and decision details for simulation bugs.
2. Keep rules in the appropriate `src/data/*.json` file where an existing consumer supports them. New behaviour still needs a planner, executor or subsystem implementation.
3. Preserve Council authority over public choices, private developers' independent acceptance, exact acquired footprints, and auditable financing. Do not substitute another public action when a requested action fails.
4. Run the checks relevant to the change and `npm run build`. Browser checks need `APP_URL`; see [testing](docs/testing.md).
5. Update the relevant docs, SRS and TODO. Run `npm run docs:generate` after changing settings, routes, catalogues or package scripts, then `npm run docs:check`.

Keep credentials, generated MapNow history, screenshots from private runs, and dependency/build folders out of commits. The included README screenshot is a deliberately published seed-1337 fixture.

Explain validation results precisely. A provider-mocked test proves orchestration and guards; it does not prove that a live model will make the same choices. A calendar-speed result does not establish equal vehicle-physics throughput.
