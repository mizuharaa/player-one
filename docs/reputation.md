# Reputation, tiers and badges

Written 2026-08-25. Content design only — no schema, no routes, no code. This
file is the record of what the numbers mean and why they are those numbers.

Everything a collector does that the platform can see, it already sees for
another reason: to decide a payment. A review says whether footage was usable, a
handover says a card came back, an upload batch says the bytes arrived whole, a
device record says the hardware is still working. Those rows exist. Reputation
is a second reading of the same rows — it earns a collector **access**, never
money.

Two hard lines run through the whole design and neither is a matter of taste.

**Reputation never touches the pay formula.** `reviewed effective minutes ×
task unit price` (§6.10) is what it was before any of this existed. There is no
multiplier, no bonus rate, no tier premium. A tier changes *what you can claim,
how much of it at once, how early you see it, and how soon it is looked at* —
nothing about what a reviewed minute is worth. A collector at the bottom tier
and a collector at the top tier are paid identically for identical footage, and
that has to stay true: the moment reputation pays, every argument in
`docs/review.md` about the reviewer's judgement being the only source of the
number stops holding.

**Every input is an event somebody else wrote.** A reviewer's verdict, an
operator's handover, the engine's checksum, a device administrator's fault
record. Nothing here counts a login, a tap, a profile field, a streak of opening
the app, or anything a collector types about themselves. If a number can move
without reviewed footage existing, it is not in this design.

Social-credit linkage is parked. It is not designed here, not stubbed, and not
anticipated in the shapes below.

## The recompute principle

**The score is a function of the event log, not a counter.**

`score(collector, t) = f(all qualifying events with occurred_at <= t)`

Nothing increments. There is no "+5 on review pass" written at verdict time.
The score is recomputed from rows that already exist, and any stored value is a
cache carrying an `as_of` timestamp and the event watermark it was computed
from. Throw the cache away, recompute, and the same number must come back.

That is not architectural fashion. It is the argument the settlement path
already makes: a running total drifts, and when a collector asks why they
dropped a tier the answer has to be a list of events, each of which they can be
shown. A counter cannot answer that question; a recompute can print its own
inputs.

Three consequences, all deliberate:

- **One review contributes once**, keyed by `episode_reviews.id`. The verdict
  route is already idempotent on the client's `verdict_id`, so a retry after a
  lost response returns the first answer and there is no second row to count.
  Reputation inherits that guarantee instead of restating it.
- **Attribution follows the identity spine and has no second path.** An episode
  reaches a collector through `episodes.collection_session_id →
  collection_sessions.collector_id`. A quarantined episode has no session and
  therefore no collector, so it counts for and against nobody until an operator
  attaches it (PLT-05). There is no reputation-only shortcut from footage to a
  person.
- **A correction corrects the score.** If a delivery is superseded, or a dispute
  overturns a verdict when QR-08 lands, the next recompute reflects it. No
  compensating entry, no adjustment row.

## The scale, and where a new collector starts

Score runs **0 to 1000**. A new collector starts at **500** — mid-tier, second
of four — and the window is the **last 90 days**.

Starting at zero would be a lie about what is known: a collector who has
delivered nothing has not delivered anything *bad* either. It would also punish
exactly the population the programme recruits from, members of the public with
no history, and it would make the first review a hundred-point coin flip.

So the cold start has three parts:

1. **500 on qualification.** The moment the exam is passed and claiming is
   allowed (APP-05), the collector is a `Tay máy` with a full second-tier
   allowance.
2. **Quality inputs stay silent until there is evidence.** Pass rate and
   effective ratio contribute nothing until **10 decided reviews** exist in the
   window. Before that only volume and onboarding move the number, and both only
   upward.
3. **Tiers above the second have an evidence gate as well as a score gate.**
   Score alone from a three-episode sample cannot buy access — see the table.

The 90-day window is what makes every penalty temporary. It is also what stops a
collector coasting for a year on one good month, which matters more than it
sounds: the tiers hand out concurrent claims and early access to higher-priced
work, and those should track what someone is doing now.

## The four tiers

