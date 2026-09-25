-- Mandatory originality admission. No legacy exemption and no RISK_HOLD switch.
ALTER TABLE operators ADD COLUMN collector_id uuid REFERENCES collectors(id);
ALTER TABLE operators ADD COLUMN collector_identity_verified boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE FUNCTION originality_lock() RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'originality_isolation: READ COMMITTED required'
      USING ERRCODE = '25001', CONSTRAINT = 'originality_isolation';
  END IF;
  -- ponytail: one short global admission lock for the pilot; shard by ingest
  -- with sorted multi-ingest locks if measured admission throughput needs it.
  PERFORM pg_advisory_xact_lock(hashtext('originality_gate'));
END $$;
--> statement-breakpoint
CREATE FUNCTION originality_operator_identity_audited() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.collector_identity_verified AND NEW.collector_id IS NULL THEN RETURN NULL; END IF;
  ELSIF NEW.collector_id IS NOT DISTINCT FROM OLD.collector_id AND NEW.collector_identity_verified = OLD.collector_identity_verified THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_events a JOIN operators o ON o.id=a.operator_id
    WHERE age(a.xmin)=0 AND a.action='originality.identity_attest' AND a.target_table='operators'
      AND a.target_id=NEW.id::text AND a.operator_id<>NEW.id AND o.role='administrator' AND o.status='active'
      AND length(trim(a.reason))>=10 AND (a.after->>'collector_id') IS NOT DISTINCT FROM NEW.collector_id::text
      AND (a.after->>'collector_identity_verified')::boolean=NEW.collector_identity_verified) THEN
    RAISE EXCEPTION 'originality_identity_attestation_required' USING ERRCODE='23514', CONSTRAINT='originality_identity_attestation_required';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER originality_operator_identity_audited AFTER INSERT OR UPDATE ON operators
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION originality_operator_identity_audited();
--> statement-breakpoint
CREATE FUNCTION originality_operator_identity_lock() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF NEW.collector_id IS DISTINCT FROM OLD.collector_id OR NEW.collector_identity_verified <> OLD.collector_identity_verified THEN
    PERFORM originality_lock();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER originality_operator_identity_lock BEFORE UPDATE ON operators
  FOR EACH ROW EXECUTE FUNCTION originality_operator_identity_lock();
