# Fitness Agent

A private, iPhone-first workspace for nutrition, workouts, meal planning, groceries, daily routines, and food spending.

[Open Fitness Agent](https://planwithdata.github.io/Fitness-Agent/)

## Use the app

- **Today** combines today's logged nutrition, seven days of movement, monthly food spending, upcoming routines, and a seven-day calorie chart. Dashes represent unlogged days.
- **Nutrition** integrates the full BabyNeKhanaKhaya? diary. Search the Indian food catalog, log household portions, save or repeat meals, create custom labels and recipes, and review coverage-aware nutrition trends. In the original app, download a JSON backup from Settings. In Fitness Agent, choose **Nutrition → Settings → Restore JSON** and review the replacement prompt.
- **Workouts** records session types, duration, and notes. The movement target is a rolling seven-day target and can be changed or disabled in Settings.
- **Planner** holds meals by date and daily check-ins. **Use plan for groceries** previews ingredients and adds only the ones selected. Groceries already on the list are deduplicated regardless of case or checked status. Routines reset daily in the app.
- **Spending** tracks manual grocery, delivery, and restaurant expenses in INR. Edit your monthly budget in Settings.
- **Coach** can answer common questions about these records and uses preferences you explicitly add to Memory. The GitHub Pages edition uses a local rules engine. The optional model mode is described below.

On iPhone, open Fitness Agent in Safari and choose **Share → Add to Home Screen**. Once Settings shows **Ready for offline use**, the main workspace and food diary can open without a network connection. Check-ins are shown inside the app.

## Develop and deploy

Use Node.js 22 or later.

```sh
npm test
npm start
```

Open [http://127.0.0.1:4173/Fitness-Agent/](http://127.0.0.1:4173/Fitness-Agent/). The preview serves the same path as production. Restart the server after editing files.

The frontend has zero runtime package dependencies. **Settings → Pages → Source** uses **GitHub Actions**. The workflow tests the app, stamps its offline cache with the commit SHA, and publishes only `site/` on pushes to `main`. It can also be dispatched from the Actions tab. Hash routes and relative assets work under `/Fitness-Agent/`.

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
