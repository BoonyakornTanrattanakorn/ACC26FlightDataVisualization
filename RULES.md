# ACC 2026 — Flight Score Calculation Rules

Extracted from *Air Cargo Challenge 2026 Participation Handbook* (v1.1, 25.8.2025), Section 4.
This document covers **only rules that affect the flight score**. Where the change-log (page II)
supersedes body text, the corrected formula is used and noted.

---

## 1. Round Raw Score

For each flight round, the raw team score is:

```
S_round,team,raw = B_takeoff · m_payload · l_distance²  −  Σ_j P_round,j
```

> **Change-log note (Section 4.7.1):** The current-penalty was moved out of the raw-score
> formula. The **corrected** raw score subtracts the sum of penalties `Σ_j P_round,j` instead of
> multiplying by `(1 − P_round,current)`. (The original body text on page 20 still shows the old
> multiplicative form `... · (1 − P_round,current)` — the change-log overrides it.)

Where:
- **`m_payload`** = carried payload mass [kg]. Each can = **0.350 kg** (350 g). (Payload 7)
- **`l_distance`** = ground-projected distance covered during the 120 s distance segment [m],
  logged automatically by GPS. Distance is **squared** → dominant score driver.
- **`B_takeoff`** = take-off bonus factor (below).
- **`P_round,j`** = flight penalty points for the round (see §4).

### Take-off bonus factor `B_takeoff` (Eq. 1)

Depends on the **announced** take-off runway length:

| Announced take-off length | `B_takeoff` |
|---|---|
| 40 m | **1.15** (15 % bonus) |
| 60 m | **1.00** |
| Actual take-off > announced length | **0** (flight score → 0) |

You announce payload mass **and** runway length before each round. Overrunning your announced
runway length (red flag / touching outside the runway) zeroes the flight score.

---

## 2. Normalized Round Score

The raw score is normalized against the best team in that round, then bonuses are added (Eq. 3):

```
S_round,team = ( S_round,team,raw / S_round,best-team-of-round,raw ) · 1000  +  Σ_i B_round,i
```

- Best team in a round gets **1000** from the normalized term.
- **`Σ_i B_round,i`** = sum of round bonuses (loading/unloading + payload prediction).
- **Maximum score for a single flight = 1120 points.**

---

## 3. Round Bonuses (`B_round,i`)

### 3.1 Loading & Unloading Bonus (Eq. 4)

```
B_round,loading = 60 · (1 − (t_loading + t_unloading) / 120s)   if (t_loading + t_unloading) < 120 s
                = 0                                              otherwise
```

- `t_loading`, `t_unloading` in seconds.
- Max **60 points** (instantaneous load+unload). Only awarded if payload is actually loaded.

### 3.2 Payload Prediction Bonus (Eq. 5)

You announce `N_cans,announced` in the technical report. Bonus depends on cans actually carried:

```
B_payload_prediction = 3 · N_cans,announced   if N_cans,carried ≥ N_cans,announced
                     = 2 · N_cans,announced   if N_cans,carried = N_cans,announced − 1
                     = 1 · N_cans,announced   if N_cans,carried = N_cans,announced − 2
                     = 0                       otherwise
```

- Capped at **60 points**.
- Steep drop-off for under-delivering — the multiplier falls while the base stays fixed at the
  *announced* count.

---

## 4. Flight Penalty Points (`P_round,j`) — Section 4.7.4

### 4.1 Current-limit penalty (Eq. 6)

Exceeding **30 A** (measured battery→ESCs, both motors summed):

```
P_round,current = min( 1 , 0.002 · ∫ max(0, I − 30A) dt )
```

> **Change-log note (Section 4.7.6):** corrected to the `min(1, 0.002 · ∫…)` form above,
> capping the penalty at 1. (The change-log crosses out an earlier `2 · ∫…` variant.)
> Body text (page 20) phrases it as "2 penalty per second and ampere over 30 A" — reconcile
> against the capped integral form when implementing.

- Current sampled at **10 Hz**, mean computed every **0.5 s**.
- Penalty is active for the **entire flight round**, including the 3 s of motor time before the
  timer starts.

