import 'dotenv/config'

// Set default test values if not already set via .env
process.env.LICENSE_API_URL ??= 'https://test.example.com'
process.env.LICENSE_API_TOKEN ??= 'test-token'
