import prisma from '../config/prisma.js';

function normalizeText(value) {
  const text = String(value || '').trim();
  return text.length > 0 ? text : null;
}

function normalizeSchedule(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

const routeController = {
  /**
   * GET /api/routes
   */
  async list(req, res) {
    try {
      const { search, page = 1, limit = 100 } = req.query;
      const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const where = {};
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
          },
        }),
        prisma.route.count({ where }),
      ]);

      res.json({
        success: true,
        data: routes,
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
            select: { id: true, name: true, storeCode: true },
            orderBy: { name: 'asc' },
          },
          _count: { select: { stores: true } },
        },
      });

      if (!route) {
        return res.status(404).json({ success: false, error: 'Route not found' });
      }

      res.json({ success: true, data: route });
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
      const deliverySchedule = normalizeSchedule(req.body.deliverySchedule ?? req.body.routeDates);

      if (!name) {
        return res.status(400).json({ success: false, error: 'Route name is required' });
      }

      const duplicateName = await prisma.route.findUnique({
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

      res.status(201).json({ success: true, data: route });
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
          ...(hasDeliverySchedule && { deliverySchedule: normalizeSchedule(req.body.deliverySchedule ?? req.body.routeDates) }),
        },
        include: {
          _count: { select: { stores: true } },
        },
      });

      res.json({ success: true, data: route });
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

      if (route._count.stores > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot delete route with ${route._count.stores} assigned store(s).`,
        });
      }

      await prisma.route.delete({ where: { id: routeId } });

      res.json({ success: true, message: 'Route deleted successfully' });
    } catch (error) {
      console.error('Error deleting route:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

export default routeController;
