// Shared test environment: demo mode off unless a test opts in, deterministic secrets.
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-session-secret-test-session-secret-123";
process.env.ENCRYPTION_KEY = "test-encryption-key";
process.env.DEMO_MODE = process.env.DEMO_MODE ?? "true";
process.env.DATA_DIR = process.env.DATA_DIR ?? "./data/test";