| # | Vietnamese | English | 中文 | Score | Evidence gate |
|---|---|---|---|---|---|
| 1 | **Đang kèm cặp** | Supported | 辅导期 | 0–399 | — |
| 2 | **Tay máy** | Collector | 采集者 | 400–639 | exam passed |
| 3 | **Tay máy tin cậy** | Trusted collector | 可信采集者 | 640–819 | ≥ 20 decided reviews |
| 4 | **Tay máy nòng cốt** | Core collector | 核心采集者 | 820–1000 | ≥ 60 decided reviews, ≥ 2 handovers |

`Tay máy` is what a Vietnamese speaker actually calls someone who works a
camera. Tier 1 is named for what it is — a period of extra support — and not
"restricted" or "probation", because the collector reads this string in their own
app and a label that shames is a label people leave over.

**What each tier unlocks. Exactly this and nothing else.**

| | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|---|---|
| Concurrent claims (APP-10) | 1 | 2 | 4 | 6 |
| Task types (SET-08) | general only | general only | + specialised and factory-priced | + partner sites, + privacy-sensitive scenarios |
| Task hall visibility | on publish | on publish | 12 h early window | 24 h early window |
| Review queue band (QR-05) | default | default | priority | top priority |
| Device custody between centre check-ins | 7 days | 7 days | 30 days | 30 days, and eligible for a second bound device (P2 pairing) |

Four notes on that table, each a rule rather than a detail.

**Tier 1 is not slowed down.** The queue default is age-ordered, and tier
priority is a boost above it, never a demotion below it. Making a low tier wait
longer for review would delay the payment for footage that was fine, which is a
pay effect wearing a queue costume. On top of that there is a **starvation
floor**: no episode waits more than 7 days on tier grounds, whoever recorded it.

**Privacy routing outranks tier priority.** An episode flagged for privacy risk
goes to the specialist queue (QR-07, BO-15) and a tier-4 collector's footage does
not jump that lane.

**The early window is real because tasks have capacity.** APP-10 caps concurrent
claimants and a task at capacity is not claimable, so seeing a task twelve hours
early is a genuine unlock rather than a cosmetic one. It is also the only unlock
with a real cost to other collectors, which is why it belongs to the two tiers
that carry an evidence gate.

**Nothing above is a badge unlock.** Badges unlock nothing at all — see the last
section.

Suspension is not part of this ladder. `collectors.status = 'suspended'` is a
human decision about fraud or safety, it overrides every tier, and reputation
neither imposes it nor lifts it.

## The fifteen inputs

Score is `clamp(0, 1000, 500 + Σ points)` over the 90-day window. Nine inputs
add, six subtract. **Every number below is a starting value.** They are tuning
parameters in the same sense the review reason codes are catalogue rows: PaXini
said on 13 Aug that the in-the-wild standard does not exist yet, and a weight set
before the first thousand episodes have been reviewed is a guess with arithmetic
around it. Expect to move them after the pilot; expect the shape to survive.

### Upward

| Key | Event it reads | Starting weight |
|---|---|---|
| `review_pass_rate` | share of decided reviews with verdict `good` | `600 × (rate − 0.85)`, clamp `[−150, +90]`, needs ≥ 10 reviews |
| `effective_minute_ratio` | Σ `effective_duration_s` ÷ Σ `measured_duration_s` over decided reviews | `400 × (ratio − 0.85)`, clamp `[−100, +60]`, needs ≥ 10 reviews |
| `reviewed_hours` | Σ effective minutes from decided reviews | `25 × log₂(1 + hours/10)`, cap `+100` |
| `scenario_variety` | distinct `scenario_id` with at least one passing review | `+8` each, cap `+40` |
| `commitment_adherence` | delivered effective minutes ÷ claimed target, per closed claim, each capped at 1.0 | `120 × (adherence − 0.75)`, clamp `[−60, +60]` |
| `active_week_streak` | consecutive ISO weeks containing ≥ 1 decided review | `+6` per week, cap `+48` |
| `handover_promptness` | share of episodes handed over within 7 days of their PTS epoch | `+40 × share`, cap `+40` |
| `clean_card_rate` | share of handovers whose import raised no integrity defect | `+30 × share`, cap `+30` |
| `training_completion` | exam passed (APP-04) | `+20`, once, not windowed |

