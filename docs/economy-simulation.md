# Economy Simulation

`npm run simulate:economy` runs a deterministic V1 balance pass against the current `data/*.yaml` files and `McpMiner::GameEngine` formulas.

The report covers 30-session and 100-session projections for:

- Chonks, inventory, current and earned Space Bucks.
- Upgrade levels, purchases, affordability, and GDD section 26 payback flags.
- Order completion, payout premiums, windfall rate, and market-sale fallback flow.
- Asteroid depletion/unlocks and rare-find rates/materials.

The simulator keeps gameplay assumptions in `scripts/economy_simulation.rb` and reads gameplay data from the validated fixtures. It writes only to a temporary local state file and does not emit file paths, prompts, commands, or private work details in the report.

For machine-readable output:

```sh
ruby scripts/economy_simulation.rb --json
```

The static/runtime contract test is:

```sh
npm run test:economy-simulation
```
