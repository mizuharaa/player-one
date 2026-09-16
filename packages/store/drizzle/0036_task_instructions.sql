-- Task-specific recording guidance; existing tasks remain explicitly undocumented.
-- This is not a privacy notice or payment policy, and changes no claim/rate rules.
ALTER TABLE tasks ADD COLUMN instructions text NOT NULL DEFAULT '';