The pass-rate anchor is **0.85 on purpose**: it is the programme's own
qualification target (§3.3). A collector performing exactly to target sits at
neutral and stays mid-tier, which is the honest reading of "meeting the
standard".

### Downward

| Key | Event it reads | Starting weight |
|---|---|---|
| `visual_quality_failures` | reviews carrying `VQ-*` reason codes | `−8` each, floor `−80` |
| `task_quality_failures` | reviews carrying `TQ-MISMATCH`, `TQ-MEANINGLESS`, `TQ-REPETITIVE` | `−20` each, floor `−160` |
| `privacy_incident` | review carrying `CO-PRIVACY`, upheld | `−150` each, floor `−300` |
| `device_damage_attributable` | device fault record with cause attributed to handling | `−200` each, floor `−400` |
| `abandoned_commitment` | claim closed with < 25% of its target delivered | `−40` each, floor `−120` |
| `attributable_quarantine` | episode quarantined on `SESSION-CONFLICT` / `SERIAL-CONFLICT` where the operator's resolution reason names the collector's declaration | `−10` each, floor `−60` |

The gap between `−8` for a blurry frame and `−200` for a broken device is the
whole ranking argument. Blurry footage costs the programme one episode. A
destroyed unit costs a device, the ~5,000 CNY deposit conversation that follows,
and the collector's next month of work — so it is the heaviest thing a collector
can do that is still an accident.

Every downward weight has a floor. A single terrible week is bounded; it cannot
put someone somewhere they can never climb out of.

### Sanity check on the arithmetic

Positive caps total `+488`, so the ceiling is about 988 and 1000 is unreachable
by design.

A **diligent** collector — 0.90 pass rate, 0.90 effective ratio, 20 hours, three
scenarios, promises kept, six-week streak, cards in on time and clean — lands
around **740**, comfortably tier 3.

An **excellent and consistent** one — 0.95 across the board, 40 hours, four
scenarios, eight-week streak — lands around **845**, tier 4. Reaching the top
tier takes roughly two to three months of ordinary good work, and no amount of
volume alone gets there: hours are log-scaled and cap at `+100`, which is less
than the quality block. That is the anti-grind-wall guarantee stated as
arithmetic rather than as intent.

One privacy incident takes 740 to 590 — a tier drop, recoverable in 90 days. One
attributed device fault takes 740 to 540, the bottom of tier 2.

## Why each input cannot be farmed

The rule was that nothing may move without producing reviewed footage. Per input,
that argument:

- **`review_pass_rate`** — only a reviewer's verdict raises it. The obvious
  attack is cherry-picking: record only the easiest possible scenario forever.
  That is exactly what `TQ-REPETITIVE` exists to catch, and it is why
  `scenario_variety` is a separate positive input. Claiming less to protect a
  rate does not work either, because the rate needs 10 reviews to count at all
  and volume is scored separately.
- **`effective_minute_ratio`** — the numerator is the sum of spans a reviewer
  marked, computed on the server. A collector never sends a duration. The
  denominator is the engine's measured duration, the intersection of stream
  coverage, and no client writes it.
- **`reviewed_hours`** — every hour here has passed a human. Junk hours are worse
  than no hours: they pay zero and they cost pass-rate points. Log scaling means
  the twentieth hour is worth about a third of the second.
- **`scenario_variety`** — needs a *passing* review in each scenario. Declaring
  five scenarios and recording nothing in four of them earns nothing, and the
  scenario comes from the collection session, which the operator reconstructs at
  the counter in the pilot.
- **`commitment_adherence`** — the per-claim cap at 1.0 is the anti-gaming
  mechanism. Without it, delivering 300% of one small target would mask
  abandoning three others. With it, overdelivery is never a currency.
- **`active_week_streak`** — a week counts only if a *decided review* falls in it.
  Opening the app does not tick it; nor does uploading; nor does claiming.
