export function getNestedValue<T = unknown>(
  data: unknown,
  path: (number | string)[],
  fallback?: T
): T | undefined {
  let current: unknown = data;
  for (const key of path) {
    if (current == null || typeof current !== "object") {
      return fallback;
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  // Intentional TS behavior: a final resolved value of `null` is returned as-is,
  // while only `undefined` triggers `fallback`. This differs from Python
  // `get_nested_value` (`None` -> default). Callers wanting Python-equivalent
  // semantics should check `result == null`.
  return (current === undefined ? fallback : current) as T | undefined;
}
