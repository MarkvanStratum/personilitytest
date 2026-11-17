# External checkout and website checkout

Website assessment payments remain assessment-bound and use GBP £22.95 / £37.95. Existing report entitlements and the Stripe webhook remain unchanged.

External HTML templates may be added without a fixed count. Put each file in `public/` and configure its exact server-side amount/currency/product via `EXTERNAL_CHECKOUT_OFFERS_JSON`. Templates must exist and be configured; an arbitrary filename does not authorize a charge. The included `xo-dif-za1-999.html` is configured as **ZAR 32.00**, and `xo-dif-al1.html` as GBP 37.95 when used without an assessment. No amount is accepted from the browser. Example environment variable:

`EXTERNAL_CHECKOUT_OFFERS_JSON={"xo-dif-mx1-999.html":{"amount":99900,"currency":"mxn","label":"MX$999.00","name":"Your actual digital product"}}`

The amount is in the currency's smallest unit. Confirm Stripe's minimum amount and supported currency for each offer. Do not reuse one product description for unrelated goods. Ensure the external page clearly describes what is sold, the correct price and currency, and the fulfillment/refund policy. New HTML pages must use the same API contract as the supplied `xo-dif-za1-999.html` and send `checkoutToken:tokenFromServer` to create-payment-intent and to payment-status. This is essential to bind a payment to its server-side offer and checkout session.

Routes: `POST /api/create-promo-checkout-link`, `GET /c/:token`, `GET /api/checkout-link/:token`, `POST /api/stripe/create-payment-intent`, `GET /api/stripe/payment-status`, `POST /api/stripe/webhook`.

Environment variables: `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `NODE_ENV=production`, plus `EXTERNAL_CHECKOUT_OFFERS_JSON` for additional products. Use Stripe test mode before live processing. Webhook events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`.

**Important:** External checkout charges are recorded independently of personality assessments and do not grant a personality report. The supplied South Africa page redirects after verified payment to its original BeMob destination. Make sure that destination actually fulfills the purchased product. Assessment purchase flow remains subject to `CONSULTATION_ENABLED` for the Growth Plus plan. Do not take live payments until the advertised products/services and fulfillment are accurate and tested.
