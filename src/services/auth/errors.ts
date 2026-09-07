/** Domain error carrying the HTTP status the API should answer with. */
export class AccessError extends Error {
    readonly status: number;

    constructor(message: string, status = 403) {
        super(message);
        this.name = "AccessError";
        this.status = status;
    }
}

export const forbidden = (message: string) => new AccessError(message, 403);
export const invalid = (message: string) => new AccessError(message, 400);

export const isAccessError = (e: unknown): e is AccessError => e instanceof AccessError;
