-- 0019: Path A, the route a collector's phone uploads a recorded session by.
--
-- UPL-01 (Path A end to end) and APP-26 (a large upload survives failure and
-- resumes). Until now the only route bytes could take was Path C: a TF card
-- carried to an upload centre, imported by an operator, transported to the
-- cloud by the centre's own machine. A phone has no counter, no operator and
-- no machine token, so none of that scopes it.
--
-- What this migration adds is the record of one delivery by one collector:
-- `collector_uploads`. It is the Path A answer to UPL-07, which asks that an
-- episode trace to the parties that handled it. Path C traces through
-- `upload_batches` to a handover, and from there to a centre, a machine, an
-- operator, a collector and a device. Path A has none of those hops — the
-- phone is the whole chain — so the row carries the three that exist: the
-- collector who sent it, the session it was recorded under, and the device
-- that recorded it.
--
-- Nothing here deletes anything, and no column in it can be read as permission
-- to. Rule 6 of PaXini's PRD §11.3.1 stands on Path A exactly as it does on
-- Path C: source media is never removed by any code path, and a collector's
-- phone is source media until somebody outside this system says otherwise.

-- ---------------------------------------------------------------------------
-- The target of `collector_uploads_session_fk`.
--
-- "This session is not yours" has to be unrepresentable and not merely
-- refused by a route, so the upload names (session, collector) as a pair and
-- the pair has to exist on `collection_sessions`. `id` is already the primary
-- key, so this unique adds no new restriction on that table — it only gives
-- the composite key something to point at.
ALTER TABLE collection_sessions
  ADD CONSTRAINT collection_sessions_owner_key UNIQUE (id, collector_id);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A fourth way an episode can acquire its session.
--
-- The three that existed are the resolver's: `automatic_single` and
-- `automatic_time_window` are a machine's proposal from a card's contents,
-- `manual` is an operator overruling it at a counter with a written reason.
-- Path A is none of them. The collector's app bound the session before
-- recording (APP-16) and then pulled that session's own files off the device,
-- so the attribution is a declaration made before the fact by the person who
-- made the recording — stronger evidence than a time window and a different
-- kind of evidence from an operator's override.
--
-- Recording it as `manual` would have made the two indistinguishable in the
-- one query anybody asks of this column: "why is this episode on this
-- session?". So it gets its own value.
ALTER TABLE episodes
  DROP CONSTRAINT episodes_resolution_method_check;--> statement-breakpoint
