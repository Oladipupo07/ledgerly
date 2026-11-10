-- MVP storage expansion and defense-in-depth tenant isolation.
-- The application must SET LOCAL ROLE ledgerly_app and set app.user_id /
-- app.organisation_id inside each request transaction before reading tenant data.

DO $$
BEGIN
  CREATE ROLE ledgerly_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT ledgerly_app TO %I', session_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'The migration login must be allowed to grant ledgerly_app to the runtime database login';
END
$$;

ALTER TABLE organisations ADD COLUMN IF NOT EXISTS owner_user_id text REFERENCES app_users(id);
ALTER TABLE organisations ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS business_id text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bill_id uuid;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS invited_email text;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS invited_by text REFERENCES app_users(id);
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tracking_accounts ADD COLUMN IF NOT EXISTS opening_balance_recorded_by text REFERENCES app_users(id);
ALTER TABLE tracking_accounts ADD COLUMN IF NOT EXISTS masked_ref text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS public_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS audit_events_public_id_idx ON audit_events(public_id);

UPDATE organisations o
   SET owner_user_id = m.user_id
  FROM memberships m
 WHERE m.organisation_id = o.id AND m.role = 'owner' AND o.owner_user_id IS NULL;

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  invoice_number text NOT NULL,
  customer_id uuid NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'shared', 'partially_paid', 'paid', 'disputed', 'cancelled')),
  discount_kobo bigint NOT NULL DEFAULT 0 CHECK (discount_kobo >= 0),
  tax_label text,
  tax_rate_percent numeric(5,2) CHECK (tax_rate_percent BETWEEN 0 AND 100),
  terms text NOT NULL DEFAULT '',
  payment_instructions text NOT NULL DEFAULT '',
  notes text,
  created_by text NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, invoice_number),
  FOREIGN KEY (organisation_id, customer_id) REFERENCES contacts(organisation_id, id)
);
CREATE INDEX IF NOT EXISTS invoices_org_due_idx ON invoices(organisation_id, due_date, status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  unit_price_kobo bigint NOT NULL CHECK (unit_price_kobo >= 0),
  line_number integer NOT NULL CHECK (line_number > 0),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, invoice_id, line_number),
  FOREIGN KEY (organisation_id, invoice_id) REFERENCES invoices(organisation_id, id)
);

CREATE TABLE IF NOT EXISTS invoice_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  receipt_date date NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  method_label text NOT NULL DEFAULT 'recorded receipt',
  reference text NOT NULL CHECK (length(reference) BETWEEN 1 AND 120),
  tracking_account_id uuid NOT NULL,
  recorded_by text NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, transaction_id),
  FOREIGN KEY (organisation_id, invoice_id) REFERENCES invoices(organisation_id, id),
  FOREIGN KEY (organisation_id, transaction_id) REFERENCES transactions(organisation_id, id),
  FOREIGN KEY (organisation_id, tracking_account_id) REFERENCES tracking_accounts(organisation_id, id)
);
CREATE INDEX IF NOT EXISTS invoice_receipts_org_invoice_idx ON invoice_receipts(organisation_id, invoice_id, receipt_date);

CREATE TABLE IF NOT EXISTS supplier_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  bill_number text NOT NULL,
  supplier_id uuid NOT NULL,
  bill_date date NOT NULL,
  due_date date NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  paid_amount_kobo bigint NOT NULL DEFAULT 0 CHECK (paid_amount_kobo >= 0 AND paid_amount_kobo <= amount_kobo),
  category_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partially_paid', 'paid', 'cancelled')),
  reference text,
  notes text,
  created_by text NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, bill_number),
  FOREIGN KEY (organisation_id, supplier_id) REFERENCES contacts(organisation_id, id),
  FOREIGN KEY (organisation_id, category_id) REFERENCES categories(organisation_id, id)
);
DO $$
BEGIN
  ALTER TABLE transactions
    ADD CONSTRAINT transactions_org_bill_fk
    FOREIGN KEY (organisation_id, bill_id) REFERENCES supplier_bills(organisation_id, id);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;
CREATE INDEX IF NOT EXISTS supplier_bills_org_due_idx ON supplier_bills(organisation_id, due_date, status);

