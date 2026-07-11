import { Request, Response } from 'express';
import { SalesPersonService } from '../services/salesPerson.service.js';
import { catchAsync } from '../utils/catchAsync.js';

export const SalesPersonController = {
  /**
   * GET /api/sales-persons
   * Query params: search, page, limit
   */
  list: catchAsync(async (req: Request, res: Response) => {
    const query = {
      search: req.query.search as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await SalesPersonService.getAll(query);

    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  }),

  /**
   * GET /api/sales-persons/:id
   */
  getById: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const salesPerson = await SalesPersonService.getById(id);
    res.status(200).json({ success: true, data: salesPerson });
  }),

  /**
   * POST /api/sales-persons
   */
  create: catchAsync(async (req: Request, res: Response) => {
    const salesPerson = await SalesPersonService.create(req.body);
    res.status(201).json({ success: true, data: salesPerson });
  }),

  /**
   * PUT /api/sales-persons/:id
   */
  update: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const salesPerson = await SalesPersonService.update(id, req.body);
    res.status(200).json({ success: true, data: salesPerson });
  }),

  /**
   * DELETE /api/sales-persons/:id
   */
  delete: catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    await SalesPersonService.delete(id);
    res.status(200).json({ success: true, message: 'Sales person deleted successfully' });
  }),
};