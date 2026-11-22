# Debt Tracker

A private, offline debt tracker. Everything you enter stays on the device: no bank connections, nothing uploaded.
Built with React + TypeScript + Vite, Tailwind, Dexie (IndexedDB), Recharts and decimal.js, and packaged for iPhone with Capacitor.

## Hosting (website that installs like an app)
It's a static site. Your financial data is **never** sent to the host; it lives in the browser storage of each device you use.

**GitHub Pages:** push to a GitHub repo's `main` branch. In the repo, go to Settings › Pages › Source and choose **GitHub Actions**. `.github/workflows/deploy.yml` runs the tests, builds and deploys.
**Netlify:** "Import from Git" uses `netlify.toml` automatically. Or run `npm run build` and drag the `dist` folder onto app.netlify.com/drop.

## Install on iPhone 15
Open the site in **Safari**, tap Share › **Add to Home Screen**. It opens full screen with its own icon and works offline.
- Data saved in Safari and data saved in the home-screen app are separate. Use the installed app.
- Each device keeps its own data. To move it, use More › Backup › Export, then Restore on the other device.
- Export a backup regularly (it saves to the Files app). Deleting the home-screen app deletes its data.

## Run locally (Mac / Windows)
Requires Node 20+. `npm install`, then `npm run dev` (development) or `npm run build && npm run preview`.

## Optional: native iPhone build
`scripts/iphone.sh` opens the Capacitor Xcode project (free Apple ID; reinstall every 7 days). The web install above is simpler.

## Tests
`npm test` runs the calculation-engine tests (daily/monthly/compound interest, rate changes, minimums, amortization, avalanche/snowball, frequencies, LOC withdrawals).

## Notes
- Projected interest is always an **estimate**. Actual interest is whatever you record as "Interest charge" transactions. Recording one resets the estimate from that date, so interest is never counted twice.
- No lender formulas are assumed. If you don't know a minimum-payment formula, choose "Entered manually".
