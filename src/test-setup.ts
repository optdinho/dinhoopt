import dotenv from 'dotenv'

// `quiet` suppresses the "injected env (N) from .env" banner, which otherwise
// prints once per test file and buries the real stderr (act warnings, etc).
// Same option as src/main/index.ts.
dotenv.config({ quiet: true })

// Set default test values if not already set via .env
process.env.LICENSE_API_URL ??= 'https://test.example.com'
process.env.LICENSE_API_TOKEN ??= 'test-token'
