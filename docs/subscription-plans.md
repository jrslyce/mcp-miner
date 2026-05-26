# MCP Miner Subscription Plans

`data/subscription_plans.yaml` is the source of truth for subscription pricing and entitlements.
The subscription is for cloud sync, portal convenience, history, exports, cosmetics, and beta
access. It must not promise stronger mining output, better rarity rolls, faster order progress, or
any other pay-to-win progression boost.

## Plans

| Plan ID | Public name | Billing | Devices | Sync | History | Included benefits |
| --- | --- | --- | ---: | --- | --- | --- |
| `free` | Free | None | 1 | 60-second batches plus manual refresh | 7 days | Basic portal, one Codex device |
| `pro_monthly` | Pro Monthly | Monthly | 5 | Near real time, currently 10-second target | 365 days | Device management, backup/restore, advanced dashboard, cosmetics, weekly digest, exports, priority beta access |
| `pro_annual` | Pro Annual | Annual | 5 | Same as Pro Monthly | 365 days | Same entitlements as Pro Monthly, charged for exactly 11 months |

The launch draft price is `$5.00` per month. Annual billing is derived by validation:

```text
pro_annual.annual_price_cents = pro_monthly.monthly_price_cents * annual_months_charged
annual_months_charged = 11
```

If the monthly price changes, update `pro_monthly.monthly_price_cents` and
`pro_annual.monthly_price_cents` together, then let validation enforce the annual total.

## Provider Price References

The config includes provider price references for Stripe and an optional crypto wallet provider.
Test environments use stable placeholder IDs. Live environments use `env:` references so production
secrets and provider IDs can be supplied by deployment configuration instead of committed directly.

Required Stripe live variables:

- `STRIPE_PRO_MONTHLY_PRICE_ID`
- `STRIPE_PRO_ANNUAL_PRICE_ID`

Required crypto live variables, if the crypto provider ships:

- `CRYPTO_PRO_MONTHLY_PLAN_ID`
- `CRYPTO_PRO_ANNUAL_PLAN_ID`

## Downgrade And Cancellation

Cancelled Pro subscriptions keep Pro benefits until `subscription_period_end`. Failed payments keep
benefits during the configured grace period, then fall back to Free.

When an account downgrades to Free with more than one linked Codex device, all devices remain
visible but only one may actively cloud sync. Extra devices are blocked from cloud sync until the
user chooses the active Free device or upgrades again.

History beyond the Free retention window is hidden from the portal and excluded from exports after
downgrade. It can be removed by retention jobs after the paid period ends. Existing backups remain
recoverable during the grace period; restore actions require Pro after that.

Cosmetics never change mining output, Space Bucks, rare-find odds, or order progress. Free cosmetics
remain available for all accounts. Earned/unlockable cosmetics are retained after downgrade once the
account owns them. Pro included and beta cosmetics can remain selected in the server record, but they
become inactive after the effective entitlement falls back to Free; the portal renders the category's
free default until Pro access returns. Retired cosmetics cannot be newly unlocked and are retained
only for accounts with server-side ownership.

## Support Notes

Support and admin tooling should be able to answer these questions from the config:

- Upgrade: switching from Free to Pro unlocks Pro entitlements as soon as billing is active.
- Cancel: Pro benefits continue until the paid period ends.
- Failed payment: Pro remains active during the grace period, then falls back to Free.
- Downgrade: one active Codex device, Free sync cadence, and Free retention apply.
- Annual renewal: annual is charged once per year at exactly 11 times the monthly price.
