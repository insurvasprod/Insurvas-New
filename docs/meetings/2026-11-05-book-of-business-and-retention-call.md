# Call, 2026-11-05: Book of business, Carrier sync and what Retention really is

Two screen recordings of a call held on 2026-11-05: `2026-11-05 17-55-17.mp4` (4.4 min) and `2026-11-05 18-01-47.mp4` (6.9 min).

On the call: Rinor, Umar Masood, Rion Reqica, Olti and Artin Ahmeti. Most of the direction comes from Umar, who is the highlighted speaker during the instructions.

- **Screens shown in the first recording:** Book of business › Files and the Save queue.
- **Screens shown in the second recording:** a ChatGPT answer about retention, the new Save queue card page (Jill Hudson › Fix), and the Power Policies sign-in page.

**How this was transcribed.** WhisperX `small` ran locally, in English. It never names the speaker, it has gaps, and it garbled a stretch of the second recording (about 02:03–02:49, marked below). Speakers are assigned from context. Every change listed is tied to its timestamp so it can be checked against the recording.

---

## What changes

### 1. Book of business holds only Policies and Commissions (rec. 1, 00:08–01:23)
- In the navigation, Book of business becomes a parent with two things only:
  - **Policies**: the list of all policies.
  - **Commissions**: the list of commissions.
- **The policy list is the current book, not a list of uploads** (00:08–00:35): "it already has every American Amicable policy and then it just got updated… not to have all of them like this, like new files, every single upload."
  - Each policy shows once, in its latest state, and every carrier file updates it.
  - The current Files table, one row per upload (the page on screen), is not what Book of business should show.

### 2. A new parent, "Carrier sync" (rec. 1, 01:25–01:46)
- "Your process of uploading all these files and matching and stuff and history… should go into a new parent."
- Name: **Carrier sync**. "CRM sync" was said first, then settled as "Carrier sync is a better word."
- It takes everything Book of business has today apart from Policies and Commissions:
  - upload;
  - Files;
  - matching / Needs you;
  - history;
  - Setup (layouts, carrier rules).

  *The exact split is our reading, not something said line by line.*

### 3. Carrier files arranged as folders (rec. 1, 00:35–01:01)
- "We need to have these files in the form of folders, and inside folders."
- "There will be a folder outside, and in that folder, it's a day folder. So I have five carriers, I will upload each file in that carrier."
- The goal: "just arranging of the files should be very easy."
- **Reading:** a carrier folder, inside it a folder per day, inside that the files. ⚠️ Confirm the order: carrier › day, or day › carrier?

### 4. Pipelines on the history (rec. 1, 01:52–02:14) ⚠️ unclear
- The audio here is "staging?" followed by "No, you said pipelines to be added on the history… History pipeline, okay."
- Our reading: the history should show the pipeline (stage) a policy moved through.
- ⚠️ Confirm what is meant: a pipeline view of the history, or pipeline stages recorded in it.

### 5. Retention is redefined (rec. 1, 02:17–04:20; rec. 2, 00:00–06:41)
**The current module is "not retention."**
- Rinor described today's module: "someone who has high risk of not paying… you click to start the fix… all based on forecasting."
- Umar: "This is not retention."
- The current module is the Notion Module 5 radar: a predicted risk score, the Save queue, and Start the fix.

**What Retention is instead:** policies already in the book that need care now, found from the facts in the carrier files.
- The situations to find, as named on the call (rec. 2, 00:43–01:39 and 05:58–06:21):
  - **first-draft payment failures**;
  - **failed payments**: a client who paid the first premium and then misses the second or third ("they are in the risk of getting this policy off your books");
  - **pending lapses / lapse notices**;
  - **pending requirements / pending manual actions**;
  - **charged-back failed payments**.
- The rule behind it: "unless a policy gets fully lapsed, we have time to save that policy" (06:11–06:21).

**How it works** (rec. 2, 03:01–03:53 and 05:09–05:35):
1. Upload a carrier file. It already carries everything needed.
2. A **set of rules** finds the policies in those situations.
3. Those policies are moved into the Retention module, kept in a **new table**, and highlighted there.
4. Open a policy and go through a process to fix it.
5. A policy stays in Retention until it is fixed, then leaves: "once they get fixed, they will not appear here."
6. Every one of these policies is still part of the book of business; Retention shows the ones that need care.

