-- 0021's owner default privileges also grant table-wide UPDATE on new tables.
-- Remove that inherited table grant before preserving only demo-review edits.
REVOKE UPDATE ON showcase_footage FROM playerone_app;
GRANT UPDATE (verdict, note, reviewed_at) ON showcase_footage TO playerone_app;
