import prisma from '../lib/prisma.js';
import { AppError } from '../utils/appError.js';
import {
  StoreDTO,
  CreateStoreInput,
  UpdateStoreInput,
  StoreQueryParams,
  PaginatedResult,
} from '../types/index.js';

function toDTO(record: any): StoreDTO {
  return {
    id: record.id,
    name: record.name,
    address: record.address ?? undefined,
    route: record.route ?? undefined,
    phone: record.phone ?? undefined,
    salesPersonId: record.salesPersonId ?? undefined,
    salesPerson: record.salesPerson
      ? {
          id: record.salesPerson.id,
          name: record.salesPerson.name,
          phone: record.salesPerson.phone ?? undefined,
        }
      : undefined,
    invoiceCount: record._count?.invoices ?? 0,
    createdAt: record.createdAt?.toISOString(),
    updatedAt: record.updatedAt?.toISOString(),
  };
}

export class StoreService {
  /**
   * GET /api/stores
   * Paginated, searchable list of stores.
   */
  static async getAll(params: StoreQueryParams): Promise<PaginatedResult<StoreDTO>> {
    const { search, route: routeFilter, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (routeFilter) {
      where.route = routeFilter;
    }

    const [total, items] = await Promise.all([
      prisma.store.count({ where }),
      prisma.store.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { invoices: true } },
          salesPerson: { select: { id: true, name: true, phone: true } },
        },
      }),
    ]);

    const pages = Math.ceil(total / limit);

    return {
      data: items.map(toDTO),
      pagination: { page, limit, total, pages },
    };
  }

  /**
   * GET /api/stores/routes
   * List all unique delivery routes.
   */
  static async listRoutes(): Promise<string[]> {
    const routes = await prisma.store.findMany({
      where: { route: { not: null } },
      select: { route: true },
      distinct: ['route'],
      orderBy: { route: 'asc' },
    });
    return routes.map((r) => r.route as string).filter(Boolean);
  }

  /**
   * GET /api/stores/:id
   */
  static async getById(id: string): Promise<StoreDTO> {
    const item = await prisma.store.findUnique({
      where: { id },
      include: {
        _count: { select: { invoices: true } },
        salesPerson: { select: { id: true, name: true, phone: true } },
        invoices: {
          orderBy: { date: 'desc' },
          include: {
            salesPerson: { select: { id: true, name: true } },
            payments: true,
          },
        },
      },
    });

    if (!item) {
      throw new AppError('Store not found', 404);
    }

    return {
      ...toDTO(item),
      invoices: item.invoices,
    } as any;
  }

  /**
   * POST /api/stores
   */
  static async create(input: CreateStoreInput): Promise<StoreDTO> {
    if (!input.name || input.name.trim().length === 0) {
      throw new AppError('Store name is required', 400);
    }

    const normalizedSalesPersonId = String(input.salesPersonId || '').trim() || null;
    if (normalizedSalesPersonId) {
      const salesPerson = await prisma.salesPerson.findUnique({
        where: { id: normalizedSalesPersonId },
        select: { id: true },
      });
      if (!salesPerson) {
        throw new AppError('Sales person not found', 400);
      }
    }

    const item = await prisma.store.create({
      data: {
        name: input.name.trim(),
        address: input.address ?? null,
        route: input.route ?? null,
        phone: input.phone ?? null,
        salesPerson: normalizedSalesPersonId
          ? { connect: { id: normalizedSalesPersonId } }
          : undefined,
      },
      include: {
        _count: { select: { invoices: true } },
        salesPerson: { select: { id: true, name: true, phone: true } },
      },
    });

    return toDTO(item);
  }

  /**
   * PUT /api/stores/:id
   */
  static async update(id: string, input: UpdateStoreInput): Promise<StoreDTO> {
    const existing = await prisma.store.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Store not found', 404);
    }

    const updateData: any = {};
    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.address !== undefined) updateData.address = input.address;
    if (input.route !== undefined) updateData.route = input.route;
    if (input.phone !== undefined) updateData.phone = input.phone;
    if (Object.prototype.hasOwnProperty.call(input, 'salesPersonId')) {
      const normalizedSalesPersonId = String(input.salesPersonId || '').trim() || null;
      if (normalizedSalesPersonId) {
        const salesPerson = await prisma.salesPerson.findUnique({
          where: { id: normalizedSalesPersonId },
          select: { id: true },
        });
        if (!salesPerson) {
          throw new AppError('Sales person not found', 400);
        }
      }
      updateData.salesPerson = normalizedSalesPersonId
        ? { connect: { id: normalizedSalesPersonId } }
        : { disconnect: true };
    }

    const updated = await prisma.store.update({
      where: { id },
      data: updateData,
      include: {
        _count: { select: { invoices: true } },
        salesPerson: { select: { id: true, name: true, phone: true } },
      },
    });

    return toDTO(updated);
  }

  /**
   * DELETE /api/stores/:id
   * Prevents deletion if store has invoices.
   */
  static async delete(id: string): Promise<void> {
    const existing = await prisma.store.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } },
    });

    if (!existing) {
      throw new AppError('Store not found', 404);
    }

    if (existing._count.invoices > 0) {
      throw new AppError(
        `Cannot delete store with ${existing._count.invoices} existing invoice(s). Archive instead.`,
        400,
      );
    }

    await prisma.store.delete({ where: { id } });
  }
}