**It is built as a product, with its own rules** (04:44–05:13):
- "Do we have something like this implemented for our policies?" Answer: yes, at Power Policies (its sign-in page was opened on screen).
- "That is different… we have some of our own rules… Power Policies is just customized for one person. It will not work. We are building a product."
- So the rule set must be general, not copied from Power Policies.

**It links straight to Book of business** (06:27–06:41):
- "Book of business is basically the list of all the policies and their statuses and all their fields; you use those fields and get answers."

**Test it with a real file** (04:03 and 06:41):
- "Just put one AMAM file" (American Amicable): take a whole AMAM file, upload it, and find every retention opportunity in it.

**Learn the domain first** (05:49–05:58):
- "You will go and learn about retention first… how retention works in life insurance, final expense."

### 6. Background shown on screen, not spoken (rec. 2, ChatGPT answer)
This is general reference the team read on the call. It is not an instruction.
- **A retention agent's job:**
  - call customers whose payments failed;
  - ask why they are cancelling;
  - fix billing (for example outdated bank details);
  - explain the coverage;
  - offer approved options when the premium is unaffordable (example: "$65 a month… if I could pay around $40");
  - help with reinstatement requests;
  - record everything in the CRM.
- **"Sales gets someone to buy insurance. Retention helps them keep it."**
- **Three situations to understand:**
  - **Grace period:** commonly about 30 or 31 days; coverage usually stays active.
  - **Lapse:** coverage stops.
  - **Reinstatement:** not automatic; may need missed premiums, forms, health information and approval.

---

## What this means for the current build (our notes, not said on the call)

- **The Notion spec disagrees.** The Module 5 doc and LA-5.1–5.11 are the predictive radar this call rejects.
  - Notion should be updated, or the owner should confirm that this call overrides it.
  - Owner rule: check Notion before any change, and label anything outside it.
- **Much of this already exists as facts:**
  - **LA-4.16 Lapse risk** (Book of business › Needs you) already flags behind-on-payments, bounced drafts, recently lapsed and direct bill, all from the carrier files.
  - **LA-5.6 Reinstatement** opens cases from lapses in the files.
  - **LA-5.4 Servicing** fixes a payment date or bank and closes when the next file proves it.
  - The new Retention could be built from these, plus a rule engine and a "fixed → leaves" table, rather than from scratch.
