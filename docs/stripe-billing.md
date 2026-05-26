# Stripe Billing

MCP Miner Pro uses Stripe Checkout for new subscriptions and Stripe Customer Portal for existing
customers. The portal must treat Stripe webhooks as the source of truth: a successful Checkout
redirect is not enough to grant Pro. Pro is granted only after webhook processing writes the
server-owned billing and entitlement projections.

## Required Configuration

Firebase Functions need these secrets or environment variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_MONTHLY_PRICE_ID`
- `STRIPE_PRO_ANNUAL_PRICE_ID`
- `MCP_MINER_DASHBOARD_URL`

The annual Stripe Price must be exactly eleven times the monthly price. The local data validator
enforces this in `data/subscription_plans.yaml`; the Stripe Dashboard should mirror that same
monthly amount and 11x annual amount.

## Callable Functions

- `createCheckoutSession`
  - Requires Firebase Auth.
  - Accepts `plan` as `pro_monthly` or `pro_annual`.
  - Rejects a client-supplied `uid` that does not match `request.auth.uid`.
  - Creates or reuses a Stripe Customer bound with `firebaseUid` metadata.
  - Sends existing Pro subscribers to Customer Portal instead of duplicate Checkout.
  - Writes `/players/{uid}/billing/current` as `checkout_pending`, which still evaluates as Free.

- `createCustomerPortalSession`
  - Requires Firebase Auth.
  - Requires an existing Stripe customer ID in the server-owned billing projection.
  - Returns a Stripe-hosted Customer Portal URL.

## Manual Stripe Test Plan

Run this only after test-mode Stripe secrets and Price IDs are configured:

- Successful card payment creates a Checkout Session and returns to `?billing=success`.
- 3DS/authentication-required card completes the authentication flow without granting Pro before webhook projection.
- Failed card payment returns to Checkout failure behavior and leaves entitlements Free.
- Expired Checkout Session does not create Pro entitlements.
- Stripe Dashboard shows Customer metadata `firebaseUid`.
- Stripe Dashboard shows Subscription metadata `firebaseUid`, `plan`, and `source`.
- Existing active subscriber clicking upgrade/manage is sent to Customer Portal.

## Webhooks

Configure Stripe to send these events to the `stripeWebhook` HTTPS Function:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

Webhook processing verifies the Stripe signature with `STRIPE_WEBHOOK_SECRET`, records each Stripe
event ID in `billingWebhookEvents/{eventId}`, and ignores duplicate event IDs. Unknown Price IDs or
missing `firebaseUid` metadata are audited but do not write Pro entitlements.
