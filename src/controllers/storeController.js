import prisma from '../config/prisma.js';

function normalizeSalesPersonConnectId(value) {
  const rawId = String(value || '').trim();
  if (!rawId) return null;

  // Preserve UUID/string IDs, but safely normalize purely numeric IDs.
  if (/^\d+$/.test(rawId)) {
    return String(parseInt(rawId, 10));
  }

  return rawId;
}

function normalizeRouteId(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function toMoneyNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return parseFloat(numeric.toFixed(2));
}

async function resolveRouteId(routeIdInput, routeNameInput) {
  const normalizedRouteId = normalizeRouteId(routeIdInput);
  if (normalizedRouteId) {
    const route = await prisma.route.findUnique({
      where: { id: normalizedRouteId },
      select: { id: true },
    });
    return route?.id || null;
  }

  const normalizedRouteName = String(routeNameInput || '').trim();
  if (!normalizedRouteName) return null;

  const route = await prisma.route.findUnique({
    where: { name: normalizedRouteName },
    select: { id: true },
  });

  return route?.id || null;
}

/**
 * Store Controller
 * Handles CRUD operations for Store (customer/business entities).
 */
const storeController = {
  /**
   * GET /api/stores
   * List all stores with optional search and pagination.
   */
  async list(req, res) {
    try {
      const { search, route, page = 1, limit = 50 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where = {};
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { phone: { contains: search } },
          { address: { contains: search } },
        ];
      }
      if (route) {
        const routeAsId = normalizeRouteId(route);
        if (routeAsId) {
          where.routeId = routeAsId;
        } else {
          where.route = {
            is: {
              name: String(route).trim(),
            },
          };
        }
      }

      const [stores, total] = await Promise.all([
        prisma.store.findMany({
          where,
          skip,
          take: parseInt(limit),
          orderBy: { name: 'asc' },
          include: {
            route: true,
            _count: { select: { invoices: true } },
            invoices: {
              orderBy: { date: 'desc' },
              take: 1,
              include: {
                salesPerson: true,
                store: {
                  include: { route: true },
                },
              },
            },
          },
        }),
        prisma.store.count({ where }),
      ]);

      const storeIds = stores.map((store) => store.id);
      const storePaymentRows = storeIds.length > 0
        ? await prisma.payment.findMany({
            where: {
              invoice: {
                storeId: { in: storeIds },
              },
            },
            select: {
              amountPaid: true,
              invoice: {
                select: { storeId: true },
              },
            },
          })
        : [];

      const totalPaidByStoreId = storePaymentRows.reduce((accumulator, paymentRow) => {
        const storeId = paymentRow.invoice?.storeId;
        if (!storeId) return accumulator;

        const nextTotal = toMoneyNumber((accumulator.get(storeId) || 0) + Number(paymentRow.amountPaid || 0));
        accumulator.set(storeId, nextTotal);
        return accumulator;
      }, new Map());

      const storesWithBalances = stores.map((store) => {
        const totalPaid = totalPaidByStoreId.get(store.id) || 0;
        return {
          ...store,
          totalPaid,
          totalPayments: totalPaid,
        };
      });

      res.json({
        success: true,
        data: storesWithBalances,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error('Error listing stores:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/stores/:id
   * Get a single store by ID with its invoices.
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const store = await prisma.store.findUnique({
        where: { id },
        include: {
          route: true,
          _count: { select: { invoices: true } },
          salesPerson: { select: { id: true, name: true, phone: true } },
          invoices: {
            orderBy: { date: 'desc' },
            include: {
              store: { include: { route: true } },
              salesPerson: { select: { id: true, name: true } },
              payments: true,
            },
          },
        },
      });

      if (!store) {
        return res.status(404).json({ success: false, error: 'Store not found' });
      }

      // Calculate summary metrics
      const summary = store.invoices.reduce(
        (acc, inv) => ({
          totalInvoiced: acc.totalInvoiced + Number(inv.amount),
          totalReceived: acc.totalReceived + Number(inv.received),
          totalBalanceDue: acc.totalBalanceDue + Number(inv.balanceDue),
        }),
        { totalInvoiced: 0, totalReceived: 0, totalBalanceDue: 0 }
      );

      res.json({
        success: true,
        data: { ...store, summary },
      });
    } catch (error) {
      console.error('Error getting store:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /api/stores
   * Create a new store.
   */
  async create(req, res) {
    try {
      const { name, address, route, routeId, phone, salesPersonId } = req.body;
      const normalizedName = String(name || '').trim();
      const normalizedAddress = String(address || '').trim();
      const normalizedSalesPersonId = normalizeSalesPersonConnectId(salesPersonId);
      const normalizedRouteId = await resolveRouteId(routeId, route);

      if ((routeId || route) && !normalizedRouteId) {
        return res.status(400).json({ success: false, error: 'Route not found' });
      }

      if (!normalizedName) {
        return res.status(400).json({ success: false, error: 'Store name is required' });
      }

      const existingStore = await prisma.store.findFirst({
        where: {
          name: normalizedName,
        },
        select: { id: true, name: true },
      });

      if (existingStore) {
        return res.status(409).json({
          success: false,
          error: 'Store name already exists',
        });
      }

      if (normalizedSalesPersonId) {
        const salesPerson = await prisma.salesPerson.findUnique({
          where: { id: normalizedSalesPersonId },
          select: { id: true },
        });
        if (!salesPerson) {
          return res.status(400).json({ success: false, error: 'Sales person not found' });
        }
      }

      const totalStores = await prisma.store.count();
      let nextCodeNumber = totalStores + 1;
      let generatedStoreCode = `STR-${String(nextCodeNumber).padStart(6, '0')}`;

      while (true) {
        const codeExists = await prisma.store.findUnique({
          where: { storeCode: generatedStoreCode },
          select: { id: true },
        });

        if (!codeExists) {
          break;
        }

        nextCodeNumber += 1;
        generatedStoreCode = `STR-${String(nextCodeNumber).padStart(6, '0')}`;
      }

      const store = await prisma.store.create({
        data: {
          storeCode: generatedStoreCode,
          name: normalizedName,
          address: normalizedAddress || null,
          route: normalizedRouteId ? { connect: { id: normalizedRouteId } } : undefined,
          phone,
          salesPerson: normalizedSalesPersonId
            ? { connect: { id: normalizedSalesPersonId } }
            : undefined,
        },
        include: {
          route: true,
          _count: { select: { invoices: true } },
          salesPerson: true,
        },
      });

      res.status(201).json({ success: true, data: store, ...store });
    } catch (error) {
      console.error('Error creating store:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * PUT /api/stores/:id
   * Update an existing store.
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, address, route, routeId, phone, salesPersonId } = req.body;

      const existing = await prisma.store.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Store not found' });
      }

      const hasSalesPersonKey = Object.prototype.hasOwnProperty.call(req.body, 'salesPersonId');
      const hasRouteKey =
        Object.prototype.hasOwnProperty.call(req.body, 'routeId') ||
        Object.prototype.hasOwnProperty.call(req.body, 'route');
      const normalizedSalesPersonId = normalizeSalesPersonConnectId(salesPersonId);
      const normalizedRouteId = hasRouteKey ? await resolveRouteId(routeId, route) : null;
      const hasRouteInputValue =
        normalizeRouteId(routeId) !== null ||
        String(route || '').trim().length > 0;

      if (hasRouteKey && hasRouteInputValue && !normalizedRouteId) {
        return res.status(400).json({ success: false, error: 'Route not found' });
      }
      if (hasSalesPersonKey && normalizedSalesPersonId) {
        const salesPerson = await prisma.salesPerson.findUnique({
          where: { id: normalizedSalesPersonId },
          select: { id: true },
        });
        if (!salesPerson) {
          return res.status(400).json({ success: false, error: 'Sales person not found' });
        }
      }

      const store = await prisma.store.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(address !== undefined && { address }),
          ...(phone !== undefined && { phone }),
          ...(hasRouteKey && {
            route: normalizedRouteId
              ? { connect: { id: normalizedRouteId } }
              : { disconnect: true },
          }),
          ...(hasSalesPersonKey && {
            salesPerson: normalizedSalesPersonId
              ? { connect: { id: normalizedSalesPersonId } }
              : { disconnect: true },
          }),
        },
        include: {
          route: true,
          _count: { select: { invoices: true } },
          salesPerson: true,
        },
      });

      res.json({ success: true, data: store, ...store });
    } catch (error) {
      console.error('Error updating store:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * DELETE /api/stores/:id
   * Delete a store (only if it has no invoices).
   */
  async delete(req, res) {
    try {
      const { id } = req.params;

      const store = await prisma.store.findUnique({
        where: { id },
        include: { _count: { select: { invoices: true } } },
      });

      if (!store) {
        return res.status(404).json({ success: false, error: 'Store not found' });
      }

      if (store._count.invoices > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot delete store with ${store._count.invoices} existing invoice(s). Archive instead.`,
        });
      }

      await prisma.store.delete({ where: { id } });
      res.json({ success: true, message: 'Store deleted successfully' });
    } catch (error) {
      console.error('Error deleting store:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/stores/routes
   * List all unique delivery routes.
   */
  async listRoutes(req, res) {
    try {
      const routes = await prisma.route.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          routeCode: true,
          name: true,
          areaCoverage: true,
          deliverySchedule: true,
        },
      });

      res.json({
        success: true,
        data: routes,
      });
    } catch (error) {
      console.error('Error listing routes:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

export default storeController;