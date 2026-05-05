import type { JsonObject } from "../types.js";

export function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge<T extends JsonObject>(base: T, override: JsonObject): T {
  const result: JsonObject = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }

  return result as T;
}

export function setDeepValue(target: JsonObject, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("Override path cannot be empty.");
  }

  let cursor: JsonObject = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part] as JsonObject;
  }
  cursor[parts[parts.length - 1]!] = value;
}
