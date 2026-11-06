import prisma from '../lib/prisma.ts';

function normalizeText(value) {
  const text = String(value || '').trim();
  return text.length > 0 ? text : null;
}

/**
 * Safely parses deliverySchedule column from string (LongText) to an array of day strings.
 * Supports JSON array strings as well as legacy comma-delimited strings.
 */
function parseSchedule(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
  } catch {
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Normalizes and serializes deliverySchedule array to a JSON string for LongText storage.
 */
function serializeSchedule(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => String(item || '').trim()).filter(Boolean));
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed.map((item) => String(item || '').trim()).filter(Boolean));
      }
    } catch {
      return JSON.stringify(value.split(',').map((s) => s.trim()).filter(Boolean));
    }
  }
  return JSON.stringify([]);
}

const routeController = {
  /**
   * GET /api/routes
   */
  async list(req, res) {
    try {
      const { search, page = 1, limit = 100 } = req.query;
      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const where: any = {};
      if (search) {
        where.OR = [
          { name: { contains: String(search).trim() } },
          { routeCode: { contains: String(search).trim() } },
          { areaCoverage: { contains: String(search).trim() } },
        ];
      }

      const [routes, total] = await Promise.all([
        prisma.route.findMany({
          where,
          skip,
          take: parseInt(limit, 10),
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { stores: true } },
            stores: {
              select: {
                id: true,
                name: true,
                salesPerson: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                  },
                },
              },
            },
          },
        }),
        prisma.route.count({ where }),
      ]);

      // Dynamically attach primary sales representative details and parse schedule to each route payload
      const formattedRoutes = routes.map((r: any) => {
        const primaryStoreWithRep = r.stores?.find((s: any) => s.salesPerson && s.salesPerson.phone);
        const rep = primaryStoreWithRep?.salesPerson || r.stores?.[0]?.salesPerson || null;
        return {
          ...r,
          deliverySchedule: parseSchedule(r.deliverySchedule),
          salesPerson: rep,
          rep,
        };
      });

      res.json({
        success: true,
        data: formattedRoutes,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total,
          pages: Math.ceil(total / parseInt(limit, 10)),
        },
      });
    } catch (error) {
      console.error('Error listing routes:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/routes/:id
   */
  async getById(req, res) {
    try {
      const routeId = Number(req.params.id);
      if (!Number.isInteger(routeId) || routeId <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid route id' });
      }

      const route = await prisma.route.findUnique({
        where: { id: routeId },
        include: {
          stores: {
            select: {
              id: true,
              name: true,
              storeCode: true,
              salesPerson: {
                select: { id: true, name: true, phone: true },
              },
            },
            orderBy: { name: 'asc' },
          },
          _count: { select: { stores: true } },
        },
      });

      if (!route) {
        return res.status(404).json({ success: false, error: 'Route not found' });
      }

      // Dynamically attach primary sales representative details to single route payload
      const primaryStoreWithRep = route.stores?.find((s: any) => s.salesPerson && s.salesPerson.phone);
      const rep = primaryStoreWithRep?.salesPerson || route.stores?.[0]?.salesPerson || null;

      res.json({
        success: true,
        data: {
          ...route,
          deliverySchedule: parseSchedule(route.deliverySchedule),
          salesPerson: rep,
          rep,
        },
      });
    } catch (error) {
      console.error('Error getting route:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /api/routes
   */
  async create(req, res) {
    try {
      const name = normalizeText(req.body.name);
      const areaCoverage = normalizeText(req.body.areaCoverage ?? req.body.description);
      const deliverySchedule = serializeSchedule(req.body.deliverySchedule ?? req.body.routeDates);

      if (!name) {
        return res.status(400).json({ success: false, error: 'Route name is required' });
      }

      const duplicateName = await prisma.route.findFirst({
        where: { name },
        select: { id: true },
      });

      if (duplicateName) {
        return res.status(409).json({ success: false, error: 'Route name already exists' });
      }

      const totalRoutes = await prisma.route.count();
      let nextCodeNumber = totalRoutes + 1;
      let generatedRouteCode = `RT-${String(nextCodeNumber).padStart(3, '0')}`;

      while (true) {
        const existingCode = await prisma.route.findUnique({
          where: { routeCode: generatedRouteCode },
          select: { id: true },
        });

        if (!existingCode) break;

        nextCodeNumber += 1;
        generatedRouteCode = `RT-${String(nextCodeNumber).padStart(3, '0')}`;
      }

      const route = await prisma.route.create({
        data: {
          routeCode: generatedRouteCode,
          name,
          areaCoverage,
          deliverySchedule,
        },
        include: {
          _count: { select: { stores: true } },
        },
      });

      res.status(201).json({
        success: true,
        data: {
          ...route,
          deliverySchedule: parseSchedule(route.deliverySchedule),
        },
      });
    } catch (error) {
      console.error('Error creating route:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * PUT /api/routes/:id
   */
  async update(req, res) {
    try {
      const routeId = Number(req.params.id);
      if (!Number.isInteger(routeId) || routeId <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid route id' });
      }

      const existingRoute = await prisma.route.findUnique({
        where: { id: routeId },
        select: { id: true },
      });

      if (!existingRoute) {
        return res.status(404).json({ success: false, error: 'Route not found' });
      }

      const hasName = Object.prototype.hasOwnProperty.call(req.body, 'name');
      const hasAreaCoverage =
        Object.prototype.hasOwnProperty.call(req.body, 'areaCoverage') ||
        Object.prototype.hasOwnProperty.call(req.body, 'description');
      const hasDeliverySchedule =
        Object.prototype.hasOwnProperty.call(req.body, 'deliverySchedule') ||
        Object.prototype.hasOwnProperty.call(req.body, 'routeDates');

      const name = normalizeText(req.body.name);
      if (hasName && !name) {
        return res.status(400).json({ success: false, error: 'Route name cannot be empty' });
      }

      if (hasName && name) {
        const duplicateName = await prisma.route.findFirst({
          where: {
            name,
            id: { not: routeId },
          },
          select: { id: true },
        });

        if (duplicateName) {
          return res.status(409).json({ success: false, error: 'Route name already exists' });
        }
      }

      const route = await prisma.route.update({
        where: { id: routeId },
        data: {
          ...(hasName && { name }),
          ...(hasAreaCoverage && { areaCoverage: normalizeText(req.body.areaCoverage ?? req.body.description) }),
          ...(hasDeliverySchedule && { deliverySchedule: serializeSchedule(req.body.deliverySchedule ?? req.body.routeDates) }),
        },
        include: {
          _count: { select: { stores: true } },
        },
      });

      res.json({
        success: true,
        data: {
          ...route,
          deliverySchedule: parseSchedule(route.deliverySchedule),
        },
      });
    } catch (error) {
      console.error('Error updating route:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * DELETE /api/routes/:id
   */
  async delete(req, res) {
    try {
      const routeId = Number(req.params.id);
      if (!Number.isInteger(routeId) || routeId <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid route id' });
      }

      const route = await prisma.route.findUnique({
        where: { id: routeId },
        include: {
          _count: { select: { stores: true } },
        },
      });

      if (!route) {
        return res.status(404).json({ success: false, error: 'Route not found' });
      }

      if ((route._count?.stores ?? 0) > 0) {
        return res.status(400).json({
          success: false,
          error: 'Cannot delete route with assigned stores',
        });
      }

      await prisma.route.delete({
        where: { id: routeId },
      });

      res.json({ success: true, message: 'Route deleted successfully' });
    } catch (error) {
      console.error('Error deleting route:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

export default routeController;