--> statement-breakpoint
CREATE FUNCTION originality_inventory(p_ingest uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('fingerprint', i.content_fingerprint,
    'duration', i.measured_duration_s::text, 'source', i.source_basename,
    'record', i.record_json, 'extras', i.transport_extra_files,
    'uploads', coalesce((SELECT jsonb_agg(source ORDER BY source) FROM (
      SELECT DISTINCT jsonb_build_object('measured', u.measured, 'files',
        (SELECT jsonb_agg(f ORDER BY f->>'relative_path', f->>'bytes', f->>'sha256') FROM jsonb_array_elements(coalesce(u.declared_files, '[]'::jsonb)) f)) AS source
      FROM collector_uploads u WHERE u.ingest_id = i.ingest_id) declarations), '[]'::jsonb),
    'files', coalesce((SELECT jsonb_agg(jsonb_build_array(f.relative_path, f.size_bytes::text, f.sha256)
      ORDER BY f.relative_path COLLATE "C") FROM episode_files f WHERE f.ingest_id = i.ingest_id), '[]'::jsonb))
  FROM episode_ingests i WHERE i.ingest_id = p_ingest
$$;
--> statement-breakpoint
CREATE TABLE originality_assessments (
  id uuid PRIMARY KEY,
  seq bigserial UNIQUE NOT NULL,
  ingest_id uuid NOT NULL REFERENCES episode_ingests(ingest_id),
  inventory jsonb NOT NULL,
  policy_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('complete', 'unavailable', 'failed')),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  assessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX originality_assessments_ingest_idx ON originality_assessments(ingest_id, seq DESC);
--> statement-breakpoint
CREATE TABLE originality_decisions (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL UNIQUE REFERENCES originality_assessments(id),
  decision text NOT NULL CHECK (decision IN ('cleared', 'reused', 'accepted_unassessable')),
  operator_id uuid NOT NULL REFERENCES operators(id),
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  decided_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION originality_file_key(p_ingest uuid, p_path text, p_sha text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT c.object_key FROM cloud_verifications c JOIN episode_ingests i USING (ingest_id)
  WHERE c.ingest_id = p_ingest AND c.sha256 = p_sha AND (
    c.object_key = 'episodes/' || i.episode_id::text || '/' || i.ingest_id::text || '/' || p_path
    OR EXISTS (SELECT 1 FROM collector_uploads u WHERE u.ingest_id = p_ingest AND NOT u.measured
      AND u.episode_id = i.episode_id AND u.state IN ('verified', 'ingested')
      AND c.object_key = 'episodes/' || i.episode_id::text || '/' || u.id::text || '/' || p_path))
  ORDER BY c.object_key LIMIT 1
$$;
--> statement-breakpoint
CREATE FUNCTION originality_media_verified(p_ingest uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM episode_files WHERE ingest_id = p_ingest)
     AND NOT EXISTS (SELECT 1 FROM collector_uploads WHERE ingest_id = p_ingest AND measured)
     AND (EXISTS (SELECT 1 FROM episode_ingests WHERE ingest_id = p_ingest AND transport_extra_files IS NOT NULL)
       OR EXISTS (SELECT 1 FROM collector_uploads WHERE ingest_id = p_ingest AND NOT measured AND state IN ('verified', 'ingested')))
     AND NOT EXISTS (
       SELECT 1 FROM episode_files f WHERE f.ingest_id = p_ingest
       AND originality_file_key(p_ingest, f.relative_path, f.sha256) IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM episode_ingests i, jsonb_array_elements(coalesce(i.transport_extra_files, '[]'::jsonb)) f
       WHERE i.ingest_id = p_ingest AND originality_file_key(p_ingest, f->>'relative_path', f->>'sha256') IS NULL)
     AND NOT EXISTS (
       SELECT 1 FROM collector_uploads u, jsonb_array_elements(coalesce(u.declared_files, '[]'::jsonb)) f
       WHERE u.ingest_id = p_ingest AND NOT u.measured
       AND originality_file_key(p_ingest, f->>'relative_path', f->>'sha256') IS NULL)
$$;
--> statement-breakpoint
CREATE FUNCTION originality_operator_independent(p_operator uuid, p_ingest uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM operators o WHERE o.id=p_operator AND o.collector_identity_verified
    AND NOT EXISTS (SELECT 1 FROM episode_ingests i JOIN episodes e USING(episode_id)
      JOIN collection_sessions c ON c.id=e.collection_session_id
      WHERE i.ingest_id=p_ingest AND c.collector_id=o.collector_id)
    AND NOT EXISTS (SELECT 1 FROM episode_reviews r JOIN settlements s ON s.episode_review_id=r.id
      JOIN task_claims c ON c.id=s.task_claim_id WHERE r.ingest_id=p_ingest AND c.collector_id=o.collector_id)
    AND NOT EXISTS (SELECT 1 FROM episode_reviews r JOIN settlements s ON s.episode_review_id=r.id
      JOIN bill_lines l ON l.settlement_id=s.id JOIN bills b ON b.id=l.bill_id
      WHERE r.ingest_id=p_ingest AND b.collector_id=o.collector_id))
$$;
--> statement-breakpoint
CREATE FUNCTION originality_ingest_payable(p_ingest uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((
    SELECT a.policy_version = 'segment-v1'
      AND a.inventory = originality_inventory(p_ingest)
      AND originality_media_verified(p_ingest)
      AND EXISTS (SELECT 1 FROM originality_decisions d
        WHERE d.assessment_id = a.id AND originality_operator_independent(d.operator_id, p_ingest)
        AND
        ((d.decision = 'cleared' AND a.status = 'complete') OR
         (d.decision = 'accepted_unassessable' AND a.status IN ('failed', 'unavailable')
          AND a.evidence->>'media_verified' = 'true'
          AND a.evidence->>'reason' IN ('insufficient_samples', 'low_information', 'budget_exceeded'))))
      AND NOT EXISTS (SELECT 1 FROM originality_decisions d JOIN originality_assessments x ON x.id = d.assessment_id
                      WHERE x.ingest_id = p_ingest AND d.decision = 'reused')
    FROM originality_assessments a WHERE a.ingest_id = p_ingest ORDER BY a.seq DESC LIMIT 1
  ), false)
$$;
--> statement-breakpoint
CREATE FUNCTION bill_originality_blocker(p_bill uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM bill_lines l JOIN settlements s ON s.id = l.settlement_id
    JOIN episode_reviews r ON r.id = s.episode_review_id
    WHERE l.bill_id = p_bill AND s.amount > 0 AND NOT originality_ingest_payable(r.ingest_id)
  ) THEN 'payout_originality_pending'::text ELSE NULL::text END
$$;
--> statement-breakpoint
CREATE FUNCTION originality_assessments_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'originality_append_only' USING ERRCODE = '23514', CONSTRAINT = 'originality_append_only';
  END IF;
  PERFORM originality_lock();
  IF NEW.inventory IS DISTINCT FROM originality_inventory(NEW.ingest_id) THEN
    RAISE EXCEPTION 'originality_inventory_changed' USING ERRCODE = '23514', CONSTRAINT = 'originality_inventory_changed';
  END IF;
  IF NEW.status = 'complete' AND (NEW.policy_version <> 'segment-v1' OR NOT originality_media_verified(NEW.ingest_id)) THEN
    RAISE EXCEPTION 'originality_media_unverified' USING ERRCODE = '23514', CONSTRAINT = 'originality_media_unverified';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER originality_assessments_guard BEFORE INSERT OR UPDATE OR DELETE ON originality_assessments
  FOR EACH ROW EXECUTE FUNCTION originality_assessments_guard();
--> statement-breakpoint
CREATE FUNCTION originality_decisions_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE assessment originality_assessments;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'originality_append_only' USING ERRCODE = '23514', CONSTRAINT = 'originality_append_only';
  END IF;
  PERFORM originality_lock();
  SELECT * INTO assessment FROM originality_assessments WHERE id = NEW.assessment_id;
  IF assessment.id IS NULL
     OR (NEW.decision = 'cleared' AND assessment.status <> 'complete')
     OR (NEW.decision = 'reused' AND assessment.status <> 'complete' AND NOT (
       coalesce(assessment.evidence->>'media_verified', 'false') = 'true'
       AND jsonb_array_length(CASE WHEN jsonb_typeof(assessment.evidence->'matching_ingests') = 'array'
         THEN assessment.evidence->'matching_ingests' ELSE '[]'::jsonb END) > 0
       AND EXISTS (SELECT 1 FROM operators WHERE id=NEW.operator_id AND role='administrator')))
     OR (NEW.decision = 'accepted_unassessable' AND NOT (assessment.status IN ('failed', 'unavailable')
          AND coalesce(assessment.evidence->>'media_verified', 'false') = 'true'
          AND coalesce(assessment.evidence->>'reason', '') IN ('insufficient_samples', 'low_information', 'budget_exceeded')))
     OR assessment.policy_version <> 'segment-v1'
     OR assessment.inventory IS DISTINCT FROM originality_inventory(assessment.ingest_id)
     OR NOT originality_media_verified(assessment.ingest_id)
     OR EXISTS (SELECT 1 FROM originality_assessments WHERE ingest_id = assessment.ingest_id AND seq > assessment.seq) THEN
    RAISE EXCEPTION 'originality_assessment_not_current' USING ERRCODE = '23514', CONSTRAINT = 'originality_assessment_not_current';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM operators WHERE id = NEW.operator_id AND status = 'active' AND role IN ('finance', 'administrator'))
     OR (NEW.decision = 'accepted_unassessable' AND NOT EXISTS (SELECT 1 FROM operators WHERE id = NEW.operator_id AND role = 'administrator'))
     OR EXISTS (SELECT 1 FROM episode_reviews WHERE ingest_id = assessment.ingest_id AND reviewer_ref = NEW.operator_id) THEN
    RAISE EXCEPTION 'originality_reviewer_forbidden' USING ERRCODE = '23514', CONSTRAINT = 'originality_reviewer_forbidden';
  END IF;
  IF NOT originality_operator_independent(NEW.operator_id, assessment.ingest_id) THEN
    RAISE EXCEPTION 'originality_identity_unverified_or_self' USING ERRCODE='23514', CONSTRAINT='originality_identity_unverified_or_self';
  END IF;
  IF NEW.decision IN ('cleared', 'accepted_unassessable') AND EXISTS (
    SELECT 1 FROM originality_decisions d JOIN originality_assessments a ON a.id = d.assessment_id
    WHERE a.ingest_id = assessment.ingest_id AND d.decision = 'reused') THEN
    RAISE EXCEPTION 'originality_reuse_confirmed' USING ERRCODE = '23514', CONSTRAINT = 'originality_reuse_confirmed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER originality_decisions_guard BEFORE INSERT OR UPDATE OR DELETE ON originality_decisions
  FOR EACH ROW EXECUTE FUNCTION originality_decisions_guard();
--> statement-breakpoint
CREATE FUNCTION originality_decision_audited() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM audit_events a WHERE age(a.xmin) = 0
    AND a.action = 'originality.decide' AND a.target_table = 'originality_decisions'
    AND a.target_id = NEW.id::text AND a.operator_id = NEW.operator_id AND a.reason = NEW.reason) THEN
    RAISE EXCEPTION 'originality_decision_unaudited' USING ERRCODE = '23514', CONSTRAINT = 'originality_decision_unaudited';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER originality_decision_audited AFTER INSERT ON originality_decisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION originality_decision_audited();
--> statement-breakpoint
-- Source inventory changes serialize with admission; old immutable assessment
-- snapshots then fail equality. This permits recovery of missing transport extras.
CREATE FUNCTION originality_inventory_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM originality_lock();
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER originality_inventory_guard BEFORE INSERT OR UPDATE OR DELETE ON episode_files
  FOR EACH ROW EXECUTE FUNCTION originality_inventory_guard();
CREATE TRIGGER originality_inventory_guard BEFORE UPDATE OR DELETE ON episode_ingests
  FOR EACH ROW EXECUTE FUNCTION originality_inventory_guard();
CREATE TRIGGER originality_inventory_guard BEFORE INSERT OR UPDATE OR DELETE ON collector_uploads
  FOR EACH ROW EXECUTE FUNCTION originality_inventory_guard();
--> statement-breakpoint
CREATE FUNCTION originality_receipt_lock() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM originality_lock();
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER originality_receipt_lock BEFORE INSERT OR UPDATE OR DELETE ON cloud_verifications
  FOR EACH ROW EXECUTE FUNCTION originality_receipt_lock();
--> statement-breakpoint
CREATE FUNCTION payout_originality_admit() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE blocker text;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'created' AND NEW.status = 'submitted') THEN RETURN NEW; END IF;
  -- Match 0038 even when its optional risk switch is off.
  PERFORM pg_advisory_xact_lock(hashtext('risk_holds:' || NEW.bill_id::text));
  PERFORM originality_lock();
  blocker := bill_originality_blocker(NEW.bill_id);
  IF blocker IS NOT NULL THEN
    RAISE EXCEPTION 'payout_originality_pending: bill % needs originality review', NEW.bill_id
      USING ERRCODE = '23514', CONSTRAINT = 'payout_originality_pending';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_attempts_admission_originality BEFORE INSERT OR UPDATE ON payout_attempts
  FOR EACH ROW EXECUTE FUNCTION payout_originality_admit();
--> statement-breakpoint
CREATE FUNCTION payout_export_originality_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM originality_lock();
  IF NOT EXISTS (SELECT 1 FROM payout_attempts WHERE bill_id = NEW.bill_id AND status = 'succeeded')
     AND EXISTS (SELECT 1 FROM bill_lines l JOIN settlements s ON s.id = l.settlement_id
                 WHERE l.bill_id = NEW.bill_id AND s.settlement_state <> 'manually_paid')
     AND bill_originality_blocker(NEW.bill_id) IS NOT NULL THEN
    RAISE EXCEPTION 'payout_originality_pending' USING ERRCODE = '23514', CONSTRAINT = 'payout_originality_pending';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payout_export_originality_guard BEFORE INSERT ON payout_export_rows
  FOR EACH ROW EXECUTE FUNCTION payout_export_originality_guard();
--> statement-breakpoint
CREATE FUNCTION settlement_originality_paid_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE bill uuid;
BEGIN
  -- Other predecessors are already refused by settlements_transition_guard.
  IF NEW.settlement_state <> 'manually_paid' OR OLD.settlement_state <> 'bill_generated' THEN RETURN NEW; END IF;
  SELECT bill_id INTO bill FROM bill_lines WHERE settlement_id = NEW.id;
  -- Already admitted transfers still reconcile after evidence changes.
  IF EXISTS (SELECT 1 FROM payout_attempts WHERE bill_id = bill AND status IN ('submitted', 'processing', 'pending_zlp', 'unknown', 'succeeded')) THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('risk_holds:' || bill::text));
  PERFORM originality_lock();
  IF bill_originality_blocker(bill) IS NOT NULL THEN
    RAISE EXCEPTION 'payout_originality_pending' USING ERRCODE = '23514', CONSTRAINT = 'payout_originality_pending';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlement_originality_paid_guard BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlement_originality_paid_guard();
