-- ============================================
-- AI FinOps Gateway — V1 Seed Data
-- Demo users, providers, keys, and 30 days of mock analytics
-- ============================================

-- ============================================
-- USERS
-- ============================================
INSERT INTO users (id, email, name, password_hash, role, status) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@aigateway.io', 'Sarah Chen', '$2b$10$dummy_admin_hash', 'admin', 'active'),
  ('a0000000-0000-0000-0000-000000000002', 'dev@aigateway.io', 'Marcus Johnson', '$2b$10$dummy_dev_hash', 'developer', 'active'),
  ('a0000000-0000-0000-0000-000000000003', 'analyst@aigateway.io', 'Priya Sharma', '$2b$10$dummy_analyst_hash', 'analyst', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'viewer@aigateway.io', 'Alex Kim', '$2b$10$dummy_viewer_hash', 'viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000005', 'lead@aigateway.io', 'Jordan Rivera', '$2b$10$dummy_lead_hash', 'developer', 'active');

-- ============================================
-- PROVIDERS (user brings their own API keys)
-- ============================================
INSERT INTO providers (id, name, display_name, base_url, api_key_encrypted, api_key_prefix, status, models, added_by, last_verified) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com',
    'REPLACE_WITH_YOUR_GEMINI_KEY', 'AIzaSyB3••••', 'active',
    '[{"id":"gemini-2.5-pro","name":"Gemini 2.5 Pro"},{"id":"gemini-2.5-flash","name":"Gemini 2.5 Flash"},{"id":"gemini-2.0-flash","name":"Gemini 2.0 Flash"},{"id":"gemini-1.5-pro","name":"Gemini 1.5 Pro"},{"id":"gemini-1.5-flash","name":"Gemini 1.5 Flash"}]'::jsonb,
    'a0000000-0000-0000-0000-000000000001', now());

-- ============================================
-- VIRTUAL KEYS
-- ============================================
INSERT INTO virtual_keys (id, name, key_prefix, key_hash, user_id, provider_id, config, status, total_requests, total_cost) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Production - Gemini', 'vk-prod', 'sha256_prod_key_hash_demo', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
    '{"allowed_models": ["gemini-2.0-flash", "gemini-2.5-pro"], "rpm_limit": 60, "tpm_limit": 100000}'::jsonb,
    'active', 1247, 342.5600),
  ('c0000000-0000-0000-0000-000000000002', 'Dev - Gemini Flash', 'vk-dev1', 'sha256_dev1_key_hash_demo', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001',
    '{"allowed_models": ["gemini-2.0-flash"], "rpm_limit": 30, "tpm_limit": 50000}'::jsonb,
    'active', 583, 87.2400),
  ('c0000000-0000-0000-0000-000000000003', 'Analytics - Pro', 'vk-anly', 'sha256_analytics_key_hash_demo', 'a0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001',
    '{"allowed_models": ["gemini-2.5-pro", "gemini-1.5-pro"], "rpm_limit": 20, "tpm_limit": 200000}'::jsonb,
    'active', 312, 156.8000),
  ('c0000000-0000-0000-0000-000000000004', 'Legacy - Revoked', 'vk-old1', 'sha256_old_key_hash_demo', 'a0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002',
    '{"allowed_models": ["gpt-4o"]}'::jsonb,
    'revoked', 89, 44.5000);

-- ============================================
-- COST EVENTS (30 days of mock data)
-- ============================================
DO $$
DECLARE
  day_offset INTEGER;
  events_per_day INTEGER;
  i INTEGER;
  models TEXT[] := ARRAY['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'];
  providers TEXT[] := ARRAY['gemini', 'gemini', 'gemini', 'gemini'];
  user_ids UUID[] := ARRAY[
    'a0000000-0000-0000-0000-000000000001'::UUID,
    'a0000000-0000-0000-0000-000000000002'::UUID,
    'a0000000-0000-0000-0000-000000000003'::UUID,
    'a0000000-0000-0000-0000-000000000005'::UUID
  ];
  key_ids UUID[] := ARRAY[
    'c0000000-0000-0000-0000-000000000001'::UUID,
    'c0000000-0000-0000-0000-000000000002'::UUID,
    'c0000000-0000-0000-0000-000000000003'::UUID,
    'c0000000-0000-0000-0000-000000000001'::UUID
  ];
  model_idx INTEGER;
  user_idx INTEGER;
  prompt_tok INTEGER;
  comp_tok INTEGER;
  cost NUMERIC;
  input_prices NUMERIC[] := ARRAY[0.10, 1.25, 1.25, 0.075]; -- per 1M tokens
  output_prices NUMERIC[] := ARRAY[0.40, 10.00, 5.00, 0.30];
BEGIN
  FOR day_offset IN 0..29 LOOP
    -- Vary traffic: weekdays more, weekends less
    events_per_day := 15 + floor(random() * 25)::INTEGER;
    IF EXTRACT(DOW FROM (now() - (day_offset || ' days')::INTERVAL)) IN (0, 6) THEN
      events_per_day := events_per_day / 2;
    END IF;

    FOR i IN 1..events_per_day LOOP
      model_idx := 1 + floor(random() * 4)::INTEGER;
      user_idx := 1 + floor(random() * 4)::INTEGER;
      prompt_tok := 100 + floor(random() * 3000)::INTEGER;
      comp_tok := 50 + floor(random() * 2000)::INTEGER;
      cost := (prompt_tok * input_prices[model_idx] / 1000000.0) + (comp_tok * output_prices[model_idx] / 1000000.0);

      INSERT INTO cost_events (request_id, virtual_key_id, user_id, provider, model,
        prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, status_code, created_at)
      VALUES (
        gen_random_uuid(),
        key_ids[user_idx],
        user_ids[user_idx],
        providers[model_idx],
        models[model_idx],
        prompt_tok, comp_tok, prompt_tok + comp_tok,
        cost,
        200 + floor(random() * 3000)::INTEGER,
        CASE WHEN random() > 0.02 THEN 200 ELSE (ARRAY[400, 429, 500])[1 + floor(random() * 3)::INTEGER] END,
        now() - (day_offset || ' days')::INTERVAL + (floor(random() * 86400) || ' seconds')::INTERVAL
      );
    END LOOP;
  END LOOP;
END $$;

-- ============================================
-- SAMPLE PROMPT LOGS (most recent 20)
-- ============================================
INSERT INTO prompt_logs (request_id, virtual_key_id, user_id, provider, model,
  prompt_preview, prompt_full, response_preview, response_full,
  prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, status_code, created_at)
SELECT
  ce.request_id, ce.virtual_key_id, ce.user_id, ce.provider, ce.model,
  'Sample prompt for ' || ce.model || ' — request analysis...',
  'Full prompt content for request ' || ce.request_id::TEXT,
  'Sample response from ' || ce.model || ' — generated output...',
  'Full response content for request ' || ce.request_id::TEXT,
  ce.prompt_tokens, ce.completion_tokens, ce.total_tokens,
  ce.cost_usd, ce.latency_ms, ce.status_code, ce.created_at
FROM cost_events ce
ORDER BY ce.created_at DESC
LIMIT 20;