### 4.2 Conditions that ZERO the flight score

The flight is scored **0 points** if any of the following occur:

| Condition | Source |
|---|---|
| Battery voltage exceeds **12.75 V** at any time | 4.7.4 (2) |
| Current exceeds **70 A** at any time | 4.7.4 (3) |
| Any part is **lost** during the flight (no physical connection to aircraft) | 4.7.4 (4) |
| Hard landing → requested Static Load Test failed or refused | 4.7.4 (4b) |
| Flight Zone violated (outside flight area) | 4.7.4 (5) / 4.6.8 |
| Take-off exceeds announced runway length (`B_takeoff = 0`) | 4.7.1 |
| Loss of the Measuring Equipment Box | Measure 3 |
| Losing parts during landing | 4.6.7 |
| Bouncing off the runway on landing (must not bounce) | 4.6.7 |
| Landing first contact outside the landing area | 4.6.7 |

**Flight-zone / altitude limits** (distance segment): min altitude **10 m** AGL, max altitude
**200 m** AGL. Flying outside the zone → 0 points + additional penalties; 2nd offense →
disqualification. Flying over spectators → disqualification.

---

## 5. Flight Time & Segment Definitions (affect what gets measured)

- **Flight time start** (Eq., §4.6.4) — whichever occurs first:
  - current exceeds **5 A for > 3 s** in the log, and take-off is valid; **or**
  - aircraft reaches **5 km/h GPS speed**, and take-off is valid.
- **Climb:** first **60 s** of flight time. Altitude achieved is **not scored directly**, but banked
  altitude can be traded for distance speed later.
- **Distance segment:** the **120 s** after the 60 s climb. Only distance covered here counts as
  `l_distance`.

---

## 6. Flight Competition Score (per team) — Eq. 7

Combine rounds:

```
S_flight_competition = (S_best_round + S_second_best_round) / 2   if num_rounds ≥ 3
                     =  S_best_round                              otherwise
```

- Max **1120 points**.

---

## 7. Total Competition Score (context) — Eq. 8

Flight score feeds the overall ranking:

```
S_competition = S_flight_competition + S_report + S_drawings + S_presentation − Σ_i P_global,i
```

| Component | Max points |
|---|---|
| Flight competition | 1120 |
| Technical report | 200 |
| Drawings | 50 |
| Presentation | 100 |
| **Total achievable** | **1470** |

### Global penalties (`P_global,i`) — Section 4.7.6

Deducted from the **final competition score** (not the per-round flight score):

| Infraction | Penalty |
|---|---|
| Preliminary report late | 30 pts/day, max 100; DQ after 30 days |
| Poster missing | 50 pts |
| Technical report/drawings late | 30 pts + 30 pts/day; not accepted after 15 days |
| Proof of flight late | 10 pts/day |
| Late/absent at technical inspection (e.g. >60 min setup) | 50 pts |
| Aircraft dimensions differ from drawing package (±2 cm tolerance) | 5 pts per additional cm |
| Corrected drawings incomplete | 30 pts |
| Disregard of aircraft requirements | Disqualification |
| Flying outside the flight area | flight = 0 pts; 2nd offense = DQ |
| Flying over spectator area | Disqualification |
| Disregard of official instructions | 200 pts up to DQ |
| Unjustified protest | 1st: 5 pts; thereafter: 50 pts |
| Endangering any person | penalty up to disqualification |

---

## Quick Reference — Score-Driving Levers

1. **Distance is squared** — the single biggest lever (`l_distance²`).
2. **Payload mass** is linear (0.350 kg/can).
3. **Announce 40 m take-off** for the 1.15× multiplier — but only if you can reliably clear it.
4. **Fast load + unload** (< 120 s combined) for up to 60 bonus pts.
5. **Accurate/conservative payload prediction** for up to 60 bonus pts.
6. **Stay under 30 A** to avoid the current penalty; **never** hit 70 A or 12.75 V (instant zero).
7. Only your **two best rounds** (of ≥3) count, averaged.
