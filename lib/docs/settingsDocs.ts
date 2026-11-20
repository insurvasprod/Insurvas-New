/**
 * Settings docs: every Settings section, its sub-pages, tabs and sheets, and every control on them.
 *
 * Data only. The Docs pages render it. One entry per section in lib/settings/sections.ts that a real
 * tenant role can reach (the hidden Welcome pack section is left out). Labels are the on-screen labels;
 * `href` is the section's own route, or /app/settings#<id> for a panel drawn inside Settings.
 */

export type SettingsDocField = { label: string; what: string; default?: string; who?: string };
export type SettingsDocPart = { key: string; title: string; what: string; fields: SettingsDocField[] };
export type SettingsDocPage = {
  /** The SETTINGS_SECTIONS id. */
  id: string;
  /** Url-safe and unique. */
  slug: string;
  /** The section label. */
  title: string;
  /** The SettingsGroup. */
  group: string;
  /** Where it opens in the app: the route, or /app/settings#<id> for in-page panels. */
  href: string;
  /** What this page is for and when you would change it. */
  why: string;
  /** Which roles can open it. */
  who: string;
  /** Its sub-pages, tabs and cards, in screen order, each with every field. */
  parts: SettingsDocPart[];
};

/** The groups in rail order. */
export const SETTINGS_DOC_GROUPS: string[] = ["Your account","Agency","Selling","Leads & calling","Integrations","Money & compliance","Records"];

