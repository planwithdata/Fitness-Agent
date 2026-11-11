# Fitness Agent

A private, iPhone-first workspace for nutrition, workouts, meal planning, groceries, daily routines, and food spending.

[Open Fitness Agent](https://planwithdata.github.io/Fitness-Agent/)

## Use the app

- **Today** combines today's logged nutrition, seven days of movement, monthly food spending, upcoming routines, and a seven-day calorie chart. Dashes represent unlogged days.
- **Nutrition** integrates the full BabyNeKhanaKhaya? diary and can link directly to the separate Calorie Counter app. Search the Indian food catalog, log household portions, save or repeat meals, create custom labels and recipes, and review coverage-aware nutrition trends. If the apps use separate browser storage, download a JSON backup from the original app. In Fitness Agent, choose **Imports → Calorie Counter → Import JSON backup** and review the replacement prompt. The import switches Fitness Agent to the saved diary.
- **Workouts** records session types, duration, and notes. It also shows IronLog working sets and imported body measurements. The movement target is a rolling seven-day target and can be changed or disabled in Settings.
- **Planner** holds meals by date and daily check-ins. **Use plan for groceries** previews ingredients and adds only the ones selected. Groceries already on the list are deduplicated regardless of case or checked status. Routines reset daily in the app.
- **Spending** tracks grocery, delivery, and restaurant expenses in INR, including reviewed receipts. Edit your monthly budget in Settings.
- **Coach** can answer common questions about these records and uses preferences you explicitly add to Memory. The GitHub Pages edition uses a local rules engine. The optional model mode is described below.

On iPhone, open Fitness Agent in Safari and choose **Share → Add to Home Screen**. Once Settings shows **Ready for offline use**, the main workspace and food diary can open without a network connection. Check-ins are shown inside the app.

**Today** shows Coach advice based on the current day, the last seven days, and the last thirty days. Each suggestion opens its matching review. Advice refreshes as linked or local logs update.

## See what worked

In Coach, choose Daily, Weekly, or Monthly and an end date. The views cover one, seven, or thirty days ending on that date. Consistency and daily nutrient averages show the preceding period alongside the selected period. Averages use food days marked complete with values for the nutrient across every logged entry. Protein comparisons use your current target.

Strength comparisons use IronLog working sets for the same recorded exercise name. Coach looks for a shared load or rep count and shows the two session dates. Body trends compare one reading per day from the same source. Findings include the records behind the observation and a way to check whether it repeats. Ask Coach about the selected period, or include a period or an ISO date in your question. The review and its answers run locally.

## Read-only imports

Open **Settings → Imports**, or use the [Imports screen](https://planwithdata.github.io/Fitness-Agent/#imports).

- **Calorie Counter automatic link.** Open both apps on the same browser profile, then choose **Link Calorie Counter** in Imports. Fitness Agent reads the diary, personal foods and recipes, favorites, portions, saved meals, day completion and targets from the original app. Today, Nutrition and Coach use the same source. Changes refresh when you return to Fitness Agent and every few seconds while it is visible. Log and edit in Calorie Counter. Fitness Agent reads the link without writing to it. Disconnect to return to your separate Fitness Agent diary, or export the linked view under Nutrition Settings. When the source cannot be reached in this browser, Nutrition shows the Fitness Agent diary with a status message. Separate iPhone Home Screen installations can have isolated storage, so use both apps in Safari tabs for the link or use a JSON backup.
- **IronLog automatic link.** Open both apps in the same browser profile and choose **Link IronLog**. After you opt in, Fitness Agent reads completed sessions from IronLog's dedicated storage key and refreshes them as they change in another tab or when you return to Fitness Agent. Linked sessions update in place and live in IronLog. Disconnect to hide the live records. Browser profiles, devices, and isolated Home Screen installations may have separate storage.
- **IronLog backup.** Export the JSON from IronLog Settings, then use **Import JSON backup**. This adds completed sessions and completed working sets to Fitness Agent's local workspace. The importer accepts IronLog backup schemas 1–4. Reimports skip existing session IDs, and the live link shows a single row when a session is also in the backup. Fitness Agent uses recorded duration or elapsed start/end time when available. Duration stays unknown otherwise. Workout backup imports include sessions and working sets.
- **Apple Health and DrTrust.** In Apple's Health app, tap your profile and choose **Export All Health Data**, then save it to Files. Choose the ZIP or its `export.xml` under **Import Health file**. Review whether to import workouts, body measurements, or both. If you already track the same sessions in IronLog, choose measurements only. Weight and body fat are the supported measurements. DrTrust readings can be imported when they appear in Apple Health. The original file is processed in your browser. Reimport the latest export when you want to bring in new readings. [Apple Health export instructions](https://support.apple.com/en-euro/guide/iphone/iph5ede58c3d/ios)
- **DrTrust PDF.** Choose **Import DrTrust PDF** and review the dated readings found in the body composition report. Fitness Agent reads the text table and keeps its weight, body fat, muscle mass, muscle rate, body water, bone mass, BMR, visceral and subcutaneous fat, protein percentage, and weight without fat when present. The report's timestamps have no offset and are interpreted as India time. Workouts shows measurement history and Coach can compare the last two readings from the same source. The PDF and its profile details are excluded from saved records. Identical DrTrust readings are skipped on reimport.
- **Blinkit and Zomato.** Save the complete order summary or receipt from your order history, then choose **Read receipts**. Select up to 20 PDFs with selectable text or plain-text files. For a scan or screenshot, use iPhone Live Text and **Paste receipt text**. Check the provider, date, amount, and detected line items before saving. Full order summaries are preferred because a fee-only invoice may show only part of what you paid. Duplicate order IDs are skipped. When an order ID is missing, identical files or pasted text are deduplicated. In Spending, expand the saved receipt's line items. For Zomato, **Find in diary** opens a prefilled food-catalog search so you can choose what you ate and log a portion. Ask Coach what you buy often to see patterns from imported Blinkit items. [Blinkit invoice guidance](https://blinkit.com/terms)
- **Data controls.** Workspace backups include imported records you saved. Live IronLog rows remain in IronLog. Imported body measurements can be cleared in Imports. Receipt text, PDF files, and Health XML are processed for extraction and omitted from saved records. Health measurements and receipt line items are omitted from the optional model context.

### Reduce file handling on iPhone

- **Weight Shortcut.** In Shortcuts, use **Find Health Samples**, select Weight, and format each selected reading in kilograms as `YYYY-MM-DD,weight`. Use the header `date,weight_kg` and a period for decimals. Save to Files as `weight.csv`, then use **Import Health file** in Fitness Agent. A Time of Day automation can prepare the file where your device permits the Health action. [Find Health Samples](https://support.apple.com/guide/shortcuts/intro-to-find-and-filter-actions-apd3c845e881/10.0/ios/27)
- **Receipt Shortcut.** If the merchant emails a PDF, an Email automation filtered to that sender and subject can save the attachment to a Receipts folder in Files. Select those files together in Fitness Agent. Orders without an emailed attachment can use the PDF or text from the order page. [Apple communication triggers](https://support.apple.com/en-ae/guide/shortcuts/apdd711f9dff/ios)
- **Direct provider access.** Zomato reviews [personal-use developer requests](https://forms.eternal.com/form/ja8hap2tpm/) and allowlists approved OAuth redirect URLs. Live receipt sync would require that access and a private authorization backend. Direct background access to Apple Health requires a native iOS app with HealthKit permissions.

## Develop and deploy

Use Node.js 22.13 or later.

```sh
npm ci
npm test
npm start
```

Open [http://127.0.0.1:4173/Fitness-Agent/](http://127.0.0.1:4173/Fitness-Agent/). The preview serves the same path as production. Restart the server after editing files.

The build bundles the PDF, ZIP and XML readers into `site/vendor/` with their licenses. All readers run locally in the browser. **Settings → Pages → Source** uses **GitHub Actions**. The workflow tests the app, stamps its offline cache with the commit SHA, and publishes only `site/` on pushes to `main`. It can also be dispatched from the Actions tab. Hash routes and relative assets work under `/Fitness-Agent/`.

## Data and architecture

- `site/nutrition/` contains the diary UI, catalog, storage, and nutrition logic from Calorie Counter revision `5bf49c9`. The integration adds the Fitness Agent shell and theme, reuses the upstream tests, and uses a separate database. Both public projects run under the same GitHub Pages origin, so separate names keep routine operations scoped to their intended diary.
- `site/lib/domain.js` derives a shared snapshot from the workspace and nutrition diary. `records.js` handles form and backup validation. IndexedDB read-modify-write transactions keep concurrent record mutations consistent, and a browser channel refreshes other workspace tabs.
- `site/lib/coach.js` consumes the shared snapshot. Saved preferences are visible, editable, and removable. Conversation history is capped at 60 messages. The dashboard brief is generated locally.
- Personal records stay in browser storage in the Pages edition. Browser storage is tied to the browser profile and origin. Keep both the workspace JSON and the nutrition JSON when moving devices or clearing browser data. Each restore validates its own file and asks for confirmation.
- The catalog retains its upstream attributions, sources, and household estimates. For source archives and reproducibility, run `python scripts/build_catalog.py --help`. Generic survey or delivery proxy nutrition is an estimate.

## Optional model mode

The included Node server can serve a private, single-user copy with an optional OpenAI Responses API adapter. Set `OPENAI_API_KEY`, `OPENAI_MODEL` to a model your API project can access, and `FITNESS_AGENT_PASSWORD` to a unique password of at least 16 characters in the server environment, then start it. Sign in as `fitness`. It binds to loopback. For access from a phone, put it behind an HTTPS reverse proxy and use a private host you control.

The self-hosted Coach has a per-question checkbox that sends your question and a bounded summary to OpenAI. The summary includes nutrition totals and coverage, movement, budget, meal names, grocery and routine names, and recent memory notes. The optional adapter sends no raw diary entries or conversation history. It uses `store: false` for the model response. Service credentials stay on the server. If the model fails, the coach falls back to the local answer. The server uses a password gate, same-origin requests, and a request limit. Model replies can only return text. See the [official OpenAI documentation](https://developers.openai.com/api/docs/guides/migrate-to-responses).

## Roadmap

1. **Portable data and imports.** Add account-backed, user-scoped sync and a normalized import interface. Start with documented user exports and preserve provenance and import history.
2. **Authorized connections.** Add consent-based, revocable, read-only provider adapters after obtaining legitimate access. Keep OAuth grants and refresh tokens server-side. Health and shopping integrations should report availability and permissions explicitly.
3. **Contextual planning.** Add transparent, source-linked suggestions that combine food preferences, prior purchases, groceries, activity, and budget. Keep user notes editable and make information sharing granular.
4. **User-approved actions.** When provider access allows it, preview proposed carts or orders with merchant, prices, items, and fees. Require explicit confirmation of the exact proposal, then execute with an idempotency key and an auditable receipt. Use the same workflow for scheduled reminders when a supported delivery channel is available.
