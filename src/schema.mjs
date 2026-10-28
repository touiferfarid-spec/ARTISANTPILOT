export const migrations = [
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    email_verified BOOLEAN NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL DEFAULT '', job TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL DEFAULT 'site',
    budget_eur NUMERIC(10,2) NOT NULL DEFAULT 30, daily_max_alert_percent INTEGER NOT NULL DEFAULT 25,
    ads_mode TEXT NOT NULL DEFAULT 'new',
    phone TEXT NOT NULL DEFAULT '', geo_target_id TEXT,
    conversion_verified BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS integrations (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    encrypted_token TEXT NOT NULL,
    account_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id, provider)
  )`,
  `CREATE TABLE IF NOT EXISTS google_accounts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'EUR',
    timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
    selected BOOLEAN NOT NULL DEFAULT false,
    created_by_app BOOLEAN NOT NULL DEFAULT false,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, customer_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_google_account_one_selected ON google_accounts(user_id) WHERE selected`,
  `CREATE TABLE IF NOT EXISTS business_links (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL, business_account_id TEXT NOT NULL,
    asset_set TEXT NOT NULL, linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(user_id,customer_id)
  )`,
  `CREATE TABLE IF NOT EXISTS campaign_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id TEXT,
    plan JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    google_campaign_resource TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_drafts_user_created ON campaign_drafts(user_id,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS performance_snapshots (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,
    report_date DATE NOT NULL,
    impressions BIGINT NOT NULL DEFAULT 0, clicks BIGINT NOT NULL DEFAULT 0,
    spend_micros BIGINT NOT NULL DEFAULT 0, conversions NUMERIC(16,3) NOT NULL DEFAULT 0,
    phone_calls BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id,customer_id,report_date)
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL, report_date DATE NOT NULL,
    kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id,customer_id,report_date,kind)
  )`,
  `CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'rules',
    kind TEXT NOT NULL, query_text TEXT,
    description TEXT NOT NULL,
    estimated_waste_micros BIGINT,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'proposed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id,customer_id,kind,query_text)
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id TEXT, stripe_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'inactive',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_events (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_user_date ON audit_log(user_id,created_at DESC)`,
];
export async function applyMigrations(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(92740545)');
    for (const statement of migrations) await client.query(statement);
  } finally {
    await client.query('SELECT pg_advisory_unlock(92740545)').catch(()=>{});
    client.release();
  }
}
