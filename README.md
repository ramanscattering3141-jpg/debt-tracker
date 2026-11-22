# Debt Tracker

A private, offline debt tracker. Everything you enter stays on the device: no bank connections, nothing uploaded.
Built with React + TypeScript + Vite, Tailwind, Dexie (IndexedDB), Recharts and decimal.js, and packaged for iPhone with Capacitor.

## iPhone 15 (native app)
1. Plug in the iPhone (Developer Mode must be on: Settings › Privacy & Security › Developer Mode).
2. Run `scripts/iphone.sh`. It builds the app and opens Xcode.
3. In Xcode, select the **App** target › Signing & Capabilities › Team: your Apple ID. Choose your iPhone and press ▶.
4. On the phone, trust the developer: Settings › General › VPN & Device Management.
With a free Apple ID the app has to be reinstalled every 7 days. Your data survives reinstalls; export a backup anyway (More › Backup).

## Mac / Windows (browser)
Requires Node 20+. `npm install`, then `npm run build && npm run preview`, then open the printed URL.
For development, use `npm run dev`.

## Tests
`npm test` runs the calculation-engine tests (daily/monthly/compound interest, rate changes, minimums, amortization, avalanche/snowball, frequencies, LOC withdrawals).

## Notes
- Projected interest is always an **estimate**. Actual interest is whatever you record as "Interest charge" transactions. Recording one resets the estimate from that date, so interest is never counted twice.
- No lender formulas are assumed. If you don't know a minimum-payment formula, choose "Entered manually".
