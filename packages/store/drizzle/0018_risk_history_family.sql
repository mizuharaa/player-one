-- 0018: one more family in the risk catalogue, HIST.
--
-- Every family the catalogue had judges ONE subject at ONE moment: this
-- payout account, this episode's picture, this operator's share of these
-- bills. Nothing judged a collector across their own past, which is the fact
-- that separates one bad recording from a person who keeps producing them.
--
-- HIST holds those signals. They are collector-subject signals like the VOL
-- family, they score into the same sum, and they roll up into a bill through
-- the same path; nothing about the engine changes because they exist. The
-- family is separate only so a retune of "what does history weigh" is one
-- filter in the console and one line in a report.
--
-- The check is dropped and rewritten rather than edited because a CHECK cannot
-- be altered in place. No row moves: every existing row names a family that is
-- still in the list.

ALTER TABLE "risk_signals" DROP CONSTRAINT "risk_signals_family_check";--> statement-breakpoint
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_family_check"
  CHECK ("family" IN ('IDENT', 'VOL', 'CONT', 'PROV', 'OPS', 'HIST', 'BAND', 'META'));
