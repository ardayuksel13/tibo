function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`[TiBo ENV] Missing required environment variable: ${name}`);
  }
  return value;
}

export function assertRuntimeEnv(): void {
  const env = process.env.NODE_ENV;

  if (env === 'production') {
    required('NEXT_PUBLIC_APP_URL', process.env.NEXT_PUBLIC_APP_URL);
  }

  const analyticsProvider = process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER;
  if (analyticsProvider === 'plausible') {
    required('NEXT_PUBLIC_PLAUSIBLE_DOMAIN', process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN);
  }
}
