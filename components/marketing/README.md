# components/marketing

The marketing site: landing hero, sections, intro animation and 3D scenes.

**Rules:** [BRAND.md](../../docs/design/BRAND.md) for colour, type and logo. Marketing keeps
Montserrat when the apps move to Inter (v3). Numbers and money follow
[UI-CONSISTENCY.md](../../docs/design/UI-CONSISTENCY.md) §14; trial and price copy follows §13
(derived from data, never typed in).

Marketing may use the eyebrow label style and larger display type; app pages may not.

Do not: hard-code trial length or prices, or reuse marketing motion inside the apps.

**Calls to action:** use `MarketingCta` (`cta.tsx`): primary, secondary and onDark pills in
sentence case. The app's shared Button title-cases its label and is for the apps, not this site.