CREATE TABLE IF NOT EXISTS supplier_bill_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  bill_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  payment_date date NOT NULL,
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  reference text NOT NULL CHECK (length(reference) BETWEEN 1 AND 120),
  recorded_by text NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, transaction_id),
  FOREIGN KEY (organisation_id, bill_id) REFERENCES supplier_bills(organisation_id, id),
  FOREIGN KEY (organisation_id, transaction_id) REFERENCES transactions(organisation_id, id)
);
CREATE INDEX IF NOT EXISTS supplier_bill_payments_org_bill_idx ON supplier_bill_payments(organisation_id, bill_id, payment_date);

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 240),
  tracking_account_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'committed', 'failed')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  committed_count integer NOT NULL DEFAULT 0 CHECK (committed_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  uploaded_by text NOT NULL REFERENCES app_users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, tracking_account_id) REFERENCES tracking_accounts(organisation_id, id)
);

CREATE TABLE IF NOT EXISTS import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number > 0),
  raw_data jsonb NOT NULL,
  normalized_hash text,
  outcome text NOT NULL DEFAULT 'preview' CHECK (outcome IN ('preview', 'included', 'skipped', 'error', 'duplicate')),
  transaction_id uuid,
  issue text,
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, batch_id, row_number),
  FOREIGN KEY (organisation_id, batch_id) REFERENCES import_batches(organisation_id, id),
  FOREIGN KEY (organisation_id, transaction_id) REFERENCES transactions(organisation_id, id)
);
CREATE INDEX IF NOT EXISTS import_rows_hash_idx ON import_rows(organisation_id, normalized_hash) WHERE normalized_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS idempotency_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  operation text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  response_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS membership_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  invited_email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','bookkeeper','accountant')),
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')),
  invited_by text NOT NULL REFERENCES app_users(id),
  accepted_by text REFERENCES app_users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS membership_invites_pending_email_idx
  ON membership_invites(organisation_id, lower(invited_email)) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION ledgerly_current_user_id()
RETURNS text LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION ledgerly_current_organisation_id()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.organisation_id', true), '')::uuid $$;

-- SECURITY DEFINER avoids recursive membership RLS policy evaluation.
CREATE OR REPLACE FUNCTION ledgerly_is_member(target_organisation_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.organisation_id = target_organisation_id
       AND m.user_id = ledgerly_current_user_id()
       AND m.status = 'active'
  )
$$;

CREATE OR REPLACE FUNCTION ledgerly_has_role(target_organisation_id uuid, allowed_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.organisation_id = target_organisation_id
       AND m.user_id = ledgerly_current_user_id()
       AND m.status = 'active'
       AND m.role = ANY(allowed_roles)
  )
$$;

CREATE OR REPLACE FUNCTION ledgerly_invite_matches(target_organisation_id uuid, target_role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM membership_invites i
      JOIN app_users u ON lower(u.email) = lower(i.invited_email)
     WHERE i.organisation_id = target_organisation_id
       AND (target_role IS NULL OR i.role = target_role)
       AND i.status = 'pending'
       AND i.expires_at > now()
       AND u.id = ledgerly_current_user_id()
  )
$$;

