const SENSITIVE_KEY = /password|token|authorization|secret|pepper|cookie/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(entry);
    }
    return output;
  }
  return value;
}

function write(level: "info" | "error", message: string, meta?: Record<string, unknown>): void {
  const payload = {
    level,
    message,
    ...(meta ? (redact(meta) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  write("info", message, meta);
}

export function logError(message: string, meta?: Record<string, unknown>): void {
  write("error", message, meta);
}
