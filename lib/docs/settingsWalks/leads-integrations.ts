import type { SettingsWalk } from "../settingsWalks.ts";

/**
 * Settings walks for this group of Settings pages; see lib/docs/settingsWalks.ts.
 * Each walk's first step carries an `at` with a `?docs=` query: the Settings pages differ only by #hash, and a
 * hash-only address does not reload the page, so a sheet or tab left open by the walk before would stay on screen.
 */
export const WALKS: Record<string, SettingsWalk> = {
  "lead-posting": {
    outcome: "Each lead vendor posts with its own key, price and field map, and you can see what they send and what is refused.",
    minutes: 10,
    steps: [
      { at: "/app/settings?docs=lead-posting#lead-posting", say: "Check Posts today and Refused", detail: "Today's figures for every vendor. They reset at midnight, your time, and refused posts are never charged.", find: "text=Posts today" },
      { say: "Click Copy posting address", detail: "Every vendor posts to this one address. Each is told apart by its own key.", find: "text:Copy posting address" },
      { say: "Click Connect a vendor to add one", detail: "Four short steps make a key for the new vendor and send them the instructions.", find: "text:Connect a vendor" },
      { say: "Open the Rejections tab", detail: "Refused posts and the reasons that repeat, so you can tell the vendor what to fix.", find: "text:Rejections", then: "open" },
      { say: "Open the Vendor guide tab", detail: "General posting instructions you can send to any vendor, as a link or a PDF.", find: "text:Vendor guide", then: "open" },
      { say: "Open the Vendors tab", detail: "One line per vendor, with its status and today's posts.", find: "text:Vendors", then: "open" },
      { say: "Click a vendor to open its sheet", detail: "The sheet holds the vendor's price, daily cap, posting hours, key and field map.", find: "tbody tr", then: "open" },
      { say: "Set the price per accepted lead", detail: "Lead spend and cost per sale are worked out from this price.", find: "label:Price per accepted lead" },
      { say: "Set a daily cap", detail: "Posts past the cap are refused, so a vendor cannot send more than you want to pay for.", find: "label:Daily cap" },
      { say: "Open the Field map tab", detail: "Match each of the vendor's field names to yours, so their leads land in the right places.", find: "text:Field map", then: "open" },
      { say: "Open the Test tab", detail: "Send a test post before the vendor goes live, and fix anything that is refused.", find: "[role=\"tab\"]:text-is(\"Test\")", then: "open" },
    ],
  },
  "dialing-cadence": {
    outcome: "The dialer knows how long to wait before each retry, for each call result, and when to stop.",
    minutes: 6,
    steps: [
      { at: "/app/settings?docs=dialing-cadence#cadence", say: "Pick a call result, starting with No answer", detail: "Each call result has its own retry plan. No answer is the one used most.", find: "text:No answer" },
      { say: "Choose a Preset", detail: "A preset fills in the whole plan at once. You can change single calls after.", find: "[aria-label=\"Preset\"]" },
      { say: "Set Max calls", detail: "The dialer stops retrying a lead after this many calls.", find: "#cadence-max-attempts" },
      { say: "Click Copy it and edit to make your own", detail: "Until you do, the Insurvas default is in force. This copies it into a draft you can change. Nothing is saved yet.", find: "text:Copy it and edit", then: "open" },
      { say: "Read the timeline", detail: "One dot per call, across the days and the parts of the day. Drag a dot sideways to change its wait, or up and down to change the time of day.", find: "[role=\"group\"][aria-label$=\"the example lead's calls\"]" },
      { say: "Click a call to change it", detail: "Call 1 is made as soon as the lead arrives. From call 2 on, each call has its own wait and part of the day.", find: "button[data-call=\"2\"]", then: "open" },
      { say: "Set Wait after call 1", detail: "How long the dialer waits after the call before, in minutes, hours or days.", find: "#cadence-wait-2" },
      { say: "Click Done", detail: "It closes the call. Your change stays in the draft and the timeline moves with it.", find: "button:text-is(\"Done\")", then: "open" },
      { say: "Check What happens", detail: "Each call an example lead would get, with its day and time. A call that lands on a no-call day is moved.", find: "aside[aria-label=\"What happens\"]" },
      { say: "Click Save cadence to put it in force", detail: "The dialer uses your cadence from the next call it schedules. Leads already part-way through keep their next call.", find: "text:Save cadence" },
      { say: "Open History to see past versions", detail: "Every saved cadence is kept. You can view an old one and restore it.", find: "text:History", then: "open" },
    ],
  },
  "calling-windows": {
    outcome: "Your agency's calling hours and days off are set, inside the federal and state limits.",
    minutes: 5,
    steps: [
      { at: "/app/settings?docs=calling-windows#calling-windows", say: "Turn on No Sundays if you never call then", detail: "The switch saves straight away. The dialer then skips Sundays for every campaign.", find: "#calling-no-sunday" },
      { say: "Turn on No federal holidays", detail: "The dialer skips each federal holiday. The switch saves straight away.", find: "#calling-no-holidays" },
      { say: "Set your hours on the week grid", detail: "Drag the top or bottom of a day to change it. You can never call outside the legal limits.", find: "[aria-label=\"Your agency's hours, Monday to Sunday\"]" },
      { say: "Click Save hours", detail: "The dialer uses the new hours from the next call it places.", find: "guide:calling-windows-save" },
      { say: "Check the State rules in force", detail: "Some states allow fewer hours. The dialer always keeps to the stricter rule, by the lead's state.", find: "section[aria-label=\"State rules in force\"]" },
      { say: "Click Narrow a campaign to call less", detail: "A campaign can call in fewer hours than your agency, never more.", find: "text:Narrow a campaign" },
      { say: "Open Days off", detail: "The days your agency is closed. Nobody is dialled on them.", find: "text:Days off", then: "open" },
      { say: "Click Add a day off", detail: "Pick the date and give it a name. The dialer stays quiet all that day.", find: "text:Add a day off" },
    ],
  },
  "inbound-settings": {
    outcome: "A waiting transfer is warned about, escalated and expired on your times, and goes to the right agent.",
    minutes: 5,
    steps: [
      { at: "/app/settings?docs=inbound-settings#queue-sla", say: "Set Warn, Escalate and Expire on the ladder", detail: "Drag a rung or use - and +. Each step fires once if nobody has taken the transfer yet.", find: "[role=\"group\"][aria-label=\"The waiting ladder\"]" },
      { say: "Choose who hears about it", detail: "Pick who is alerted when a transfer arrives and when it escalates.", find: "section[data-section=\"alerts\"]" },
      { say: "Click Add a buffer agent", detail: "A buffer agent takes the call first and hands it to a licensed agent. You add them in Team & access.", find: "text:Add a buffer agent" },
      { say: "Choose who gets the next transfer", detail: "Only agents licensed in the caller's state, and skip anyone on a break.", find: "section[data-section=\"routing\"]" },
      { say: "Click Save", detail: "Everything on this page saves together. The new times apply to transfers that arrive from now on.", find: "guide:queue-sla-save" },
    ],
  },
  "calendar-availability": {
    outcome: "Your working hours, time off and booking rules are set, so callbacks and appointments land when you can take them.",
    minutes: 6,
    steps: [
      { at: "/app/settings?docs=calendar-availability#calendar", say: "Pick whose calendar to set", detail: "You can set your own hours or another agent's.", find: "#calendar-whose" },
      { say: "Set your timezone", detail: "Your working hours are read in this timezone.", find: "#calendar-timezone" },
      { say: "Pick a Quick start for your week", detail: "Fills a usual working week at once. You can change single days after. A Save changes bar shows once you change anything.", find: "#calendar-quick" },
      { say: "Open the Appointments tab", detail: "How long each appointment takes and the gap after it.", find: "#calendar-tab-appointments", then: "open" },
      { say: "Set the Length and Gap after each", detail: "Every booking takes this much room on the calendar.", find: "#calendar-panel" },
      { say: "Open the Time off & breaks tab", detail: "Lunch, leave and training go here.", find: "#calendar-tab-blocks", then: "open" },
      { say: "Click Block some time", detail: "Blocked time is never offered for a booking.", find: "text:Block some time" },
      { say: "Open the Booking rules tab", detail: "Same-day booking, double-booking and linked calendars.", find: "#calendar-tab-rules", then: "open" },
      { say: "Choose whether same-day booking is allowed", detail: "When it is off, the earliest anyone can book is tomorrow.", find: "#policy-same-day" },
      { say: "Open the Whole agency tab", detail: "Limits that apply to everyone in the agency.", find: "#calendar-tab-agency", then: "open" },
      { say: "Set Most appointments a day", detail: "The whole agency stops taking bookings for a day once it reaches this number. Click Save changes at the foot when you're done.", find: "#agency-cap" },
    ],
  },
  "pipelines-outcomes": {
    outcome: "Your pipelines have the stages you work in, and each call outcome moves the lead to the right stage.",
    minutes: 10,
    steps: [
      { at: "/app/settings?docs=pipelines-outcomes#pipelines", say: "Find the pipeline you use", detail: "Each pipeline has its own stages, and the call outcomes agents pick.", find: "table" },
      { say: "Click New pipeline for another", detail: "Start a pipeline from a template or a copy, for a product or a partner type.", find: "text:New pipeline" },
      { say: "Click Set up to open the map", detail: "The map shows each outcome and the stage it moves the lead to.", find: "guide:pipeline-setup", then: "open" },
      { say: "Check where each outcome goes", detail: "Outcomes are on the left, stages on the right. A line joins each outcome to the stage it moves the lead to.", find: "guide:pipeline-outcomes" },
      { say: "Click Add outcome for a new result", detail: "Outcomes are what an agent picks at the end of a call.", find: "text:Add outcome" },
      { say: "Click Add stage for a new step", detail: "Stages are the columns a lead moves through.", find: "text:Add stage" },
      { say: "Click Save changes", detail: "Changes wait until you save. Then the lead workspace and the dialer use them right away.", find: "text:Save changes" },
    ],
  },
  integrations: {
    outcome: "You can see every app, webhook and vendor connected to Insurvas, and where to add or review each one.",
    minutes: 5,
    steps: [
      { at: "/app/settings?docs=integrations#integrations", say: "Check the Overview tab", detail: "Everything connected to Insurvas, in one list.", find: "[role=\"tab\"]:has-text(\"Overview\")" },
      { say: "Open the API keys tab", detail: "Each app that reads or changes your data has its own key.", find: "[role=\"tab\"]:has-text(\"API keys\")", then: "open" },
      { say: "Click New API key for a new app", detail: "Give the key a name and only the permissions the app needs. The key is shown once.", find: "text:New API key" },
      { say: "Click a key to see its details", detail: "Shows what the key can do, when it ends and when it was last used.", find: "tbody tr", then: "open" },
      { at: "/app/settings?docs=integrations-webhooks#integrations", say: "Open the Webhooks tab", detail: "Webhooks send an event to another app the moment it happens here.", find: "[role=\"tab\"]:has-text(\"Webhooks\")", then: "open" },
      { say: "Click Add a webhook to send events out", detail: "Give the address, then tick the events it should receive.", find: "text:Add a webhook" },
      { say: "Open the Developer docs tab", detail: "Topics and code samples for whoever builds the connection.", find: "[role=\"tab\"]:has-text(\"Developer docs\")", then: "open" },
    ],
  },
  "browser-extension": {
    outcome: "You know whether the extension is installed, which carrier sites it fills and who can use it.",
    minutes: 3,
    steps: [
      { at: "/app/settings?docs=browser-extension#sales-extension", say: "Click Install for Chrome", detail: "Adds the extension to Chrome on this device, so it can fill carrier applications for you.", find: "text:Install for Chrome" },
      { say: "Click Check again after you install", detail: "The status line then says whether the extension is installed in this browser.", find: "text:Check again" },
      { say: "Check the carrier sites it fills", detail: "Each carrier site shows what it fills and whether it works today.", find: "[data-slot=\"table-card\"]:has-text(\"Carrier sites it fills\")" },
      { say: "Check who can use it", detail: "Everyone who can fill carrier sites, with their fills this month.", find: "[data-slot=\"table-card\"]:has-text(\"Who can use it\")" },
      { say: "Click Revoke to take someone's access away", detail: "They lose access at once, for every carrier or for one. Give back returns it.", find: "td :text-is(\"Revoke\")" },
      { say: "Open Recent fills", detail: "Every fill the extension made, by person and carrier.", find: "text:Recent fills", then: "open" },
    ],
  },
};
