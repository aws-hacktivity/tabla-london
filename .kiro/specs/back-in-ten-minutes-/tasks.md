# Back in Ten Minutes — Tasks

## 1. Create feature directory and README spec

- [ ] Create `features/back-in-ten-minutes/`
- [ ] Write `features/back-in-ten-minutes/README.md` containing:
  - Overview (one sentence)
  - EARS-style requirements (copied/adapted from the spec)
  - Store keys table showing pk/sk/item layout
  - Explanation of store verb choice (`put` with timestamp sk)

## 2. Implement feature.ts

- [ ] Create `features/back-in-ten-minutes/feature.ts`
- [ ] Set `name: "back-in-ten-minutes"` (must match directory)
- [ ] Set description: one sentence about the break timer
- [ ] Implement POST `/` route:
  - Validate `session` (non-empty string) → 400
  - Validate `duration` (number > 0) → 400
  - Compute `endTime = new Date(Date.now() + duration * 60_000)`
  - `store.put(pk, sk, { endTime, createdAt })` with sk = `TIMER#<ISO timestamp>`
  - Return 201 with `{ ok: true, endTime }`
- [ ] Implement GET `/` route:
  - Validate `?session=` query param → 400
  - `store.query(pk, "TIMER#")` to get all timers
  - For each: compute status (running/expired) and remainingSeconds
  - Return 200 with array
- [ ] Implement `card` function:
  - Query all timers for the session
  - Filter: keep running + expired < 5 minutes
  - If none survive → show "Break soon, don't worry!"
  - Running timers → "Break — back at HH:MM (N min left)"
  - Expired timers → "Time's up!"
  - Stack all lines vertically in card HTML

## 3. Write tests

- [ ] Create `features/back-in-ten-minutes/feature.test.ts`
- [ ] Test: POST with valid duration → 201, timer stored
- [ ] Test: POST with missing session → 400
- [ ] Test: POST with duration ≤ 0 → 400
- [ ] Test: POST with non-number duration → 400
- [ ] Test: GET returns running timer with correct status
- [ ] Test: GET returns expired timer with status "expired"
- [ ] Test: Multiple POSTs create multiple timers (concurrent)
- [ ] Test: Card shows "Break soon, don't worry!" with no timers
- [ ] Test: Card shows countdown text for running timer
- [ ] Test: Card shows "Time's up!" for expired timer

## 4. Verify gate passes

- [ ] Run `npm run gate` — must exit 0
- [ ] Fix any TypeScript errors (no enums, no parameter properties)
- [ ] Fix any test failures

## 5. Prepare for PR

- [ ] Squash all commits on the branch into one
- [ ] Commit message: `feat: add back-in-ten-minutes break timer`
- [ ] Push to fork
- [ ] Open PR from `PoorWifi/tabla-ontario:feat/back-in-ten-minutes` → `aws-hacktivity/tabla-ontario:main`
