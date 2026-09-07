/**
 * Domain error carrying the HTTP status the API should answer with.
 * Validators throw these so the controller stays a thin translation layer.
 */
export class SaleError extends Error {
    readonly status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.name = "SaleError";
        this.status = status;
    }
}

export const badRequest = (message: string) => new SaleError(message, 400);
export const notFound = (message: string) => new SaleError(message, 404);

export const isSaleError = (e: unknown): e is SaleError => e instanceof SaleError;