ALTER TABLE episodes
  ADD CONSTRAINT episodes_resolution_method_check CHECK (
    resolution_method IS NULL
    OR resolution_method IN ('automatic_single', 'automatic_time_window', 'manual', 'app_declared')
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A third kind of actor in the audit trail.
--
-- PLT-07 and PLT-08 want every mutation attributed, and `mutate` is the only
-- write path in the API, so a route a collector calls has to be able to write
-- an attributed row. A collector is not an `operators` row and must not become
-- one: `operator_id` carries a foreign key into a table of people who sign in
-- to VNG systems, and putting collectors in it would make "did a member of
-- staff touch this episode" unanswerable.
--
-- So the same shape the reviewer got in 0002: a role, a column of its own, and
-- an attribution CHECK that lists complete shapes rather than loose minimums.
-- A collector has no upload device, no upload centre and no operator row, and
-- an audit row claiming otherwise is evidence of something that did not happen.
ALTER TABLE audit_events
  ADD COLUMN collector_id uuid REFERENCES collectors(id);--> statement-breakpoint
CREATE INDEX audit_events_collector_idx ON audit_events (collector_id, occurred_at DESC);--> statement-breakpoint

ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_actor_role_check;--> statement-breakpoint
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_actor_role_check
    CHECK (actor_role IN ('operator', 'reviewer', 'collector'));--> statement-breakpoint

ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_attributed_check;--> statement-breakpoint
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_attributed_check CHECK (
    action LIKE '%.login'
    -- `feat/rate-limiting` migration 0017 adds this exemption for a refused
    -- sign-in, which has no actor at all. That migration rewrites the same
    -- constraint and runs before this one, so the clause is carried here
    -- rather than dropped by a later rewrite. It matches nothing until that
    -- branch lands, and costs nothing if it never does.
    OR action LIKE '%.login_failed'
    OR (actor_role = 'reviewer'
        AND operator_id IS NOT NULL
        AND collector_id IS NULL
        AND upload_device_id IS NULL
        AND upload_centre_id IS NULL)
    OR (actor_role = 'operator'
        AND operator_id IS NOT NULL
        AND collector_id IS NULL
        AND upload_device_id IS NOT NULL
        AND upload_centre_id IS NOT NULL)
    OR (actor_role = 'collector'
        AND collector_id IS NOT NULL
        AND operator_id IS NULL
        AND upload_device_id IS NULL
        AND upload_centre_id IS NULL)
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- One delivery, by one collector, of one session.
CREATE TABLE collector_uploads (
  -- Client-generated, like every other mutation a disconnected client makes
  -- (counter.ts says why): the phone queues the registration, the link drops,
  -- the queue replays, and the same delivery has to land once. The primary key
  -- is what makes that true.
  id uuid PRIMARY KEY,
  collector_id uuid NOT NULL REFERENCES collectors(id),
  collection_session_id uuid NOT NULL,

  -- The device that made the recording. `device_serial` is what the session
  -- directory's own basename spells, recorded as observed; `device_id` is the
  -- platform row that serial resolves to, when the fleet has one. The same
  -- split, for the same reason, as `episodes.device_serial`: the serial is
  -- evidence and the id is identity, and a device row created later must not
  -- retroactively change what an upload said at the time (§4.3).
  device_serial text NOT NULL,
  device_id uuid REFERENCES devices(id),

  -- The delivery these bytes are. Null while the upload is only registered and
  -- the episode has not been written yet is NOT a state this table allows —
  -- the episode row is written in the same transaction as this one, because
  -- the object keys are derived from the episode and the ingest and there is
  -- nothing to plan without them.
  episode_id uuid NOT NULL REFERENCES episodes(episode_id),
  ingest_id uuid NOT NULL REFERENCES episode_ingests(ingest_id),
  source_basename text NOT NULL,

  -- What the phone said it would send: how many files and how many bytes.
  -- Declared, not measured — the server never sees the phone's disk. It is
  -- what the payload ceiling is checked against and what an operator compares
  -- against the objects that actually arrived.
  file_count integer NOT NULL,
  total_bytes bigint NOT NULL,

  -- The files of the delivery that are NOT in `episode_files`.
  --
  -- `episode_files` holds exactly the set the content fingerprint covers, and
  -- the manifest is deliberately not in it (ING-02). That is right for
  -- identity and wrong for transport, for the reason `transportInventory`
  -- gives: the manifest is the advisory evidence a payment dispute reads, and
  -- a cloud copy that cannot reproduce the delivered directory is not a copy
  -- of the delivery. Path C recomputes this set by scanning the centre's disk.
  -- Path A has no disk to scan, so the phone declares it and it is stored.
  extra_files jsonb NOT NULL DEFAULT '[]'::jsonb,

  state text NOT NULL DEFAULT 'registered',
  client_version text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  -- The session has to be this collector's. A foreign key on the session alone
  -- would accept anybody's; the composite one cannot.
  CONSTRAINT collector_uploads_session_fk
    FOREIGN KEY (collection_session_id, collector_id)
    REFERENCES collection_sessions (id, collector_id),
  -- The delivery has to be one of that episode's own.
  CONSTRAINT collector_uploads_delivery_fk
    FOREIGN KEY (episode_id, ingest_id)
    REFERENCES episode_ingests (episode_id, ingest_id),
  CONSTRAINT collector_uploads_state_check
    CHECK (state IN ('registered', 'verified', 'failed')),
  -- A finished upload knows when it finished, and an unfinished one does not
  -- pretend to. Both or neither, in the shape `collectors_exam_decided_check`
  -- already uses.
  CONSTRAINT collector_uploads_completed_check
    CHECK ((state = 'registered') = (completed_at IS NULL)),
  -- `>= 0` and not `> 0`. Sample session 072415 is a real recorded session
  -- with no media in it at all, and ING-17 says nothing is discarded: an empty
  -- delivery still stores, still resolves to its session, and still gets an
  -- upload row saying a phone offered it. Its measured duration is zero, so
  -- the review queue never serves it and nobody is paid for it.
  CONSTRAINT collector_uploads_counts_check
    CHECK (file_count >= 0 AND total_bytes >= 0)
);--> statement-breakpoint
CREATE INDEX collector_uploads_collector_idx ON collector_uploads (collector_id, registered_at DESC);--> statement-breakpoint
CREATE INDEX collector_uploads_session_idx ON collector_uploads (collection_session_id);--> statement-breakpoint
CREATE INDEX collector_uploads_episode_idx ON collector_uploads (episode_id);--> statement-breakpoint

-- One verified upload per delivery, and no second one.
--
-- A partial unique index rather than a plain one: a delivery may be attempted
-- more than once and each attempt is a row, but two rows both saying "these
-- bytes are up and checked" is the state that would let one recording be
-- delivered twice and read as two. `registered` and `failed` rows are
-- deliberately unconstrained — that is the retry history.
CREATE UNIQUE INDEX collector_uploads_verified_key
  ON collector_uploads (episode_id, ingest_id)
  WHERE state = 'verified';
