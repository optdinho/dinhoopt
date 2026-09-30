import dotenv from 'dotenv'

// `quiet` suppresses the "injected env (N) from .env" banner, which otherwise
// prints once per test file and buries the real stderr (act warnings, etc).
// Same option as src/main/index.ts.
dotenv.config({ quiet: true })

// Set default test values if not already set via .env
process.env.LICENSE_API_URL ??= 'https://test.example.com'
process.env.LICENSE_API_TOKEN ??= 'test-token'

// Production code writes progress to stdout directly (cliLog/cliUsage/log in
// src/main/cli/utils.ts, the daemon banner, the Prometheus "listening on..."
// line). Those writes are asserted with vi.spyOn(process.stdout, 'write') in a
// couple of tests, which keeps working because a spy wraps whatever is here.
//
// Only stdout is muted — stderr stays untouched on purpose, because that is
// where console.error/console.warn land. React act warnings, unknown prop
// warnings and real stack traces must keep showing up in the test output.
process.stdout.write = (() => true) as typeof process.stdout.write
