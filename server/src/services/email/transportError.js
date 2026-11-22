// Provider-neutral transport error used by every email transport.
export class EmailTransportError extends Error {
  constructor(message, { code = 'provider_error', status = 0, temporary = false, permanent = false, providerErrorCode = '', providerErrorIdentifier = '' } = {}) {
    super(message)
    this.name = 'EmailTransportError'
    this.code = code
    this.status = status
    this.temporary = temporary
    // Permanent: retrying the same message cannot succeed (e.g. invalid recipient).
    this.permanent = permanent
    // Provider's own error reference (error name / request id) for support requests.
    this.providerErrorCode = providerErrorCode
    this.providerErrorIdentifier = providerErrorIdentifier
  }
}
