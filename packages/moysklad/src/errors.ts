export class MoySkladError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: { code?: number; moreInfo?: string }[] = [],
  ) {
    super(message);
    this.name = "MoySkladError";
  }
}

/** The request may or may not have been processed (timeout, 5xx, dropped connection). Never retry a POST blindly: look it up by syncId first. */
export class MoySkladAmbiguousError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "MoySkladAmbiguousError";
  }
}

/** The circuit breaker is open: no request was sent. Callers reschedule instead of retrying. */
export class CircuitOpenError extends Error {
  constructor(readonly openUntil: number) {
    super(`MoySklad circuit breaker is open until ${new Date(openUntil).toISOString()}`);
    this.name = "CircuitOpenError";
  }
}

export class MoySkladAuthError extends MoySkladError {
  constructor(status: number) {
    super("MoySklad rejected the token (401). Check MOYSKLAD_TOKEN.", status);
    this.name = "MoySkladAuthError";
  }
}
