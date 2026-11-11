/** What every printing path of a Secret produces instead of its value. */
export const REDACTED = "[REDACTED]";

/**
 * Holds a sensitive string so that logging it by accident cannot leak it:
 * String(), template literals, JSON.stringify and util.inspect all yield
 * REDACTED. Only reveal() returns the value, and the value lives in a true
 * private field, so it is not an own property either (D-06, RESEARCH Pattern 8).
 */
export class Secret {
  #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}
