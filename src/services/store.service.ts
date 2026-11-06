import prisma from '../lib/prisma.ts';
import { AppError } from '../utils/appError.ts';
import {
  type StoreDTO,
  type CreateStoreInput,
  type UpdateStoreInput,
  type StoreQueryParams,
  type PaginatedResult,
} from '../types/index.ts';

/**
 * Normalizes a raw Store Prisma database record into a strongly-typed StoreDTO.
 * Preserves the relational route object, extracts routeId, and provides a safe
 * fallback routeName to ensure UI components never fall back to "Unassigned Route".
 *
 * @param record - Raw Store record with relations from Prisma
 * @returns Standardized StoreDTO
 */
function toDTO(record: any): StoreDTO {
  const routeObj =
    record.route && typeof record.route === 'object'
      ? {
          id: record.route.id,
          name: record.route.name,
          routeCode: record.route.routeCode,
        }
      : null;

  const resolvedRouteName =
    routeObj?.name ||
    (typeof record.route === 'string' && record.route.trim() !== '' ? record.route.trim() : null) ||
    record.routeName ||
    'Unassigned Route';

  const resolvedRouteId =
    record.routeId != null
      ? Number(record.routeId)
      : (routeObj?.id != null ? Number(routeObj.id) : null);

  return {
    id: record.id,
    storeCode: record.storeCode ?? undefined,
    name: record.name,
    address: record.address ?? undefined,
    routeId: resolvedRouteId,
    route: routeObj || resolvedRouteName,
    routeName: resolvedRouteName,
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
   * Paginated, searchable list of customer stores including related Route and SalesPerson.
   */
  static async getAll(params: StoreQueryParams): Promise<PaginatedResult<StoreDTO>> {
    const { search, route: routeFilter, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q } },
        { phone: { contains: q } },
        { address: { contains: q } },
      ];
    }

    if (routeFilter && routeFilter.trim()) {
      const q = routeFilter.trim();
      const parsedId = Number(q);
      if (!Number.isNaN(parsedId) && parsedId > 0) {
        where.routeId = parsedId;
      } else {
        where.route = { name: q };
      }
    }

    const [total, items] = await Promise.all([
      prisma.store.count({ where }),
      prisma.store.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          route: { select: { id: true, name: true, routeCode: true } },
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
   * List all unique delivery route names directly from the Route model.
   */
  static async listRoutes(): Promise<string[]> {
    const routes = await prisma.route.findMany({
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return routes.map((r: { name: string }) => r.name).filter(Boolean);
  }

  /**
   * GET /api/stores/:id
   * Retrieves full store details, active relational route, assigned sales rep, and invoices.
   */
  static async getById(id: string): Promise<StoreDTO> {
    const item = await prisma.store.findUnique({
      where: { id },
      include: {
        route: { select: { id: true, name: true, routeCode: true } },
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
   * Creates a new Store with optional routeId relational assignment and assigned sales person.
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

    // Resolve assigned route ID: prefer explicit routeId, fallback to route name lookup
    let assignedRouteId: number | null = null;
    if (input.routeId !== undefined && input.routeId !== null && String(input.routeId).trim() !== '') {
      const parsedRouteId = Number(input.routeId);
      if (!Number.isNaN(parsedRouteId)) {
        const routeExists = await prisma.route.findUnique({
          where: { id: parsedRouteId },
          select: { id: true },
        });
        if (!routeExists) {
          throw new AppError(`Delivery route with ID ${parsedRouteId} does not exist`, 400);
        }
        assignedRouteId = parsedRouteId;
      }
    } else if (input.route && typeof input.route === 'string' && input.route.trim() !== '') {
      const matchedRoute = await prisma.route.findFirst({
        where: { name: input.route.trim() },
        select: { id: true },
      });
      if (matchedRoute) {
        assignedRouteId = matchedRoute.id;
      }
    }

    const item = await prisma.store.create({
      data: {
        name: input.name.trim(),
        storeCode: input.storeCode ?? null,
        address: input.address ?? null,
        routeId: assignedRouteId,
        phone: input.phone ?? null,
        salesPersonId: normalizedSalesPersonId,
      },
      include: {
        route: { select: { id: true, name: true, routeCode: true } },
        _count: { select: { invoices: true } },
        salesPerson: { select: { id: true, name: true, phone: true } },
      },
    });

    return toDTO(item);
  }

  /**
   * PUT /api/stores/:id
   * Updates store details, adjusting relational routeId and salesPersonId connections safely.
   */
  static async update(id: string, input: UpdateStoreInput): Promise<StoreDTO> {
    const existing = await prisma.store.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Store not found', 404);
    }

    const updateData: any = {};
    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.storeCode !== undefined) updateData.storeCode = input.storeCode;
    if (input.address !== undefined) updateData.address = input.address;
    if (input.phone !== undefined) updateData.phone = input.phone;

    // Relational route update: support routeId (preferred) or route name fallback
    if (input.routeId !== undefined) {
      if (input.routeId === null || String(input.routeId).trim() === '') {
        updateData.routeId = null;
      } else {
        const parsedRouteId = Number(input.routeId);
        if (!Number.isNaN(parsedRouteId)) {
          const routeExists = await prisma.route.findUnique({
            where: { id: parsedRouteId },
            select: { id: true },
          });
          if (!routeExists) {
            throw new AppError(`Delivery route with ID ${parsedRouteId} does not exist`, 400);
          }
          updateData.routeId = parsedRouteId;
        }
      }
    } else if (input.route !== undefined) {
      const routeValue = String(input.route || '').trim();
      if (!routeValue) {
        updateData.routeId = null;
      } else {
        const matchedRoute = await prisma.route.findFirst({
          where: { name: routeValue },
          select: { id: true },
        });
        updateData.routeId = matchedRoute ? matchedRoute.id : null;
      }
    }

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
      updateData.salesPersonId = normalizedSalesPersonId;
    }

    const updated = await prisma.store.update({
      where: { id },
      data: updateData,
      include: {
        route: { select: { id: true, name: true, routeCode: true } },
        _count: { select: { invoices: true } },
        salesPerson: { select: { id: true, name: true, phone: true } },
      },
    });

    return toDTO(updated);
  }

  /**
   * DELETE /api/stores/:id
   * Prevents deletion if store has existing ledger invoices.
   */
  /**
   * DELETE /api/stores/:id
   * Deletes a store by ID, ensuring no linked invoices exist before deletion.
   */
  static async delete(id: string): Promise<void> {
    const existing = await prisma.store.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } },
    });

    if (!existing) {
      throw new AppError('Store not found', 404);
    }

    if ((existing._count?.invoices ?? 0) > 0) {
      throw new AppError('Cannot delete store with existing invoices', 400);
    }

    await prisma.store.delete({
      where: { id },
    });
  }
}