REVOKE ALL ON FUNCTION ledgerly_current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION ledgerly_current_organisation_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION ledgerly_is_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledgerly_has_role(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION ledgerly_invite_matches(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ledgerly_current_user_id() TO ledgerly_app;
GRANT EXECUTE ON FUNCTION ledgerly_current_organisation_id() TO ledgerly_app;
GRANT EXECUTE ON FUNCTION ledgerly_is_member(uuid) TO ledgerly_app;
GRANT EXECUTE ON FUNCTION ledgerly_has_role(uuid, text[]) TO ledgerly_app;
GRANT EXECUTE ON FUNCTION ledgerly_invite_matches(uuid, text) TO ledgerly_app;

GRANT USAGE ON SCHEMA public TO ledgerly_app;
GRANT SELECT, INSERT, UPDATE ON app_users, organisations, memberships,
  tracking_accounts, categories, contacts, transactions, invoices,
  invoice_lines, invoice_receipts, supplier_bills, supplier_bill_payments,
  import_batches, import_rows, idempotency_records
TO ledgerly_app;
GRANT SELECT, INSERT ON membership_invites TO ledgerly_app;
GRANT UPDATE (status, accepted_by, accepted_at, updated_at) ON membership_invites TO ledgerly_app;
GRANT SELECT, INSERT ON audit_events TO ledgerly_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledgerly_app;

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_users_self_select ON app_users;
CREATE POLICY app_users_self_select ON app_users FOR SELECT TO ledgerly_app
  USING (id = ledgerly_current_user_id());
DROP POLICY IF EXISTS app_users_workspace_select ON app_users;
CREATE POLICY app_users_workspace_select ON app_users FOR SELECT TO ledgerly_app
  USING (
    ledgerly_has_role(ledgerly_current_organisation_id(), ARRAY['owner','admin'])
    AND EXISTS (
      SELECT 1 FROM memberships m
       WHERE m.organisation_id = ledgerly_current_organisation_id() AND m.user_id = app_users.id
    )
  );
DROP POLICY IF EXISTS app_users_self_insert ON app_users;
CREATE POLICY app_users_self_insert ON app_users FOR INSERT TO ledgerly_app
  WITH CHECK (id = ledgerly_current_user_id());
DROP POLICY IF EXISTS app_users_self_update ON app_users;
CREATE POLICY app_users_self_update ON app_users FOR UPDATE TO ledgerly_app
  USING (id = ledgerly_current_user_id()) WITH CHECK (id = ledgerly_current_user_id());

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organisations_member_select ON organisations;
CREATE POLICY organisations_member_select ON organisations FOR SELECT TO ledgerly_app
  USING (
    (ledgerly_is_member(id) AND
      (ledgerly_current_organisation_id() IS NULL OR ledgerly_current_organisation_id() = id))
    OR owner_user_id = ledgerly_current_user_id()
  );
DROP POLICY IF EXISTS organisations_self_create ON organisations;
CREATE POLICY organisations_self_create ON organisations FOR INSERT TO ledgerly_app
  WITH CHECK (owner_user_id = ledgerly_current_user_id());
DROP POLICY IF EXISTS organisations_owner_update ON organisations;
CREATE POLICY organisations_owner_update ON organisations FOR UPDATE TO ledgerly_app
  USING (ledgerly_has_role(id, ARRAY['owner','admin']))
  WITH CHECK (ledgerly_has_role(id, ARRAY['owner','admin']));

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_member_select ON memberships;
CREATE POLICY memberships_member_select ON memberships FOR SELECT TO ledgerly_app
  USING (
    user_id = ledgerly_current_user_id()
    OR (ledgerly_current_organisation_id() = organisation_id AND ledgerly_is_member(organisation_id))
  );
DROP POLICY IF EXISTS memberships_owner_insert ON memberships;
CREATE POLICY memberships_owner_insert ON memberships FOR INSERT TO ledgerly_app
  WITH CHECK (
    (user_id = ledgerly_current_user_id() AND role = 'owner' AND status = 'active'
      AND EXISTS (SELECT 1 FROM organisations o WHERE o.id = organisation_id AND o.owner_user_id = ledgerly_current_user_id()))
    OR ledgerly_has_role(organisation_id, ARRAY['owner','admin'])
    OR (user_id = ledgerly_current_user_id() AND status = 'active' AND ledgerly_invite_matches(organisation_id, role))
  );
DROP POLICY IF EXISTS memberships_admin_update ON memberships;
CREATE POLICY memberships_admin_update ON memberships FOR UPDATE TO ledgerly_app
  USING (ledgerly_has_role(organisation_id, ARRAY['owner','admin']) OR
    (user_id = ledgerly_current_user_id() AND ledgerly_invite_matches(organisation_id, NULL)))
  WITH CHECK (ledgerly_has_role(organisation_id, ARRAY['owner','admin']) OR
    (user_id = ledgerly_current_user_id() AND status = 'active' AND ledgerly_invite_matches(organisation_id, role)));

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tracking_accounts','categories','contacts','transactions','invoices',
    'invoice_lines','invoice_receipts','supplier_bills','supplier_bill_payments',
    'import_batches','import_rows','idempotency_records','membership_invites','audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_member_select', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO ledgerly_app USING (organisation_id = ledgerly_current_organisation_id() AND ledgerly_is_member(organisation_id))', table_name || '_member_select', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_member_insert', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO ledgerly_app WITH CHECK (organisation_id = ledgerly_current_organisation_id() AND ledgerly_is_member(organisation_id))', table_name || '_member_insert', table_name);
    IF table_name <> 'audit_events' THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_member_update', table_name);
      EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO ledgerly_app USING (organisation_id = ledgerly_current_organisation_id() AND ledgerly_is_member(organisation_id)) WITH CHECK (organisation_id = ledgerly_current_organisation_id() AND ledgerly_is_member(organisation_id))', table_name || '_member_update', table_name);
    END IF;
  END LOOP;
END
$$;

-- Author and actor identifiers are tied to the authenticated context too.
DROP POLICY IF EXISTS transactions_member_insert ON transactions;
DROP POLICY IF EXISTS transactions_author_insert ON transactions;
CREATE POLICY transactions_author_insert ON transactions FOR INSERT TO ledgerly_app
  WITH CHECK (organisation_id = ledgerly_current_organisation_id() AND ledgerly_has_role(organisation_id, ARRAY['owner','admin','bookkeeper']) AND created_by = ledgerly_current_user_id());
DROP POLICY IF EXISTS audit_events_member_insert ON audit_events;
DROP POLICY IF EXISTS audit_events_actor_insert ON audit_events;
CREATE POLICY audit_events_actor_insert ON audit_events FOR INSERT TO ledgerly_app
  WITH CHECK (organisation_id = ledgerly_current_organisation_id() AND ledgerly_is_member(organisation_id) AND actor_user_id = ledgerly_current_user_id());
DROP POLICY membership_invites_member_select ON membership_invites;
DROP POLICY IF EXISTS membership_invites_member_insert ON membership_invites;
DROP POLICY IF EXISTS membership_invites_member_update ON membership_invites;
DROP POLICY IF EXISTS membership_invites_admin_select ON membership_invites;
CREATE POLICY membership_invites_admin_select ON membership_invites FOR SELECT TO ledgerly_app
  USING (organisation_id = ledgerly_current_organisation_id() AND ledgerly_has_role(organisation_id, ARRAY['owner','admin']));
DROP POLICY IF EXISTS membership_invites_invitee_select ON membership_invites;
CREATE POLICY membership_invites_invitee_select ON membership_invites FOR SELECT TO ledgerly_app
  USING ((ledgerly_current_organisation_id() IS NULL OR organisation_id = ledgerly_current_organisation_id())
    AND status = 'pending' AND expires_at > now()
    AND lower(invited_email) = (SELECT lower(email) FROM app_users WHERE id = ledgerly_current_user_id()));
DROP POLICY IF EXISTS membership_invites_admin_insert ON membership_invites;
CREATE POLICY membership_invites_admin_insert ON membership_invites FOR INSERT TO ledgerly_app
  WITH CHECK (organisation_id = ledgerly_current_organisation_id() AND ledgerly_has_role(organisation_id, ARRAY['owner','admin']) AND invited_by = ledgerly_current_user_id());
DROP POLICY IF EXISTS membership_invites_update ON membership_invites;
CREATE POLICY membership_invites_update ON membership_invites FOR UPDATE TO ledgerly_app
  USING (organisation_id = ledgerly_current_organisation_id() AND (
    ledgerly_has_role(organisation_id, ARRAY['owner','admin']) OR
    (status = 'pending' AND expires_at > now() AND lower(invited_email) = (SELECT lower(email) FROM app_users WHERE id = ledgerly_current_user_id()))
  ))
  WITH CHECK (organisation_id = ledgerly_current_organisation_id() AND (
    ledgerly_has_role(organisation_id, ARRAY['owner','admin']) OR
    (status = 'accepted' AND accepted_by = ledgerly_current_user_id() AND lower(invited_email) = (SELECT lower(email) FROM app_users WHERE id = ledgerly_current_user_id()))
  ));
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
DROP TRIGGER IF EXISTS transactions_protect_posted ON transactions;
CREATE TRIGGER transactions_protect_posted
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION ledgerly_protect_posted_transaction();

-- Prevent ordinary API role from deleting any financial or audit record.
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM ledgerly_app;