- **`handover_promptness`** — measured between the PTS epoch, which comes out of
  the media itself, and `handover_time`, which an operator stamps at the counter.
  Neither end is collector-entered. Delaying the recording instead of the
  handover gains nothing, because the clock starts at the footage's own
  timestamps. The threshold is in days rather than hours because D4 is unresolved
  and the basename carries no timezone.
- **`clean_card_rate`** — integrity defects come from the engine's own checksums
  and container reads. `MEDIA-TRUNCATED`, `PART-MISSING-INTERIOR` and
  `CHECKSUM-MISMATCH` are not opinions.
- **`training_completion`** — one-time, `+20`, and a gate anyway. Small on
  purpose: it is a thing you do once, not a thing you do well.
- **`visual_quality_failures` / `task_quality_failures`** — a reviewer selects
  these from a server-side catalogue; there is no free text and no client-chosen
  code.
- **`privacy_incident`** — only an upheld `CO-PRIVACY` on a decided review, that
  is, after the specialist queue has looked. A raw BO-15 flag is a routing
  decision, not a finding, and does not score.
- **`device_damage_attributable`** — three protections, because this is the
  heaviest weight and the one with a deposit behind it. It counts only when a
  device administrator writes a fault record with an explicit attribution;
  firmware and manufacturing faults are excluded by category; and if the **same
  fault code appears on three or more devices within 14 days it is a fleet fault
  and attributes to nobody**. The lens cover PaXini called "easy to lose" is the
  case that rule was written for.
- **`abandoned_commitment`** — the target is copied at claim time, so
  re-publishing a task with a smaller target does not retroactively make an
  abandonment look like delivery.
- **`attributable_quarantine`** — deliberately narrow. Multi-session cards go to
  an operator *by design* and that is not the collector's fault, so only
  `SESSION-CONFLICT` and `SERIAL-CONFLICT` count, and only when the operator's
  mandatory resolution reason names the collector's declaration. The audit row
  already has to carry a reason, so nothing new is being asked of anyone.

**Deliberately not inputs**, each for a reason:

- Agreement acceptance (APP-02). Measured, not farmable, and still wrong to score
  — accepting a document is not work. It stays a gate: a collector with an
  unaccepted current agreement version cannot claim, which is APP-02 and APP-05
  doing their existing job.
- Anything about upload attempts, app opens, session declarations with no
  footage behind them, or profile completeness.
- Reviewer-side metrics. QR-06 measures reviewers; that is a different subject and
  it does not belong to the person being reviewed.

## Both directions, and the way back

Falling is possible and must be, or none of the upward weights mean anything. The
recovery path is stated here so it can be shown in the app rather than explained
by support.

**Everything windowed expires.** A negative event carries full weight for 30
days, then decays linearly to zero at day 90. Nothing in this design is permanent
except the one-time training points and the badges.

**From tier 1 back to tier 2**, two routes, either one sufficient:

1. Wait. The events that dropped you age out, and with no new ones the score
   returns to what the remaining evidence says.
2. Fix it and show it. Complete the retraining module for the reason codes you
   failed on (the material exists — APP-03, APP-06, LOC-03) and deliver **three
   consecutive episodes that pass review**. The retraining is an exam event and
   the three passes are review events; neither is self-reported, and this is the
   route that takes days rather than weeks.

