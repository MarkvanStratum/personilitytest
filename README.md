# Personality Discovery — premium edition

## Deployment

Node 22+, Dockerfile, HTTP port 3000. Create a PostgreSQL database on Northflank and configure `DATABASE_URL` (SSL certificate validation is enabled by default; `DATABASE_SSL=disable` only for trusted local PostgreSQL).

Environment variables:
- `DATABASE_URL`: PostgreSQL connection string (required for assessments and purchases)
- `STRIPE_SECRET_KEY`: Stripe test or live secret key
- `STRIPE_PUBLISHABLE_KEY`: matching publishable key
- `STRIPE_WEBHOOK_SECRET`: signing secret for webhook endpoint
- `CHECKOUT_SIGNING_SECRET`: random 32+ character string for external checkout tokens
- `ADMIN_PREVIEW_SECRET`: private random 20+ character string; entered in admin preview on results page
- `NODE_ENV=production` on HTTPS deployment
- `CONSULTATION_ENABLED=true` only after a real instructor and booking process are ready (otherwise premium checkout is blocked)

Webhook URL: `https://YOUR-DOMAIN/api/stripe/webhook`
Subscribe to `payment_intent.succeeded`, `payment_intent.payment_failed`, and `payment_intent.canceled`.

## Pricing

- starter £22.95 (2295 pence)
- premium £37.95 (3795 pence)

**Important:** Premium advertises an instructor consultation. Do not accept purchases for a service you cannot fulfill. The booking feature is not implemented; arrange instructor availability and scheduling before activating premium sales.

## Testing

Use Stripe **test-mode** keys and Stripe test cards; no real charge. For nonpayment preview, enter ADMIN_PREVIEW_SECRET under Administrator report preview. The secret is checked on the server. Do not expose it in public files.

## External checkout compatibility

Routes preserved: `/api/create-promo-checkout-link`, `/api/checkout-link/:token`, `/api/stripe/config`, `/api/stripe/create-payment-intent`, `/api/stripe/payment-status?reference=...`. Response keys preserved (`url`, `plan`, `publishableKey`, `clientSecret`, `reference`, `status`). The assessment site **additionally requires `assessmentId`** on checkout creation and PaymentIntent requests, and an assessment access cookie. The included `external-checkout.html` adapts the uploaded Albanian payment page for this. Your original unmodified external payment file cannot work as-is because it doesn't send `assessmentId`, uses a different plan identifier, and redirects to `/` after payment.

This app currently uses Stripe's card Element. The server confirms completed payment before granting access, and records entitlement in PostgreSQL. Assessment access is tied to a secure HttpOnly browser cookie; clearing cookies or changing devices will prevent access until an account/email recovery mechanism is added. Add authenticated recovery before a commercial launch.

## Content and rights

Premium text is original, independently written, and does not reproduce 16Personalities descriptions or illustrations. Personality.fyi questionnaire rights and commercial usage must be verified independently before selling. This site is not an official MBTI assessment and is not a clinical instrument. The provider API has not been live-tested in this build.

## Limitations before launch

Add an account or secure email recovery flow, refund and legal pages, real consultation scheduling, customer support details, confirmation emails, and verify the API provider's commercial permissions and reliability. Test all Stripe webhook and 3DS paths in test mode before going live.
