export function resolveSecret(
  value: string | undefined,
  envName: string | undefined,
  label: string,
  fallbackEnvName?: string
) {
  if (value && value.trim()) {
    return value.trim();
  }

  const selectedEnvName = envName || fallbackEnvName;
  if (selectedEnvName) {
    const envValue = process.env[selectedEnvName];
    if (envValue && envValue.trim()) {
      return envValue.trim();
    }
  }

  throw new Error(`Missing ${label}. Provide it in config, an *_env reference, --set, or the environment.`);
}

export function optionalSecret(
  value: string | undefined,
  envName: string | undefined,
  fallbackEnvName?: string
) {
  if (value && value.trim()) {
    return value.trim();
  }

  const selectedEnvName = envName || fallbackEnvName;
  if (!selectedEnvName) {
    return undefined;
  }

  const envValue = process.env[selectedEnvName];
  return envValue && envValue.trim() ? envValue.trim() : undefined;
}
