# components/public

The public pages that are not marketing: the sign-up form, pricing, checkout, legal, and the site
header and footer.

**Rules:** [UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md) §13 auth pages (sign-up and
checkout), §12 status colours, §14 numbers and money. Type and colour:
[BRAND.md](../../docs/design/BRAND.md).
**Visual reference:** [foundation-v3/mockup.html](../../docs/design/foundation-v3/mockup.html).

Trial length and card wording come from data (`resolveTrialDays` in `lib/checkout/constants.ts`,
`checkoutPaymentMode()` in `lib/checkout/paymentMode.ts`), never typed into copy. Products and
prices come from the plan tables; never hard-code a price.

Do not: change products or pricing as part of a design change, or contradict the payment mode in
copy.
