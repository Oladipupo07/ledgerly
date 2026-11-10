CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  email text,
  display_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organisations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  display_name text NOT NULL,
  business_type text NOT NULL,
  state_city text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'Africa/Lagos' CHECK (timezone = 'Africa/Lagos'),
  base_currency char(3) NOT NULL DEFAULT 'NGN' CHECK (base_currency = 'NGN'),
  fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  low_cash_threshold_kobo bigint NOT NULL DEFAULT 0 CHECK (low_cash_threshold_kobo >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id text NOT NULL REFERENCES app_users(id),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'bookkeeper', 'accountant')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'deactivated', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organisation_id)
);
CREATE INDEX IF NOT EXISTS memberships_org_idx ON memberships(organisation_id, status);

CREATE TABLE IF NOT EXISTS tracking_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bank_label', 'pos_label', 'cash_label')),
  opening_balance_kobo bigint NOT NULL DEFAULT 0,
  opening_balance_date date NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, name)
);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('income', 'expense', 'both')),
  archived boolean NOT NULL DEFAULT false,
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, name)
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  name text NOT NULL,
  roles text[] NOT NULL DEFAULT '{}',
  email text,
  phone text,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  transaction_date date NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
  type text NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'refund', 'adjustment')),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'reversed')),
  amount_kobo bigint NOT NULL CHECK (amount_kobo > 0),
  direction text NOT NULL CHECK (direction IN ('inflow', 'outflow')),
  category_id uuid,
  tracking_account_id uuid NOT NULL,
  transfer_to_account_id uuid,
  contact_id uuid,
  reference text,
  source text NOT NULL CHECK (source IN ('manual', 'csv_import', 'invoice_receipt', 'bill_payment', 'reversal')),
  created_by text NOT NULL REFERENCES app_users(id),
  idempotency_key text NOT NULL,
  reversed_by uuid,
  reverses uuid,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, idempotency_key),
  FOREIGN KEY (organisation_id, category_id) REFERENCES categories(organisation_id, id),
  FOREIGN KEY (organisation_id, tracking_account_id) REFERENCES tracking_accounts(organisation_id, id),
  FOREIGN KEY (organisation_id, transfer_to_account_id) REFERENCES tracking_accounts(organisation_id, id),
  FOREIGN KEY (organisation_id, contact_id) REFERENCES contacts(organisation_id, id),
  FOREIGN KEY (organisation_id, reversed_by) REFERENCES transactions(organisation_id, id),
  FOREIGN KEY (organisation_id, reverses) REFERENCES transactions(organisation_id, id)
);
CREATE INDEX IF NOT EXISTS transactions_org_date_idx ON transactions(organisation_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  actor_user_id text NOT NULL REFERENCES app_users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text,
  before_data jsonb,
  after_data jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_org_time_idx ON audit_events(organisation_id, created_at DESC);

-- Application role should have INSERT and SELECT only; no UPDATE or DELETE grants.
