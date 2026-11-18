// ApiError lives alone so both the live client and the demo client can throw it
// without importing each other — client.ts selects the demo implementation, so
// a shared error type there would be a circular import.
export class ApiError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
