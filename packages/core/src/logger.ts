import { pino, type Logger } from "pino";

/** Never log secrets, initData, tokens or full phone numbers. */
export function createLogger(level = "info", name = "shop"): Logger {
  return pino({
    level,
    name,
    redact: {
      paths: ["*.token", "*.password", "*.authorization", "req.headers.authorization", "req.headers.cookie", "*.initData", "*.phone", "*.contactPhone"],
      censor: "[redacted]",
    },
  });
}
export type { Logger };
