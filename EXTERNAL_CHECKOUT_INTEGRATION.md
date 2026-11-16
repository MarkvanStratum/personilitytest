# External checkout compatibility

The original `xo-dif-al1.html` is copied byte-for-byte and is not edited. Its API routes and request/response shapes are supported by the personality backend. Checkout tokens are 30-minute database records bound to the completed assessment cookie. `3795`/`ultimate` maps to £37.95 Growth Plus; `2295`/`starter` maps to £22.95 Personality Report. Payment verification is server-side and the original success redirect to `/` is routed to the customer's result page.

**IMPORTANT: Original checkout HTML has hard-coded display labels:** `ultimate: '240,00 ALL'` and `premium: '£26.95 GBP'`. Therefore the unchanged external page displays **240,00 ALL** for the £37.95 Growth Plus plan. Do NOT accept live payments using this unchanged page until you authorize correcting the customer-visible amount/currency label or choose a matching external checkout template. Backend charges GBP £37.95 correctly; this visual mismatch is unacceptable for live checkout.

Set `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `NODE_ENV=production`; optionally `CONSULTATION_ENABLED=true` only when the advertised service can be fulfilled. Stripe webhook endpoint: `/api/stripe/webhook`; events `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`. Test in Stripe sandbox before live use.