- **Not yet detected from files:**
  - "pending requirements / pending manual actions" (needs the carrier's requirement or status columns in the layouts);
  - "first-draft payment failure" as its own case.
- **Open owner decisions:**
  1. Remove the predictive Save queue, or keep it as one view?
  2. Folder order: carrier › day, or day › carrier?
  3. What "pipelines on the history" means.
  4. Do Lapse risk (now in Book of business › Needs you) and Reinstatement move into the new Retention?

---

## Transcript, recording 1 (`2026-11-05 17-55-17.mp4`)
WhisperX `small`; speakers not attributed; ASR mistakes kept as heard.

```
[00:00] you talk or this is just a simple thing.
[00:02] No, I just want to keep everything, the new changes.
[00:08] So here on the book of business, book of business should be all of the should it should this be as already has it like every American amicable policies and then it just got updated.
[00:25] right?
[00:25] Not to have all of them like this, like new files, every single upload, right?
[00:35] No, the all TVU is is actually we need to have this files in the form of like folders folders and inside folder.
[00:44] So there will be a folder outside, right?
[00:48] And in that folder, it's a day folder.
[00:51] So I have five carriers, I will upload each files in that carrier.
[00:55] So it's like just just arrange arranging of the funds [files] should be very easily.
[01:01] Okay.
[01:02] And you said the book of business should be the folders.
[01:06] In this case, the file is not a book of business should be a parent here on your navigation and it should contain two things policies and commissions list of all policies and list of commissions.
[01:20] This should be in book of business.
[01:23] Whatever else
[01:25] and your process of uploading all these files and matching and stuff and history and whatever, it should go into a new parent called CRM sync, okay?
[01:38] Or you can call, say, carrier sync.
[01:40] Carrier sync is a better word rather than carrier [CRM] sync.
[01:46] Carrier sync, okay, go ahead.
[01:52] Anything else that, okay, staging?
[01:56] No, you said pipelines to be added on the history.
[02:06] History pipeline, okay.
[02:14] Anything else that I'm missing here?
[02:17] Let's go through retention.
[02:19] So what do we have in the retention?
[02:23] As for retention, I did want to ask you actually because I didn't think retention is just these things that I had on the modules.
[02:36] Just because it has, for example, someone who has high risk of not paying and then there's a reason about it.
[02:44] So you click to start the fix.
[02:48] So this is all based on like predicaments, like forecasting it.
[02:54] Okay.
[02:55] This is not retention.
[02:57] So this is why I'm asking is, is this what retention should be?
[03:02] Or am I missing out something?
[03:05] This is not retention.
[03:06] Go to Claude and ask him simple question.
[03:09] What is retention?
[03:12] means and how it looks like in different carriers for life insurance policy.
[03:28] Just Google this Gemini, this whatever.
[03:30] Yeah, I'm doing this in cloth [Claude].
[03:36] Here, I'll do it here.
[03:47] What does this include?
[03:56] And insurance companies.
[04:10] Also, how well insurance companies keep spending this is a plethora of money.
[04:15] There's any other policy to look and throw in switching one.
[04:19] Okay.
[04:20] Customer retention.
```

## Transcript, recording 2 (`2026-11-05 18-01-47.mp4`)

```
[00:09] Now just write what is different retention cases.
[00:43] for example wait wait for example for example first draft payment failures for example payment first draft payment failure
        (typed into ChatGPT: "what are some retention cases for example first draft payment failure, pending lapse, notices, pending manual actions")
[01:18] Yes.
[01:20] Pending laps [lapse].
[01:21] Notices.
[01:31] Pending manual actions.
[01:42] So now once you are done with that, now let's read this whole thing once again, like all the things that is in between.
[01:54] Okay, what are we left again here?
[01:58–02:49] ⚠️ garbled by the ASR (reading the ChatGPT answer aloud: the retention agent, the "$65 policy" example, grace period / lapse / reinstatement)
[03:01] When you upload a file, when you upload this carrier file, you have all the information there.
[03:23] So for example, if you upload right now a mem [AMAM] file and ask her go figure out what are the three different important situations first off [draft] payment failure pending lapses what are the pending requirements go find these and those all policies will get highlighted in the retention module.
[03:44] And then I open one policy and I go through a process to fix it.
[03:48] And unless I fix it, that policy is there in the retention module.
[03:53] So this will I be able to help business retain my business customers with me.
[04:00] This is the whole module, this was the whole module, the tension [retention] module.
[04:03] So just put one mm [AMAM] file and just learn this, read this again and see how you can guess first draft payment failures, pending lapses, failed payments.
[04:17] Even if someone is doing, if someone paid their first payment and they are failing their next payments,
[04:26] Second month or third month, so they are in the risk that is the risk of getting Getting this policy of [off] your books.
[04:34] So you need to maintain your book of business.
[04:36] So retention Do we have something like this implemented for our policies?
[04:44] Yes, we have okay, so Should I ask for?
[04:54] No, that is different.
[04:57] It's different because we have some of our own rules.
[05:00] It will not work here.
[05:02] We are building a product.
[05:04] Power policy is just customized for one person.
[05:08] It will not work.
[05:09] What we need to build here is again
[05:13] set of rules that will get applied to move those policies where we think that they are retention fixes, right?
[05:24] They need some retention care.
[05:26] And those policy will get moved to this platform.
[05:28] You can save them in a new table and just show them here.
[05:31] And once they get fixed, they will not appear here.
[05:35] But these policies are all parts.
[05:39] All these policies are part of your book of business.
[05:42] But you find something in there that you think that it's retention capable.
[05:49] Now what is retention capable?
[05:51] You will go and learn about retention first.
[05:54] So how retention works in life insurance, final expense.
[05:58] It's the first draft.
[05:59] I told you first draft payment failures, pending lapses and pending manual actions and failed payments, charged back failed payments.
[06:09] right?
[06:11] People who are missing their first, second or third payment, they are also so unless a policy not get lapsed, fully lapsed, we have a time to save that policy.
[06:21] So that's it.
[06:27] And this modules links directly to your book of business because book of business is is basically having list of all the policies and their statuses and all their fields you utilize those fields and get answers.
[06:41] So for example now if you upload a file if you have a whole AMM file just upload one file and then ask the LGBT [LLM?] to find all these retention opportunities
```
