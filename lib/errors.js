/** One failure with a stable machine code and a message safe to show. */
export class SyncError extends Error {
  /**
   * @param {string} code stable code the Client localizes
   * @param {string} message English detail appended to the localized text
   * @param {Record<string, unknown>} [details] non-secret structured context
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'SyncError'
    this.code = code
    this.details = details
  }
}

/** Normalize any thrown value into a wire-safe `{ code, message, details? }`. */
export function toFailure(error, fallbackCode = 'internal') {
  if (error instanceof SyncError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    }
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  }
}
