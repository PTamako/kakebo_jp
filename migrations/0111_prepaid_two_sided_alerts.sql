-- Extend existing owner-bound prepaid alerts with optional upper threshold.
-- Preserve all legacy enabled/threshold/version/ownership records as LOWER mode.
ALTER TABLE prepaid_balance_alert_settings
 ADD COLUMN alert_mode TEXT NOT NULL DEFAULT 'lower'
 CHECK(alert_mode IN ('lower','upper','both'));
ALTER TABLE prepaid_balance_alert_settings
 ADD COLUMN upper_threshold_jpy INTEGER NOT NULL DEFAULT 10000
 CHECK(upper_threshold_jpy BETWEEN 0 AND 100000000);
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0111-prepaid-two-sided-alerts',
 'Optional lower/upper/both owner-only wallet alerts; existing settings default to lower');
