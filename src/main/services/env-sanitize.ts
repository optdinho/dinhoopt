const SENSITIVE_VARS = ['LICENSE_API_TOKEN', 'GH_TOKEN', 'NODE_AUTH_TOKEN'] as const

const secrets = new Map<string, string>()

export function sanitizeEnvVars(): void {
  for (const key of SENSITIVE_VARS) {
    const val = process.env[key]
    if (val) {
      secrets.set(key, val)
      delete process.env[key]
    }
  }
}

export function getSecret(key: string): string | undefined {
  return secrets.get(key)
}