export const SETTINGS_DOCS: SettingsDocPage[] = [
{
  id: "my-profile",
  slug: "my-profile",
  title: "My profile",
  group: "Your account",
  href: "/app/settings#my-profile",
  why: "Your own details, how you sign in, and which alerts reach you. Change it when your phone, photo, languages or licence numbers change, or to make your account safer.",
  who: "Everyone. Each person sees and changes only their own profile.",
  parts: [
    {
      key: "header",
      title: "Page buttons",
      what: "Buttons beside the page title.",
      fields: [
        {
          label: "History",
          what: "Opens a side panel with the settings you changed and the sign-ins to your account."
        },
        {
          label: "Open my producer record",
          what: "Opens your producer record, with your carriers, writing numbers and anything that still stops you submitting.",
          who: "Shown only to people who have a producer record"
        }
      ]
    },
    {
      key: "profile",
      title: "Profile",
      what: "How clients and teammates see you. Saves with the bar at the foot of the card.",
      fields: [
        {
          label: "Upload photo / Change photo",
          what: "Picks a JPEG or PNG picture for you. It shows in the top bar and next to your name once you save. Until then your initials show."
        },
        {
          label: "Remove",
          what: "Takes your photo off when you save. Your initials show instead."
        },
        {
          label: "Change in Sign-in & security",
          what: "Shows the email you sign in with and takes you to Sign-in & security to change it."
        },
        {
          label: "Full name",
          what: "Your name as clients and teammates see it. It is required."
        },
        {
          label: "Mobile phone",
          what: "Your own number. The agency's main line is set on Business identity."
        },
        {
          label: "Your time zone",
          what: "How times show for you only. Calling hours still follow each customer's state.",
          default: "The agency's time zone"
        },
        {
          label: "Languages you speak with clients",
          what: "Callers who speak a language you pick are offered to you first. With none picked, you are offered English-speaking callers first. Type into \"Another language\" and press Add to add one that is not listed."
        },
        {
          label: "Your NPN",
          what: "Your National Producer Number, stored on your record."
        },
        {
          label: "<State> licence number",
          what: "One box for each state you are licensed in. Fills in your licence number for that state."
        },
        {
          label: "Licensed states",
          what: "Shows the states you are licensed in. Read-only here: your owner sets them, with each licence's end date, in Settings › Team & Access."
        }
      ]
    },
    {
      key: "producer-record",
      title: "Producer record",
      what: "What the agency holds about you as a producer. Read-only. Shown only to people who have a producer record.",
      fields: [
        {
          label: "Role",
          what: "Shows your role in the agency."
        },
        {
          label: "Agency",
          what: "Shows the agency's name."
        },
        {
          label: "Open my record",
          what: "Opens your producer record to see your carrier appointments and writing numbers."
        }
      ]
    },
    {
      key: "security",
      title: "Sign-in & security",
      what: "How you sign in. Each change asks you to confirm in its own window and does not use the save bar.",
      fields: [
        {
          label: "Change email",
          what: "Opens a window to change the email you sign in with."
        },
        {
          label: "Change password",
          what: "Opens a window to change your password. Every other session is signed out."
        },
        {
          label: "Two-step verification: Turn on",
          what: "Starts setup: you scan a code with an authenticator app and type the six-digit code it shows. After that you need a code from the app each time you sign in. Some roles must have it on before Social Security and bank numbers can be shown."
        },
        {
          label: "Two-step verification: Turn off",
          what: "Opens a window to switch two-step off. Your account is then protected by your password alone."
        },
        {
          label: "Recovery codes: Make new codes",
          what: "Opens a window to make a fresh set of recovery codes. Your old codes stop working. Shown while two-step is on."
        },
        {
          label: "Where you're signed in: See devices",
          what: "Opens a side panel listing every device signed in to your account."
        },
        {
          label: "Sign out of every other device: Sign out others",
          what: "After you confirm, signs out every device except the one you are using."
        }
      ]
    },
    {
      key: "change-email",
      title: "Change your sign-in email",
      what: "Window opened by Change email. The email changes only when the new address confirms it. Both addresses are told.",
      fields: [
        {
          label: "New email",
          what: "The address you want to sign in with."
        },
        {
          label: "Current password",
          what: "Confirms it is you."
        },
        {
          label: "Send the confirmation link",
          what: "Sends a link to the new address. Until it is used, you keep signing in with the old one."
        }
      ]
    },
    {
      key: "change-password",
      title: "Change your password",
      what: "Window opened by Change password.",
      fields: [
        {
          label: "Current password",
          what: "Confirms it is you."
        },
        {
          label: "New password",
          what: "Your new password. It must meet the minimum length shown."
        },
        {
          label: "Repeat it",
          what: "Type the new password again. It must match."
        },
        {
          label: "Change password",
          what: "Saves the new password and signs out every other session."
        }
      ]
    },
    {
      key: "two-step-setup",
      title: "Two-step verification setup",
      what: "Shown in Sign-in & security after you press Turn on, then the recovery codes after it is on.",
      fields: [
        {
          label: "The six-digit code it shows",
          what: "The code from your authenticator app after you scan the QR code or type the key."
        },
        {
          label: "Turn on",
          what: "Checks the code and switches two-step on."
        },
        {
          label: "Cancel",
          what: "Stops setup. Two-step stays off."
        },
        {
          label: "Copy",
          what: "Copies your recovery codes. They are shown only once."
        },
        {
          label: "Download .txt",
          what: "Saves your recovery codes as a text file on your computer."
        },
        {
          label: "I have saved them",
          what: "Hides the recovery codes. They cannot be shown again."
        }
      ]
    },
    {
      key: "two-step-manage",
      title: "Turn off two-step / Make new recovery codes",
      what: "Window opened by Turn off or Make new codes.",
      fields: [
        {
          label: "A current code, or a recovery code",
          what: "Confirms it is you before two-step is switched off."
        },
        {
          label: "A current code from your app",
          what: "Confirms it is you before new recovery codes are made."
        },
        {
          label: "Turn off",
          what: "Switches two-step verification off."
        },
        {
          label: "Make new codes",
          what: "Makes new recovery codes and shows them once. The old ones stop working."
        }
      ]
    },
    {
      key: "devices",
      title: "Where you're signed in",
      what: "Side panel opened by See devices. Lists each device with its place, address and when it was last used.",
      fields: [
        {
          label: "End",
          what: "Signs that device out on its next click."
        },
        {
          label: "Sign out others",
          what: "Signs out every device except this one."
        }
      ]
    },
    {
      key: "alerts",
      title: "Alerts",
      what: "Where each alert reaches you: in the app, in the browser or by email. Saves with the bar at the foot of the card. Alerts marked Always on cannot be switched off.",
      fields: [
        {
          label: "Quiet hours",
          what: "When on, email and browser alerts wait between the two times you set. Always on alerts still come through.",
          default: "Off"
        },
        {
          label: "Quiet from / to",
          what: "The start and end of quiet hours, in your time zone. Shown while quiet hours are on."
        },
        {
          label: "All / Off / Always on",
          what: "Filters the list: every alert, alerts you will not hear about, or alerts that cannot be switched off. Does not change anything."
        },
        {
          label: "Alert group",
          what: "Shows only one group: Money, Retention, Compliance, Acquisition or Account. Does not change anything.",
          default: "Every group"
        },
        {
          label: "Find an alert",
          what: "Searches the list by name. Does not change anything."
        },
        {
          label: "In app",
          what: "Per alert: shows it in the app's notifications."
        },
        {
          label: "Browser",
          what: "Per alert: shows it as a browser notification."
        },
        {
          label: "Email",
          what: "Per alert: sends it by email."
        },
        {
          label: "How email arrives",
          what: "Per alert, for busy alerts, while email is on: Right away, Daily digest or Weekly digest.",
          default: "Right away"
        }
      ]
    },
    {
      key: "alert-list",
      title: "Alerts: the list",
      what: "Every alert that can reach you. Which ones you see depends on your role and your plan. Defaults are given as In app / Email / Browser.",
      fields: [
        {
          label: "New lead waiting",
          what: "A lead arrived that nobody has claimed yet.",
          default: "In app on, email off, browser on",
          who: "Owner, producer, assistant"
        },
        {
          label: "Handoff offered to you",
          what: "A colleague asks you to pick up a live caller.",
          default: "In app on, email off, browser on",
          who: "Owner, producer, assistant"
        },
        {
          label: "Unclaimed lead escalated",
          what: "A lead has waited past your response ladder.",
          default: "All on",
          who: "Owner only"
        },
        {
          label: "Callback due",
          what: "A callback you booked is coming up.",
          default: "All on"
        },
        {
          label: "Appointment due",
          what: "An appointment on your calendar is coming up.",
          default: "All on"
        },
        {
          label: "You were mentioned",
          what: "Someone named you in a lead note or a partner chat.",
          default: "In app on, email off, browser on"
        },
        {
          label: "Partner message",
          what: "A partner wrote in the shared chat.",
          default: "In app on, email off, browser on",
          who: "Owner, producer, assistant, bookkeeper"
        },
        {
          label: "Monthly bill to OK",
          what: "A monthly bill came back and waits for you to OK it before it is booked and marked paid.",
          default: "In app on, email off, browser on",
          who: "Owner, bookkeeper"
        },
        {
          label: "Return window closing",
          what: "A vendor's return window closes soon and bad leads are still unclaimed.",
          default: "In app on, email on, browser off",
          who: "Owner, bookkeeper"
        },
        {
          label: "Carrier status needs mapping",
          what: "A carrier file used a policy status the layout does not know.",
          default: "In app off, email on, browser off",
          who: "Owner, bookkeeper"
        },
        {
          label: "Servicing request failed",
          what: "A billing or payment change for a client did not go through.",
          default: "In app on, email on, browser off"
        },
        {
          label: "Reinstatement window closing",
          what: "Always on. A lapsed policy's last chance to be reinstated is close."
        },
        {
          label: "DOI complaint deadline",
          what: "Always on. A regulator complaint is close to its statutory response date."
        },
        {
          label: "Record purge dry run ready",
          what: "What the next record purge would delete, for review.",
          default: "In app off, email on, browser off",
          who: "Owner only"
        },
        {
          label: "Monthly compliance summary",
          what: "The month's consent, screening and complaint figures.",
          default: "In app off, email on, browser off",
          who: "Owner only"
        },
        {
          label: "Licence expiring",
          what: "Always on. A state licence the agency holds is about to lapse.",
          who: "Owner only"
        },
        {
          label: "Payment failed on your plan",
          what: "Always on. Your Insurvas subscription payment did not go through.",
          who: "Owner only"
        },
        {
          label: "Webhook turned off",
          what: "A webhook kept failing and was turned off; nothing is being sent to it.",
          default: "In app on, email on, browser off",
          who: "Owner only"
        },
        {
          label: "Allowance nearly used",
          what: "A usage allowance on your plan is close to its limit for this billing period.",
          default: "In app on, email on, browser off",
          who: "Owner only"
        }
      ]
    },
    {
      key: "save-bar",
      title: "Save bar",
      what: "One bar at the foot of the card saves the profile fields, the photo and every alert together. Email, password and two-step are not part of it.",
      fields: [
        {
          label: "Save",
          what: "Saves every change on the page."
        },
        {
          label: "Discard",
          what: "Throws away every unsaved change."
        }
      ]
    },
    {
      key: "history",
      title: "Your history",
      what: "Side panel opened by History.",
      fields: [
        {
          label: "Settings you changed / Sign-ins and security",
          what: "Switches between the settings you changed and a log of sign-ins and security changes on your account, newest first. Read-only."
        },
        {
          label: "Section",
          what: "Shows only changes in one settings section. Does not change anything."
        },
        {
          label: "Kind",
          what: "Shows only one kind of change. Does not change anything."
        }
      ]
    }
  ]
},
{
  id: "billing",
  slug: "plan-and-billing",
  title: "Plan & billing",
  group: "Your account",
  href: "/app/settings#billing",
  why: "Your Insurvas plan, what you use of each limit, your invoices and how you pay. Come here to change plan, update the card, pay an invoice, or pause or cancel.",
  who: "Owner only",
  parts: [
    {
      key: "status",
      title: "Status line and page buttons",
      what: "The line under the title says where the account stands (trial, active, payment failed, paused, ending, ended) and offers the one fix. The buttons change with the account's state.",
      fields: [
        {
          label: "Compare plans",
          what: "Opens a side panel comparing your plan with the plans you can move to."
        },
        {
          label: "Upgrade",
          what: "Opens Compare plans with the next bigger plan already picked."
        },
        {
          label: "Update card",
          what: "Opens the payment provider's (Whop) page to change the card on file. Shown instead of Upgrade when a payment failed."
        },
        {
          label: "Resume subscription",
          what: "Ends the pause. Billing restarts that day and a new period starts.",
          who: "Shown while paused"
        },
        {
          label: "Cancel instead",
          what: "Opens the cancel steps.",
          who: "Shown while paused"
        },
        {
          label: "update card / pay / contact support / keep my subscription / export / compare plans",
          what: "Links on the status line. Each one is the fix for the state shown: update the card, pay an overdue invoice, email support, ask to keep a subscription that is ending, export your records, or compare plans when a limit is near full."
        }
      ]
    },
    {
      key: "plan",
      title: "Your plan",
      what: "The plan's name, state, price, add-ons and what it includes, with a meter for each limit.",
      fields: [
        {
          label: "See everything included",
          what: "Shows every feature in your plan. Show less hides the list again."
        },
        {
          label: "Usage meters",
          what: "One per limit (for example seats). Shows what you use of the limit and when it resets. A warning shows at the warning level and at 95%. Nothing is cut off without a warning first."
        },
        {
          label: "Pause or cancel… / Cancel subscription…",
          what: "Opens the pause or cancel steps. Shows \"Cancel subscription…\" when a pause is not possible."
        },
        {
          label: "Export your book / Export commission history",
          what: "Downloads your policies or your commission statement lines as a CSV file.",
          who: "Shown when the subscription is ending or has ended"
        }
      ]
    },
    {
      key: "invoices",
      title: "Invoices",
      what: "Every invoice with its number, date, period, amount and status.",
      fields: [
        {
          label: "Pay <amount>",
          what: "Opens the invoice's payment page to pay it. Shown on unpaid invoices that have a payment link."
        },
        {
          label: "View",
          what: "Opens the invoice in a side panel."
        }
      ]
    },
    {
      key: "payment",
      title: "Payment",
      what: "How you pay. While paused, this card is replaced by What still works.",
      fields: [
        {
          label: "Next charge",
          what: "Shows the amount and date of your next charge, plus add-ons."
        },
        {
          label: "Paid with",
          what: "Shows whether a card is on file with Whop or each invoice is paid by its own link."
        },
        {
          label: "Update card",
          what: "Opens Whop's page to change your card. Your card never passes through Insurvas."
        }
      ]
    },
    {
      key: "still-works",
      title: "What still works",
      what: "Shown while paused. Lists what still works: your book, policies and commissions are readable; exports and invoices work; dialing, applications and lead posting are stopped; the partner portal is read-only.",
      fields: [
        {
          label: "Update card",
          what: "Opens Whop's page to change your card."
        }
      ]
    },
    {
      key: "compare",
      title: "Compare plans",
      what: "Side panel. Your use beside each plan's limits and the features that differ. Prices are on your billing cycle.",
      fields: [
        {
          label: "Plan cards",
          what: "Pick the plan you want to move to. Your own plan cannot be picked."
        },
        {
          label: "See what changes",
          what: "Shows what the move would cost and what you would gain or lose before anything changes."
        },
        {
          label: "Close",
          what: "Closes the panel. Nothing changes."
        }
      ]
    },
    {
      key: "upgrade",
      title: "Upgrade to <plan> now?",
      what: "Window for a plain upgrade. Shows the new price, the extra charge for the days left in this period, the next invoice and how it is paid.",
      fields: [
        {
          label: "Upgrade now",
          what: "Moves you to the bigger plan straight away. The new limits start now and the difference is added to your next invoice."
        },
        {
          label: "Ask support to move me",
          what: "Shown instead when your card is billed through Whop: opens an email asking support to move you."
        },
        {
          label: "Not now",
          what: "Closes the window. Nothing changes."
        }
      ]
    },
    {
      key: "impact",
      title: "Move to <plan>",
      what: "Side panel for a smaller plan, or any move that takes something away. Shows the new price, when it starts, what you would lose and which limits you would be over. Nothing is deleted.",
      fields: [
        {
          label: "Move on <date>",
          what: "Books the move for your renewal date."
        },
        {
          label: "Upgrade now",
          what: "Moves you straight away when the move applies now."
        },
        {
          label: "Ask support to move me",
          what: "Shown instead when your card is billed through Whop: opens an email asking support to move you."
        },
        {
          label: "Team & access",
          what: "Opens Team & access, shown when you have more seats in use than the new plan allows."
        },
        {
          label: "Keep my plan",
          what: "Closes the panel. Nothing changes."
        }
      ]
    },
    {
      key: "pause-or-cancel",
      title: "Pause or cancel",
      what: "First screen of the side panel opened by Pause or cancel….",
      fields: [
        {
          label: "Pause",
          what: "No charges from today. Your book stays readable and exports work. Dialing, new applications and lead posting stop. Partners see the portal as read-only."
        },
        {
          label: "Cancel",
          what: "Everything works until the period ends. After that the workspace is read-only and your records can be read and exported for the retention days shown, then it can no longer be opened."
        },
        {
          label: "Pause subscription",
          what: "Pauses the subscription now."
        },
        {
          label: "Continue to cancel",
          what: "Goes on to the cancel steps."
        },
        {
          label: "Keep it running",
          what: "Closes the panel. Nothing changes."
        }
      ]
    },
    {
      key: "cancel",
      title: "Cancel your subscription",
      what: "Steps: Why, Pause? (offered once), Records, Confirm.",
      fields: [
        {
          label: "Why are you cancelling?",
          what: "Pick one: Too expensive, Missing something, Switching tools, Slow season, Closing the agency or Other. Required."
        },
        {
          label: "Anything we should know?",
          what: "An optional note, up to 400 characters, sent with the reason."
        },
        {
          label: "Pause instead",
          what: "Pauses rather than cancels. Offered once."
        },
        {
          label: "Continue to cancel",
          what: "Skips the pause offer and goes on to your records."
        },
        {
          label: "Export",
          what: "Downloads Your book (policies) or Commission history (statement lines) as a CSV file."
        },
        {
          label: "Next / Back",
          what: "Moves between the steps."
        },
        {
          label: "Cancel on <date>",
          what: "Cancels the subscription. It ends at the end of the period and there are no more charges. To change your mind before then, email support."
        },
        {
          label: "Keep my subscription",
          what: "Leaves the steps. Nothing changes."
        }
      ]
    },
    {
      key: "invoice",
      title: "Invoice <number>",
      what: "Side panel showing one invoice: who it is billed to, its lines, subtotal, discount, tax and total.",
      fields: [
        {
          label: "Download PDF",
          what: "Opens the printable invoice in a new tab to print or save as PDF."
        },
        {
          label: "Pay <amount>",
          what: "Opens the payment page for an unpaid invoice."
        },
        {
          label: "Done",
          what: "Closes the panel."
        }
      ]
    }
  ]
},
{
  id: "business-identity",
  slug: "business-identity",
  title: "Business identity",
  group: "Agency",
  href: "/app/settings#business-identity",
  why: "Who the business is on every letter, statement and export the platform makes. Change it when your names, NPN, tax ID, address, phone or logo change, or when a document says a detail is missing.",
  who: "Owner only",
  parts: [
    {
      key: "header",
      title: "Page buttons and documents line",
      what: "Above the form. The line at the top of the card says how many documents can be made and names the first missing detail.",
      fields: [
        {
          label: "History",
          what: "Opens a side panel with every change to this page, newest first."
        },
        {
          label: "Preview a letter",
          what: "Shows how a letter's head and foot print with what is on screen now, before you save."
        },
        {
          label: "Add it",
          what: "Jumps to the field the first unready document still needs."
        },
        {
          label: "See all documents",
          what: "Scrolls to the Documents & logo section."
        }
      ]
    },
    {
      key: "business",
      title: "Business",
      what: "The names and numbers carriers and clients see. Saves with the bar at the foot of the card.",
      fields: [
        {
          label: "Trading name",
          what: "The name printed on client documents. The welcome pack, payout statement and commission dispute letter need it."
        },
        {
          label: "Legal name",
          what: "Used on tax forms and carrier contracts. Required. The DOI complaint response and tax export need it."
        },
        {
          label: "Entity type",
          what: "Individual, Sole proprietor, LLC or Corporation.",
          default: "Not set"
        },
        {
          label: "National producer number (NPN)",
          what: "The agency's NPN. The commission dispute letter and DOI complaint response need it. Shows \"Checked with NIPR\" once it has been checked."
        },
        {
          label: "Tax ID type",
          what: "Whether the tax ID is an EIN or a Social Security number.",
          default: "EIN"
        },
        {
          label: "Tax ID",
          what: "Stored encrypted and shown masked. Typing a new one replaces the one on file when you save. The tax export needs it."
        },
        {
          label: "Reveal / Hide",
          what: "Shows the full tax ID once. Each reveal is recorded."
        },
        {
          label: "Replace",
          what: "Opens a box to type a new tax ID. \"Keep the one on file\" cancels it."
        },
        {
          label: "Remove",
          what: "After you confirm, removes the tax ID straight away. Tax summaries and 1099 exports stop until a new one is added."
        },
        {
          label: "Business time zone",
          what: "How times show for your team, and when daily summaries arrive. It does not set calling hours: those follow each customer's own state.",
          default: "Not set"
        }
      ]
    },
    {
      key: "contact-address",
      title: "Contact & address",
      what: "Printed on letters, statements and the client portal.",
      fields: [
        {
          label: "Street address",
          what: "The first line of the business address. The payout statement and commission dispute letter need the full address."
        },
        {
          label: "Address line 2",
          what: "Suite or floor. Optional."
        },
        {
          label: "City",
          what: "Part of the business address."
        },
        {
          label: "State",
          what: "Part of the business address."
        },
        {
          label: "ZIP code",
          what: "Part of the business address."
        },
        {
          label: "Business phone",
          what: "The agency's main line. The welcome pack needs it. Your own number is on My profile."
        },
        {
          label: "Business email",
          what: "An address clients can reply to. Printed on letters when set."
        },
        {
          label: "Website",
          what: "The agency's website. Printed in a letter's foot."
        }
      ]
    },
    {
      key: "documents-logo",
      title: "Documents & logo",
      what: "Every letter and statement checks these details before it is made.",
      fields: [
        {
          label: "Upload logo / Replace",
          what: "Picks a PNG or JPEG, up to 512 KB, printed at the head of every letter and statement. It saves as soon as you choose it. Save the business identity first."
        },
        {
          label: "Remove",
          what: "Takes the logo off straight away. Documents print your trading name as text."
        },
        {
          label: "Document checklist",
          what: "One line each for the welcome pack, payout statement, commission dispute letter, DOI complaint response and tax export. Shows Ready, or how many details it needs."
        },
        {
          label: "Add <detail>",
          what: "Jumps to the missing field for that document."
        }
      ]
    },
    {
      key: "partners-owner",
      title: "Partners & owner",
      what: "How partners reach you about payouts and leads, and who owns the workspace.",
      fields: [
        {
          label: "Partner support email",
          what: "The support email partners see in the partner portal. Leave it blank to hide it."
        },
        {
          label: "Partner support phone",
          what: "The help line partners see in the partner portal only. Not your business phone. Leave it blank to hide it."
        },
        {
          label: "Owner / Owners",
          what: "Shows who owns the workspace. Team & access opens the team page to change it."
        },
        {
          label: "Agency since",
          what: "Shows when the workspace was made."
        },
        {
          label: "Plan",
          what: "Shows your plan. Plan & billing opens the billing page."
        },
        {
          label: "Show technical details",
          what: "Shows the workspace ID, with a Copy button, for support."
        }
      ]
    },
    {
      key: "save-bar",
      title: "Save bar",
      what: "One bar at the foot of the card saves every field on the page, the partner support contact included. The logo and tax ID Remove act on their own.",
      fields: [
        {
          label: "Save",
          what: "Saves every change on the page."
        },
        {
          label: "Discard",
          what: "Throws away every unsaved change."
        }
      ]
    },
    {
      key: "history",
      title: "Business identity history",
      what: "Side panel opened by History. Every change to this page, newest first.",
      fields: [
        {
          label: "Find a setting",
          what: "Searches the changes. Does not change anything."
        },
        {
          label: "Section",
          what: "Shows only changes in one settings section. Does not change anything."
        },
        {
          label: "Person",
          what: "Shows only changes made by one person. Does not change anything."
        },
        {
          label: "Kind",
          what: "Shows only one kind of change. Does not change anything."
        }
      ]
    }
  ]
},
{
  id: "team-access",
  slug: "team-access",
  title: "Team & access",
  group: "Agency",
  href: "/app/settings#team-access",
  why: "Who works in your agency on Insurvas, what each person can do and where agents are licensed. Come here to invite someone, change a role, record licences or deactivate someone who leaves.",
  who: "Owner only",
  parts: [
    {
      key: "header",
      title: "Team & access (title line and status line)",
      what: "The sub-page bar, the Invite button and a line that says how many seats you use.",
      fields: [
        {
          label: "People",
          what: "Shows everyone with an active account. The number is how many there are."
        },
        {
          label: "Invites",
          what: "Shows invitations that have not been accepted yet. Each one holds a seat."
        },
        {
          label: "Deactivated",
          what: "Shows people you have deactivated. You can reactivate them from their sheet."
        },
        {
          label: "Invite someone",
          what: "Opens the Invite someone sheet. It is greyed out when every seat on your plan is in use.",
          who: "Off when all seats are used"
        },
        {
          label: "Status line",
          what: "Shows seats used of your plan's seats, invites waiting, buffer seats and setter seats, with a link to Plan & billing. When every seat is in use it tells you to free one or upgrade."
        },
        {
          label: "Plan & billing",
          what: "Opens Settings > Plan & billing, where you change your plan and seats."
        }
      ]
    },
    {
      key: "people",
      title: "People",
      what: "One line per active person. Click a line to open their sheet.",
      fields: [
        {
          label: "Show",
          what: "Filters the list to All, Agents, Setters or Office (everyone else). Each shows a count.",
          default: "All"
        },
        {
          label: "Find a person",
          what: "Searches by name or email."
        },
        {
          label: "Person",
          what: "Shows their name, and \"Owner\", \"Manager\" or \"you\" where it applies."
        },
        {
          label: "Access",
          what: "Shows their role in plain words, for example Agent, Setter · dial and book, Intake · leads and inbound, Admin, Accounting, Retention or Everything."
        },
        {
          label: "Licensed in",
          what: "Shows the states they hold a licence in. \"Any agency state\" means none are recorded, so lead assignment uses the agency's licences. \"Not needed\" for roles that do not sell."
        },
        {
          label: "Last seen",
          what: "Shows when they last had Insurvas open. \"Now\" means in the last two minutes."
        },
        {
          label: "Status",
          what: "Shows Active, Suspended, or a warning when a licence ends within 60 days (\"Licence ends ...\" or \"Licence ended\")."
        }
      ]
    },
    {
      key: "invites",
      title: "Invites",
      what: "Invitations that are still waiting. Click a line to open the person's sheet, where you can revoke it.",
      fields: [
        {
          label: "Find a person",
          what: "Searches invites by name or email."
        },
        {
          label: "Expires",
          what: "Shows the date the invite link stops working."
        },
        {
          label: "Status",
          what: "Shows Invited, or Invite expired once the date has passed."
        },
        {
          label: "Resend",
          what: "Sends the invitation email again with a fresh link."
        }
      ]
    },
    {
      key: "deactivated",
      title: "Deactivated",
      what: "People who can no longer sign in. Their policies and commission history stay. Open a line to reactivate them.",
      fields: [
        {
          label: "Find a person",
          what: "Searches by name or email."
        },
        {
          label: "Status",
          what: "Shows Deactivated."
        }
      ]
    },
    {
      key: "person-sheet",
      title: "Person sheet",
      what: "Opens when you click a person. Role, licences and extra access save together with Save. The time zone and the hand-over act at once.",
      fields: [
        {
          label: "Access: Agent",
          what: "Makes them an agent: leads, dialer, calendar and quoting. Uses an agent seat."
        },
        {
          label: "Access: Setter",
          what: "Makes them a setter: dial and book only, never given a lead that needs a licence. Uses a setter seat; greyed out when none are left."
        },
        {
          label: "Access: Intake",
          what: "Gives them leads, imports and inbound with no dialer. They take inbound overflow as a buffer agent. Uses a buffer seat; greyed out when none are left."
        },
        {
          label: "Show 4 more roles",
          what: "Shows the other roles: Admin, Accounting, Retention and Owner."
        },
        {
          label: "Access: Admin",
          what: "Gives them everything but billing. They manage everyone except the owner."
        },
        {
          label: "Access: Accounting",
          what: "Gives them policies, all commissions, statements and payouts."
        },
        {
          label: "Access: Retention",
          what: "Gives them the save queue, reinstatements and the lapse-risk board."
        },
        {
          label: "Access: Owner",
          what: "Gives them everything, including billing."
        },
        {
          label: "Manager",
          what: "For an agent: they see their team's calls and are told when a transfer escalates.",
          default: "Off",
          who: "Shown only when Agent is picked; on an agency plan"
        },
        {
          label: "Extra roles and pages",
          what: "Adds more roles and hides pages from their menu. See the Extra roles and pages part.",
          who: "Only with the Custom team access add-on"
        },
        {
          label: "Licensed in",
          what: "The states they are licensed in, each with how many of your carriers are appointed there. Leads are only assigned to them in these states; with none, the agency's licences apply. See the Licensed in part.",
          who: "Only for Owner, Admin and Agent roles"
        },
        {
          label: "Open work",
          what: "Shows what they hold now: Leads, Callbacks, Appointments and Follow-ups. Only for active people."
        },
        {
          label: "Hand over to",
          what: "Picks the teammate who will take all their open work. Only teammates who can work all of it are listed."
        },
        {
          label: "Hand over now",
          what: "Moves their open leads, callbacks, appointments and follow-ups to the teammate you picked, straight away. Policies stay on their book for commission history."
        },
        {
          label: "Time zone",
          what: "Their own clock, shown on the roster. Saved when picked. Calling windows always follow the customer's state.",
          default: "Not set (the agency's)"
        },
        {
          label: "Deactivate…",
          what: "Opens the Deactivate dialog. Not shown on your own sheet.",
          who: "Active people other than you"
        },
        {
          label: "Revoke invite",
          what: "Cancels the invitation and frees the seat.",
          who: "Invited people only"
        },
        {
          label: "Reactivate",
          what: "Lets a deactivated person sign in again. It uses a seat.",
          who: "Deactivated people only"
        },
        {
          label: "Cancel",
          what: "Closes the sheet and drops unsaved changes."
        },
        {
          label: "Save",
          what: "Saves the role, licensed states and extra access. It applies on their next page."
        }
      ]
    },
    {
      key: "licensed-in",
      title: "Licensed in (state chips)",
      what: "Used on the person sheet and the Invite sheet. One chip per state.",
      fields: [
        {
          label: "State chip",
          what: "Opens that state's licence end date and Remove. It also shows how many of your carriers are appointed there, or \"licence only\"."
        },
        {
          label: "<State> licence valid through",
          what: "The date the licence ends. After it, they get no leads in that state. Needed before an agency producer can submit applications."
        },
        {
          label: "Remove <state>",
          what: "Takes the state off their licences, so they get no leads there."
        },
        {
          label: "Add a state",
          what: "Opens a list of states to add. Type in Find a state to narrow it."
        }
      ]
    },
    {
      key: "extra-access",
      title: "Extra roles and pages",
      what: "With the Custom team access add-on: give a person more than one role, and hide pages from their menu.",
      fields: [
        {
          label: "Preset",
          what: "Copies a saved preset's roles and pages onto this person. Changing the preset later changes nobody.",
          who: "Shown once you have saved a preset"
        },
        {
          label: "Extra roles",
          what: "Tick a role to let them also do what it does. Lead routing, seat limits and their home page follow the main role."
        },
        {
          label: "Sees ... Money: ...",
          what: "Shows whose clients and leads they will see, and whose commissions. A warning shows if they will see pay for the whole agency."
        },
        {
          label: "Pages they see",
          what: "Untick a page to hide it from their menu. Hiding never opens anything their roles do not."
        },
        {
          label: "Save as preset…",
          what: "Name for a new preset made from these roles and pages."
        },
        {
          label: "Save preset",
          what: "Saves the current roles and pages as a preset you can apply to others."
        },
        {
          label: "Delete a preset",
          what: "Deletes the preset you pick. Nobody's access changes."
        }
      ]
    },
    {
      key: "invite-sheet",
      title: "Invite someone",
      what: "Sends an invitation. The footer says which seat it uses before it sends.",
      fields: [
        {
          label: "First and last name",
          what: "Their name as it shows across Insurvas. Required."
        },
        {
          label: "Work email",
          what: "Where the invitation goes. Required."
        },
        {
          label: "What they'll do",
          what: "Their role: Agent, Setter or Intake. \"More roles\" adds Admin, Accounting, Retention and Owner. Setter and Intake are blocked when their seats are used up.",
          default: "Agent"
        },
        {
          label: "More roles",
          what: "Shows Admin, Accounting, Retention and Owner."
        },
        {
          label: "Licensed in",
          what: "The states they are licensed in. Optional; you can add them after they accept.",
          who: "Only for Owner, Admin and Agent roles"
        },
        {
          label: "Extra roles and pages",
          what: "Extra roles and hidden pages saved on them straight after the invite is made.",
          who: "Only with the Custom team access add-on"
        },
        {
          label: "Cancel",
          what: "Closes the sheet without inviting."
        },
        {
          label: "Send invite",
          what: "Creates the invitation and sends the email. It holds a seat until it is accepted or revoked."
        }
      ]
    },
    {
      key: "deactivate-dialog",
      title: "Deactivate <name>?",
      what: "Confirms a deactivation and says what happens to their work. They can't sign in from now on and the seat is freed.",
      fields: [
        {
          label: "Hand their work to",
          what: "The teammate who gets all their open leads, callbacks, appointments and follow-ups. Required when they have open work. Only teammates who can work all of it are listed."
        },
        {
          label: "Move ... to ...",
          what: "Read-only ticks that list what will move: leads and callbacks, upcoming appointments, and open follow-ups (queue items, reinstatement cases, servicing requests)."
        },
        {
          label: "End <name>'s browser-extension access",
          what: "Read-only tick. Extension access always ends when they are deactivated."
        },
        {
          label: "Cancel",
          what: "Closes the dialog. Nothing changes."
        },
        {
          label: "Deactivate <name>",
          what: "Deactivates them and moves their work. Their sessions end on their next click; their policies and commission history stay."
        }
      ]
    }
  ]
},
{
  id: "products",
  slug: "products",
  title: "Products",
  group: "Agency",
  href: "/app/settings#products",
  why: "The products your agency sells, from the Insurvas catalogue and within your plan. Leads, partners, forms, quotes and reports offer only the products you turn on here.",
  who: "Owner only",
  parts: [
    {
      key: "header",
      title: "Products (title line and status line)",
      what: "The two tabs, a link to plans and a line that says how many products you sell and which still need setting up.",
      fields: [
        {
          label: "In your plan",
          what: "Shows the products your plan includes, which you can turn on or off."
        },
        {
          label: "Not in your plan",
          what: "Shows the products your plan does not include and the plan that adds each. Only shown when there are some."
        },
        {
          label: "See plans",
          what: "Opens Settings > Plan & billing."
        },
        {
          label: "Status line",
          what: "Shows how many you sell out of your plan's products, and names the products you sell that are not ready to quote yet. Click a name to open its sheet."
        }
      ]
    },
    {
      key: "in-your-plan",
      title: "In your plan",
      what: "One line per product, grouped by line (Life, Health, Retirement). Click a line to open the product's sheet.",
      fields: [
        {
          label: "Show",
          what: "Filters the list to All, Sold, Needs setup or Not sold.",
          default: "All"
        },
        {
          label: "Find a product",
          what: "Searches products by name."
        },
        {
          label: "Sell",
          what: "Turns the product on or off for the agency. Turning it on saves at once with Undo. Turning it off asks first. Nothing is deleted either way."
        },
        {
          label: "Product",
          what: "The product's name. Click it to open its sheet."
        },
        {
          label: "Partners who may send it",
          what: "Shows the partners allowed to send leads for it. This is set on each partner."
        },
        {
          label: "What it needs",
          what: "Shows its four needs in call order: application form, carriers, health questions, quote inputs. A missing one on a product you sell is a \"+\" link to the Settings page that sets it up."
        },
        {
          label: "Ready",
          what: "Shows Ready, Needs <n> things, or Not sold."
        }
      ]
    },
    {
      key: "stop-selling",
      title: "Stop selling <product>?",
      what: "Asks before you turn a product off. Nothing is deleted.",
      fields: [
        {
          label: "Keep selling it",
          what: "Closes the dialog. The product stays on."
        },
        {
          label: "Stop selling <product>",
          what: "Turns it off. Partners can no longer send it; new leads, imports, forms and quotes stop offering it. Leads, applications and policies you already have keep working. A notice offers Undo."
        }
      ]
    },
    {
      key: "product-sheet",
      title: "Product sheet",
      what: "Opens when you click a product. Only the switch saves; the rest shows what the product needs and who it affects.",
      fields: [
        {
          label: "Sell <product>",
          what: "Same switch as on the row. Saves at once with Undo; turning it off asks first."
        },
        {
          label: "Ready to quote",
          what: "Lists what an agent needs on a call, in call order: Application form, Carriers that offer it, Health questions, Quote inputs. Each shows if it is done."
        },
        {
          label: "Set up its form",
          what: "Opens Settings > Application forms. Shown when the form is missing on a product you sell."
        },
        {
          label: "Add a carrier",
          what: "Opens Settings > Carriers. Shown when no carrier offers it."
        },
        {
          label: "Set up health questions",
          what: "Opens Sales process > Health questions. Not asked for retirement products."
        },
        {
          label: "Set up quote inputs",
          what: "Opens Sales process > Quote inputs."
        },
        {
          label: "Partners who may send it",
          what: "Shows the partners allowed to send it."
        },
        {
          label: "Manage partners",
          what: "Opens the partners page, where you change which products each partner may send."
        },
        {
          label: "Where it shows up",
          what: "Shows where a product you sell is offered: new lead, lead imports, partner posting, forms, quotes and reports."
        },
        {
          label: "Close",
          what: "Closes the sheet."
        }
      ]
    },
    {
      key: "not-in-your-plan",
      title: "Not in your plan",
      what: "Catalogue products your plan does not include. Nothing here changes your plan.",
      fields: [
        {
          label: "Product",
          what: "The product's name."
        },
        {
          label: "Line",
          what: "Life, Health or Retirement."
        },
        {
          label: "Added by",
          what: "The plan that adds this product."
        },
        {
          label: "See plans",
          what: "Opens a short dialog naming the plan that adds it and what else comes with it."
        },
        {
          label: "Add <product>: Not now",
          what: "Closes the dialog."
        },
        {
          label: "Add <product>: Compare plans",
          what: "Opens Settings > Plan & billing to compare plans and change yours."
        }
      ]
    }
  ]
},
{
  id: "carriers",
  slug: "carriers",
  title: "Carriers",
  group: "Agency",
  href: "/app/settings#carriers",
  why: "The carriers you are contracted with and the states you are appointed in. Quotes, appointments and commission files need at least one carrier. Come here when you add or end a contract, get appointed in a new state, or set up a carrier's site for autofill.",
  who: "Owner only (needs the appointment vault feature on your plan)",
  parts: [
    {
      key: "setup-step-1",
      title: "Set-up, step 1: Your carriers",
      what: "With no carriers yet, the page is a two-step guided set-up. Every tick saves as you go. You can also reopen it from \"tick many states at once\" under the Carriers table.",
      fields: [
        {
          label: "Find a carrier or state",
          what: "Narrows the carrier list in step 1 and the states in step 2."
        },
        {
          label: "Skip for now / Done",
          what: "Leaves the set-up and shows the Carriers table."
        },
        {
          label: "Step 1 Your carriers / Step 2 Your states",
          what: "Switches between the two steps. A tick shows a step is done."
        },
        {
          label: "Carrier tick",
          what: "Adds the carrier to your agency, or switches it off. Adding also loads its products."
        },
        {
          label: "Level",
          what: "Your first-year commission percent with this carrier, for example 110. Optional; it only feeds commission figures. Saves when you leave the box."
        },
        {
          label: "Contracted from",
          what: "The date the contract starts. Saves when you leave the box."
        },
        {
          label: "Writing number",
          what: "Your agency's writing number with this carrier. Optional. Saves when you leave the box."
        },
        {
          label: "Ask Insurvas to add it",
          what: "Emails Insurvas support when your carrier is not in the library."
        },
        {
          label: "Next: Set Up States",
          what: "Moves to step 2. Needs at least one carrier."
        }
      ]
    },
    {
      key: "setup-step-2",
      title: "Set-up, step 2: Your states",
      what: "Pick a state, then tick the carriers you are appointed with there. Ticking a carrier in a state also records your agency licence there.",
      fields: [
        {
          label: "State tile",
          what: "Opens that state on the right. Shows how many of your carriers are appointed there."
        },
        {
          label: "Carrier tick (in a state)",
          what: "Adds or ends your agency's appointment with that carrier in that state."
        },
        {
          label: "Tick all",
          what: "Appoints every one of your carriers in the state."
        },
        {
          label: "Remove <state>",
          what: "Ends every carrier's appointment in the state."
        },
        {
          label: "Back",
          what: "Returns to step 1."
        },
        {
          label: "Finish set-up",
          what: "Closes the set-up and shows the Carriers table. Needs at least one state."
        }
      ]
    },
    {
      key: "header",
      title: "Carriers (title line and status line)",
      what: "Once you have carriers: the two tabs, the Add carrier button and a line that sums up your carriers.",
      fields: [
        {
          label: "Carriers",
          what: "Shows the table of your carriers."
        },
        {
          label: "States",
          what: "Shows the appointment grid: states down, carriers across."
        },
        {
          label: "Add carrier",
          what: "Opens the Add carrier dialog."
        },
        {
          label: "Status line",
          what: "Shows how many carriers you sell and in how many states you are appointed, and names the first carrier that needs something, with a link to open it."
        }
      ]
    },
    {
      key: "carriers-table",
      title: "Carriers",
      what: "One line per carrier. Switched-off carriers sit at the bottom. Click a line to open the carrier's sheet.",
      fields: [
        {
          label: "Find a carrier or product",
          what: "Searches by carrier name or product name."
        },
        {
          label: "Carrier",
          what: "The carrier's name."
        },
        {
          label: "Products",
          what: "The products you sell with it. \"None ticked\" means you have not picked any yet.",
          who: "Shown with the Applications feature"
        },
        {
          label: "Your % first year",
          what: "Your first-year commission percent from the contract."
        },
        {
          label: "Appointed in",
          what: "How many states you are appointed in with this carrier."
        },
        {
          label: "Writers",
          what: "How many of your agents are licensed where this carrier appoints you."
        },
        {
          label: "Last commission file",
          what: "The date of the last commission file from this carrier.",
          who: "Shown with Carrier files on your plan"
        },
        {
          label: "Contract",
          what: "Shows Active, Switched off, File needs matching, <n> appointments pending, Needs states or Needs products."
        },
        {
          label: "tick many states at once",
          what: "Opens the guided set-up again."
        },
        {
          label: "Start the set-up",
          what: "Opens the guided set-up. Shown when you have no carriers."
        }
      ]
    },
    {
      key: "carrier-sheet",
      title: "Carrier sheet",
      what: "Everything about one carrier. One Save carrier button saves the contract, the products and the carrier site.",
      fields: [
        {
          label: "First-year commission",
          what: "What the carrier pays your agency in the first year, as a percent, for example 110. Optional; commission figures need it. Producer splits live in Commissions."
        },
        {
          label: "Contracted from",
          what: "The date the contract starts."
        },
        {
          label: "Change in Rate card",
          what: "Opens the Rate card, where you set renewal, advance and chargeback window. The line above shows them."
        },
        {
          label: "Products you sell",
          what: "Tick the products you sell with this carrier. Only ticked products show when agents quote.",
          who: "Shown with the Applications feature"
        },
        {
          label: "Appointed states and writers",
          what: "Shows the states you are appointed in (and pending), and each writer with the states they are licensed and appointed in."
        },
        {
          label: "Change states",
          what: "Closes the sheet and opens the States tab."
        },
        {
          label: "Add a writer in Team & access",
          what: "Opens Settings > Team & access."
        },
        {
          label: "Show technical details · writing number",
          what: "Shows your agency's writing number with this carrier."
        },
        {
          label: "Agency writing number",
          what: "Adds or changes your agency's writing number. It is saved with the first-year commission."
        },
        {
          label: "Portal address",
          what: "The carrier site where agents sign in and where the browser extension fills applications.",
          who: "Shown with the Applications feature"
        },
        {
          label: "Agency username",
          what: "The agency's username on the carrier site. Passwords are never stored."
        },
        {
          label: "Second sign-in step",
          what: "The carrier site's second sign-in step: App, SMS, Email or None.",
          default: "None"
        },
        {
          label: "Last checked it works",
          what: "The date someone last checked the sign-in works."
        },
        {
          label: "Open the field map",
          what: "Opens the Field maps dialog for this carrier. The text beside it says if the extension map is ready, needs a check, is a draft or does not exist yet."
        },
        {
          label: "Commission file",
          what: "Shows the date and row count of the last commission file, and warns when its columns are not matched."
        },
        {
          label: "Match the columns / Open the full map",
          what: "Opens Carrier sync setup, where you set how this carrier's statements are read."
        },
        {
          label: "See its files",
          what: "Opens the carrier files page."
        },
        {
          label: "End contract…",
          what: "Asks first, then switches the carrier off: no new quotes, applications or leads. Open cases stay open; its policies and commission history stay."
        },
        {
          label: "Sell this carrier again",
          what: "Switches a switched-off carrier back on."
        },
        {
          label: "Cancel",
          what: "Closes the sheet and drops unsaved changes."
        },
        {
          label: "Save carrier",
          what: "Saves the contract, products and carrier site."
        }
      ]
    },
    {
      key: "add-carrier",
      title: "Add a carrier",
      what: "Three short steps: Carrier, Contract, States and writers. Nothing saves until you press Add; then the carrier's sheet opens so you can pick its products.",
      fields: [
        {
          label: "Find a carrier",
          what: "Searches the carrier library."
        },
        {
          label: "Which carrier?",
          what: "Pick one carrier. A switched-off carrier says that adding turns it back on."
        },
        {
          label: "Next: contract",
          what: "Moves to step 2."
        },
        {
          label: "Contracted from",
          what: "The date the contract starts.",
          default: "Today"
        },
        {
          label: "First-year commission",
          what: "Your first-year commission percent, for example 110. Optional; most final-expense contracts are 80 to 120%."
        },
        {
          label: "Agency writing number",
          what: "Your agency's writing number with this carrier. Optional."
        },
        {
          label: "Next: states and writers",
          what: "Moves to step 3."
        },
        {
          label: "State ticks",
          what: "Tick the states you are appointed in with this carrier. The number beside each is how many of your writers are licensed there."
        },
        {
          label: "Same as your other carriers",
          what: "Ticks every state you already sell in with other carriers."
        },
        {
          label: "Clear",
          what: "Unticks every state."
        },
        {
          label: "Back / Cancel",
          what: "Goes back a step, or closes the dialog on step 1."
        },
        {
          label: "Add <carrier>",
          what: "Adds the carrier with its contract and appointments, and records your licence in each ticked state."
        }
      ]
    },
    {
      key: "states",
      title: "States (Where you can sell)",
      what: "The appointment grid. A tick with a number means appointed, with how many writers are licensed there. Click a cell to add or end an appointment.",
      fields: [
        {
          label: "Show the states of",
          what: "Shows the whole agency, or only the states one writer is licensed in.",
          default: "Whole agency"
        },
        {
          label: "+<n> more",
          what: "Picks another writer when you have more than three."
        },
        {
          label: "Every state",
          what: "Shows all states, not only those where you are appointed or pending."
        },
        {
          label: "Cell",
          what: "Opens the carrier in that state: whether you are appointed, applied for or not, and which writers are licensed there."
        },
        {
          label: "Add the appointment",
          what: "Appoints your agency with the carrier in the state from today, and records your licence there."
        },
        {
          label: "End the appointment",
          what: "Ends the appointment today. It is never deleted."
        },
        {
          label: "Writers in Team & access",
          what: "Opens Settings > Team & access."
        },
        {
          label: "Licensed writers",
          what: "Shows how many writers are licensed in the state."
        }
      ]
    },
    {
      key: "field-maps",
      title: "Field maps · where the extension fills each answer",
      what: "Opens from a carrier's sheet. A field map tells the browser extension where each answer goes on a carrier's application. A published map never changes; a fix saves the next version.",
      fields: [
        {
          label: "Your carriers",
          what: "Picks the carrier to look at. Each badge says its map state: Ready, Needs you, Draft, Insurvas map or No map."
        },
        {
          label: "Contract level / Products / Appointed",
          what: "Shows the carrier's contract at a glance."
        },
        {
          label: "Carrier portal address",
          what: "The carrier site address to build a map for, starting https://. Shown when the carrier has no portal yet."
        },
        {
          label: "Start a map",
          what: "Starts a draft map. It fills nothing until it is published."
        },
        {
          label: "Check / Fix / Continue / See it in the extension",
          what: "Opens the carrier's site, where the extension shows each field the map finds."
        },
        {
          label: "New version",
          what: "Starts the next version as a draft; the published one keeps filling until the new one is published."
        },
        {
          label: "Show the <n> fields / Show all fields",
          what: "Shows only the fields the map could not find, or all fields."
        },
        {
          label: "Copy to my agency",
          what: "Copies the Insurvas map to your agency so you can change it."
        },
        {
          label: "Fills / Last 30 days / Version / Checked",
          what: "Shows how many fields it fills, the fill rate, the version and when it was checked."
        },
        {
          label: "Show selectors / Hide selectors",
          what: "Shows the technical editor for each field."
        },
        {
          label: "Add a field…",
          what: "Picks a field to add to the map."
        },
        {
          label: "Add field",
          what: "Adds the picked field."
        },
        {
          label: "Selector for <field>",
          what: "Where on the carrier page this field is."
        },
        {
          label: "Kind for <field>",
          what: "What sort of box it is on the page."
        },
        {
          label: "Format for <field>",
          what: "How the answer is written into the box."
        },
        {
          label: "Mark checked",
          what: "Marks the field checked once Highlight shows the right box. Sensitive fields (SSN, routing, account and card numbers) must be checked before you can publish."
        },
        {
          label: "Discard",
          what: "Drops unsaved field changes."
        },
        {
          label: "Save draft",
          what: "Saves the map as a draft."
        },
        {
          label: "Publish version <n>",
          what: "Publishes the map. Agents get it on their next fill."
        }
      ]
    }
  ]
},
{
  id: "sales-process",
  slug: "sales-process",
  title: "Sales process",
  group: "Selling",
  href: "/app/settings#sales-process",
  why: "Everything that shapes an agent's call, in the order the agent meets it: the health questions, what the Quote step asks, each carrier's application, the checks on a case, the disclosures and where a lead's card moves after submit. Change it when a carrier, a product or your own way of selling changes.",
  who: "Owner and producer (producers see Health questions only, read-only). Needs the applications feature.",
  parts: [
    {
      key: "overview",
      title: "Overview",
      what: "A map of the call in ten steps, with what each step is set to and a list of what needs you. Owner only.",
      fields: [
        {
          label: "Try a case",
          what: "Opens a sheet where you answer as a client would and see which disclosures the application would carry. Nothing is saved."
        },
        {
          label: "The call, step by step",
          what: "Shows each step of the call (Lead form, Verify, Interview, Quote, Application, Beneficiaries, Payment, Disclosures, Review, Submit, Card moves) with its current figures. Click a step to open the tab that sets it; Lead form opens Application forms."
        },
        {
          label: "Open Health questions / Open Quote inputs / Open Carrier application / Open Disclosures / Open checks / Open Stage moves",
          what: "Opens that tab. Steps that need nothing set up (Verify, Beneficiaries, Payment, Submit) say so."
        },
        {
          label: "Needs you",
          what: "Lists every health question draft not yet published, every carrier and product pair still quoting on the Insurvas default, carrier applications with fields autofill cannot place, and disclosures that are drafts or live with no rule. Click a row to open it."
        }
      ]
    },
    {
      key: "health-questions",
      title: "Health questions",
      what: "The questions the agent asks on the Interview, one set per carrier and product. Knockout answers rule a carrier out. Edits save into a draft as you make them; agents see a change only after you publish it. Producers can open this tab to read the questions; they cannot change them.",
      fields: [
        {
          label: "Question sets",
          what: "The list of sets, one per carrier and product (\"Every carrier\" when it covers a whole product). Pick one to see and edit its questions. Sets marked Insurvas are the platform's own and are read-only."
        },
        {
          label: "Find a carrier or product",
          what: "Filters the list of sets. Changes nothing."
        },
        {
          label: "New / New question set",
          what: "Opens New underwriting template to start a set for a product, or for one carrier of it.",
          who: "Owner only"
        },
        {
          label: "Question bank",
          what: "Opens the Question bank sheet: questions Insurvas recommends for this set. Tick one to add it to the draft, untick to stop asking it.",
          who: "Owner only"
        },
        {
          label: "Copy to my agency",
          what: "Copies an Insurvas set into your agency as a draft so you can change it.",
          who: "Owner only"
        },
        {
          label: "Publish v(n)",
          what: "Opens a review of what the draft changes, then puts it live. New interviews load it; interviews already started keep the version they began on.",
          who: "Owner only"
        },
        {
          label: "See changes",
          what: "Shows what the draft changes compared with the live version."
        },
        {
          label: "Discard draft",
          what: "Deletes the draft. The live version stays in use.",
          who: "Owner only"
        },
        {
          label: "Rename",
          what: "Changes the set's name, which agents see at the foot of the Interview. Goes into the draft.",
          who: "Owner only"
        },
        {
          label: "Versions",
          what: "Opens every version of the set. You can open an older one, compare two, or restore one as a new draft."
        },
        {
          label: "Different questions for one carrier",
          what: "Starts a set for one carrier, copied from this every-carrier set. That carrier's calls load it; the others keep the general set.",
          who: "Owner only"
        },
        {
          label: "Duplicate for another product or carrier",
          what: "Copies the set as a draft for a different product line or carrier. The original does not change.",
          who: "Owner only"
        },
        {
          label: "Reset to the Insurvas set",
          what: "Retires your versions of the product's every-carrier set so calls use the Insurvas set again. Interviews already started keep theirs; carrier-specific sets stay.",
          who: "Owner only"
        },
        {
          label: "Retire v(n)",
          what: "Stops new interviews loading the live version. Work already started keeps it. A retired version cannot be published again.",
          who: "Owner only"
        },
        {
          label: "Asked on the Interview, in this order",
          what: "The open set's questions grouped in sections, in the order the agent asks them. Click a question to edit it; use the arrows to reorder questions and sections."
        },
        {
          label: "Add a section / Section name",
          what: "Adds a section to group questions, or renames one. An empty section can be removed.",
          who: "Owner only"
        },
        {
          label: "Add a question / New question",
          what: "Adds a question to the section and opens it for editing.",
          who: "Owner only"
        },
        {
          label: "Try it",
          what: "Answer Yes or No to each question and see whether the carrier would be ruled out (Ruled out or Can quote). Reset clears the answers. Nothing is saved."
        },
        {
          label: "Full preview",
          what: "Shows the Interview exactly as the agent sees it, including edits not yet saved."
        }
      ]
    },
    {
      key: "health-question-sheet",
      title: "Question (sheet)",
      what: "One question, opened from the list. Changes go into the set's draft.",
      fields: [
        {
          label: "Question text",
          what: "The words the agent reads aloud. Write it the way it should sound."
        },
        {
          label: "Answer type",
          what: "How the agent records the answer: Yes / No, Yes / No / Unsure, One choice, Several choices, Date, Number, Dollar amount, Free text, Long free text or Medication list. Only Yes / No can carry a knockout.",
          default: "Yes / No"
        },
        {
          label: "Applies to",
          what: "Who is asked: Every applicant, Ages 50 and over, Ages under 50 or Tobacco users. A skipped question is recorded as skipped, never as No.",
          default: "Every applicant"
        },
        {
          label: "Fills on the application",
          what: "Picks an application field the answer fills in on the Application step, marked as from the interview. \"Nothing — interview only\" keeps it on the Interview."
        },
        {
          label: "Section",
          what: "Which section of the Interview the question sits in."
        },
        {
          label: "Help text",
          what: "A note shown under the question in the interview."
        },
        {
          label: "Choices",
          what: "For choice questions: one choice per line, in the order the agent reads them."
        },
        {
          label: "Required",
          what: "When on, the interview cannot be marked complete without an answer.",
          default: "Off"
        },
        {
          label: "Keeps the policy on the books",
          what: "Marks a question about whether the policy will stay in force, asked before the health questions. The five persistency questions are locked on and cannot be deleted."
        },
        {
          label: "A Yes / A No is a knockout for the carrier",
          what: "For Yes / No questions: makes that answer rule the carrier out. The interview goes on; the agent sees it at once and picks another carrier on Quote."
        },
        {
          label: "What the agent sees",
          what: "The note shown as \"Knockout — …\" the moment the knockout answer is given. Required when the answer is a knockout."
        },
        {
          label: "Follow-up when Yes / No",
          what: "Questions asked only after that answer. Edit their text here or remove them."
        },
        {
          label: "Asked only when / The answer is",
          what: "Makes this question a follow-up to an earlier Yes / No or one-choice question, asked only on the answer you pick. \"Always asked\" removes the condition.",
          default: "Always asked"
        },
        {
          label: "Remove question",
          what: "Deletes the question from the draft. Locked questions and questions with follow-ups cannot be removed."
        },
        {
          label: "Save to draft / Cancel",
          what: "Keeps or drops the changes made in the sheet."
        }
      ]
    },
    {
      key: "health-new-set",
      title: "New underwriting template, Duplicate and Rename (dialogs)",
      what: "Starting, copying and naming a question set. Owner only.",
      fields: [
        {
          label: "For which product",
          what: "The product line the set is for."
        },
        {
          label: "For which carrier",
          what: "Leave on \"Every carrier without its own\" for a general set; pick one only when that carrier asks different questions."
        },
        {
          label: "Start from",
          what: "Insurvas's (the Insurvas set), Blank (the five always-on questions, then pick from the bank) or Copy of… (one of your sets)."
        },
        {
          label: "Template to copy",
          what: "Which of your sets to copy, when Start from is Copy of…."
        },
        {
          label: "Name",
          what: "The set's name. Left empty, a name is suggested for you."
        },
        {
          label: "Duplicate: Name, Product line, Carrier",
          what: "Where the copy goes. It must differ from the original, and your agency cannot already have a set for that pair."
        },
        {
          label: "Rename this set: Set name",
          what: "The name agents see at the foot of the Interview. Goes into the draft."
        }
      ]
    },
    {
      key: "quote-inputs",
      title: "Quote inputs",
      what: "What the agent types on the Quote step to get a price, for every carrier and product line you sell. No prices or rate tables live here. A saved quote keeps the version it was made with. Owner only.",
      fields: [
        {
          label: "What the agent types on the Quote step",
          what: "A grid of carriers by product line. Each cell shows what that pair uses (its own inputs, Your default, Insurvas default, or Not sold). Click a cell to open it."
        },
        {
          label: "Your default · every carrier",
          what: "The first row: the inputs used for a product line by every carrier that has none of its own."
        },
        {
          label: "Status",
          what: "Per carrier: Set, or how many of its pairs still run on the default."
        },
        {
          label: "Your default",
          what: "Opens the default row's first product line."
        }
      ]
    },
    {
      key: "quote-pair-sheet",
      title: "Carrier · product (sheet)",
      what: "One carrier and product pair's quote inputs. Edits save into the pair's draft; agents see them after you publish.",
      fields: [
        {
          label: "Give it its own / Add a template / Make a (product) default",
          what: "Gives the pair its own inputs, starting as a copy of what it uses now."
        },
        {
          label: "Copy to my agency",
          what: "Copies the Insurvas default into your agency as a draft so you can change it."
        },
        {
          label: "Publish v(n)",
          what: "Puts the draft live. New quotes use it; saved quotes keep their version."
        },
        {
          label: "How (input) is asked",
          what: "For each input (Date of birth, Gender, State, Tobacco use, Face amount, Target premium, Rate tier, Riders, and any of your own): Not asked, Optional or Required. Required inputs must be filled before a price shows. Date of birth and Face amount are always asked. Inputs not asked are not stored."
        },
        {
          label: "Move up / Move down",
          what: "Changes the order the Quote step asks the inputs in."
        },
        {
          label: "What the agent reads",
          what: "The input's label on the Quote step. Use the carrier's own words when they differ."
        },
        {
          label: "Note under it",
          what: "A note shown to the agent under the input on the Quote step."
        },
        {
          label: "Answer",
          what: "For your own inputs: Yes / no, One choice, Number, Dollar amount, Date or Short text."
        },
        {
          label: "Benefit types offered",
          what: "For Rate tier: which benefit types the Quote step offers. None picked offers all of the product's."
        },
        {
          label: "States offered",
          what: "For State: which states the Quote step offers. All and None set every state at once. None picked offers every state."
        },
        {
          label: "Riders offered / Choices",
          what: "The choices the agent picks from. Riders here are used when the product lists no riders of its own."
        },
        {
          label: "Add your own input / Answer / Add input",
          what: "Adds a new input of your own to the end of the list."
        },
        {
          label: "Remove this input",
          what: "Deletes an input you added."
        },
        {
          label: "Age basis",
          what: "How the carrier counts age: Age last birthday or Age nearest birthday.",
          default: "Age nearest birthday"
        },
        {
          label: "A quote stays valid for",
          what: "How long a quote stands before the agent must quote again: 14, 30 or 60 days.",
          default: "30 days"
        },
        {
          label: "What the agent sees",
          what: "The Quote step drawn with these inputs, including your latest edits."
        },
        {
          label: "Versions: Open / Retire",
          what: "Lists every version. Open shows an older one; Retire stops new quotes using a published version."
        },
        {
          label: "Copy to another carrier",
          what: "Makes a draft with the same inputs for another carrier or product line. Publish it when it is right."
        },
        {
          label: "Reset to the Insurvas default",
          what: "On the default row: drops your product default so quotes use the Insurvas default again."
        },
        {
          label: "Stop using it (retire v(n))",
          what: "Retires the pair's live inputs so it falls back to the default."
        },
        {
          label: "Discard draft v(n)",
          what: "Deletes the draft. The live version stays in use."
        }
      ]
    },
    {
      key: "carrier-application",
      title: "Carrier application",
      what: "Each carrier's application form: which fields the Application step asks and which are required. Review and Submit refuse a case missing any Required field. Carriers without their own set use the platform set. Edits save into a draft; agents see them after you publish. Owner only.",
      fields: [
        {
          label: "Carriers",
          what: "One row per carrier and product, with its required count, how many fields autofill cannot place, and whether it is a draft or the Insurvas set. Search carriers filters it."
        },
        {
          label: "Give a carrier its own set",
          what: "Opens a dialog to start a set for a carrier: Carrier, Product line, and Start from (the set it uses now, the platform set, or another of yours). It starts as a draft."
        },
        {
          label: "Customise for (carrier)",
          what: "Copies the set the carrier uses now into a draft of its own."
        },
        {
          label: "Publish v(n)",
          what: "Puts the draft live. Any live version is retired at the same time; applications already started keep theirs."
        },
        {
          label: "Fields to show",
          what: "Shows All fields, only Required, or only Changed (fields that differ from the platform set). Find a field searches. Changes nothing."
        },
        {
          label: "How (field) is asked",
          what: "For each field, grouped as Proposed insured, Contact, Address, Policy owner, Coverage and Payment: Not asked, Optional or Required. Your own questions are Optional or Required."
        },
        {
          label: "Move (field)",
          what: "Drag, or use the arrow keys, to change the order within its group."
        },
        {
          label: "Require all asked",
          what: "Makes every asked field in the group Required."
        },
        {
          label: "Add question",
          what: "Adds a question of the carrier's own to the group."
        },
        {
          label: "Autofill",
          what: "Shows whether the carrier's autofill map places each field on the carrier's form. Open the field map goes to Carriers to place it."
        },
        {
          label: "Use for other carriers",
          what: "Gives each carrier you tick a draft copy of this set. Publish each one when it matches that carrier's form."
        },
        {
          label: "What the agent sees",
          what: "The Application step as the agent sees it; starred fields must be filled before Submit."
        },
        {
          label: "Versions",
          what: "Every version of the set. Applications keep the version they started on."
        },
        {
          label: "Discard draft v(n)",
          what: "Deletes the draft."
        },
        {
          label: "Retire v(n)",
          what: "New applications fall back to the platform set; applications already started or submitted keep it."
        },
        {
          label: "Reset to default",
          what: "Takes the carrier back to the platform set."
        }
      ]
    },
    {
      key: "carrier-application-field",
      title: "Field or question (sheet)",
      what: "One field of a carrier's application, or a question of your own.",
      fields: [
        {
          label: "Asked as",
          what: "Optional or Required on the Application step."
        },
        {
          label: "Label the agent sees",
          what: "For a built-in field: the label on the Application step. Leave it as is when the carrier's form uses the same words."
        },
        {
          label: "Question",
          what: "For your own question: the words the agent sees."
        },
        {
          label: "Answer type",
          what: "For your own question: what kind of answer it takes."
        },
        {
          label: "Section",
          what: "For your own question: which group it sits in."
        },
        {
          label: "Choices",
          what: "For a choice question: one choice per line."
        },
        {
          label: "Help under it",
          what: "A note shown under the field on the Application step. Optional."
        },
        {
          label: "Where autofill puts it",
          what: "Shows whether the browser extension places this field on the carrier's form. If not placed, the agent writes it by hand; the link opens the field map."
        },
        {
          label: "Remove question / Add question / Save to draft",
          what: "Deletes your question, or keeps your changes in the draft."
        }
      ]
    },
    {
      key: "checks",
      title: "Quote & case checks",
      what: "One set of agency-wide checks on a quote and a case. Save on the title line stores every change on this tab. Owner only.",
      fields: [
        {
          label: "Lowest per $1,000",
          what: "The bottom of the monthly price band per $1,000 of cover. A final expense or whole life quote below it shows the agent a warning before choosing it. It never stops the case.",
          default: "0.50"
        },
        {
          label: "Highest per $1,000",
          what: "The top of the same band. A quote above it shows the agent a warning.",
          default: "15.00"
        },
        {
          label: "Reset to default",
          what: "Puts every check on this tab back to the Insurvas defaults. The welcome pack wording and the AI assistant switch are not touched."
        },
        {
          label: "When the carrier is not appointed in the client's state",
          what: "Checked at Review against your appointments. Block stops the case at the Quote step until the appointment is active; Warn lets it go on with a warning.",
          default: "Warn"
        },
        {
          label: "Draft-date buffer after the deposit",
          what: "The first draft is set at least this many days after the client's deposit, so the money is there when the carrier pulls it: 2, 3 or 4 days.",
          default: "3 days"
        },
        {
          label: "Flag open requirements after",
          what: "Days before a carrier requirement shows amber on Pending; it turns red at twice that. 1 to 60.",
          default: "5 days"
        },
        {
          label: "Welcome pack",
          what: "Send: goes to the client on its own once the case is submitted. Hold: waits in the agent's queue until someone sends it.",
          default: "Send"
        },
        {
          label: "Missing Required fields from the carrier application",
          what: "Always blocks Submit. Shown for reference; set the fields in Carrier application."
        },
        {
          label: "Try a quote",
          what: "Opens a dialog: pick Product type (Final expense, Whole life, Term), type a Face amount and Monthly premium, and see whether it falls inside the band. Nothing is saved."
        },
        {
          label: "Save / Discard",
          what: "Stores the changes, or drops them."
        }
      ]
    },
    {
      key: "product-bands",
      title: "Products with their own band",
      what: "Products checked against their own price band instead of the all-products one. This is the only way a term product is checked. Owner only.",
      fields: [
        {
          label: "Add a product band",
          what: "Opens Give a product its own band."
        },
        {
          label: "Product",
          what: "The product to give its own band."
        },
        {
          label: "Lowest per $1,000 / Highest per $1,000",
          what: "The product's band. Its quotes are checked against it."
        },
        {
          label: "Change",
          what: "Edits a product's band."
        },
        {
          label: "Remove band",
          what: "The product goes back to the all-products band."
        }
      ]
    },
    {
      key: "disclosures",
      title: "Disclosures",
      what: "The documents an application must carry, and the rules that decide when each is required. A version is never overwritten: edits make a new draft, and publishing retires the one before. Insurvas documents need your legal review and are read-only until copied. Owner only.",
      fields: [
        {
          label: "Search title or wording / Show",
          what: "Filters the list: All, Live, Drafts, Insurvas or Retired. Changes nothing."
        },
        {
          label: "Document list",
          what: "Each document with Required when, Applies to (states and carriers), Version and one status chip (Draft, Draft waiting, Live, Live no rule, Needs legal review, Retired). Click a row to open it."
        },
        {
          label: "Add a document",
          what: "Opens a dialog to start one: Start blank, Start from an Insurvas document (copies its wording, rules and PDF), or Duplicate one of yours. It starts as a draft and applies to nothing until you publish it."
        },
        {
          label: "Call scripts",
          what: "Opens Read on the call · by state."
        },
        {
          label: "Try a case",
          what: "Opens the Try a case sheet."
        },
        {
          label: "Row menu: Publish v(n), Copy to my agency, Start a draft from v(n), Duplicate as a new document, Versions, Try it on a case, Open its PDF",
          what: "Shortcuts to the same actions as the document sheet."
        },
        {
          label: "Reset to default… / Retire v(n)…",
          what: "Retires your live version; for a copied Insurvas document it goes back to the Insurvas one. Applications that acknowledged it keep it."
        },
        {
          label: "Delete draft v(n)… / Delete document…",
          what: "Deletes a draft, or every version of a document with its rules and PDF. A document an application carries cannot be deleted. This cannot be undone."
        },
        {
          label: "Duplicate: Code, Title",
          what: "A new draft with the same wording, states, carriers and rules, under its own code (capital letters, digits and _)."
        }
      ]
    },
    {
      key: "disclosure-sheet",
      title: "Disclosure document (sheet)",
      what: "One document version, in four sections: Wording, When required, Call scripts and Versions.",
      fields: [
        {
          label: "Code",
          what: "The document's code. Capital letters, digits and _. Fixed once a version has been published."
        },
        {
          label: "Title",
          what: "The document's name, as agents see it."
        },
        {
          label: "What the agent reads or sends",
          what: "The wording the client receives and agrees to. Copy wording copies it."
        },
        {
          label: "PDF",
          what: "Attach a PDF to the draft (Choose a file), open it, replace it or remove it. The PDF is private and opens through a short-lived link."
        },
        {
          label: "States",
          what: "The client's state on the application. None picked means every state."
        },
        {
          label: "Carriers",
          what: "The carrier the application goes to. None ticked means every carrier."
        },
        {
          label: "Required when",
          what: "Rules that make the document required. Every condition in a rule must hold; add another rule for an OR. Each condition picks a field (an interview answer or an application field), an operator (is, is not, is one of, is not one of, is more than, is less than) and a value. Up to 10 rules, 10 conditions each. No rule means never required."
        },
        {
          label: "Add a rule / Add another rule (or) / Add a condition / Duplicate / Remove rule",
          what: "Builds or removes rules and conditions. A removed rule can be undone for a few seconds."
        },
        {
          label: "Open scripts",
          what: "Opens the call scripts sheet."
        },
        {
          label: "Versions: Open / Compare / Start a draft from this version",
          what: "Opens or compares versions, or starts a new draft from a retired one."
        },
        {
          label: "Save draft / Discard / Delete draft",
          what: "Keeps your edits as a draft, drops them, or deletes the draft."
        },
        {
          label: "Publish",
          what: "New applications attach this version from now on; the version before is retired, and applications that acknowledged it keep it. A document with no rule is never required."
        },
        {
          label: "Copy to my agency",
          what: "On an Insurvas document: copies it into your agency as a draft so you can change it."
        },
        {
          label: "Compare with live v(n)",
          what: "Shows this version beside the live one."
        }
      ]
    },
    {
      key: "call-scripts",
      title: "Read on the call · by state (sheet)",
      what: "The wording an agent reads before pressing Call, per state and product. Insurvas compliance maintains it, so it is read-only.",
      fields: [
        {
          label: "Product",
          what: "Which product's wording to show."
        },
        {
          label: "Show states",
          what: "Filters states: All, Missing, Placeholder or Approved. A state with no wording cannot be dialed."
        },
        {
          label: "State tile",
          what: "Opens that state's wording. Copy wording copies it; Ask support to change it emails support."
        }
      ]
    },
    {
      key: "try-a-case",
      title: "Try a case (sheet)",
      what: "Answer as a client would and see which documents the application would carry. Reads the live versions. Nothing is saved. Opened from Overview or Disclosures.",
      fields: [
        {
          label: "Client's state",
          what: "The state to test."
        },
        {
          label: "Carrier",
          what: "The carrier to test."
        },
        {
          label: "Rule questions",
          what: "One field per answer your rules check (for example existing coverage). Yes, No or a value."
        },
        {
          label: "Start over",
          what: "Clears the answers."
        },
        {
          label: "Open / Review draft",
          what: "Opens a required document, or a draft that would apply once published."
        }
      ]
    },
    {
      key: "stage-moves",
      title: "Stage moves",
      what: "Where a lead's card moves on your pipeline when its application changes. A card never moves backwards (except to quoting after a decline), and a card a person moved stays put. An event with no stage moves nothing. Owner only.",
      fields: [
        {
          label: "Pipeline",
          what: "Which pipeline's map you are looking at."
        },
        {
          label: "When the application…",
          what: "The seven events (Quoted, Application started, Submitted, Pending requirements, Issued, Requoting, Lost) and the stage each moves the card to. Click one to edit it."
        },
        {
          label: "Fill in",
          what: "Match stage names (maps each event to the stage of the same name), Copy from another pipeline…, Undo this pipeline's changes, or Reset to default (clears the map)."
        },
        {
          label: "Open Pipelines & outcomes",
          what: "Goes to the page where you add pipelines and stages."
        },
        {
          label: "Save / Save (n) pipelines / Discard",
          what: "Stores the map changes, or drops them."
        },
        {
          label: "Copy a map into (pipeline)",
          what: "Copies another pipeline's map. Stages are matched by name; an event with no stage of the same name stays as it was."
        }
      ]
    },
    {
      key: "stage-move-event",
      title: "When the application… (sheet)",
      what: "One event, with one stage per pipeline.",
      fields: [
        {
          label: "Move the lead card to",
          what: "Per pipeline: the stage the card moves to. Leave it on \"Doesn't move the card\" to leave the card where it is.",
          default: "Doesn't move the card"
        },
        {
          label: "If the card is already further along",
          what: "Shows the fixed rule: never moves a card backwards. Always on."
        },
        {
          label: "Save / Done / Cancel",
          what: "Stores the event's stages, or closes without changing them."
        }
      ]
    },
    {
      key: "recent-moves",
      title: "Recent moves",
      what: "What the sync has done on the picked pipeline. Owner only.",
      fields: [
        {
          label: "Moved by the sync",
          what: "Cards moved automatically in the last 30 days."
        },
        {
          label: "Ready to move / Held by a person / Nowhere to go",
          what: "After a check: cards whose application changed before the map, cards where the board and the application disagree, and events with no stage."
        },
        {
          label: "Check cards / Check again",
          what: "Checks open cases against the saved map."
        },
        {
          label: "Move (n) cards now",
          what: "Moves the cards that are ready, by the saved map. Save or discard map changes first."
        },
        {
          label: "Recent automatic moves",
          what: "Each lead moved, where to, why and when. Open lead opens it."
        }
      ]
    }
  ]
},
{
  id: "form-templates",
  slug: "application-forms",
  title: "Application forms",
  group: "Selling",
  href: "/app/settings#form-templates",
  why: "The forms partners and agents fill in to send you a complete lead, one per product and more if you need them. Change it when you want to ask different questions, reorder pages, limit ages, or share a form on your website.",
  who: "Owner only",
  parts: [
    {
      key: "forms-list",
      title: "Forms · Results · Webhooks",
      what: "The list of every form you have, with its product, version, use in the last 30 days and status. Click a row to open the form.",
      fields: [
        {
          label: "Forms",
          what: "Shows each form with its version, how many were started and completed in the last 30 days, who changed it last and whether it is Live, Draft or Off."
        },
        {
          label: "Results",
          what: "Shows the same forms with how many were started, sent and finished in the last 30 days."
        },
        {
          label: "Webhooks",
          what: "Shows which forms call your own system when they make a lead. Click a row to set one up or open it."
        },
        {
          label: "Product chips",
          what: "Narrows the list to one product's forms."
        },
        {
          label: "Find a form",
          what: "Narrows the list to forms whose name or product matches what you type."
        },
        {
          label: "New form",
          what: "Opens the New form sheet to make another form for a product."
        },
        {
          label: "Open Products",
          what: "Shown when no product is switched on yet. Takes you to Products, where you switch one on so it gets its Insurvas form."
        }
      ]
    },
    {
      key: "new-form",
      title: "New form",
      what: "A sheet for making another form for a product. It opens as a draft until you publish it.",
      fields: [
        {
          label: "Product",
          what: "The product this form makes leads for.",
          default: "The first product in the list"
        },
        {
          label: "Start from",
          what: "What the new form starts with: The Insurvas <product> form (its questions and pages), A copy of one of your forms, or A blank form (name, phone and consent only).",
          default: "The Insurvas form"
        },
        {
          label: "The form to copy",
          what: "Shown with \"A copy of one of your forms\". Picks which of your forms to copy."
        },
        {
          label: "Form name",
          what: "The name partners see when they pick a form. Left empty, it is called \"<product> form\"."
        },
        {
          label: "Who fills it in",
          what: "Who the form is for: Partners, Your agents, Anyone with the link. At least one is needed.",
          default: "Partners and Your agents"
        },
        {
          label: "Create and open",
          what: "Makes the form and opens it. Until Insurvas applies a database update, only each product's main form can be saved, and this stays off."
        }
      ]
    },
    {
      key: "form-title-line",
      title: "An open form: title line",
      what: "The bar above an open form: its name, product, version, save state and the buttons that act on the whole form.",
      fields: [
        {
          label: "Application forms",
          what: "Goes back to the list of forms."
        },
        {
          label: "Build · Settings · Results · Versions",
          what: "Switches between the form's parts. An extra form (not a product's main form) has Build and Settings only."
        },
        {
          label: "Preview",
          what: "Shows the draft as a partner sees it. Nothing is saved from the preview."
        },
        {
          label: "Test submission",
          what: "Opens the Test submission sheet, which checks a filled-in draft without making a lead."
        },
        {
          label: "Share",
          what: "Opens the Share this form sheet: a link, website embed code and a QR code."
        },
        {
          label: "Publish v<number>",
          what: "Opens the Publish dialog. Turns your draft into the next live version. Off until there is a change."
        },
        {
          label: "Status line",
          what: "Shows whether the form is live and which version, or how many changes are not published and whether the draft is saved to Insurvas or only on this computer. Your draft is kept as you work, so closing the tab loses nothing."
        }
      ]
    },
    {
      key: "build-add-field",
      title: "Build · Add a field",
      what: "The left pane of the builder. Click an item to add it to the open page, or drag it onto the form.",
      fields: [
        {
          label: "Search fields",
          what: "Narrows the list to questions and field types that match what you type."
        },
        {
          label: "Insurvas questions · ready to use",
          what: "Insurvas's ready-made questions for this product. Ones already on the form say \"in use\" and can't be added twice. On an extra form this reads \"This product's questions\"."
        },
        {
          label: "Field types",
          what: "Adds a new question of that kind: Text, Long text, Number, Money, Date, Phone, Email, Yes / no, Choice, Multiple, SSN, Bank routing, Bank account. Not offered on an extra form."
        },
        {
          label: "New page",
          what: "Adds an empty page after the open one."
        }
      ]
    },
    {
      key: "build-form",
      title: "Build · the form",
      what: "The centre of the builder: the form's pages as tabs and the open page's questions in order.",
      fields: [
        {
          label: "Pages",
          what: "Switches which page you are looking at. Dragging a question onto a page's tab moves it to the end of that page."
        },
        {
          label: "Page",
          what: "Adds a new page at the end."
        },
        {
          label: "Page name",
          what: "Renames the open page. Partners see this name."
        },
        {
          label: "Move this page earlier / Move this page later",
          what: "Changes the order partners see the pages in."
        },
        {
          label: "Remove page",
          what: "Removes the open page. If it has questions you are asked first (Keep it / Remove the page); the questions stay saved on leads under For your agents only. You can Undo from the message that follows."
        },
        {
          label: "A question",
          what: "Click it to change it in the panel on the right. Drag it by its handle to move it."
        },
        {
          label: "Duplicate",
          what: "Adds a copy of the question right below it. Not on an extra form."
        },
        {
          label: "More: Move up · Move down · Move to <page> · Remove",
          what: "Moves the question within the page or to another page, or takes it off the form (with Undo)."
        },
        {
          label: "Add a field",
          what: "Adds a new question of the kind you pick to the end of the open page. Not on an extra form."
        }
      ]
    },
    {
      key: "question-field",
      title: "Question · Field",
      what: "The right pane when a question is picked. On an extra form the question's words and kind belong to the product, so only where it sits, whether it must be answered and its logic can change.",
      fields: [
        {
          label: "Question",
          what: "The words partners and agents read."
        },
        {
          label: "Help under the question",
          what: "Extra words shown under the question.",
          default: "None"
        },
        {
          label: "Answer with",
          what: "The kind of answer the question takes (text, number, date, phone, choice and so on). Changing it clears its rules."
        },
        {
          label: "Choices",
          what: "For Choice and Multiple questions: the answers people pick from. Add a choice adds one; the x removes one.",
          default: "First choice, Second choice"
        },
        {
          label: "Must be answered",
          what: "When on, the form can't be sent without an answer.",
          default: "Off for a new question"
        },
        {
          label: "Where it must be answered",
          what: "On this form only, or On every lead, from any source (imports and vendor posts too)."
        },
        {
          label: "Width",
          what: "Half or Full width on the page, on a computer."
        },
        {
          label: "Only your agents see it",
          what: "When on, the question leaves the partner form and is kept on the lead for your agents to fill in."
        },
        {
          label: "Lands on the application as",
          what: "Shows which carrier application field the answer fills. \"No match\" means it stays on the lead only."
        },
        {
          label: "Show technical details",
          what: "Shows the question's stored key, with Copy."
        },
        {
          label: "Remove / Delete",
          what: "Remove takes the question off this page; Delete removes it from the form entirely. Both can be undone from the message that follows."
        },
        {
          label: "Put back",
          what: "Shown when you changed a published question. Returns it to how it is in the live version."
        },
        {
          label: "Duplicate",
          what: "Adds a copy of the question below it."
        }
      ]
    },
    {
      key: "question-logic",
      title: "Question · Logic",
      what: "When the picked question shows, and when a whole page is skipped. Only for questions on a page.",
      fields: [
        {
          label: "Show this question when all / any of these are true",
          what: "Whether every rule must match, or one is enough, for the question to show."
        },
        {
          label: "Add a rule / And a rule / Or a rule",
          what: "Adds a rule that reads another question's answer: the Question, How it is tested, and The answer."
        },
        {
          label: "And a group / Or a group",
          what: "Adds a group of rules with its own Any of these / All of these."
        },
        {
          label: "Remove this rule",
          what: "Takes the rule away."
        },
        {
          label: "Always show it",
          what: "Removes every rule so the question always shows."
        },
        {
          label: "Clear the answer",
          what: "Always on and can't be changed: a hidden question's answer is cleared so it never reaches the lead."
        },
        {
          label: "Skip page … when all / any of these are true",
          what: "Picks a page and the rules that make partners skip it. Rules can only read questions on other pages."
        },
        {
          label: "All logic on this form",
          what: "Lists every rule on the form. Click one to open that question."
        }
      ]
    },
    {
      key: "question-validation",
      title: "Question · Validation",
      what: "The rules an answer must meet, and the message shown when it doesn't. Phone, email, SSN, bank and yes/no questions have fixed rules that are shown in words.",
      fields: [
        {
          label: "Amount allowed",
          what: "For Money questions: the lowest and highest amount accepted.",
          default: "No limit"
        },
        {
          label: "Number allowed",
          what: "For Number questions: the lowest and highest number accepted.",
          default: "No limit"
        },
        {
          label: "Age on the day they apply",
          what: "For Date questions: the youngest and oldest age accepted. For the date of birth these are the same ages as Who can apply; change one and both change.",
          default: "No limit"
        },
        {
          label: "No dates in the future",
          what: "For Date questions: refuses a date after today.",
          default: "Off"
        },
        {
          label: "Characters",
          what: "For Text and Long text: the fewest and most characters accepted.",
          default: "No limit"
        },
        {
          label: "Allowed",
          what: "For Text and Long text: Anything, Letters only, Digits only, or Letters and digits.",
          default: "Anything"
        },
        {
          label: "Message when it fails",
          what: "The words a person reads when the answer breaks a rule. Used in the preview and test submissions now.",
          default: "The usual message"
        },
        {
          label: "Try a value",
          what: "Type an answer to see whether it passes the rules above. Nothing is saved."
        }
      ]
    },
    {
      key: "preview",
      title: "Preview",
      what: "The draft as partners see it, filled in for real but never saved.",
      fields: [
        {
          label: "Preview width",
          what: "Shows the form as on a Computer, a Phone, or Both.",
          default: "Both"
        },
        {
          label: "Open in the partner form",
          what: "Opens the partner portal's own form with your draft in it. Nothing is saved or sent."
        },
        {
          label: "Start again",
          what: "Clears the answers you typed in the preview."
        },
        {
          label: "Back to building",
          what: "Returns to the builder."
        },
        {
          label: "Test submission",
          what: "Opens Test submission with the answers you typed."
        }
      ]
    },
    {
      key: "test-submission",
      title: "Test submission",
      what: "Runs the draft's answers through the checks a sent form meets and shows where each answer lands. No lead is made and nobody is told.",
      fields: [
        {
          label: "Fill with sample answers",
          what: "Fills every shown question with a sample answer."
        },
        {
          label: "Send as a test",
          what: "Checks the answers. The result shows the test lead's name, the pipeline stage it would start in, that no lead was made, and whether a webhook would be sent."
        },
        {
          label: "Where each answer landed",
          what: "Shows each answer next to the lead field and carrier application field it fills."
        },
        {
          label: "Change the answers / Send another",
          what: "Go back to the answers, or run the check again."
        }
      ]
    },
    {
      key: "share",
      title: "Share this form",
      what: "A link to the live version (never the draft), code for your website and a QR code for mailers. Saves once Insurvas applies a database update.",
      fields: [
        {
          label: "Link · Embed · QR code",
          what: "Switches between the three ways to share."
        },
        {
          label: "Form link",
          what: "The address of the form, with Copy. It names your agency and the product."
        },
        {
          label: "Who can open it",
          what: "Anyone with the link, Signed-in partners, or Your agents. Anyone-with-the-link leads give consent on the last page and are checked against your Never call list.",
          default: "Anyone with the link"
        },
        {
          label: "Lead source for this link",
          what: "The source leads from this link carry, so they show apart in Results.",
          default: "Website · <form name>"
        },
        {
          label: "The link is on",
          what: "Turns the link on or off.",
          default: "On"
        },
        {
          label: "Make the link / Save link",
          what: "Saves the link settings above."
        },
        {
          label: "Embed as",
          what: "In the page, Pop-up button, or Full page. Changes the code you copy.",
          default: "In the page"
        },
        {
          label: "Copy the code",
          what: "Copies the embed code for your website."
        },
        {
          label: "Download PNG / Download SVG",
          what: "Saves a QR code that opens the link marked as a mailer lead."
        }
      ]
    },
    {
      key: "publish",
      title: "Publish version <number>?",
      what: "Asked once when you press Publish. New leads use the new version; forms already started finish on the old one.",
      fields: [
        {
          label: "Changes list",
          what: "Shows each change in the draft: added, changed, moved or removed. Anything that blocks publishing is listed in red."
        },
        {
          label: "Note for the team (optional)",
          what: "A few words on what this version changes, kept with the version."
        },
        {
          label: "Publish version <number>",
          what: "Makes the draft the live version. Off while something blocks it."
        }
      ]
    },
    {
      key: "settings-who",
      title: "Settings · Who can apply",
      what: "The ages this product covers, read from the form's date-of-birth question. Checked when a lead is sent and when leads are imported. If the form has no date of birth, anyone can apply.",
      fields: [
        {
          label: "Youngest age",
          what: "Leads younger than this are refused.",
          default: "No limit"
        },
        {
          label: "Oldest age",
          what: "Leads older than this are refused.",
          default: "No limit"
        }
      ]
    },
    {
      key: "settings-parts",
      title: "Settings · Pages & parts",
      what: "The form's name, and whole topics switched off for this product.",
      fields: [
        {
          label: "Name of this form",
          what: "The name partners see when they pick a form."
        },
        {
          label: "Topic switches (for example Medical, Banking)",
          what: "One switch per topic the form's pages belong to. Off hides that topic's pages for this product."
        }
      ]
    },
    {
      key: "settings-steps",
      title: "Settings · After sending",
      what: "Shows where a lead from this form goes: the pipeline for its partner's type, or your default pipeline, starting at the first open step. Read only here.",
      fields: [
        {
          label: "Pipelines list",
          what: "Shows each pipeline with its steps in order."
        },
        {
          label: "Change steps in Pipelines & outcomes",
          what: "Takes you to Pipelines & outcomes, where steps are changed."
        }
      ]
    },
    {
      key: "settings-hook",
      title: "Settings · When a form is sent",
      what: "A signed call to your own system each time this form makes a lead. It saves on its own, apart from the draft. Needs a database update before it saves.",
      fields: [
        {
          label: "Send to this address",
          what: "The HTTPS address that receives the call. Private addresses are refused."
        },
        {
          label: "Send when",
          what: "A form is sent, A test is sent, or both.",
          default: "A form is sent"
        },
        {
          label: "Signing secret",
          what: "Shown once, when you save, with Copy. Your system uses it to check the call came from Insurvas. SSN and bank answers are never sent."
        },
        {
          label: "What we send",
          what: "Shows a sample of the call's content."
        },
        {
          label: "Recent deliveries",
          what: "Shows each call: when, what, how long it took and the answer. Failed calls retry 5 times over about nine hours."
        },
        {
          label: "Remove webhook",
          what: "Stops the calls for this form."
        },
        {
          label: "Send a test",
          what: "Sends a test call now."
        },
        {
          label: "Save webhook",
          what: "Saves the address and events."
        }
      ]
    },
    {
      key: "settings-agents",
      title: "Settings · For your agents only",
      what: "Questions saved on every lead that partners never see. Your agents fill them in.",
      fields: [
        {
          label: "Question chips",
          what: "Click one to change it in the question panel below."
        },
        {
          label: "Add one",
          what: "Adds a new agents-only question."
        }
      ]
    },
    {
      key: "settings-versions",
      title: "Settings · Versions & Insurvas updates",
      what: "What is live, Insurvas's own templates for this product, and a way back to the Insurvas form. An extra form gets updates through its product's main form.",
      fields: [
        {
          label: "Add from an Insurvas template",
          what: "Pick an Insurvas template for this product to add from. Adding only adds what is missing; nothing of yours is removed."
        },
        {
          label: "See what it adds",
          what: "Lists the questions, pages and lead steps the template would add."
        },
        {
          label: "Add it to this form",
          what: "Adds what is missing. Publish or undo your own changes first."
        },
        {
          label: "Reset to default",
          what: "Puts the Insurvas form's questions and pages into your draft. Your lead steps stay. Nothing changes for partners until you publish."
        }
      ]
    },
    {
      key: "results",
      title: "Results",
      what: "How the live form is doing: opens, starts, sends and where people stop, by question and by source.",
      fields: [
        {
          label: "Results window",
          what: "Counts the last 7, 30 or 90 days.",
          default: "30 days"
        },
        {
          label: "Opened · Started · Sent · Finished",
          what: "Shows the counts for the window. Opened needs a database update."
        },
        {
          label: "Where people stop",
          what: "Shows each question with how many reached it and how many stopped there; the worst is marked."
        },
        {
          label: "By source",
          what: "Shows how many forms were sent from each source."
        }
      ]
    },
    {
      key: "versions",
      title: "Versions",
      what: "Your draft and every published version, with what each changed.",
      fields: [
        {
          label: "Versions list",
          what: "Click the draft or a version to see what changed in it. Each version shows when, by whom and how many partner forms are on it."
        },
        {
          label: "Insurvas update available · Review",
          what: "Shown when Insurvas has a newer template. Opens Settings · Versions & Insurvas updates."
        },
        {
          label: "Undo all",
          what: "Throws away every change in the draft."
        },
        {
          label: "Restore into the draft",
          what: "Puts an older version into your draft. Publish it to make it live again."
        }
      ]
    }
  ]
},
{
  id: "sales-ai",
  slug: "ai-assistant",
  title: "AI assistant",
  group: "Selling",
  href: "/app/settings#sales-ai",
  why: "What the AI assistant will do and exactly what data it would be sent. It is not available yet; here you can join the early list and set your data choices for the day it is ready.",
  who: "Owner only",
  parts: [
    {
      key: "top",
      title: "AI assistant",
      what: "The tabs, the buttons and the status line saying the assistant is not available yet and whether you are on the early list.",
      fields: [
        {
          label: "What it does · Your data",
          what: "Switches between the features and the full data lists."
        },
        {
          label: "Data controls",
          what: "Opens the Data controls sheet."
        },
        {
          label: "Join the early list / On the early list",
          what: "Opens the early-list dialog to join, change your choices or leave."
        }
      ]
    },
    {
      key: "what-it-does",
      title: "What it does",
      what: "The planned features with an example each: Underwriting helper (first to arrive), Call summaries, Next best step, Quote explainer, Compliance check. Nothing it writes is saved or sent to a client without an agent's click.",
      fields: [
        {
          label: "See your data rules",
          what: "Opens the Your data tab."
        },
        {
          label: "Your data",
          what: "Shows what is sent, only for the feature in use, and what is never sent. Fixed in code; you can't add to \"sent\" or remove from \"never\"."
        },
        {
          label: "When it's ready",
          what: "What happens the day a provider is signed: Email me, or Turn it on for admins to try. Picking one before you join opens the early-list dialog.",
          default: "Email me"
        }
      ]
    },
    {
      key: "your-data",
      title: "Your data",
      what: "The two data lists in full, and the choices you made in Data controls.",
      fields: [
        {
          label: "Sent, only for the feature in use",
          what: "Shows what would be sent: the question text, the answer text, medication names and doses, the product and the state."
        },
        {
          label: "Never sent",
          what: "Shows what is never sent: name, Social Security number, bank and card numbers, home address, phone, email, date of birth, income and screenshots."
        },
        {
          label: "Provider · Processed · Medication doses · Kept · Who can use it",
          what: "Shows your current choices and the fixed facts."
        },
        {
          label: "Data controls",
          what: "Opens the Data controls sheet."
        }
      ]
    },
    {
      key: "early-list",
      title: "Join the early list?",
      what: "We email you the day the assistant is ready. Nothing is sent to any AI provider until you turn it on then.",
      fields: [
        {
          label: "Which features interest you?",
          what: "The features you want. At least one is needed.",
          default: "Underwriting helper, Call summaries, Compliance check"
        },
        {
          label: "When it's ready",
          what: "Just email me (it stays off until you switch it on), or Turn it on for admins to try (agents don't see it until you say so).",
          default: "Just email me"
        },
        {
          label: "Join the early list / Save",
          what: "Saves your place and choices."
        },
        {
          label: "Leave the list",
          what: "Takes you off the early list."
        }
      ]
    },
    {
      key: "data-controls",
      title: "Data controls",
      what: "Saved now and applied when a provider is signed.",
      fields: [
        {
          label: "Provider",
          what: "Read only. Chosen by Insurvas once its terms for health data are settled.",
          default: "Not chosen yet"
        },
        {
          label: "Where data is processed",
          what: "Read only. Always United States only."
        },
        {
          label: "What the provider keeps",
          what: "Read only. Nothing; deleted after each answer."
        },
        {
          label: "Send medication doses",
          what: "Sends doses as well as names, for better carrier matches.",
          default: "On"
        },
        {
          label: "Use call transcripts",
          what: "Always off and can't be changed today. Call transcripts are never sent."
        },
        {
          label: "Keep what it writes",
          what: "How long the assistant's writing is kept: 30 days, 1 year, or Like the lead.",
          default: "1 year"
        },
        {
          label: "Who can use it",
          what: "Admins, or Everyone.",
          default: "Everyone"
        },
        {
          label: "Save",
          what: "Saves the choices above."
        }
      ]
    }
  ]
},
{
  id: "lead-posting",
  slug: "lead-posting",
  title: "Lead posting",
  group: "Leads & calling",
  href: "/app/settings#lead-posting",
  why: "Connect the lead vendors that post leads to you by API, give each one a key, and map their field names onto yours. Come here to add a vendor, fix posts that are being refused, or rotate a key.",
  who: "Owner only. Needs a plan with lead import.",
  parts: [
    {
      key: "header",
      title: "Page header",
      what: "The tabs and the buttons at the top of Lead posting. A status line under them says how many vendors are posting and when the last lead came in.",
      fields: [
        {
          label: "Vendors",
          what: "Shows every connected vendor with today's figures. The tab count is the number of vendors."
        },
        {
          label: "Activity",
          what: "Shows every post from every vendor, newest first."
        },
        {
          label: "Rejections",
          what: "Shows refused posts and the reasons that repeat. The red count is posts refused today."
        },
        {
          label: "Vendor guide",
          what: "Shows the general posting instructions you can send to any vendor."
        },
        {
          label: "Copy posting address",
          what: "Copies your agency's posting address, the one URL every vendor posts to. Shown on every tab except Rejections."
        },
        {
          label: "Export CSV",
          what: "Downloads the refused posts for the window you picked as a spreadsheet file. Shown on the Rejections tab only."
        },
        {
          label: "Connect a vendor",
          what: "Opens the four-step Connect a vendor window that makes a key for a new vendor."
        }
      ]
    },
    {
      key: "vendors",
      title: "Vendors",
      what: "Today's figures and one line per vendor. Click a vendor to open its sheet.",
      fields: [
        {
          label: "Posts today",
          what: "Shows how many posts arrived today. Today resets at midnight, your time."
        },
        {
          label: "Accepted",
          what: "Shows how many posts today became leads, and the share of all posts."
        },
        {
          label: "Refused",
          what: "Shows how many posts were refused today. Refused posts are never charged."
        },
        {
          label: "Lead spend today",
          what: "Shows what today's accepted leads cost, from each vendor's price per lead. Shows a dash until a pending database update is applied."
        },
        {
          label: "First dial, median",
          what: "Shows how long it usually takes from a posted lead to its first dial."
        },
        {
          label: "Show vendors",
          what: "Filters the table: All, Live, Needs you, Testing or Off. Each choice shows its count.",
          default: "All"
        },
        {
          label: "Find a vendor",
          what: "Filters the table by vendor or campaign name."
        },
        {
          label: "Vendor table",
          what: "Shows each vendor's campaign, status, posts today, share accepted over 7 days, price per lead and last post. Click a row to open the vendor's sheet."
        },
        {
          label: "Read the vendor guide",
          what: "Shown when no vendor is connected yet. Opens the Vendor guide tab."
        }
      ]
    },
    {
      key: "vendor-setup",
      title: "Vendor sheet: Setup",
      what: "Where a vendor's accepted leads go, what they cost, when posts are accepted, the key, the instructions and notes. Changes here save with Save changes at the foot of the sheet.",
      fields: [
        {
          label: "Setup / Field map / Test / Activity",
          what: "Switch between the four parts of the vendor's sheet. Field map shows a red count of their fields not read yet."
        },
        {
          label: "Campaign",
          what: "Picks the campaign the vendor's accepted leads land in. If the campaign's product has no intake form, posts are refused.",
          default: "Their accepting campaign (their first active, scrubbed campaign)"
        },
        {
          label: "Price per accepted lead",
          what: "Sets what you pay this vendor for each accepted lead. It feeds Lead spend. Refused and test posts are never charged. Needs a pending database update before it can be changed."
        },
        {
          label: "Daily cap",
          what: "Sets the most leads you take from this vendor in a day. Posts past the cap are refused. Leave blank for no cap. Needs a pending database update.",
          default: "No cap"
        },
        {
          label: "Accept posts",
          what: "Choose Any time, or Only at set hours to refuse posts outside the days and hours below. Needs a pending database update.",
          default: "Any time"
        },
        {
          label: "Days (Sun to Sat)",
          what: "With set hours, picks the days posts are accepted.",
          default: "Mon to Sat"
        },
        {
          label: "From",
          what: "With set hours, the time posts start being accepted.",
          default: "08:00"
        },
        {
          label: "Until",
          what: "With set hours, the time posts stop being accepted.",
          default: "20:00"
        },
        {
          label: "Time zone",
          what: "With set hours, the time zone the hours are read in.",
          default: "Central (America/Chicago)"
        },
        {
          label: "Key",
          what: "Shows whether the key is working, rotated with a grace period, or revoked, when it was made and when it was last used."
        },
        {
          label: "Posting address",
          what: "Shows the posting address with a copy button. Technical details also list the start of the key and the older shared address."
        },
        {
          label: "Rotate key",
          what: "Opens Rotate key to make a new key for this vendor. When the key is revoked the button reads Make a new key and opens Connect a vendor for them."
        },
        {
          label: "Revoke",
          what: "Opens Revoke key. When the key is already revoked, Turn this key back on lets their posts in again."
        },
        {
          label: "Sent",
          what: "Shows when the instructions were sent, to whom, and how often the link was opened."
        },
        {
          label: "Their developer's email",
          what: "The address the instructions are emailed to."
        },
        {
          label: "Copy link / Copy instructions",
          what: "Copies a link to the vendor's own instructions page, or the instructions text before a pending database update is applied."
        },
        {
          label: "Download PDF",
          what: "Downloads the vendor's instructions as a PDF."
        },
        {
          label: "Email to vendor",
          what: "Opens an email to their developer with the instructions. Reads Email again once sent."
        },
        {
          label: "Their status address",
          what: "A web address we call when one of their leads is accepted or refused, so they can stop billing bad leads. Needs a pending database update."
        },
        {
          label: "Accepted",
          what: "When on, we call their status address for each accepted lead."
        },
        {
          label: "Refused",
          what: "When on, we call their status address for each refused post."
        },
        {
          label: "Notes",
          what: "Free text about this vendor, such as account rep or billing terms. Up to 2,000 characters. Needs a pending database update."
        },
        {
          label: "Save changes",
          what: "Saves the Setup changes. Close asks before it drops unsaved changes."
        }
      ]
    },
    {
      key: "vendor-field-map",
      title: "Vendor sheet: Field map",
      what: "Matches each field the vendor sends to one of your lead fields or a question on the product's intake form. A field that is not read is still kept on the lead as sent.",
      fields: [
        {
          label: "Paste a sample lead",
          what: "Opens a window where you paste one of their leads (JSON or name=value pairs). Their fields are matched by name. Nothing is posted or saved."
        },
        {
          label: "Their lead",
          what: "In Paste a sample lead: the lead as they send it. Match their fields fills the map; Cancel closes."
        },
        {
          label: "Reset to suggested",
          what: "Replaces each row's choice with the suggested match from their last post."
        },
        {
          label: "Their field",
          what: "The name the vendor sends. Typed by hand for rows you add yourself."
        },
        {
          label: "Goes to",
          what: "Picks which of your lead fields, or which intake form question (Form ›), takes their value. Each of your fields can be read from only one of theirs."
        },
        {
          label: "Note",
          what: "An optional note on the row, up to 200 characters. Needs a pending database update."
        },
        {
          label: "Add a field",
          what: "Adds an empty row so you can map a field they have not sent yet."
        },
        {
          label: "Remove row",
          what: "Removes a row you added by hand."
        },
        {
          label: "Save field map",
          what: "Saves the map to all of this vendor's keys. Discard drops the unsaved changes."
        }
      ]
    },
    {
      key: "vendor-test",
      title: "Vendor sheet: Test",
      what: "Sends a made-up lead through every check a real post runs, stopping before a lead or a charge is made.",
      fields: [
        {
          label: "Test mode / Live",
          what: "In test mode the vendor's own posts are checked the same way but never become leads. Live turns their posts into leads. Needs a pending database update."
        },
        {
          label: "Edit test lead",
          what: "Opens Edit the test lead: First name, Last name, Phone, State, Date of birth, Consent IP and Consent words. Use this lead keeps it for the next test.",
          default: "Martha Reyes, (512) 555-0142, TX, born 03/14/1956"
        },
        {
          label: "Send a test post",
          what: "Sends the test lead in the vendor's own field names and shows whether it would be accepted or refused, and why."
        },
        {
          label: "Fix and resend",
          what: "Shown on a refused test when a field is not read: saves the suggested match into the field map and sends the same test again."
        },
        {
          label: "Fix link on a refused test",
          what: "For a licence or campaign problem, links to the page where you fix it."
        }
      ]
    },
    {
      key: "vendor-activity",
      title: "Vendor sheet: Activity",
      what: "This vendor's last 7 days, why posts were refused, and its recent posts.",
      fields: [
        {
          label: "Posts, 7 days / Accepted / Refused / First dial, median",
          what: "Shows this vendor's figures for the last 7 days."
        },
        {
          label: "Why posts were refused, 7 days",
          what: "Lists each refusal reason with its count and one fix button: fix the field map, rotate the key, tell the vendor by email, or open the licence or campaign page."
        },
        {
          label: "Recent posts",
          what: "Shows up to 25 of their posts with arrival time, outcome and time taken. Open lead opens an accepted lead."
        },
        {
          label: "Speed to lead by campaign",
          what: "When the vendor feeds more than one campaign, shows each campaign's median first dial and share dialled inside a minute."
        }
      ]
    },
    {
      key: "key-dialogs",
      title: "Rotate key, Revoke key and the new key",
      what: "The windows that change a vendor's key.",
      fields: [
        {
          label: "Old key stops now",
          what: "In Rotate key: the old key stops working at once. Use it if the key may have leaked.",
          default: "Selected"
        },
        {
          label: "Old key works for 24 more hours",
          what: "In Rotate key: the old key keeps working for a day so the vendor has time to switch. Needs a pending database update."
        },
        {
          label: "Email the new instructions",
          what: "In Rotate key: after you close the new key, opens an email to the vendor with updated instructions.",
          default: "On"
        },
        {
          label: "Rotate key",
          what: "Makes the new key and shows it once."
        },
        {
          label: "Type the vendor's name to confirm",
          what: "In Revoke key: you type the vendor's name before Revoke key works. Revoking refuses every post with this key from now on; their leads and history stay."
        },
        {
          label: "Copy key",
          what: "In the new key window: copies the key. It is shown only once; we keep a fingerprint, never the key."
        },
        {
          label: "I've copied the key somewhere safe",
          what: "Must be ticked before Done closes the new key window."
        }
      ]
    },
    {
      key: "activity",
      title: "Activity",
      what: "Every post from every vendor, newest first. Payloads are not shown; test posts are marked and never become leads.",
      fields: [
        {
          label: "Every post",
          what: "Shows arrival time, vendor, outcome and time taken for each post. Open lead opens the lead an accepted post made."
        }
      ]
    },
    {
      key: "rejections",
      title: "Rejections",
      what: "Refused posts, which are leads you are not billed for, and the reasons that keep repeating with their fixes.",
      fields: [
        {
          label: "Window",
          what: "Picks the period shown: Today, 7 days or 30 days.",
          default: "Today"
        },
        {
          label: "Vendor",
          what: "Shows refused posts from one vendor only.",
          default: "All vendors"
        },
        {
          label: "Refused posts",
          what: "Shows time, vendor, lead, reason and charge ($0.00) for each refused post. The newest 500 are shown; Export CSV has the rest."
        },
        {
          label: "What keeps happening",
          what: "Lists each repeating reason per vendor with its count and one fix: open the field map, tell the vendor, rotate the key, or open the licence or campaign page."
        },
        {
          label: "Tell vendor",
          what: "Opens an email to the vendor with the refused posts and the rule they broke."
        }
      ]
    },
    {
      key: "guide",
      title: "Vendor guide",
      what: "General posting instructions for a vendor you are talking to. Once a vendor is connected, their own copy in their sheet uses their field names.",
      fields: [
        {
          label: "Guide",
          what: "Shows the instructions page: address, headers, fields, replies and a sample."
        },
        {
          label: "Copy the guide",
          what: "Copies the general instructions."
        },
        {
          label: "Download PDF",
          what: "Downloads the general instructions as a PDF."
        },
        {
          label: "Posting address",
          what: "Shows your posting address with a copy button. Technical details list the older shared address and the key-in-the-path form for systems that cannot set a header."
        }
      ]
    },
    {
      key: "connect-wizard",
      title: "Connect a vendor",
      what: "Four steps in one window: vendor and campaign, the key, instructions, and a test post. Once the key is made, closing the window keeps the vendor.",
      fields: [
        {
          label: "Vendor",
          what: "Pick one of your lead sources or type a new name. A new name is added to your lead sources. A vendor that already has a key cannot be picked again."
        },
        {
          label: "Price per accepted lead",
          what: "What you pay for each accepted lead. Needs a pending database update."
        },
        {
          label: "Which campaign do their leads go to?",
          what: "Pick Their first open campaign, or one of the vendor's campaigns. Campaigns whose product has no intake form cannot be picked.",
          default: "Their first open campaign"
        },
        {
          label: "Next: make the key",
          what: "Makes the vendor's key. With the pending database update applied, the key starts in test mode."
        },
        {
          label: "Copy key",
          what: "Step 2: copies the key, shown only once."
        },
        {
          label: "I've copied the key somewhere safe",
          what: "Step 2: must be ticked before Next: send instructions."
        },
        {
          label: "Email to",
          what: "Step 3: the developer's address the instructions go to."
        },
        {
          label: "Copy to",
          what: "Step 3: a second address copied on the email."
        },
        {
          label: "Include the key",
          what: "Step 3: always off. The key is never put in an email or link; the guide tells them to use the key you sent separately."
        },
        {
          label: "Email to vendor / Download PDF / Copy link to this page",
          what: "Step 3: send or copy the vendor's instructions. Skip moves on without sending."
        },
        {
          label: "Send one from here / Wait for vendor",
          what: "Step 4: send a made-up test lead through their field map, or listen for the vendor's own first post."
        },
        {
          label: "Edit / Send the test",
          what: "Step 4: change the test lead, then send it and see the result."
        },
        {
          label: "Go live",
          what: "Finishes and turns the vendor's posts into leads. Finish, stay in test mode keeps their posts checked but not kept. Before the pending database update this button reads Done and the key already works."
        }
      ]
    }
  ]
},
{
  id: "cadence",
  slug: "dialing-cadence",
  title: "Dialing cadence",
  group: "Leads & calling",
  href: "/app/settings#cadence",
  why: "Sets how long the dialer waits before each retry on a lead, which part of the day it prefers, and how many calls it makes before the lead goes to Nurture. Change it when leads are called too often, too little, or at the wrong time of day.",
  who: "Owner only. Needs a plan with outbound dialing. Others who reach it see it read-only.",
  parts: [
    {
      key: "header",
      title: "Page header",
      what: "The outcome tabs and the scope, history and reset buttons. A status line under them says which cadence is in force, which calls calling windows move, and who saved last.",
      fields: [
        {
          label: "No answer / Voicemail / Busy / Callback / Not interested",
          what: "Shows the cadence for a lead that gets this outcome every time. A count on a tab is the number of calls where that outcome has its own rule.",
          default: "No answer"
        },
        {
          label: "Applies to",
          what: "Picks what you edit: Every campaign (the agency cadence) or a campaign that has its own cadence. Picking a campaign on the agency cadence, or Give a campaign its own cadence…, opens the campaign sheet.",
          default: "Every campaign"
        },
        {
          label: "History",
          what: "Opens Cadence history for the scope you are editing."
        },
        {
          label: "Reset to default",
          what: "Asks first, then puts the Insurvas default into your draft (for a campaign, the agency cadence). Nothing changes for the dialer until you save. Leads already mid-cadence keep their next scheduled call."
        }
      ]
    },
    {
      key: "cadence-card",
      title: "Agency cadence (or the campaign's cadence)",
      what: "The cadence drawn on a 14-day timeline for one example lead, with a sentence that says how many calls it gets and over how long.",
      fields: [
        {
          label: "Preset",
          what: "Writes a starting cadence into your draft: Gentle (5 calls, a day or more apart), Balanced (the Insurvas default, 7 calls, front-loaded) or Persistent (10 calls, closer together early). Custom means your own waits. Presets other than Balanced need a pending database update."
        },
        {
          label: "Max calls",
          what: "The most calls a lead gets on this cadence, from 1 to 20. After the last call the lead goes to Nurture. Blank uses the agency's number, or 7. A recycled lead keeps its own ceiling. Needs a pending database update.",
          default: "7"
        },
        {
          label: "Copy it and edit",
          what: "Shown before you have a cadence of your own. Copies the Insurvas default into your draft so you can change it."
        },
        {
          label: "Timeline",
          what: "One dot per call across the days and the parts of the day. Drag a call sideways to change its wait, up or down to change its part of the day, click it to edit it. Days your calling windows close are striped; a call they push shows where the rule wanted it."
        },
        {
          label: "Calling windows",
          what: "Link in the legend that opens Calling windows."
        },
        {
          label: "Save cadence",
          what: "Saves the draft so the dialer uses it. The band says how many changes are not saved; Discard drops them. Save stays off while a call has a problem."
        }
      ]
    },
    {
      key: "call-popover",
      title: "Call",
      what: "Opens when you click a call. Edits the rule the current outcome tab shows for that call. Call 1 is made as soon as the lead arrives and has no wait to change.",
      fields: [
        {
          label: "Wait after call",
          what: "How long the dialer waits after the call before, as a number plus minutes, hours or days."
        },
        {
          label: "Part of the day",
          what: "Any, Morning, Afternoon (noon to 3pm) or Evening. The dialer aims for that part of the day inside your calling hours.",
          default: "Any"
        },
        {
          label: "Or another time…",
          what: "Picks a narrower time: the other half of the day, early morning, late morning, early evening, late evening or the weekend."
        },
        {
          label: "Make this call after",
          what: "One tick per outcome. Untick an outcome to give it its own wait for this call; the others follow the shared rule."
        },
        {
          label: "Follow the shared rule again",
          what: "Shown when the outcome has its own rule for this call. Drops it so the call follows the shared rule."
        },
        {
          label: "Remove call",
          what: "Removes the call and lowers Max calls by one. You can undo from the message. Needs max calls, which needs a pending database update."
        },
        {
          label: "Done",
          what: "Closes the call."
        }
      ]
    },
    {
      key: "what-happens",
      title: "What happens",
      what: "The example lead's calls as a list: when each lands and why then. A call moved by calling windows carries a Moved chip. Click a row to open that call.",
      fields: [
        {
          label: "Call rows",
          what: "Shows the day and time of each call and the wait or reason behind it. The last row says the lead then goes to Nurture."
        },
        {
          label: "Calling windows",
          what: "Link in the footer that opens Calling windows, where your hours and state rules are listed."
        }
      ]
    },
    {
      key: "history",
      title: "Cadence history",
      what: "Every save of this scope as a version, with what it changed. Max calls is not kept in versions.",
      fields: [
        {
          label: "View",
          what: "Draws that version on the timeline. Back to your draft returns to your edits."
        },
        {
          label: "Restore",
          what: "Loads that version as your draft. Nothing changes for the dialer until you save. The version in force is marked In force."
        },
        {
          label: "Insurvas default",
          what: "View shows the built-in cadence on the timeline."
        }
      ]
    },
    {
      key: "campaign-override",
      title: "Campaign's own cadence",
      what: "Gives a campaign its own cadence. It replaces the agency cadence completely for that campaign; the two never mix.",
      fields: [
        {
          label: "Campaign",
          what: "Shown when more than one campaign runs the agency cadence. Picks the campaign."
        },
        {
          label: "Which cadence does this campaign run?",
          what: "Use the agency cadence, or This campaign uses its own cadence.",
          default: "This campaign uses its own cadence"
        },
        {
          label: "Start from",
          what: "The cadence the campaign starts with: Agency, Gentle, Balanced or Persistent.",
          default: "Agency"
        },
        {
          label: "Max calls",
          what: "The most calls a lead in this campaign gets, 1 to 20. Needs a pending database update; until then every campaign stops at seven."
        },
        {
          label: "Rules that shape this campaign",
          what: "Shows the campaign's or agency's calling hours, no Sundays or holidays, and the busiest day, with how many calls each moves."
        },
        {
          label: "Edit calling windows",
          what: "Opens Calling windows."
        },
        {
          label: "Save campaign cadence",
          what: "Saves the choice. After saving, pick the campaign in Applies to and edit it call by call."
        }
      ]
    }
  ]
},
{
  id: "calling-windows",
  slug: "calling-windows",
  title: "Calling windows",
  group: "Leads & calling",
  href: "/app/settings#calling-windows",
  why: "Sets the days and hours your agency dials, on top of federal and state limits. These hours can only narrow the law, never widen it. Every time is the customer's local time.",
  who: "Owner only. Needs a plan with outbound dialing. Others who reach it see what is in force, read-only.",
  parts: [
    {
      key: "header",
      title: "Page header",
      what: "Buttons at the top, and a status line that says whether the hours are saved, the next day off and any pending updates.",
      fields: [
        {
          label: "Reset to Insurvas default",
          what: "Asks first, then puts your hours back to 9am to 8pm every day, no Sundays, no federal holidays. Campaigns that call less and your own days off stay. Shown only when your hours differ from the default."
        },
        {
          label: "Clear my hours",
          what: "Removes your own hours so only the federal and state limits apply. Shown only in some setups."
        },
        {
          label: "Days off",
          what: "Opens the Days off sheet."
        }
      ]
    },
    {
      key: "agency-hours",
      title: "Your agency's hours",
      what: "A week grid of the hours you dial. Changes are a draft until you press Save hours.",
      fields: [
        {
          label: "No Sundays",
          what: "When on, nothing is dialled on Sundays.",
          default: "On"
        },
        {
          label: "No federal holidays",
          what: "When on, nothing is dialled on federal holidays in any state. The day count next to it opens the Days off sheet.",
          default: "On"
        },
        {
          label: "Show a state on the grid",
          what: "Draws one state's legal cut-offs on the grid so you can see what it removes. None, the four states that cut most, or more in the + list.",
          default: "None"
        },
        {
          label: "Week grid",
          what: "Each day's hours as a block. Drag the top or bottom edge to change them in quarter hours, drag across an empty day to add hours. Arrow keys move an edge 15 minutes.",
          default: "9am to 8pm"
        },
        {
          label: "Day menu",
          what: "Click a day name or right-click a day: Copy the day to the whole week, Make it a day off, or Add hours to it. Different hours per day need a pending database update; until then a change to one day changes them all."
        },
        {
          label: "Save hours",
          what: "Saves the hours, the switches and your days off together. Discard drops the draft. The dialer keeps the saved hours until you save."
        }
      ]
    },
    {
      key: "state-rules",
      title: "State rules in force",
      what: "The states you work in, or those whose law is tighter than your hours, with how much each cuts. Set by law and read-only; the dialer always obeys the stricter rule.",
      fields: [
        {
          label: "State rows",
          what: "Click a state to draw its cut-offs on the grid; click again to clear it."
        },
        {
          label: "full rules per state",
          what: "Opens Full rules per state: for each state, what the law allows and what the dialer uses with your hours, plus when the rules were last refreshed."
        }
      ]
    },
    {
      key: "campaigns",
      title: "Campaigns that call less",
      what: "Campaigns given shorter calling times than your agency. A campaign can only call less, never more.",
      fields: [
        {
          label: "Narrow a campaign",
          what: "Opens the campaign sheet to give a campaign shorter hours."
        },
        {
          label: "Campaign rows",
          what: "Shows each narrowed campaign with its reason and hours. Click one to open its sheet."
        },
        {
          label: "Campaigns may call less",
          what: "When off, no campaign's shorter hours apply. Saves with your hours.",
          default: "On"
        }
      ]
    },
    {
      key: "campaign-sheet",
      title: "Campaign sheet",
      what: "One campaign's hours. The sheet saves on its own, separate from the agency draft.",
      fields: [
        {
          label: "Campaign",
          what: "Shown when you start from Narrow a campaign. Picks the campaign."
        },
        {
          label: "Hours",
          what: "Same as agency, or Narrower to drag the campaign's hours inside the agency's. They apply on every day the agency calls.",
          default: "Narrower"
        },
        {
          label: "When the campaign may call",
          what: "A small grid. Drag inside the hatched agency hours to start later or stop earlier."
        },
        {
          label: "Why it calls less",
          what: "A short reason shown to anyone who wonders why these leads wait. Required to save narrower hours. Quick picks: Vendor consent is daytime-only, Customers answer after work, Carrier asked us to, Testing."
        },
        {
          label: "Use agency hours again",
          what: "Removes the campaign's own hours so it calls whenever the agency does."
        },
        {
          label: "Save campaign",
          what: "Saves the campaign's hours and reason. Leads outside them wait in the list until the window opens."
        }
      ]
    },
    {
      key: "days-off",
      title: "Days off",
      what: "The federal holidays your switch blocks and your agency's own days off. Everything here saves with your hours.",
      fields: [
        {
          label: "No federal holidays",
          what: "The same switch as on the grid. Nothing dials on these days, in any state."
        },
        {
          label: "Federal holidays, next 12 months",
          what: "Lists each holiday and whether it is called. + more shows the rest."
        },
        {
          label: "Add a day off",
          what: "Opens a form to close a day, or part of one, for the whole agency. Needs a pending database update."
        },
        {
          label: "Date",
          what: "The day off. Must be today or later."
        },
        {
          label: "Closed",
          what: "All day, or From a time to stop early that day.",
          default: "All day"
        },
        {
          label: "Name",
          what: "A label for the day off, up to 80 characters."
        },
        {
          label: "Remove",
          what: "Takes a day off off the list."
        }
      ]
    }
  ]
},
{
  id: "queue-sla",
  slug: "inbound-settings",
  title: "Inbound settings",
  group: "Leads & calling",
  href: "/app/settings#queue-sla",
  why: "This page sets how long a live transfer may wait for an agent and what happens at each step, who gets alerted, how buffer agents hand calls over, and who gets the next transfer. Change it when transfers wait too long or alerts reach the wrong people.",
  who: "Owner only",
  parts: [
    {
      key: "ladder",
      title: "When a transfer waits",
      what: "The waiting ladder. A transfer starts at 0 the moment it can be claimed, and each of the four rungs fires once if nobody has claimed it yet. Drag a rung, use the minus and plus buttons, use the arrow keys, or click a rung to pick a time. A rung cannot pass its neighbour; it stops 15 seconds short and a line under the ladder says why. A sentence under the ladder reads the whole wait back to you. The status line at the top shows unsaved changes, or, once saved, last 7 days: transfers claimed, median wait and how many expired.",
      fields: [
        {
          label: "Warn after",
          what: "How long a transfer waits before its row turns amber and sorts to the top of the queue.",
          default: "45 seconds"
        },
        {
          label: "Escalate after",
          what: "How long before an alert goes out and the transfer is offered more widely, buffer agents included.",
          default: "2 minutes"
        },
        {
          label: "Partner notice after",
          what: "How long before the partner who sent the transfer sees on their pipeline row that nobody claimed it.",
          default: "5 minutes"
        },
        {
          label: "Expire after",
          what: "How long before the transfer leaves the active queue, marked expired (or, once the nurture update is applied, becomes a nurture lead the dialer works like any other lead). At most 7 days.",
          default: "4 hours"
        },
        {
          label: "Rung pop-up: common times",
          what: "Chips with common times for the rung you clicked. Times that would cross a neighbouring rung are greyed out."
        },
        {
          label: "Rung pop-up: stepper",
          what: "Moves the rung earlier or later in steps that grow with the time (15-second steps for short waits). The line under it shows the limits set by the neighbouring rungs."
        },
        {
          label: "Rung pop-up: Use <time>",
          what: "Puts the chosen time on the rung. Cancel closes the pop-up without changing it."
        }
      ]
    },
    {
      key: "alerts",
      title: "Who hears about it",
      what: "Who is told about a waiting transfer, grouped by rung. Agents always see the wait on the claim card. Shown only when inbound transfers are on your plan.",
      fields: [
        {
          label: "When it arrives: Agents",
          what: "Sends the \"new lead waiting\" alert in the app to owners, producers and buffer agents when a transfer arrives. Off means agents only see it on the claim card.",
          default: "On"
        },
        {
          label: "At Escalate: Owners, producers and buffer agents",
          what: "Shows that at the Escalate rung the transfer is offered to them with an in-app alert. Always on; you cannot turn it off."
        },
        {
          label: "At Escalate: The owners (By email)",
          what: "Emails the owners when a transfer escalates. Each owner can still turn it off for themselves in Notifications.",
          default: "On"
        },
        {
          label: "At Partner notice: The partner who sent it",
          what: "Shows that the partner's pipeline row says nobody claimed it. Always on."
        },
        {
          label: "At Expire: Leaves the active queue / Becomes a nurture lead",
          what: "Shows what happens at Expire: the transfer is marked expired and an owner can reopen it from the transfer inbox, or (once the nurture update is applied) it becomes a nurture lead. Always on."
        }
      ]
    },
    {
      key: "buffers",
      title: "Buffer agents",
      what: "Buffer agents are the people with the Assistant role. They take the call first, then hand it to a licensed agent. The list is read from Team & access and is not edited here. If there are none, after Escalate transfers keep ringing the main line only. Shown only when inbound transfers are on your plan.",
      fields: [
        {
          label: "Buffer agent list",
          what: "Shows each person who holds the Assistant role and has accepted their invite, and how many buffer seats are used (of the plan's maximum, if there is one)."
        },
        {
          label: "+ Add a buffer agent",
          what: "Opens Team & access, where you give someone the Assistant role."
        },
        {
          label: "The licensed agent has this long to accept",
          what: "How long a licensed agent has to accept a handoff from a buffer agent. After that the offer lapses and the buffer can offer someone else. Set with minus and plus, 5 to 300 seconds (5-second steps up to a minute, then 15-second steps).",
          default: "30 seconds"
        }
      ]
    },
    {
      key: "routing",
      title: "Who gets the next transfer",
      what: "How the next transfer is handed out. Hidden in solo mode, where every transfer goes to the one agent, and when inbound transfers are not on your plan.",
      fields: [
        {
          label: "Only agents licensed in the caller's state",
          what: "When on, licensed agents are offered only callers in states they hold a live licence for. Buffer agents are not licensed and still take any caller.",
          default: "Off"
        },
        {
          label: "Order",
          what: "Shows the order transfers are handed out: Take next and the claim card hand out the longest wait first. This is fixed and cannot be changed."
        },
        {
          label: "Skip agents on a break",
          what: "When on, someone set to On break or Off on the floor is not handed a transfer until they are Ready again.",
          default: "Off"
        }
      ]
    },
    {
      key: "save",
      title: "Save band",
      what: "Everything on this page saves together. If you leave with unsaved changes you are asked to save or discard.",
      fields: [
        {
          label: "Save",
          what: "Saves the ladder and the alerts, buffer handoff and routing. If one half fails, the status line names it and keeps your edits."
        },
        {
          label: "Discard",
          what: "Drops all unsaved changes on the page."
        },
        {
          label: "See today's transfers",
          what: "Opens the inbound transfers page."
        }
      ]
    }
  ]
},
{
  id: "calendar",
  slug: "calendar-availability",
  title: "Calendar & availability",
  group: "Leads & calling",
  href: "/app/settings#calendar",
  why: "This page sets each person's working hours, appointment length, blocked time and booking rules, plus agency-wide limits. Every booking rule reads these, so change them when someone's hours change or appointments land at the wrong times.",
  who: "Owner only",
  parts: [
    {
      key: "whose",
      title: "Whose calendar",
      what: "Picks whose calendar you are editing. Shown when more than one person can take appointments. Each name shows how many days have hours and whether it has unsaved edits. It opens on your own calendar. Unsaved changes are kept per person while you look at someone else.",
      fields: [
        {
          label: "Whose calendar",
          what: "Switches the page to that person's hours, appointments, time off and booking rules."
        }
      ]
    },
    {
      key: "hours",
      title: "Working hours",
      what: "The hours someone can be booked, one row per day, Monday first. Each open day shows how many appointment slots it leaves. With no hours set, an appointment can be booked at any legal time for the customer, and the person does not appear in the roster or in the dialer's booking panel.",
      fields: [
        {
          label: "Timezone",
          what: "The timezone these hours are in. You must choose one before you can save.",
          who: "Owners can change anyone's; others only their own"
        },
        {
          label: "Quick start",
          what: "Fills the week in one step: Mon–Fri, 9–5; Mon–Fri, 8–6; or Mon–Sat, 9–5. It replaces the hours already there."
        },
        {
          label: "Clear all",
          what: "Removes every day's hours."
        },
        {
          label: "<Day> open",
          what: "Opens or closes that day. A closed day means nothing can be booked. Opening a day starts it at 9:00 to 17:00."
        },
        {
          label: "<Day> opens / <Day> closes",
          what: "The start and end time of a block of hours. Hours have to close after they open."
        },
        {
          label: "Add hours",
          what: "Adds another block of hours on the same day, for a split shift. It starts where the last block ends and runs an hour."
        },
        {
          label: "Remove (x)",
          what: "Removes that block of hours."
        }
      ]
    },
    {
      key: "appointments",
      title: "Appointments",
      what: "How long each appointment is and the gap after it. These decide how many slots fit in a day.",
      fields: [
        {
          label: "Length",
          what: "How long each appointment lasts: 20, 30, 45 or 60 minutes.",
          default: "30 min"
        },
        {
          label: "Gap after each",
          what: "Time added after each appointment before the next can start: None, 5, 10 or 15 minutes.",
          default: "None"
        }
      ]
    },
    {
      key: "blocks",
      title: "Time off & breaks",
      what: "Blocked time. Nothing can be booked across a block, even inside working hours. The table lists each block: What, When, Repeats and Slots lost per week.",
      fields: [
        {
          label: "Block some time",
          what: "Opens the Block some time dialog to add a new block."
        },
        {
          label: "Edit",
          what: "Opens the block in the Edit blocked time dialog."
        },
        {
          label: "Remove",
          what: "Removes the block (saved when you save the calendar)."
        },
        {
          label: "Block some time: What",
          what: "A short name for the block, such as lunch, leave or training. Up to 120 characters."
        },
        {
          label: "Block some time: From",
          what: "When the block starts."
        },
        {
          label: "Block some time: To",
          what: "When the block ends. It has to end after it starts."
        },
        {
          label: "Block some time: Repeats",
          what: "Once, Every day, Every weekday, Weekly or Yearly. A repeating block has to be shorter than the gap between repeats. Repeats other than Once need a pending database update.",
          default: "Once"
        },
        {
          label: "Block some time: Add block / Update block",
          what: "Puts the block on the calendar draft. Cancel closes the dialog."
        }
      ]
    },
    {
      key: "rules",
      title: "Booking rules",
      what: "Rules for when and how appointments can be booked for this person, and their linked calendars.",
      fields: [
        {
          label: "Same-day booking",
          what: "On: people can book for later today. Off: the earliest anyone can book is tomorrow.",
          default: "On"
        },
        {
          label: "Double-booking",
          what: "On: two appointments can share one time. Off: one appointment per time.",
          default: "Off"
        },
        {
          label: "Linked calendars: Connect",
          what: "Links this person's Google Calendar or Outlook Calendar. Meetings there then block those times here, updated automatically, and meetings booked here are added to the Google Calendar."
        },
        {
          label: "Linked calendars: Reconnect",
          what: "Shown for a Google calendar linked for busy time only. Links it again so meetings booked here can be added to it."
        },
        {
          label: "Linked calendars: Refresh",
          what: "Reads the linked calendar's busy time again now."
        },
        {
          label: "Linked calendars: Unlink",
          what: "Disconnects the calendar. Its busy time no longer removes slots."
        },
        {
          label: "Linked calendars: Turn on",
          what: "Shown when busy time from linked calendars was switched off. Turns it back on so linked meetings block time again.",
          default: "On"
        }
      ]
    },
    {
      key: "agency",
      title: "Whole agency",
      what: "Limits that apply to every agent, not one person. Shown only on an agency plan.",
      fields: [
        {
          label: "Most appointments a day, whole agency",
          what: "The most appointments all agents together can have in one day, 1 to 1,000. Empty means no agency limit.",
          default: "No agency limit",
          who: "Owner only"
        },
        {
          label: "Callback reminder, minutes before",
          what: "How many minutes before a callback the reminder goes out, 5 to 1,440. Empty uses the platform default.",
          default: "Platform default",
          who: "Owner only"
        }
      ]
    },
    {
      key: "save",
      title: "Save bar",
      what: "Shown when something changed. Saves the person's whole calendar and any agency limits together. Leaving with unsaved changes asks you to save or discard.",
      fields: [
        {
          label: "Save changes",
          what: "Saves the hours, appointments, time off, booking rules and agency limits."
        },
        {
          label: "Discard",
          what: "Drops the unsaved changes to this person's calendar and the agency limits."
        }
      ]
    }
  ]
},
{
  id: "pipelines",
  slug: "pipelines-outcomes",
  title: "Pipelines & outcomes",
  group: "Leads & calling",
  href: "/app/settings#pipelines",
  why: "This page sets your pipelines' stages, the call outcomes agents pick after a call, and the stage each outcome moves a lead to. Change it when you add a step to your sales process or want an outcome to send leads somewhere else.",
  who: "Owner only",
  parts: [
    {
      key: "list",
      title: "Pipelines",
      what: "The list of your pipelines with who each is for, how many stages and how many leads it has. Open one to set up its outcomes and stages.",
      fields: [
        {
          label: "New pipeline",
          what: "Opens the New pipeline dialog."
        },
        {
          label: "Set up",
          what: "Opens that pipeline's outcomes and stages map."
        }
      ]
    },
    {
      key: "new-pipeline",
      title: "New pipeline",
      what: "Creates a pipeline from a copy of one you have or from three plain stages (New, Sold, Not interested). Outcomes with a stage of the same name send leads there right away.",
      fields: [
        {
          label: "Start from",
          what: "Copies the stages of the pipeline you pick, or Blank for three plain stages."
        },
        {
          label: "Name",
          what: "The new pipeline's name. Required."
        },
        {
          label: "Who it is for",
          what: "No partner type, Publisher / transfer, Marketing or Affiliate. Leads from that kind of partner land in this pipeline.",
          default: "No partner type"
        },
        {
          label: "Create pipeline",
          what: "Creates the pipeline right away and opens its setup. Cancel closes the dialog."
        }
      ]
    },
    {
      key: "map",
      title: "Outcomes and stages map",
      what: "Outcomes on the left, this pipeline's stages on the right, and a line from each outcome to the stage it sends a lead to. Line colours: Open, Won, Lost and Stays put. A dashed line is the default route. By default an outcome goes to the stage with its own name, and an outcome with no such stage keeps the lead where it is. Nothing is saved until you press Save changes.",
      fields: [
        {
          label: "Pipelines (back)",
          what: "Goes back to the pipeline list. With unsaved changes it asks before discarding them."
        },
        {
          label: "Pipeline settings",
          what: "Opens this pipeline's name, partner type and default."
        },
        {
          label: "Reset to default",
          what: "Sends each standard outcome to the stage with its Insurvas name again. Only on the all-in-one pipeline when its routing differs from the default. Stages and outcomes stay; nothing is saved until you save."
        },
        {
          label: "Add outcome",
          what: "Adds a new call outcome and opens its editor."
        },
        {
          label: "Add stage",
          what: "Adds a new open stage and opens its editor."
        },
        {
          label: "Outcome (drag or click)",
          what: "Drag an outcome onto a stage to send leads there, or click it to open its editor. While an outcome is open, clicking a stage routes it there."
        },
        {
          label: "Stage (click or hold and drag)",
          what: "Click a stage to edit it. Hold and drag it to change the order of stages."
        },
        {
          label: "Stays where it is",
          what: "Drop an outcome here, or click it while an outcome is open, so the lead does not move after that outcome."
        },
        {
          label: "Show archived / Hide archived",
          what: "Shows or hides outcomes you removed, so you can restore them."
        },
        {
          label: "Discard",
          what: "Drops all unsaved changes on this pipeline."
        },
        {
          label: "Save changes",
          what: "Saves every change. The lead workspace and the dialer use them right away. If something is missing, such as an unnamed stage, it opens that item and says what to fix."
        }
      ]
    },
    {
      key: "outcome-editor",
      title: "Outcome",
      what: "Opens when you click an outcome. Changes go into the page's draft until you save.",
      fields: [
        {
          label: "Outcome name",
          what: "What agents see when they pick this outcome after a call. A new outcome's icon follows its name."
        },
        {
          label: "Then",
          what: "What happens to the lead next: Cadence (back on your dialing cadence), Retry (call again after a time you choose), Rest (stop calling for a while, then the lead comes back) or Stop (no more calls). The Callback outcome always books a time and Do not call always adds the number to your do-not-call list.",
          default: "Cadence (new outcome)"
        },
        {
          label: "Then: time",
          what: "For Retry: 15 min, 2 h or 1 day; for Rest: 30 days or 90 days; or type a custom number of minutes.",
          default: "Retry 2 h; Rest 30 days"
        },
        {
          label: "Lead",
          what: "The stage this outcome moves the lead to in this pipeline, grouped by Open, Won and Lost, or Stays to keep the lead where it is. If it currently moves the lead to another pipeline, pick a stage here to keep it in this one."
        },
        {
          label: "Counts",
          what: "Worked: the call counts toward the agent's worked leads. Not worked: it does not count, like a no answer.",
          default: "Worked (new outcome)"
        },
        {
          label: "Closes as",
          what: "Shown for outcomes that stop calling. Completed counts it as finished work; Dropped as work given up.",
          default: "Completed (new outcome)"
        },
        {
          label: "Default",
          what: "Puts the outcome back on its default route: the stage with its name, or stays."
        },
        {
          label: "Remove outcome / Restore",
          what: "Archives a saved outcome so it leaves the list; nothing is deleted and Restore brings it back. A new unsaved outcome is removed outright."
        },
        {
          label: "Done",
          what: "Closes the editor."
        }
      ]
    },
    {
      key: "stage-editor",
      title: "Stage",
      what: "Opens when you click a stage. Changes go into the page's draft until you save.",
      fields: [
        {
          label: "Stage name",
          what: "The stage's name. An outcome with the same name sends leads here by default."
        },
        {
          label: "Means",
          what: "Open (still being worked), Won (it became business) or Lost (closed).",
          default: "Open (new stage)"
        },
        {
          label: "Stage colour",
          what: "The stage's colour, picked from eight swatches."
        },
        {
          label: "Time",
          what: "How long a lead may sit in an open stage before it shows as overdue on the lead workspace: No limit, 15 min, 2 h, 1 day or 3 days. Won and lost stages have no limit.",
          default: "No limit"
        },
        {
          label: "Worked",
          what: "Counts: a lead that reaches this stage counts as worked on the lead workspace, whatever outcome brought it here. Does not count: it does not.",
          default: "Does not count"
        },
        {
          label: "Note",
          what: "A short line agents see on the stage, up to 200 characters."
        },
        {
          label: "From",
          what: "Shows the outcomes that move a lead into this stage. Click one to edit it."
        },
        {
          label: "Agent questions",
          what: "Opens the questions an agent answers on a lead in this stage. Not shown for a stage that is not saved yet."
        },
        {
          label: "Remove stage",
          what: "Archives the stage. Not possible while leads are in it or if it is the pipeline's only stage."
        },
        {
          label: "Done",
          what: "Closes the editor."
        }
      ]
    },
    {
      key: "pipeline-editor",
      title: "Pipeline settings",
      what: "This pipeline's name, who it is for and whether it is the default.",
      fields: [
        {
          label: "Pipeline name",
          what: "The pipeline's name."
        },
        {
          label: "For",
          what: "No partner type, Publisher / transfer, Marketing or Affiliate. Leads from that kind of partner land here. With no partner type it is the all-in-one pipeline: agents' own leads, imports, vendor posts and any partner with no pipeline of its own."
        },
        {
          label: "Default",
          what: "Default or Not default. The default pipeline is where new leads of its partner type land; one per partner type, plus one all-in-one default."
        },
        {
          label: "Delete",
          what: "Deletes the pipeline after you confirm with Delete pipeline. Not possible for a default pipeline, with unsaved changes, or for a pipeline with leads or past outcomes. This takes effect right away."
        },
        {
          label: "Done",
          what: "Closes the editor."
        }
      ]
    },
    {
      key: "agent-questions",
      title: "Questions the agent answers",
      what: "The questions shown on a lead in this stage before the agent picks an outcome. Each change saves as you make it, not with the page's Save.",
      fields: [
        {
          label: "Question",
          what: "The question's short name."
        },
        {
          label: "Prompt",
          what: "The text the agent reads."
        },
        {
          label: "Question type",
          what: "Choice, Multiple choice or Free text.",
          default: "Choice"
        },
        {
          label: "Next question",
          what: "Which question comes after this one, or Ends here. Used by free-text and multiple-choice questions."
        },
        {
          label: "Answers: Label",
          what: "The answer the agent can pick."
        },
        {
          label: "Answers: Ends with outcome",
          what: "The call outcome this answer records, or None."
        },
        {
          label: "Answers: Next question",
          what: "Which question follows this answer, or Ends call."
        },
        {
          label: "Answers: Note template",
          what: "Text added to the lead's note when this answer is picked."
        },
        {
          label: "Add a question: Question key",
          what: "A permanent internal key for the new question: lowercase letters, numbers and underscores."
        },
        {
          label: "Add a question: Question / Prompt / Question type",
          what: "The new question's name, the text the agent reads and its type. Add question saves it."
        },
        {
          label: "Add an answer: Question",
          what: "Which question the new answer belongs to."
        },
        {
          label: "Add an answer: Answer key",
          what: "A permanent internal key for the new answer: lowercase letters, numbers and underscores."
        },
        {
          label: "Add an answer: Answer / Ends with outcome / Note template",
          what: "The new answer's text, the outcome it records and its note text. Add answer saves it."
        }
      ]
    }
  ]
},
{
  id: "integrations",
  slug: "integrations",
  title: "Integrations",
  group: "Integrations",
  href: "/app/settings#integrations",
  why: "Everything connected to Insurvas in one place: apps that use an API key, webhooks that send policy and commission events out, your lead vendors and the browser extension. Come here to connect a tool such as Zapier or a data warehouse, or to fix a failing webhook.",
  who: "Owner only",
  parts: [
    {
      key: "header",
      title: "Overview · API keys · Webhooks · Developer docs",
      what: "The tabs and the status line, which names the problem that needs you (a failing webhook, a key ending soon or unused) with a link to fix it.",
      fields: [
        {
          label: "New API key",
          what: "Opens the New API key steps."
        },
        {
          label: "Add a webhook",
          what: "Opens the Add a webhook sheet."
        }
      ]
    },
    {
      key: "overview",
      title: "Overview",
      what: "Who's connected: apps by their API key, webhook endpoints, lead vendors and the browser extension, each saying where it is managed.",
      fields: [
        {
          label: "Apps using a key · Webhook endpoints · Lead vendors · Browser extension",
          what: "Shows counts and health. The last two link to Lead posting and Browser extension."
        },
        {
          label: "Show",
          what: "Narrows the table to All, Apps, Webhooks, Lead vendors, or Needs you.",
          default: "All"
        },
        {
          label: "Everything connected to Insurvas",
          what: "Click an app or webhook row to open it. Lead-vendor keys are only shown here; they are managed in Lead posting."
        }
      ]
    },
    {
      key: "api-keys",
      title: "API keys",
      what: "One line a key with what it can do, last use, end date, who made it and status. The key itself never shows. No key can read a Social Security number, bank details or a card number.",
      fields: [
        {
          label: "Show keys",
          what: "Active, Rotating out, or Ended.",
          default: "Active"
        },
        {
          label: "Find a key",
          what: "Narrows the list by name or what the key can do."
        },
        {
          label: "Review",
          what: "Shown on a key unused for 90 days. Opens the Still using it? dialog."
        },
        {
          label: "A key row",
          what: "Opens the key's sheet."
        }
      ]
    },
    {
      key: "key-sheet",
      title: "A key's sheet",
      what: "One key's settings. Only a live key can be changed.",
      fields: [
        {
          label: "Name",
          what: "Say what uses it, so the next person knows what breaks if it's revoked."
        },
        {
          label: "What it can do",
          what: "Read policies, Read leads, Read commissions, Create leads, Manage webhooks. You can only narrow it here; widening makes a new key."
        },
        {
          label: "Ends",
          what: "Never, or On a date (pick the End date). A rotating-out key's end belongs to the rotation."
        },
        {
          label: "Extend 90 days",
          what: "Moves the end date 90 days later."
        },
        {
          label: "Try it",
          what: "A copy-ready request; paste the full key where it says YOUR_KEY."
        },
        {
          label: "Show technical details",
          what: "Shows the masked key, the address it was last used from and the scope names."
        },
        {
          label: "Revoke",
          what: "Opens the revoke dialog."
        },
        {
          label: "Rotate key",
          what: "Opens the rotate dialog. Not shown on a key already being replaced."
        },
        {
          label: "Save",
          what: "Saves the name, permissions and end date."
        }
      ]
    },
    {
      key: "new-key",
      title: "New API key",
      what: "Four steps: Name, What it can do, Ends, Key shown once.",
      fields: [
        {
          label: "Name",
          what: "The key's name, after the app that uses it."
        },
        {
          label: "Start from",
          what: "Zapier, Make, Google Sheets, Data warehouse, or Other. Picking an app fills the name and ticks what it usually needs."
        },
        {
          label: "Read / Change permissions",
          what: "Tick only what the app needs: Read policies, Read leads, Read commissions, Create leads, Manage webhooks. At least one."
        },
        {
          label: "When should it stop working?",
          what: "In 30 days, In 90 days, In a year, or Never. We still ask if a key goes 90 days unused.",
          default: "In 90 days"
        },
        {
          label: "Make the key",
          what: "Makes the key and shows it once."
        },
        {
          label: "Your key · Copy key",
          what: "The full key, shown only this once, with a sample request. We keep a fingerprint, never the key."
        },
        {
          label: "I've copied the key somewhere safe",
          what: "Must be ticked before Done. Closing hides the key for good."
        }
      ]
    },
    {
      key: "rotate",
      title: "Rotate <key>'s key?",
      what: "Makes a new key with the same permissions, shown once. The old one keeps working for a while so nothing breaks while you swap it in.",
      fields: [
        {
          label: "Old key keeps working for",
          what: "Stops now, 1 hour, 24 hours, or 3 days. Pick Stops now if the key may have leaked.",
          default: "24 hours"
        },
        {
          label: "Rotate key",
          what: "Makes the new key."
        }
      ]
    },
    {
      key: "revoke-key",
      title: "Revoke <key>?",
      what: "Anything using the key is refused from its next request. A revoked key can't be turned back on.",
      fields: [
        {
          label: "Type <key name> to confirm",
          what: "Revoke key stays off until the name matches."
        },
        {
          label: "Revoke key",
          what: "Revokes the key."
        }
      ]
    },
    {
      key: "idle",
      title: "Still using <key>?",
      what: "Asked when a key has gone 90 days unused.",
      fields: [
        {
          label: "Revoke it / Keep it, ask again in 90 days",
          what: "Revoke it opens the revoke dialog. Keeping it is noted in the settings history.",
          default: "Revoke it"
        },
        {
          label: "Later",
          what: "Closes and asks again next time."
        },
        {
          label: "Confirm",
          what: "Does what you picked."
        }
      ]
    },
    {
      key: "webhooks",
      title: "Webhooks",
      what: "One line a webhook with where it sends, its events, last delivery, events waiting and health. We try each event 6 times over about 9 hours; after 18 failures in a row we turn the webhook off and tell you.",
      fields: [
        {
          label: "Show webhooks",
          what: "All, Working, or Needs you.",
          default: "All"
        },
        {
          label: "Retry now",
          what: "On a failing or retrying webhook: sends the waiting events again now."
        },
        {
          label: "Turn on",
          what: "On a webhook we turned off: turns it back on and sends the missed events."
        },
        {
          label: "A webhook row",
          what: "Opens the webhook's sheet."
        }
      ]
    },
    {
      key: "webhook-setup",
      title: "A webhook's sheet · Setup",
      what: "One webhook's name, address, events and signing secret.",
      fields: [
        {
          label: "Turn on / Turn on and send <n> missed",
          what: "Shown when we turned it off. Fix their server first."
        },
        {
          label: "Name",
          what: "The webhook's name, after the app that receives it."
        },
        {
          label: "Address",
          what: "Where deliveries go. Must start with https://."
        },
        {
          label: "Events",
          what: "Policy issued, Policy lapsed, Commission doesn't match, Application form sent, Application form test. Events carry names and figures only."
        },
        {
          label: "Make a new secret",
          what: "Makes a new signing secret, shown once. Their app must swap it in or it will refuse our deliveries."
        },
        {
          label: "Show technical details",
          what: "Shows the full address and event names."
        },
        {
          label: "Pause / Resume",
          what: "Pause holds events until you resume; Resume sends the waiting ones."
        },
        {
          label: "Delete",
          what: "Stops sending and deletes its waiting events and delivery log, after you confirm."
        },
        {
          label: "Save",
          what: "Saves the name, address and events."
        }
      ]
    },
    {
      key: "webhook-deliveries",
      title: "A webhook's sheet · Deliveries",
      what: "Every try with when, event, which try, result and time taken. Click a row for what we sent and what they said.",
      fields: [
        {
          label: "Show deliveries",
          what: "All, Failed, or Delivered.",
          default: "All"
        },
        {
          label: "Send test",
          what: "Sends a test delivery. Off while the webhook is paused or off."
        },
        {
          label: "Retry <n> waiting",
          what: "Sends every waiting event again now."
        },
        {
          label: "Retry now",
          what: "In an opened failed row: sends that one delivery again."
        }
      ]
    },
    {
      key: "add-webhook",
      title: "Add a webhook",
      what: "We send a signed message to this address the moment an event happens. The signing secret is shown once after saving.",
      fields: [
        {
          label: "Name",
          what: "After the app that receives it."
        },
        {
          label: "Address",
          what: "Must start with https://."
        },
        {
          label: "Which events?",
          what: "Tick the events to send. See an example shows a sample of each.",
          default: "Policy issued and Policy lapsed"
        },
        {
          label: "Send a test delivery right away",
          what: "Sends a test as soon as the webhook is added.",
          default: "On"
        },
        {
          label: "Add webhook",
          what: "Adds it, then shows the signing secret once with Copy secret."
        }
      ]
    },
    {
      key: "developer-docs",
      title: "Developer docs",
      what: "Read only. For the developer connecting an app: Address and keys, Errors and limits, Policies, Leads, Commissions, Events, Check the signature, Retries.",
      fields: [
        {
          label: "Topics",
          what: "Opens that topic."
        },
        {
          label: "Code samples language",
          what: "Switches the samples between curl and JavaScript."
        }
      ]
    }
  ]
},
{
  id: "sales-extension",
  slug: "browser-extension",
  title: "Browser extension",
  group: "Integrations",
  href: "/app/settings#sales-extension",
  why: "The Chrome extension that copies a case's answers into a carrier's own e-app. Check whether it is installed, which carrier sites it fills, and who may use it; revoke someone if needed.",
  who: "Owner only",
  parts: [
    {
      key: "status",
      title: "Status line",
      what: "Shows whether the extension is installed on this device and its version, how many people can use it, the last fill, and any carrier whose site changed.",
      fields: [
        {
          label: "Check again",
          what: "Reads the extension's state again."
        }
      ]
    },
    {
      key: "carrier-sites",
      title: "Carrier sites it fills",
      what: "Read only. Each carrier with a portal address in Carriers gets a site here; the extension has no access to any other site.",
      fields: [
        {
          label: "Carrier · Site · Fills · Fills this month · Works",
          what: "Shows each site and whether filling works: Working, Site changed, Being mapped, or Not mapped."
        }
      ]
    },
    {
      key: "who-can-use",
      title: "Who can use it",
      what: "One line a person with the carrier sites they may fill, fills this month and last fill. Setters and intake never get the extension.",
      fields: [
        {
          label: "Find a person",
          what: "Narrows the list to people whose name matches."
        },
        {
          label: "Recent fills",
          what: "Opens the Recent fills sheet."
        },
        {
          label: "Revoke everyone…",
          what: "Ends every live fill for every person. Nobody loses access; each agent starts again from the case's Submit step. Off when no fill is live."
        },
        {
          label: "Revoke",
          what: "Opens the revoke dialog for that person. Not shown for the owner."
        },
        {
          label: "Give back",
          what: "Lets a revoked person use the extension again."
        }
      ]
    },
    {
      key: "revoke-person",
      title: "Revoke <name>'s extension access?",
      what: "The person stops filling carrier applications straight away. Applications already sent aren't touched. Stopping new fills for good needs a database update; until then only live fills end.",
      fields: [
        {
          label: "Only for one carrier",
          what: "Revokes for one carrier and keeps the others. Needs a database update."
        },
        {
          label: "Which carrier",
          what: "The carrier to revoke for."
        },
        {
          label: "Revoke",
          what: "Revokes the access."
        }
      ]
    },
    {
      key: "install",
      title: "Install card",
      what: "Shows Installed in Chrome with the version, or Not installed on this device. Install is per device and per person.",
      fields: [
        {
          label: "Install for Chrome",
          what: "Tells you the extension isn't in the Chrome Web Store yet; your Insurvas admin can load it for you."
        }
      ]
    },
    {
      key: "how-it-works",
      title: "How it works",
      what: "Read only. An agent clicks Fill on carrier site from a case; the extension copies the answers into the carrier's e-app and the agent submits there. Each fill lasts 60 minutes and reads one application. It never stores carrier passwords.",
      fields: []
    },
    {
      key: "recent-fills",
      title: "Recent fills",
      what: "Every fill and every revocation in the last 30 days, newest first, 20 to a page. Read only.",
      fields: []
    }
  ]
},
{
  id: "accounting",
  slug: "accounting",
  title: "Accounting",
  group: "Money & compliance",
  href: "/app/accounting-settings",
  why: "Every number the Accounting pages read: how money is counted, bank matching, vendor bills, partner payouts, producer pay and tax. Change it when you set the agency up, or when your accountant asks for a different basis or threshold. A change counts from now on; figures already recorded keep their values.",
  who: "Owner and bookkeeper (bookkeepers can read every value but only the owner changes them; History is owner only)",
  parts: [
    {
      key: "title-line",
      title: "Title line and setting sheets",
      what: "The six tabs sit on the title line and are kept in the address (?tab=). Each tab is one card of one-line rows: Setting, Now, Used by, Changed, Value (Yours, Insurvas, Locked, or Owner for a read-only viewer). Click a row to open a right sheet that changes that one setting.",
      fields: [
        {
          label: "History",
          what: "Opens Settings history filtered to accounting changes: who changed which setting, from what to what, and when.",
          who: "Owner only"
        },
        {
          label: "Use Insurvas value",
          what: "In a setting's sheet, puts that setting back to the Insurvas value. Shown only when the value is your own."
        },
        {
          label: "Save this setting",
          what: "Saves the one setting in the open sheet. It stays off until the value is valid and different from what is saved."
        },
        {
          label: "Put back",
          what: "In a sheet's History list, puts the newest change back to what it was before."
        },
        {
          label: "What it affects",
          what: "Read-only list in each sheet of the pages and figures this setting changes."
        }
      ]
    },
    {
      key: "books",
      title: "Books",
      what: "When money counts on your reports, your financial year, and how persistency is measured.",
      fields: [
        {
          label: "Count money when",
          what: "Sets the basis every Profit & loss view, tax summary and producer statement opens on. It is earned (accrual) books commission when the carrier reports it and costs when they are owed. It moves (cash) books both when money reaches or leaves the bank.",
          default: "It is earned (accrual)"
        },
        {
          label: "Your financial year starts",
          what: "Picks the month year-to-date figures and the tax year's summaries start from.",
          default: "January"
        },
        {
          label: "Count a policy as persisting at",
          what: "Picks the month (3, 6, 9 or 13) at which a policy still in force counts as persisting. Cost per persisting policy on the P&L uses it.",
          default: "Month 9"
        },
        {
          label: "Show counts instead of a rate below",
          what: "With fewer policies than this (1 to 1,000), cost per policy tiles on the P&L show two counts instead of a rate.",
          default: "10 policies"
        },
        {
          label: "Recorded figures never change",
          what: "Locked. A new setting applies to what is recorded next, so a report or statement you already sent still adds up. The sheet says why and cannot be changed."
        }
      ]
    },
    {
      key: "bank",
      title: "Bank",
      what: "How Bank deposits looks for a carrier's payment in your bank file and suggests matches. Settings search link: bank-matching.",
      fields: [
        {
          label: "Look for the deposit up to",
          what: "Days after the carrier's payment date (1 to 120). Past this with nothing in the bank, Bank deposits flags it as missing money.",
          default: "3 days after the carrier's date"
        },
        {
          label: "Suggest a match when the amounts differ by up to",
          what: "A deposit this close to an expected payment is suggested as its match. $0.00 means the amounts must agree exactly. A person still confirms every match.",
          default: "$0.00"
        },
        {
          label: "Bank accounts",
          what: "Shows how many bank accounts you have. Clicking it opens Bank deposits › Accounts, where accounts are kept; nothing is changed here."
        },
        {
          label: "Matches are never applied for you",
          what: "Locked. A match stays a suggestion until a person confirms it, and your P&L shows only matches a person agreed."
        }
      ]
    },
    {
      key: "bills",
      title: "Bills & expenses",
      what: "When a vendor bill is flagged, and which expense categories count toward cost per policy. Vendors and campaigns themselves are set on Campaigns.",
      fields: [
        {
          label: "Flag a bill that differs from your count by more than",
          what: "Bills further off than this show as a difference on Vendor bills (Billed more than you got) and in its Needs you count. Recorded bills keep their status.",
          default: "$50.00"
        },
        {
          label: "Monthly bills wait for your OK",
          what: "Locked. A repeating bill is drafted, then waits for you on Accounting › To do, so nothing books cost you did not agree."
        },
        {
          label: "Expense groups on the P&L",
          what: "Opens a wide sheet, Each expense category counts as, with one Acquisition or Overhead choice per category: Leads (no invoice), Software, Telephony & dialer, Data services, Insurance, Professional fees, Licensing, Office, Other. Acquisition costs divide into cost per policy; overhead does not. Applies to new expenses only; change old ones on Expenses.",
          default: "Acquisition: Leads, Software, Telephony & dialer, Data services. Overhead: the other five."
        }
      ]
    },
    {
      key: "payouts",
      title: "Partner payouts",
      what: "How and when payout runs to partners are drafted and published. Payout terms are kept on each partner (Partners).",
      fields: [
        {
          label: "When a payout run is ready",
          what: "Wait for my review keeps a new run in draft for you to check. Publish to the partner shows it to the partner at once on the partner portal.",
          default: "Wait for my review"
        },
        {
          label: "Pay partners",
          what: "How often (Monthly, Twice a month, Weekly) and Draft the run (0 to 28 days after the period ends). Sets when the next draft run appears on Partner payouts; runs already made keep their period.",
          default: "Monthly, draft 3 days after the period ends"
        },
        {
          label: "Statement footer",
          what: "Optional text (up to 1,000 characters) printed at the foot of every statement a partner reads.",
          default: "None"
        },
        {
          label: "Ignore partner disputes under",
          what: "A disputed difference below this amount is accepted without review. $0.00 means every dispute is reviewed.",
          default: "$0.00"
        },
        {
          label: "Insurvas sends money",
          what: "Locked: never. A payout run is worked out and recorded; you mark it paid once your bank sends it."
        }
      ]
    },
    {
      key: "producers",
      title: "Producer pay",
      what: "What producers see and how their splits and negative balances are handled. Commission schedules and contract levels are on the Rate card.",
      fields: [
        {
          label: "Producers see their own balance",
          what: "Yes lets each producer see what they are owed, chargebacks included, on My balance. No hides it.",
          default: "Yes"
        },
        {
          label: "When someone's balance goes below zero",
          what: "The choice Run payroll starts with for anyone below zero: Carry it (comes off their next pay in full), Take a share each month (with Take __ % of what they owe each month), or Let it go (the agency forgives it). You can still change it per person in the draft.",
          default: "Carry it (share 50% if you switch to Take a share)"
        },
        {
          label: "Default split for a new producer",
          what: "Share (%) and Of (The advance, Earned commission, Both), filled in when you add a producer. Each producer's own split wins. Leave Share empty for none.",
          default: "None; Of: the advance"
        },
        {
          label: "Share carrier fees with producers",
          what: "Yes splits a carrier fee on a policy with its producer the way the commission is split.",
          default: "No"
        }
      ]
    },
    {
      key: "tax",
      title: "Tax",
      what: "Who appears on the 1099 summary and who may see tax IDs. Tax categories are mapped on Tax summaries.",
      fields: [
        {
          label: "1099 threshold",
          what: "Payees paid this much or more in the year appear in the 1099 summary on Tax summaries › Contractors. Check the year's IRS figure; it moves.",
          default: "$2,000.00"
        },
        {
          label: "Who may see payee tax IDs",
          what: "Owner only, or Owner and bookkeepers. Sets who can reveal a payee's full tax ID; every reveal is recorded. Widening it to bookkeepers asks you to confirm first (Let them see).",
          default: "Owner only"
        },
        {
          label: "The tax notice",
          what: "Locked. The not-tax-advice notice is shown on every tax screen and printed on every tax export, and cannot be edited or hidden."
        }
      ]
    }
  ]
},
{
  id: "retention",
  slug: "retention",
  title: "Retention",
  group: "Money & compliance",
  href: "/app/retention-settings",
  why: "Every number the retention ladder, the radar and the retention campaigns read: which carrier facts open a case, who works each queue, request and win-back waits, and how policies are scored. Change it when you want cases opened or assigned differently, or retune the radar.",
  who: "Owner only",
  parts: [
    {
      key: "title-line",
      title: "Title line",
      what: "Five tabs (Ladder, Who works it, Requests, Win-back, Radar), kept in the address (?tab=). Each row opens a right sheet for that one setting, with What it affects, its History and Put back on the newest change. A saved change shows a toast with Undo.",
      fields: [
        {
          label: "History",
          what: "Opens Settings history filtered to retention changes."
        },
        {
          label: "Reset [tab] to Insurvas values",
          what: "In the More menu. After you confirm (Reset to Insurvas values / Keep my values), every value on the open tab goes back to Insurvas's. On Who works it, queue owners are not touched."
        },
        {
          label: "See results",
          what: "In the More menu. Opens Retention results."
        },
        {
          label: "Open Cases",
          what: "In the More menu. Opens the retention Cases page."
        }
      ]
    },
    {
      key: "ladder",
      title: "Ladder",
      what: "Which facts in the carrier files put a policy on the retention ladder, and on which step. Each row shows the step, whether it counts, and the open cases with that reason. A save re-runs the ladder at once. The old address /app/retention-settings/ladder opens this tab.",
      fields: [
        {
          label: "First payment missed",
          what: "Counts: On or Off. On puts the policy on Payment problem; Off opens nothing for this fact.",
          default: "On"
        },
        {
          label: "Payment missed",
          what: "Counts: On or Off. Puts the policy on Payment problem.",
          default: "On"
        },
        {
          label: "Draft bounced",
          what: "Counts: On or Off. Puts the policy on Payment problem.",
          default: "On"
        },
        {
          label: "Banking problem",
          what: "Counts: On or Off. Puts the policy on Payment problem.",
          default: "On"
        },
        {
          label: "Carrier says lapse pending",
          what: "Counts: On or Off. Puts the policy on Pending lapse.",
          default: "On"
        },
        {
          label: "Lapse notice",
          what: "Counts: On or Off. Puts the policy on Pending lapse.",
          default: "On"
        },
        {
          label: "Lapsed, inside the reinstatement window",
          what: "Counts: On or Off. Puts the policy on Lapsed, can reinstate.",
          default: "On"
        },
        {
          label: "Lapsed past the window",
          what: "Counts: On or Off. Puts the policy on Lost.",
          default: "On"
        },
        {
          label: "Charged back",
          what: "Counts: On or Off. Puts the policy on Lost.",
          default: "On"
        },
        {
          label: "Asked to cancel",
          what: "Counts: On or Off. Puts the policy on Paperwork.",
          default: "On"
        },
        {
          label: "Pending manual action",
          what: "Counts: On or Off. Puts the policy on Paperwork.",
          default: "On"
        },
        {
          label: "Wants a new payment date",
          what: "Counts: On or Off. Puts the policy on Paperwork. Opened by a person; no file carries it.",
          default: "On"
        },
        {
          label: "Paying by mailed bill",
          what: "Counts: On or Off. Puts the policy on Paperwork.",
          default: "On"
        },
        {
          label: "A deadline is urgent within",
          what: "Days (0 to 60). A payment problem this close to its deadline moves up to Pending lapse and the urgent sort on Cases.",
          default: "7 days"
        },
        {
          label: "Unreachable after",
          what: "Tries (1 to 20): calls in a row that reach nobody before a case moves to the Unreachable step.",
          default: "4 tries"
        },
        {
          label: "Carrier words that count",
          what: "Locked, read-only. Shows the carrier status words Insurvas has flagged per carrier and the reason and step each one counts as. Ask support to flag a word your carrier uses."
        }
      ]
    },
    {
      key: "who",
      title: "Who works it",
      what: "Who gets each retention queue's cards and how work is shared between retention reps. Who holds the retention role is set in Team & access. Settings search link: assignment.",
      fields: [
        {
          label: "Who owns Save queue",
          what: "Retention reps, The writing agent or The owner gets this queue's cards. A role with nobody in it falls back to each policy's writing agent.",
          default: "Retention reps"
        },
        {
          label: "Who owns Paper-bill campaign",
          what: "Retention reps, The writing agent or The owner gets this queue's cards. A role with nobody in it falls back to you.",
          default: "Retention reps"
        },
        {
          label: "Who owns Reinstatement cases",
          what: "Retention reps, The writing agent or The owner gets this queue's cards. A role with nobody in it falls back to you.",
          default: "Retention reps"
        },
        {
          label: "Share work between reps",
          what: "Round-robin takes turns. By carrier gives each carrier to one rep (a rep picker per carrier, or Round-robin). By exposure gives the largest advance at risk to your first rep (order the reps with Move up). Cards already handed out stay with their rep.",
          default: "Round-robin"
        },
        {
          label: "Hand a reinstatement to the writing agent",
          what: "Days before its deadline. Inside this many days of the carrier's reinstatement deadline, the agent who sold the policy takes the case over.",
          default: "7 days"
        }
      ]
    },
    {
      key: "requests",
      title: "Requests",
      what: "Servicing requests, the paper bill to bank draft campaign and the reinstatement countdown. Insurvas keeps each carrier's retention windows, grace periods and chargeback rules; draft days are capped at the 28th. Settings search links: campaigns, reinstatement.",
      fields: [
        {
          label: "Fail a servicing request",
          what: "Days after its expected date. A carrier file that still disagrees this many days after a change was due fails the request.",
          default: "10 days"
        },
        {
          label: "After a client says no, ask again in",
          what: "Days a client who turned down the paper-bill campaign stays off the campaign list. Win-back calls for the same client also wait.",
          default: "180 days"
        },
        {
          label: "Talk track",
          what: "What the rep reads on the campaign card on the save call screen (up to 4,000 characters). Empty uses Insurvas's talk track.",
          default: "Insurvas's talk track"
        },
        {
          label: "Turn a case amber · red · pinned",
          what: "Amber with, Red with and Pinned to the top with: days left before the carrier's reinstatement deadline when a reinstatement case changes colour or pins to the top of Cases.",
          default: "14 · 7 · 3 days"
        }
      ]
    },
    {
      key: "winback",
      title: "Win-back",
      what: "How long a lapsed client rests before they come back as a lead, by why they lapsed. Each row opens a sheet with Wait before calling (days).",
      fields: [
        {
          label: "A payment failed; never said no",
          what: "Days before a lapsed client of this kind is called again.",
          default: "30 days"
        },
        {
          label: "Card expired, bank closed or moved",
          what: "Days before a lapsed client of this kind is called again.",
          default: "30 days"
        },
        {
          label: "Just stopped, no reason given",
          what: "Days before a lapsed client of this kind is called again.",
          default: "90 days"
        },
        {
          label: "The carrier declined reinstatement",
          what: "Days before a lapsed client of this kind is called again.",
          default: "90 days"
        },
        {
          label: "Said they could not afford it",
          what: "Days before a client who said they could not afford it is called again. Never sooner than 180 days. Shortening it asks you to type SHORTEN to confirm.",
          default: "365 days"
        },
        {
          label: "Said they no longer wanted it",
          what: "Days before a lapsed client of this kind is called again.",
          default: "365 days"
        }
      ]
    },
    {
      key: "radar",
      title: "Radar",
      what: "How the chargeback radar scores in-force policies and fills the save queue. The predictive save queue is off the Retention menu; these still score it and Results › Radar reads them. Settings search links: thresholds, weights, queue, signals, holdout.",
      fields: [
        {
          label: "The save queue takes",
          what: "Medium and above, High and above, or Critical only. Decides which scored policies reach the save queue; the sheet shows how many cards the queue would hold today.",
          default: "High and above"
        },
        {
          label: "Risk bands",
          what: "Medium from, High from, Critical from: where a risk score out of 100 turns medium, high and critical on the radar and the save queue.",
          default: "25 · 50 · 75"
        },
        {
          label: "Scoring weights",
          what: "Opens the Scoring weights sheet (see below): how much each of the seven signals counts in every risk score."
        },
        {
          label: "Queue: rest, most shown, sort",
          what: "Rest a worked card for (days), Show at most (cards), Sort the queue by (Risk × money, Risk score, Advance at risk, Days until next draft, Months since issue), and With nothing high risk (Show an empty queue or Show medium instead).",
          default: "30 days · 100 cards · Risk × money · Show an empty queue"
        },
        {
          label: "Signals: sample floors, income, danger months",
          what: "Lead source floor and Carrier floor (policies): below a floor that signal is left out rather than counted as weak. Affordable below and Unaffordable above (% of income): how premium against income is read. Danger from month and Danger to month: the months since issue when a policy is most likely to lapse.",
          default: "20 · 20 · 3%–6% · months 2–5"
        },
        {
          label: "Holdout",
          what: "Holds back a random share of the save queue so Results can measure whether working it saves policies. Fields: I have read what the holdout does (needed before switching it on), Holdout (on or off), Share (%, at most 20%), Never above ($ advance at risk above which a policy is never held back), Look after (days after a prediction the outcome is read).",
          default: "Off · 10% · $1,000 · 90 days"
        }
      ]
    },
    {
      key: "weights-sheet",
      title: "Scoring weights",
      what: "A wide sheet from the Radar tab. Each signal has a slider and a points box; the weights must add up to 100. A live preview shows what the change does to today's book before you save; a save is a new version and scores already made keep their version.",
      fields: [
        {
          label: "Draft date vs income",
          what: "Points this signal adds to a risk score (money arrives after the draft).",
          default: "30"
        },
        {
          label: "How they pay",
          what: "Points this signal adds (card, bank draft, Direct Express).",
          default: "20"
        },
        {
          label: "Months since issue",
          what: "Points this signal adds (early months lapse most).",
          default: "20"
        },
        {
          label: "Bounced and retried payments",
          what: "Points this signal adds.",
          default: "15"
        },
        {
          label: "Premium vs income",
          what: "Points this signal adds.",
          default: "10"
        },
        {
          label: "Lead source survival",
          what: "Points this signal adds.",
          default: "3"
        },
        {
          label: "Carrier grace and redrafts",
          what: "Points this signal adds.",
          default: "2"
        },
        {
          label: "What this does to your book",
          what: "Read-only preview: Policies scored, Change band, Move up, Newly critical. Runs by itself a moment after a change."
        },
        {
          label: "Save as version N",
          what: "Saves the weights as the next version and scores the book with them. Waits for a preview of these exact weights."
        },
        {
          label: "Use Insurvas weights",
          what: "After you confirm, goes back to Insurvas's weights, saved as a new version."
        }
      ]
    },
    {
      key: "weights-page",
      title: "Scoring weights page (/app/retention-settings/weights)",
      what: "The same seven weights on their own page, for older links. A table of Signal, Weight and Insurvas.",
      fields: [
        {
          label: "Weight",
          what: "One box per signal; the weights must add up to 100."
        },
        {
          label: "Preview",
          what: "Shows how many of today's scored policies change band, move up, down or become critical."
        },
        {
          label: "Save as version N",
          what: "Saves the previewed weights as a new version."
        },
        {
          label: "Reset to Insurvas weights",
          what: "In the More menu, with History and Results. Goes back to Insurvas's weights after you confirm."
        }
      ]
    }
  ]
},
{
  id: "compliance",
  slug: "compliance",
  title: "Compliance",
  group: "Money & compliance",
  href: "/app/compliance/settings",
  why: "Everything the Compliance pages read: complaint response deadlines, how long records are kept and the purge, legal holds, deletion requests, the transfer gate, the evidence report and the compliance dashboard. Change it when you get licensed in a new state, when counsel gives you new retention periods, or when litigation needs records kept. Calling windows, scripts and disclosures are edited on their own pages.",
  who: "Owner only",
  parts: [
    {
      key: "title-line",
      title: "Title line",
      what: "Five tabs: Start here, Complaints, Records, Holds & deletion, Gate & reports. Each setting row opens a right sheet with Use Insurvas value, Cancel, Save this setting, What it affects and its History (Put back on the newest change).",
      fields: [
        {
          label: "History",
          what: "Opens Settings history filtered to compliance changes."
        },
        {
          label: "Add a regulator",
          what: "On the Complaints tab. Opens the response deadline sheet, empty."
        },
        {
          label: "Start a dry run",
          what: "On the Records tab. Runs the purge without deleting anything and lists what a live run would delete."
        },
        {
          label: "New hold",
          what: "On the Holds & deletion tab. Opens the New hold sheet."
        }
      ]
    },
    {
      key: "start",
      title: "Start here",
      what: "The three decisions an owner makes first.",
      fields: [
        {
          label: "Complaint response deadlines",
          what: "Shows how many licensed states and the FTC have a response deadline, with a Not set count. Clicking it opens the Complaints tab."
        },
        {
          label: "If a transfer has no consent on file",
          what: "Accept and flag it, or Block the transfer. Flagged transfers are accepted and counted on the compliance dashboard and evidence report; blocked ones are refused before the call reaches you.",
          default: "Accept and flag it"
        },
        {
          label: "Delete records on a schedule",
          what: "On runs the purge on a schedule: a dry run is emailed first, and the live run follows after the window. Held records and the do-not-call list are never deleted. Off means nothing is deleted unless you run it.",
          default: "Off"
        },
        {
          label: "The do-not-call list is never deleted",
          what: "Locked. No purge, deletion request or rule removes a number from your internal do-not-call list."
        }
      ]
    },
    {
      key: "complaints",
      title: "Complaints",
      what: "Rules card, then the Response deadlines list: one row per regulator with Answer within, Open complaints and Changed. Licensed states with no deadline show first as Not set. Settings search link: deadlines.",
      fields: [
        {
          label: "When a complaint gets urgent",
          what: "Amber with (1 to 90 days left) and Red with (1 to 60). Inside red a complaint pins to the top of the compliance dashboard and the owner gets a daily email.",
          default: "Amber with 10 days left, red with 5"
        },
        {
          label: "If a transfer has no consent on file",
          what: "The same setting as on Start here: Accept and flag it, or Block the transfer.",
          default: "Accept and flag it"
        },
        {
          label: "Response deadlines (rows)",
          what: "Each regulator row opens its deadline sheet. A row marked Not set has no countdown."
        }
      ]
    },
    {
      key: "deadline-sheet",
      title: "Response deadline sheet (also /app/compliance/settings/deadlines/new and /deadlines/[regulator])",
      what: "Sets how many days a state insurance department or the FTC gives you to answer a complaint, counted from the day it reaches you. Unset means no countdown, never a guessed default.",
      fields: [
        {
          label: "Regulator",
          what: "Only when adding. Picks the state or the FTC; licensed states with no deadline are marked licensed, not set and listed first."
        },
        {
          label: "Days to respond",
          what: "1 to 180 days. Every new complaint from this regulator counts down from this; open complaints keep their due dates."
        },
        {
          label: "Source",
          what: "Optional, up to 500 characters: where the number comes from, for whoever checks it next."
        },
        {
          label: "Add deadline / Save this deadline",
          what: "Saves the deadline."
        },
        {
          label: "Remove regulator",
          what: "After you confirm, removes the deadline: new complaints from this regulator get no countdown, no amber or red and no daily email."
        }
      ]
    },
    {
      key: "records",
      title: "Records",
      what: "How long each record type is kept, the scheduled purge, and the list of purge runs. The shipped retention periods are a starting point, not legal advice. Your rule for a state beats your all-states rule, which beats Insurvas's. A record type with no rule is never deleted. Settings search links: retention, purge.",
      fields: [
        {
          label: "How long records are kept (rows)",
          what: "One row per record type: Consent artefacts, Call attempt logs, Scrub and screening results, Transfer verdicts, Internal do-not-call entries (locked, never deleted), Lead data never converted, Nurture and win-back candidates, Complaint records, Policy and commission records, Compliance evidence reports. Each shows Kept for and Then; clicking opens its rules sheet."
        },
        {
          label: "Delete records on a schedule",
          what: "Turns the scheduled purge on or off (same setting as on Start here).",
          default: "Off"
        },
        {
          label: "A live run waits after a dry run",
          what: "1 to 30 days. A live run, by hand or on schedule, needs a dry run inside this many days.",
          default: "7 days"
        },
        {
          label: "Email the dry-run summary to",
          what: "Tick the team members who get each dry run's summary, so they see what a live run would delete. Nobody chosen means the agency owners get it.",
          default: "The owners"
        },
        {
          label: "Live run",
          what: "On the Runs card. Deletes what the last dry run listed, and anything that came due since, after you confirm (Run the purge). Held records and the do-not-call list are not touched. It cannot be undone. Needs a dry run inside the window."
        },
        {
          label: "Runs (rows)",
          what: "Read-only list of purge runs: kind, records deleted or that would be deleted, who started it, and the result. Clicking opens the run sheet."
        }
      ]
    },
    {
      key: "record-sheet",
      title: "Record type rules sheet (also /app/compliance/settings/retention/[recordType])",
      what: "One record type's retention rules: Insurvas default, Your rules, and Add a rule. Saving a rule for a state that already has one replaces it.",
      fields: [
        {
          label: "Copy to my agency",
          what: "Copies Insurvas's default into your own rules so you can change it. Shown only when you have no rule of your own."
        },
        {
          label: "Your rules: Change / Remove",
          what: "Change loads a rule into the form; Remove deletes it after you confirm, and your next broader rule applies instead."
        },
        {
          label: "State",
          what: "All states, or one state the rule applies to.",
          default: "All states"
        },
        {
          label: "Keep for",
          what: "Days to keep the record (30 to 7,300).",
          default: "Insurvas's period for this type, else 1,461 days"
        },
        {
          label: "Then",
          what: "Delete, or Anonymise, keep (strips personal fields and keeps the row so totals still add up).",
          default: "Delete (or Insurvas's choice for this type)"
        },
        {
          label: "Where the number comes from",
          what: "Statute, Carrier requirement, Our policy or Legal advice, recorded with the rule.",
          default: "Our policy"
        },
        {
          label: "Notes",
          what: "Optional, up to 500 characters."
        },
        {
          label: "Add rule / Save rule",
          what: "Saves the rule. Clear empties the form."
        }
      ]
    },
    {
      key: "run-sheet",
      title: "Run sheet (also /app/compliance/settings/runs/[id])",
      what: "Read-only view of one purge run: Deleted or Would delete, Kept by a hold, when the live run follows or finished, counts by record, record types with no rule, and who the summary was sent to.",
      fields: []
    },
    {
      key: "holds",
      title: "Holds & deletion",
      what: "Legal holds and deletion-request rules. Nothing under a hold is deleted, by a schedule or a deletion request. A complaint or a commission dispute places a hold by itself. Settings search links: holds, deletion.",
      fields: [
        {
          label: "Legal holds (rows)",
          what: "Each hold shows what it covers, since when, who placed it, and its status (In force, Complaint open, Dispute open, Released). Clicking opens the hold sheet."
        },
        {
          label: "Wait after identity is verified",
          what: "Days between verifying a deletion request and running it (Insurvas never lets it go below 3; at most 45). The request can be cancelled during the wait.",
          default: "7 days"
        },
        {
          label: "Ways to verify who is asking",
          what: "Tick the ways you accept: Known customer, They contacted us from a number we hold for them, They wrote from an email we hold for them, Showed a document establishing identity. A request none of these can verify is rejected. Keep at least one.",
          default: "All four"
        },
        {
          label: "Who may verify and perform a deletion",
          what: "Producers too switch. Off: owner only. On: owner and producers. The owner always may.",
          default: "Owner only"
        }
      ]
    },
    {
      key: "new-hold",
      title: "New hold (also /app/compliance/settings/holds/new)",
      what: "Places a legal hold by hand. Records under it are never deleted until you release it.",
      fields: [
        {
          label: "Covers",
          what: "A phone number, A policy number, or Everything (whole agency).",
          default: "A phone number"
        },
        {
          label: "Phone number / Policy number",
          what: "The number the hold covers. Not shown for Everything."
        },
        {
          label: "Why",
          what: "Litigation, Regulator inquiry, or Placed by hand.",
          default: "Litigation"
        },
        {
          label: "Note",
          what: "Required, up to 500 characters: why the hold was placed."
        },
        {
          label: "Place hold",
          what: "Places the hold. The scheduled purge skips what it covers and deletion requests for it wait."
        }
      ]
    },
    {
      key: "hold-sheet",
      title: "Hold sheet (also /app/compliance/settings/holds/[id])",
      what: "One hold's status, what it covers, why, its note and history.",
      fields: [
        {
          label: "Release now",
          what: "After you give Why it is released and confirm, ends the hold; from then on the records it covered can be deleted on schedule. An automatic hold can't be released by hand until its complaint or dispute is closed."
        }
      ]
    },
    {
      key: "transfers",
      title: "Gate & reports",
      what: "The checks run on every transfer from a partner, the evidence report, and the compliance dashboard. Screening vendors are chosen by Insurvas; calling windows are set in Settings › Calling windows; disclosures in Settings › Disclosures. Settings search links: gate, report, dashboard.",
      fields: [
        {
          label: "TCPA litigator check",
          what: "Locked, always on. A transfer from a known serial TCPA plaintiff is refused."
        },
        {
          label: "Internal do-not-call check",
          what: "Locked, always on. A transfer of a number on your do-not-call list is refused."
        },
        {
          label: "Federal and state do-not-call check",
          what: "On or off. A check that is off is not run on a partner's transfer and shows as off in the evidence report.",
          default: "On"
        },
        {
          label: "Consent on file check",
          what: "On or off. A check that is off is not run on a partner's transfer and shows as off in the evidence report.",
          default: "On"
        },
        {
          label: "Existing customer check",
          what: "On or off. A check that is off is not run on a partner's transfer and shows as off in the evidence report.",
          default: "On"
        },
        {
          label: "Inside legal calling hours check",
          what: "On or off. A check that is off is not run on a partner's transfer and shows as off in the evidence report.",
          default: "On"
        },
        {
          label: "Wait for each check up to",
          what: "500 to 10,000 milliseconds. A check slower than this is recorded as incomplete, never as passed.",
          default: "2,000 ms"
        },
        {
          label: "Who may generate a report",
          what: "Producers, for their own leads switch. Off: owner only. On: producers can generate the evidence report for their own leads. The owner always may.",
          default: "Owner, and producers for their own leads"
        },
        {
          label: "Gap checks that run",
          what: "Tick the checks every evidence report and the monthly gap scan run: Called after a do-not-call entry, Called after a complaint, Calls with no consent artefact, Consent artefact expired before the call, Calls outside legal hours, Calls on a never-scrubbed number, Transfer accepted with no verdict, Missing disclosure on an application. A check that is off shows as off, never as passed.",
          default: "All 8"
        },
        {
          label: "Monthly coverage email",
          what: "On sends the coverage figures and the book-wide gap scan once a month; tick who gets it (nobody chosen means the owners).",
          default: "On, to the owners"
        },
        {
          label: "Tiles on the dashboard",
          what: "Tick which tiles show on the compliance dashboard: Consent proof held, Campaigns scrubbed <30d, Calls outside legal hours, Internal DNC list, Screened before transfer, Open deletion requests, Legal holds. A hidden tile's figure is still worked out.",
          default: "All 7 shown"
        },
        {
          label: "Index checks",
          what: "Read-only table of the nightly check of the compliance record index: Missing, Out of date, No number, and Status (Clean or missing)."
        }
      ]
    }
  ]
},
{
  id: "settings-history",
  slug: "settings-history",
  title: "Settings history",
  group: "Records",
  href: "/app/settings#settings-history",
  why: "Every change anyone makes in Settings: who, what, from what to what, and when. Read only and kept for good. Use it to find out why something behaves differently.",
  who: "Owner only",
  parts: [
    {
      key: "list",
      title: "Settings history",
      what: "One line a change, grouped by day: When, Who, Section, What changed, Kind. Click a row to open it. Nothing here edits or deletes.",
      fields: [
        {
          label: "Export CSV",
          what: "Saves the changes shown, with your filters, as a CSV file."
        },
        {
          label: "Find a setting…",
          what: "Narrows the list to changes whose words match what you type."
        },
        {
          label: "Dates",
          what: "Today, Last 7 days, Last 30 days, Last 90 days, This month, All time, or Pick dates (From and To, then Apply).",
          default: "Last 30 days"
        },
        {
          label: "Section",
          what: "Shows changes from one section only.",
          default: "Every section"
        },
        {
          label: "Person",
          what: "Shows changes by one person only.",
          default: "Anyone"
        },
        {
          label: "Kind",
          what: "Changed, Added, Removed, or Reset.",
          default: "Any kind"
        },
        {
          label: "Clear all",
          what: "Puts every filter back."
        },
        {
          label: "Load <n> more",
          what: "Shows the next 50 changes."
        }
      ]
    },
    {
      key: "change",
      title: "One change",
      what: "A right sheet with what changed and its context.",
      fields: [
        {
          label: "Before / After",
          what: "Shows the value before and after, in plain words."
        },
        {
          label: "Where · What it does · Who · When · Change · Why",
          what: "Shows where the setting lives, what it does, who changed it and their role, when, the kind of change and the reason if one was given."
        },
        {
          label: "Saved together",
          what: "Shows other values changed in the same save."
        },
        {
          label: "Earlier changes to this setting",
          what: "Shows up to five earlier changes to the same setting."
        },
        {
          label: "Show technical details",
          what: "Shows the stored record, with Copy, for support."
        },
        {
          label: "Open this setting",
          what: "Takes you to the setting's section."
        }
      ]
    }
  ]
},
];

export function settingsDoc(slug: string): SettingsDocPage | undefined {
  return SETTINGS_DOCS.find((page) => page.slug === slug);
}

/** The page whose own route is the longest prefix of `pathname`. In-page panels (#hash hrefs) never match. */
export function settingsDocForPath(pathname: string): SettingsDocPage | undefined {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: SettingsDocPage | undefined;
  for (const page of SETTINGS_DOCS) {
    if (page.href.includes("#")) continue;
    const route = page.href.replace(/\/+$/, "");
    if (path !== route && !path.startsWith(route + "/")) continue;
    if (!best || route.length > best.href.length) best = page;
  }
  return best;
}
