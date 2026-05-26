# Crypto Subscription Provider Evaluation

## Decision

Crypto wallet subscriptions are **not MVP** for MCP Miner. Stripe card subscriptions remain the
only launch billing path. Crypto can be reconsidered after Stripe subscriptions, entitlement
enforcement, support tooling, tax exports, and refund workflows are proven in production.

The lowest-debt later path is **Stripe stablecoin subscriptions**, because Stripe now documents
stablecoin payments for Billing subscriptions while preserving the same Stripe subscription and
invoice lifecycle we already normalize. That path is still approval-gated/private-preview surfaced
in the docs, so it should not block launch. Third-party crypto providers should be considered only
if Stripe stablecoin access is unavailable or the product needs wallet-native behavior Stripe cannot
support.

## Sources Reviewed

- Stripe stablecoin payments docs: `https://docs.stripe.com/payments/stablecoin-payments`
- Stripe stablecoin subscriptions docs: `https://docs.stripe.com/billing/subscriptions/stablecoins`
- Stripe accept stablecoin payments docs: `https://docs.stripe.com/payments/accept-stablecoin-payments`
- Loop Crypto recurring payments docs: `https://docs.loopcrypto.xyz/stripe/recurring-payments`
- Loop Crypto overview / wind-down notice: `https://docs.loopcrypto.xyz/`
- OrcaRail subscriptions docs: `https://docs.orcarail.com/docs/subscriptions/overview/`
- RecurCrypto API docs: `https://www.recurcrypto.com/developers/api`
- Acta Billing intro: `https://docs.acta.link/billing_intro`
- Coinflow docs: `https://docs.coinflow.cash/`
- Coinbase recurring buys help: `https://help.coinbase.com/customer/en/portal/articles/2168187-how-can-i-create-or-cancel-a-recurring-transaction-?b_id=13521`

## Provider Comparison

| Provider | Recurring model | Custody / authorization | Renewal failure handling | Webhooks / lifecycle | Operational fit |
| --- | --- | --- | --- | --- | --- |
| Stripe Stablecoin Payments | Stripe Billing subscriptions can support stablecoin payments while settling to the Stripe balance. | Stripe-hosted wallet payment flow; currently approval-gated/private-preview for subscriptions. | Uses Stripe Billing lifecycle and existing dunning/reporting concepts. | Native Stripe subscription, invoice, payment, and webhook lifecycle. | Best later path if account access is approved because it avoids a second billing system. |
| Loop Crypto | Recurring crypto payments tied to Stripe invoices or supported billing systems. | Customer authorizes wallet payment rails; Loop collects when invoices are due. | Retries collection and customer reminders around due dates. | Stripe-adjacent lifecycle would have been clear. | Do not select now: current docs say Loop is folding into Lead and rolling off its current product. |
| OrcaRail | Subscription resource with payment-link or auto-charge cycles. | EVM allowance / `transferFrom` or Solana delegation for auto-charge; no Bitcoin auto-charge. | Conventional subscription lifecycle, but allowance/delegation UX and depleted balances need product support. | API-oriented subscription lifecycle. | Interesting, but too much wallet authorization support surface for MVP. |
| RecurCrypto | Plans, checkout URLs, subscriptions, lifecycle webhooks. | Current focus is Polygon + USDC. | Subscription lifecycle events include failed payments. | Merchant webhooks for subscription events. | Promising but early/narrow chain-token scope. Needs sandbox proof and finance review. |
| Acta Billing | Products, paylinks, subscriptions, webhook notifications. | EVM stablecoin-focused payment acceptance. | Payment statuses include initiated, confirmed, failed, expired. | Webhook notifications. | Good API shape, but needs deeper diligence on custody, tax, and production references. |
| Coinflow | Broader payment infrastructure with subscriptions and crypto settlement. | Mixed traditional and crypto payment rails. | Payment-platform managed. | Platform docs mention subscription support. | Could become relevant, but overlaps with Stripe and needs business diligence. |
| Coinbase Commerce / Coinbase app recurring buys | Coinbase app supports recurring asset buys, not merchant SaaS wallet subscriptions. | Coinbase-hosted consumer exchange behavior. | User-managed recurring buys. | Not a merchant subscription API fit. | Do not use for MCP Miner subscriptions. |

## Risks

- Wallet recurring payments are not as reversible or familiar as card subscriptions.
- Stripe stablecoin subscriptions are approval-gated/private-preview in the docs and may not be
  available to the MCP Miner account at launch.
- Allowance/delegation models can fail because of insufficient token balance, revoked allowance,
  chain congestion, gas, token contract changes, or user wallet confusion.
- Refunds and support workflows are more manual than card refunds.
- Tax exports need stable fiat valuation, transaction hashes, chain, token, payer wallet, and
  settlement records.
- KYC/AML duties may expand depending on provider, settlement model, geography, and custody.
- Failed renewal behavior must be plain enough for support to explain without engineering help.
- Webhook replay and idempotency must be equivalent to Stripe before entitlements can change.

## Non-Goals

- No crypto provider may write entitlements directly.
- No on-chain event may grant Pro unless a trusted backend maps it into the normalized billing
  projection.
- No MVP support for volatile-token pricing. Stablecoin-only if this returns later.
- No promise of anonymous paid access; Firebase Auth remains the account boundary.
- No wallet payment path should bypass Stripe's already-built entitlement and downgrade behavior.

## Required Provider Abstraction

Every provider must normalize into this internal object before any entitlement can change:

```json
{
  "provider": "stripe_or_crypto_provider",
  "providerCustomerId": "provider_customer_or_wallet_reference",
  "providerSubscriptionId": "provider_subscription_reference",
  "plan": "pro_monthly",
  "billingStatus": "active",
  "currentPeriodEnd": "2026-06-24T00:00:00.000Z",
  "cancelAtPeriodEnd": false,
  "syncCadenceSeconds": 10,
  "maxDevices": 5,
  "historyRetentionDays": 365,
  "features": {}
}
```

Provider adapters may only write:

- `/players/{uid}/billing/current`
- `/players/{uid}/entitlements/current`
- provider audit events such as `billingWebhookEvents/{eventId}`

## Launch Recommendation

Do not implement crypto subscriptions in the launch milestone. Keep the config placeholders from
`data/subscription_plans.yaml`, but leave crypto disabled until a provider passes sandbox lifecycle
tests, account approval, and finance review.

Suggested later path:

1. Finish Stripe launch.
2. Request Stripe stablecoin subscription access and prove the Stripe sandbox lifecycle if approved.
3. Add provider adapter interface with Stripe as the reference implementation.
4. Compare one non-Stripe-native stablecoin provider, likely RecurCrypto or OrcaRail, only if
   Stripe stablecoin subscriptions are unavailable or insufficient.
5. Require lifecycle proof for subscribe, renew, fail, recover, cancel-at-period-end, immediate
   cancel, refund/support note, webhook replay, and export.

## Implementation Estimate

- Stripe stablecoin subscription pilot: 1-3 days if account access is approved.
- Provider adapter interface: 1-2 days after Stripe webhooks stabilize.
- Non-Stripe-native stablecoin sandbox: 4-7 days because wallet authorization, failed renewal, and
  tax export behavior need deeper testing.
- Production launch hardening: 1-2 weeks after a provider passes sandbox, mostly support, finance,
  reconciliation, and incident tooling.