--> statement-breakpoint
CREATE FUNCTION settlements_episode_already_payable() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE episode uuid; disputed_review uuid;
BEGIN
  IF NEW.amount <= 0 OR NEW.superseded_by IS NOT NULL THEN RETURN NEW; END IF;
  -- The existing review uniqueness constraint already rejects this retry.
  IF EXISTS (SELECT 1 FROM settlements WHERE episode_review_id=NEW.episode_review_id) THEN RETURN NEW; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'originality_isolation: READ COMMITTED required'
      USING ERRCODE='25001', CONSTRAINT='originality_isolation';
  END IF;
  SELECT r.episode_id, d.review_id INTO episode, disputed_review
    FROM episode_reviews r LEFT JOIN review_disputes d ON d.id = r.dispute_id AND d.resolved_at IS NULL
    WHERE r.id = NEW.episode_review_id;
  PERFORM pg_advisory_xact_lock(hashtext('episode_pay:' || episode::text));
  IF EXISTS (SELECT 1 FROM settlements s JOIN episode_reviews r ON r.id = s.episode_review_id
    WHERE r.episode_id = episode AND s.amount > 0 AND s.superseded_by IS NULL
      AND (disputed_review IS NULL OR r.id <> disputed_review)) THEN
    RAISE EXCEPTION 'settlements_episode_already_payable' USING ERRCODE = '23514', CONSTRAINT = 'settlements_episode_already_payable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER settlements_episode_already_payable BEFORE INSERT ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlements_episode_already_payable();
