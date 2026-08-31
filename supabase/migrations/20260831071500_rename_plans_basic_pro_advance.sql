-- Rename the three individual plans to Basic / Pro / Advance.
--
-- Same tiers, same prices, same features — only what they are called. The doc's names (Ledger,
-- Basic, Advanced) described what each plan DID; these describe where each sits in the ladder,
-- which is what a pricing page needs.
--
-- Done in this order on purpose: `basic` was taken by the middle tier, so the cheapest plan could
-- not claim that code until the middle one had moved. Renaming all three in a single UPDATE would
-- trip the unique index on (code, version) mid-statement.
--
-- Safe as a rename rather than a new version because no subscription existed yet. Once one does,
-- changing what a customer bought means a new version, not an edit.
--
-- A no-op on a database built from scratch: the seed migration above already inserts the final
-- names. It is kept because it is what actually ran against the live database.

update public.plans
   set code = 'advance',
       name = 'Advance',
       description = 'For a book big enough that chargebacks decide the year.'
 where code = 'advanced';

update public.plans
   set code = 'pro',
       name = 'Pro',
       description = 'The full-time solo producer: leads, dialer, selling and compliance.'
 where code = 'basic';

update public.plans
   set code = 'basic',
       name = 'Basic',
       description = 'Your book of business and your commission money, reconciled. No CRM.'
 where code = 'ledger';
