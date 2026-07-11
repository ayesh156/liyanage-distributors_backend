import prisma from '../lib/prisma.js';
import { AppError } from '../utils/appError.js';
import {
  SalesPersonDTO,
  CreateSalesPersonInput,
  UpdateSalesPersonInput,
  SalesPersonQueryParams,
  PaginatedResult,
} from '../types/index.js';

function toDTO(record: any): SalesPersonDTO {
  return {
    id: record.id,
    name: record.name,
    phone: record.phone ?? undefined,
    invoiceCount: record._count?.invoices ?? 0,
    createdAt: record.createdAt?.toISOString(),
    updatedAt: record.updatedAt?.toISOString(),
  };
}

export class SalesPersonService {
  /**
   * GET /api/sales-persons
   * Paginated, searchable list of sales persons.
   */
  static async getAll(params: SalesPersonQueryParams): Promise<PaginatedResult<SalesPersonDTO>> {
    const { search, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.salesPerson.count({ where }),
      prisma.salesPerson.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { _count: { select: { invoices: true } } },
      }),
    ]);

    const pages = Math.ceil(total / limit);

    return {
      data: items.map(toDTO),
      pagination: { page, limit, total, pages },
    };
  }

  /**
   * GET /api/sales-persons/:id
   */
  static async getById(id: string): Promise<SalesPersonDTO> {
    const item = await prisma.salesPerson.findUnique({
      where: { id },
      include: {
        _count: { select: { invoices: true } },
        invoices: {
          orderBy: { date: 'desc' },
          include: {
            store: { select: { id: true, name: true } },
            _count: { select: { payments: true } },
          },
        },
      },
    });

    if (!item) {
      throw new AppError('Sales person not found', 404);
    }

    return {
      ...toDTO(item),
      invoices: item.invoices,
    } as any;
  }

  /**
   * POST /api/sales-persons
   */
  static async create(input: CreateSalesPersonInput): Promise<SalesPersonDTO> {
    if (!input.name || input.name.trim().length === 0) {
      throw new AppError('Sales person name is required', 400);
    }

    const item = await prisma.salesPerson.create({
      data: {
        name: input.name.trim(),
        phone: input.phone ?? null,
      },
      include: { _count: { select: { invoices: true } } },
    });

    return toDTO(item);
  }

  /**
   * PUT /api/sales-persons/:id
   */
  static async update(id: string, input: UpdateSalesPersonInput): Promise<SalesPersonDTO> {
    const existing = await prisma.salesPerson.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError('Sales person not found', 404);
    }

    const updateData: any = {};
    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.phone !== undefined) updateData.phone = input.phone;

    const updated = await prisma.salesPerson.update({
      where: { id },
      data: updateData,
      include: { _count: { select: { invoices: true } } },
    });

    return toDTO(updated);
  }

  /**
   * DELETE /api/sales-persons/:id
   * Prevents deletion if sales person has invoices.
   */
  static async delete(id: string): Promise<void> {
    const existing = await prisma.salesPerson.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } },
    });

    if (!existing) {
      throw new AppError('Sales person not found', 404);
    }

    if (existing._count.invoices > 0) {
      throw new AppError(
        `Cannot delete sales person with ${existing._count.invoices} invoice(s). Archive instead.`,
        400,
      );
    }

    await prisma.salesPerson.delete({ where: { id } });
  }
}