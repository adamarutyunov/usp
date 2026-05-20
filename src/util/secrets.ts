export function resolveSecret(value: string | undefined, label: string) {
  if (value && value.trim()) {
    return value.trim();
  }

  throw new Error(`Missing ${label}. Provide it in config or run usp setup.`);
}

export function optionalSecret(value: string | undefined) {
  if (value && value.trim()) {
    return value.trim();
  }
  return undefined;
}
