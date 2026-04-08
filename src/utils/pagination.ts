import { Request } from "express";

export interface PaginationParams {
  page: number;
  pageSize: number;
  skip: number;
  q?: string;
  params: Record<string, any>;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * Extract and validate pagination parameters from request query
 * @param req Express request object
 * @param defaultPageSize Default page size if not provided (default: 10)
 * @returns Pagination parameters with calculated skip offset
 */
export function getPaginationParams(
  req: Request,
  defaultPageSize: number = 10,
): PaginationParams {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const q = req.query.q as string | undefined;
  const params: Record<string, any> = {};

  // Include any additional query parameters for filtering/sorting
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(req.query.pageSize as string) || defaultPageSize),
  );
  const skip = (page - 1) * pageSize;

  return {
    page,
    pageSize,
    skip,
    q,
    params,
  };
}

/**
 * Create a paginated response object
 * @param data Array of items for current page
 * @param total Total count of all items
 * @param page Current page number
 * @param pageSize Items per page
 * @returns Formatted paginated response
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / pageSize);
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    },
  };
}
