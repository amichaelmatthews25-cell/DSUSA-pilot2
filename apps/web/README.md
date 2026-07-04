# DSUSA Web — Sprint 1 (Maria's Journey)

The production frontend for Drive Society USA. Sprint 1 delivers the complete entrepreneur journey:
**referral → application → qualification → automatic business creation → operating dashboard**,
following one entrepreneur (Maria Rodriguez, referred by Defy Ventures).

## Run it
```bash
cd apps/web
npm install
npm run dev      # http://localhost:5173
```
Requires Node 18+. No backend needed — the app runs on the MockDataProvider by default.

## The demo path (click through in order)
1. **Referral Partner Dashboard** (`/`) — Defy Ventures submits Maria.
2. **Application** — identity, business entity (defaults to Sole Proprietor), documents, submit.
3. **Qualification** — review runs, Maria is approved, assigned the **Cargo Van** business class.
4. **Business Creation** — DSUSA generates her profile, budget, revenue model, capital need, plan, KPIs.
5. **Entrepreneur Dashboard** — her live home base: revenue, vehicle, health, services, activity, tasks, KPIs.

Each screen ends by pointing to what happens next, so it plays as one continuous story.

## Architecture: mock now, live later, no UI changes
Every screen reads through the **`DataProvider`** interface (`src/data/provider.ts`) via the `useData()`
hook. Today `MockDataProvider` (`src/data/mock.ts`) supplies realistic stateful data. To go live, implement
the same interface over Supabase + the platform contracts/edges and select it in `src/data/context.tsx`
(`VITE_DATA_SOURCE=live`). **No screen changes.** That is the production path — this is not throwaway work.

## Structure
```
src/
  data/      domain types, DataProvider interface, MockDataProvider, provider context (the swap point)
  components/ shared UI primitives (journey tracker, stats, pills)
  screens/   ReferralDashboard, Application, Qualification, BusinessCreation, EntrepreneurDashboard
```

## Status
Sprint 1 Definition of Done met. Priority 2 (Freight Marketplace, Payment Waterfall) and Priority 3
(Services marketplace, Capital, Vehicle, partner dashboards) are scaffolded in the domain + provider
interface and ready to build as screens.
