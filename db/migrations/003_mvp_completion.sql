ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

ALTER TABLE tracking_accounts
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz;

ALTER TABLE supplier_bills
  ADD COLUMN IF NOT EXISTS attachment_name text;

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{"inApp":true,"email":true,"hideSensitiveAmounts":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS dismissed_observations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_observations jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  user_id text NOT NULL REFERENCES app_users(id),
  session_fingerprint text NOT NULL,
  device text NOT NULL,
  location text NOT NULL DEFAULT 'Nigeria (WAT)',
  last_active_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id, session_fingerprint)
);
CREATE INDEX IF NOT EXISTS user_sessions_org_user_idx
  ON user_sessions (organisation_id, user_id, revoked_at, last_active_at DESC);

CREATE TABLE IF NOT EXISTS feedback_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  user_id text NOT NULL REFERENCES app_users(id),
  message text NOT NULL CHECK (length(trim(message)) >= 3),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_submissions_org_idx
  ON feedback_submissions (organisation_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON user_sessions TO ledgerly_app;
GRANT SELECT, INSERT ON feedback_submissions TO ledgerly_app;

DROP POLICY IF EXISTS app_users_workspace_select ON app_users;
CREATE POLICY app_users_workspace_select ON app_users FOR SELECT TO ledgerly_app
  USING (
    ledgerly_is_member(ledgerly_current_organisation_id())
    AND EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.organisation_id = ledgerly_current_organisation_id() AND m.user_id = app_users.id
    )
  );

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_sessions_self_select ON user_sessions;
CREATE POLICY user_sessions_self_select ON user_sessions FOR SELECT TO ledgerly_app
  USING (
    organisation_id = ledgerly_current_organisation_id()
    AND ledgerly_is_member(organisation_id)
    AND user_id = ledgerly_current_user_id()
  );
DROP POLICY IF EXISTS user_sessions_self_insert ON user_sessions;
CREATE POLICY user_sessions_self_insert ON user_sessions FOR INSERT TO ledgerly_app
  WITH CHECK (
    organisation_id = ledgerly_current_organisation_id()
    AND ledgerly_is_member(organisation_id)
    AND user_id = ledgerly_current_user_id()
  );
DROP POLICY IF EXISTS user_sessions_self_update ON user_sessions;
CREATE POLICY user_sessions_self_update ON user_sessions FOR UPDATE TO ledgerly_app
  USING (
    organisation_id = ledgerly_current_organisation_id()
    AND ledgerly_is_member(organisation_id)
    AND user_id = ledgerly_current_user_id()
  )
  WITH CHECK (
    organisation_id = ledgerly_current_organisation_id()
    AND ledgerly_is_member(organisation_id)
    AND user_id = ledgerly_current_user_id()
  );

ALTER TABLE feedback_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_submissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feedback_submissions_member_select ON feedback_submissions;
CREATE POLICY feedback_submissions_member_select ON feedback_submissions FOR SELECT TO ledgerly_app
  USING (
    organisation_id = ledgerly_current_organisation_id()
    AND ledgerly_is_member(organisation_id)
    AND (user_id = ledgerly_current_user_id() OR ledgerly_has_role(organisation_id, ARRAY['owner','admin']))
  );
DROP POLICY IF EXISTS feedback_submissions_member_insert ON feedback_submissions;
CREATE POLICY feedback_submissions_member_insert ON feedback_submissions FOR INSERT TO ledgerly_app
  WITH CHECK (
    organisation_id = ledgerly_current_organisation_id()
    AND ledgerly_is_member(organisation_id)
    AND user_id = ledgerly_current_user_id()
  );

CREATE OR REPLACE FUNCTION ledgerly_protect_posted_transaction()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    IF NEW.status <> 'reversed'
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
       OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.amount_kobo IS DISTINCT FROM OLD.amount_kobo
       OR NEW.direction IS DISTINCT FROM OLD.direction
       OR NEW.category_id IS DISTINCT FROM OLD.category_id
       OR NEW.tracking_account_id IS DISTINCT FROM OLD.tracking_account_id
       OR NEW.transfer_to_account_id IS DISTINCT FROM OLD.transfer_to_account_id
       OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.attachment_name IS DISTINCT FROM OLD.attachment_name
       OR NEW.bill_id IS DISTINCT FROM OLD.bill_id
       OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
       OR NEW.reverses IS DISTINCT FROM OLD.reverses
       OR NEW.reversal_reason IS NULL
       OR length(trim(NEW.reversal_reason)) < 3 THEN
      RAISE EXCEPTION 'Posted transactions are immutable; use an audited reversal';
    END IF;
  ELSIF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'Reversed transactions are immutable';
  END IF;
  RETURN NEW;
END
$$;

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ledgerly_app;
