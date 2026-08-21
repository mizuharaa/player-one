# Episode identity

**An `episode_id` is derived from the session's *name*, never from its *contents*.** The
input is the basename of the session directory and nothing else — never the absolute path,
never the parent, never a mount point. It is parsed as `{device}_{SERIAL}_{YYYYMMDD}_{HHMMSS}`,
canonicalised with the serial uppercased, and built into a versioned identity string
`playerone:episode:v1:{SERIAL}:{YYYYMMDD}T{HHMMSS}`. The first sixteen bytes of its SHA-256
become a UUID with the version nibble set to `8` and the RFC 9562 variant bits applied. So
`/media/tf/ego_AZER76400FE_20260813_072310` and `/tmp/dl/ego_AZER76400FE_20260813_072310`
resolve to one episode: a card handed in at the upload centre and a cloud re-download of the
same session are one payment, not two. A basename that does not parse is never rejected —
nothing is ever discarded (ING-17) — it falls back to `playerone:episode:v1:raw:{basename}`,
derives identically, and carries `EPISODE-ID-FALLBACK` at `flag` severity so a human can fix
the name later. v8 is used rather than v7 because v7 is time-ordered and partly random: a
re-run would mint a different id and break both ING-32 (same identity on a re-run) and ING-N2
(byte-identical output). The derivation lives in `packages/ingest/src/identity.ts`, which is
pure — no I/O, no path handling — so it can be audited by reading it.

**Why not derive the id from the content fingerprint.** v0.3.1 did exactly that, and it was
wrong. If the id is a function of the bytes, then a file changing between two deliveries
changes the id, and the second delivery lands as a brand new episode row rather than as an
alert against the first. `CHECKSUM-MISMATCH` — the one code in the catalogue that could not be
implemented before there was a store — exists precisely to catch a file whose bytes changed in
transit, and a content-derived id would make that fault invisible at exactly the moment it
mattered. Identity has to be the thing that stays still so that the bytes can be observed
moving against it. For the same reason the manifest cannot touch the id: ING-02 makes it a
hint that decides nothing, and a device rewriting its own metadata must not be able to rename
an episode. Where the basename, the manifest and the session filenames disagree on the serial,
the basename wins and `SERIAL-CONFLICT` is attached at `flag` severity. (The calibration YAML's
own `serial_number` is deliberately *not* part of that comparison: per ING-24 it is the
calibration rig's serial and legitimately differs — 072310 reads `CH5LB5400J5` against a device
`AZER76400FE`. Comparing them would fire on every healthy session.)

**The `content_fingerprint` is a column, never a key.** Every source file is collected as
`(relative_path, sha256_hex)` relative to the session root, sorted by path in byte order
(case-sensitive, never `localeCompare` — identity must not depend on where the upload centre
is), joined as `{relative_path}\n{sha256_hex}\n` per entry, and hashed. It covers source file
bytes only: no engine version, no hostname, no run timestamp, no measured output. If the
engine version leaked in, a version bump would fork every episode and every re-ingest would
report a spurious mismatch. The manifest is the one deliberate exclusion — the same ING-02
argument as above, and it is what keeps the existing B5 guarantee true (corrupting the
manifest's `files` block changes nothing in the output, `content_fingerprint` included). The
set that is fingerprinted is exactly the set written to `episode_files`, so the fingerprint
recomputes from the stored rows alone and a payment dispute can be checked against the store
rather than against the card. An **empty session** — 072415 has no files at all — fingerprints
as the SHA-256 of the empty string, `e3b0c442…b855`. That is a real value and not a sentinel;
identity still comes from the basename, so the session stores fine, quarantined and kept.