--> statement-breakpoint
-- A dispute may insert its replacement first, but must actually supersede the
-- original by commit. Naming an open dispute alone cannot mint another payment.
CREATE FUNCTION settlements_episode_one_payable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode uuid;
BEGIN
  IF NEW.amount <= 0 OR NEW.superseded_by IS NOT NULL THEN RETURN NULL; END IF;
  SELECT episode_id INTO episode FROM episode_reviews WHERE id = NEW.episode_review_id;
  IF (SELECT count(*) FROM settlements s JOIN episode_reviews r ON r.id = s.episode_review_id
      WHERE r.episode_id = episode AND s.amount > 0 AND s.superseded_by IS NULL) > 1 THEN
    RAISE EXCEPTION 'settlements_episode_already_payable' USING ERRCODE = '23514', CONSTRAINT = 'settlements_episode_already_payable';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER settlements_episode_one_payable AFTER INSERT ON settlements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION settlements_episode_one_payable();
--> statement-breakpoint
GRANT SELECT, INSERT ON originality_assessments TO playerone_risk;
GRANT SELECT, INSERT ON originality_assessments, originality_decisions TO playerone_app;
GRANT USAGE ON SEQUENCE originality_assessments_seq_seq TO playerone_risk, playerone_app;
REVOKE UPDATE, DELETE, TRUNCATE ON originality_assessments, originality_decisions FROM playerone_app, playerone_risk;
