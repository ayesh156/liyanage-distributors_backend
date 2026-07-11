import prisma from '../config/prisma.js';

/**
 * SalesPerson Controller
 * Handles CRUD operations for sales representatives.
 */
const salesPersonController = {
  /**
   * GET /api/sales-persons
   * List all sales persons with optional search.
   */
  async list(req, res) {
    try {
      const { search, page = 1, limit = 50 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const where = {};
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { phone: { contains: search } },
          { nic: { contains: search } },
          { email: { contains: search } },
          { address: { contains: search } },
        ];
      }

      const [salesPersons, total] = await Promise.all([
        prisma.salesPerson.findMany({
          where,
          skip,
          take: parseInt(limit),
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { invoices: true } },
          },
        }),
        prisma.salesPerson.count({ where }),
      ]);

      res.json({
        success: true,
        data: salesPersons,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      });
    } catch (error) {
      console.error('Error listing sales persons:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/sales-persons/:id
   * Get a single sales person with invoices.
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const salesPerson = await prisma.salesPerson.findUnique({
        where: { id },
        include: {
          invoices: {
            orderBy: { date: 'desc' },
            include: {
              store: { select: { id: true, name: true } },
              _count: { select: { payments: true } },
            },
          },
        },
      });

      if (!salesPerson) {
        return res.status(404).json({ success: false, error: 'Sales person not found' });
      }

      // Calculate aggregated metrics
      const metrics = salesPerson.invoices.reduce(
        (acc, inv) => ({
          totalInvoiced: acc.totalInvoiced + Number(inv.amount),
          totalCollected: acc.totalCollected + Number(inv.received),
          outstandingBalance: acc.outstandingBalance + Number(inv.balanceDue),
          invoiceCount: acc.invoiceCount + 1,
        }),
        { totalInvoiced: 0, totalCollected: 0, outstandingBalance: 0, invoiceCount: 0 }
      );

      res.json({
        success: true,
        data: { ...salesPerson, metrics },
      });
    } catch (error) {
      console.error('Error getting sales person:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /api/sales-persons
   * Create a new sales person.
   */
  async create(req, res) {
    try {
      const { name, phone, nic, email, address } = req.body;

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'Sales person name is required' });
      }

      const salesPerson = await prisma.salesPerson.create({
        data: {
          name: name.trim(),
          phone: String(phone || '').trim() || null,
          nic: String(nic || '').trim() || null,
          email: String(email || '').trim() || null,
          address: String(address || '').trim() || null,
        },
      });

      res.status(201).json({ success: true, data: salesPerson });
    } catch (error) {
      console.error('Error creating sales person:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * PUT /api/sales-persons/:id
   * Update a sales person.
   */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, phone, nic, email, address } = req.body;

      const existing = await prisma.salesPerson.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Sales person not found' });
      }

      const salesPerson = await prisma.salesPerson.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(phone !== undefined && { phone: String(phone || '').trim() || null }),
          ...(nic !== undefined && { nic: String(nic || '').trim() || null }),
          ...(email !== undefined && { email: String(email || '').trim() || null }),
          ...(address !== undefined && { address: String(address || '').trim() || null }),
        },
      });

      res.json({ success: true, data: salesPerson });
    } catch (error) {
      console.error('Error updating sales person:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * DELETE /api/sales-persons/:id
   * Delete a sales person (only if no invoices exist).
   */
  async delete(req, res) {
    try {
      const { id } = req.params;

      const sp = await prisma.salesPerson.findUnique({
        where: { id },
        include: { _count: { select: { invoices: true } } },
      });

      if (!sp) {
        return res.status(404).json({ success: false, error: 'Sales person not found' });
      }

      if (sp._count.invoices > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot delete sales person with ${sp._count.invoices} invoice(s). Archive instead.`,
        });
      }

      await prisma.salesPerson.delete({ where: { id } });
      res.json({ success: true, message: 'Sales person deleted successfully' });
    } catch (error) {
      console.error('Error deleting sales person:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

export default salesPersonController;