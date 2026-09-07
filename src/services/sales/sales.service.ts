import { prepareCreateSale } from "./create-sale.service";
import { prepareExchange } from "./exchange-sale.service";
import { prepareReturnSale } from "./return-sale.service";
import { loadCashierPolicy, loadParentSale, loadVariants, persistSalePlan } from "./sale-repository";
import { buildPrepareContext, parseLines, toNumberOrNull } from "./sale-request";
import { cartKind, classifyCart } from "./sale-lines";
import { notFound } from "./errors";
import type { PrepareContext, SalePlan, SaleRequestInput } from "./types";

/**
 * Picks the module that owns this cart. Keeping the choice in one place is why
 * create / return / exchange can each stay small and single-purpose.
 */
export function prepareSalePlan(ctx: PrepareContext): SalePlan {
    const cart = classifyCart(ctx.lines);
    switch (cartKind(cart)) {
        case "RETURN":
            return prepareReturnSale(ctx);
        case "EXCHANGE":
            return prepareExchange(ctx);
        default:
            return prepareCreateSale(ctx);
    }
}

/**
 * Full pipeline: parse → load → validate (per cart kind) → persist.
 * The controller only translates HTTP in and out.
 */
export async function submitSale(input: SaleRequestInput, userId: number | null) {
    const lines = parseLines(input);
    const parentSaleId = toNumberOrNull(input.parentSaleId);

    const [variantMap, parentSale, policy] = await Promise.all([
        loadVariants(lines),
        parentSaleId ? loadParentSale(parentSaleId) : Promise.resolve(null),
        loadCashierPolicy(userId),
    ]);

    if (parentSaleId && !parentSale) throw notFound("Original sale not found");

    const plan = prepareSalePlan(
        buildPrepareContext({ input, lines, variantMap, parentSale, userId, policy })
    );

    return persistSalePlan(plan);
}