**After an attributed device fault**, the `−200` decays like anything else. The
care block recovers once a replacement device has been bound for 30 days with no
new attributed fault. What happens to the deposit is a commercial decision (open
item O11; the brief's own §11.1 calls the damage policy undecided) — this design
records the fault and does not touch the money.

**After a privacy incident**, the same decay applies to the score, but tier 4's
privacy-sensitive scenario access has its own gate: no upheld `CO-PRIVACY` in the
window, full stop. That access is not something a high score should be able to
outweigh.

**What the collector sees.** Their tier, how far to the next one, and — this is
the part that matters — *which reason codes cost them the most points this
window*, in Vietnamese, from the same catalogue rows the reviewer selected
(QR-04, LOC-04). A score with no attached list of what to do differently is a
grade, and a grade is not actionable. The raw number is back-office; the app
leads with the tier and the reasons.

## What exists today, and what this needs

Honest ledger. Most of these inputs read rows that are already in the schema and
already written by built code paths. Some do not, and saying which is the point
of this section.

| Input | Reads today | Needs |
|---|---|---|
| pass rate, effective ratio, VQ/TQ/privacy failures | `episode_reviews`, `episode_review_reasons` | — |
| reviewed hours | `episode_reviews.effective_duration_s`, `settlements` | — |
| scenario variety | `collection_sessions.scenario_id` | — |
| handover promptness | `handovers.handover_time`, `episode_streams.first_timestamp_us` | — |
| clean card rate | `upload_batches`, `episode_defects` | — |
| attributable quarantine | `episodes.resolution_state`, `episode_defects`, `audit_events.reason` | — |
| week streak | `episode_reviews.decided_at` | — |
| first payment | `settlements.settlement_state` | — |
| training completion | `collectors.status → 'qualified'` stands in for it | a real exam record, with the app (APP-04) |
| commitment adherence, abandoned commitment | nothing | a claim row: claimed at, target copied at claim time, closed at, close reason (APP-10, APP-11, BO-02) |
| device damage | `devices.status` only | a fault record with a cause category, an optional attributed collector, and a fleet-fault marker (BO-04) |

Two shapes, then, that this design assumes and that do not exist: **task claims
with a pledged target**, and **device faults with an attribution**. Both are
named in Part 6 as requirements, so neither is an invention — but neither is
built, and the two inputs that depend on them score zero until they are, which is
the correct behaviour and not a bug to work around.

The cache itself is one row per collector — score, tier, `as_of`, event watermark
— and the badge awards are an append-only table. Nothing else is needed and
nothing else should be added; the whole point of the recompute principle is that
the durable state is the event log that already exists.

## Badges

Twenty-nine of them, across five categories, in three weights (bronze, silver,
gold). Naming is Vietnamese first because collectors read it, English and Chinese
for the back office. No emoji.

**Badges unlock nothing.** They are recognition, not permission — every access
decision in this design belongs to the tier ladder. That is deliberate and it is
also the strongest anti-gaming property in the section: a badge nobody can spend
is a badge nobody has a reason to farm. It also means an award can be permanent
without creating a permanent privilege, so a badge is never taken back. A
recompute can only ever add one.

The thresholds below are attainable by an ordinary diligent collector inside a
pilot season. They are also tuning parameters — every count in the criteria
column is a starting value.

| Category | Weight | Vietnamese | English | 中文 | Criteria |
|---|---|---|---|---|---|
| firsts | bronze | Đậu bài thi đầu vào | Entry exam passed | 通过入门考试 | exam passed (APP-04) |
| firsts | bronze | Lần đầu giao thẻ | First card handed in | 首次交卡 | first `handovers` row |
| firsts | bronze | Đoạn đầu tiên được duyệt | First episode passed | 首个通过审核的片段 | first review with verdict `good` or `partial` |
| firsts | bronze | Khoản tiền đầu tiên | First payment | 首笔结算 | first settlement reaching `bill_generated` |
| quality | bronze | Mười đoạn liên tiếp đạt | Ten in a row | 连续十段合格 | 10 consecutive `good` verdicts |
| quality | silver | Ba mươi đoạn liên tiếp đạt | Thirty in a row | 连续三十段合格 | 30 consecutive `good` verdicts |
| quality | gold | Sáu mươi đoạn liên tiếp đạt | Sixty in a row | 连续六十段合格 | 60 consecutive `good` verdicts |
| quality | silver | Cả tháng hình không lỗi | A month with clean footage | 整月画质无缺陷 | 30 days, ≥ 10 reviews, no `VQ-*` |
| quality | silver | Năm mươi đoạn đúng nhiệm vụ | Fifty on-task episodes | 五十段不跑题 | 50 consecutive reviews with no `TQ-*` |
| quality | gold | Phút nào cũng dùng được | Every minute usable | 每分钟都可用 | effective ÷ measured ≥ 0.95 over ≥ 15 reviews in 30 days |
| quality | bronze | Sửa được ngay lần sau | Fixed it next time | 下一次就改好 | after a failed review, the next 5 all pass |
| volume | bronze | 10 giờ hữu ích | 10 effective hours | 10小时有效时长 | 10 h reviewed effective duration, lifetime |
| volume | silver | 50 giờ hữu ích | 50 effective hours | 50小时有效时长 | 50 h reviewed effective duration, lifetime |
| volume | gold | 150 giờ hữu ích | 150 effective hours | 150小时有效时长 | 150 h reviewed effective duration, lifetime |
| volume | silver | Một buổi quay dài trọn vẹn | A long session, complete | 一整段长时录制 | one episode with ≥ 60 min effective duration |
| volume | silver | Năm bối cảnh khác nhau | Five different scenarios | 五种不同场景 | passing reviews in 5 distinct scenarios |
| consistency | bronze | Bốn tuần không nghỉ | Four weeks running | 连续四周 | 4 consecutive weeks with a passing review |
| consistency | silver | Ba tháng không nghỉ | Three months running | 连续三个月 | 12 consecutive weeks with a passing review |
| consistency | bronze | Giữ lời lần đầu | First promise kept | 首次兑现承诺 | first claim closed at ≥ 90% of target |
| consistency | silver | Hứa bao nhiêu, quay bấy nhiêu | Five promises kept | 承诺多少就交多少 | 5 consecutive claims closed at ≥ 90% |
| consistency | gold | Không bỏ dở việc nào | Nothing left unfinished | 没有半途而废 | 90 days, ≥ 5 claims closed, none abandoned |
| consistency | silver | Quay lại nhịp cũ | Back on track | 重回节奏 | returned from tier 1 to tier 2 or above |
| care | bronze | Ba thẻ sạch | Three clean cards | 三张干净的卡 | 3 consecutive handovers, no integrity defect |
| care | silver | Mười thẻ sạch | Ten clean cards | 十张干净的卡 | 10 consecutive handovers, no integrity defect |
| care | silver | Giao thẻ sớm | Card in early | 及时交卡 | 10 consecutive handovers within 3 days of recording |
| care | silver | Ba tháng máy vẫn tốt | Three months, device fine | 三个月设备完好 | 90 days bound, no attributed fault |
| care | gold | Nửa năm máy còn nguyên | Six months, device intact | 半年设备完好 | 180 days bound, no attributed fault |
| care | silver | Thẻ nào cũng khớp việc | Every card matched its task | 每张卡都对得上任务 | 20 consecutive handovers with no attributable quarantine |
| care | gold | Tôn trọng người xung quanh | Respects everyone in frame | 尊重镜头里的人 | 100 consecutive decided reviews, no `CO-PRIVACY` |

Three of these deserve their reason written down.

**Sửa được ngay lần sau** exists because the rest of the quality block only ever
rewards not failing, and the behaviour actually worth encouraging after a failure
is reading the reason code and changing something. It is bronze, it is easy, and
a collector should be able to earn it the week after their worst week.

**Quay lại nhịp cũ** is the only badge awarded for a tier transition. Recovery
that is invisible does not feel like recovery.

**Hứa bao nhiêu, quay bấy nhiêu** is the phrase a Vietnamese speaker would
actually use for keeping a commitment, and it says the criterion out loud.

## Tuning parameters

Restating it in one place, because it is the thing most likely to be forgotten
when someone reads a weight as a decision:

**Every threshold, weight, cap, floor and window length in this document is a
starting value.** The window (90 days), the anchor (0.85), the tier boundaries
(400 / 640 / 820), the concurrent-claim allowances, the early-window hours, the
badge counts. They are chosen to be defensible on day one, not to be right on day
one hundred.

What is *not* a tuning parameter, and should be argued about before it changes:
the recompute principle, the separation of reputation from pay, the rule that
every input is somebody else's event, the cold start at mid-tier, the existence
of a recovery path for every penalty, the starvation floor on the review queue,
and badges unlocking nothing.
