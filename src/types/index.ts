// ──────────────────────────────────────────────────────────────────────────────
// LIYANAGE DISTRIBUTORS — BACKEND TYPES
// Central DTO definitions for Store/SalesPerson/Invoice/Payment domains.
// Used for request/response contracts between controllers, services, and routes.
// ──────────────────────────────────────────────────────────────────────────────

// ── Store ──

export interface StoreDTO {
  id: string;
  name: string;
  address?: string;
  route?: string;
  phone?: string;
  salesPersonId?: string;
  salesPerson?: {
    id: string;
    name: string;
    phone?: string;
  };
  invoiceCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateStoreInput {
  name: string;
  address?: string;
  route?: string;
  phone?: string;
  salesPersonId?: string;
}

export interface UpdateStoreInput {
  name?: string;
  address?: string;
  route?: string;
  phone?: string;
  salesPersonId?: string | null;
}

// ── Sales Person ──

export interface SalesPersonDTO {
  id: string;
  name: string;
  phone?: string;
  invoiceCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateSalesPersonInput {
  name: string;
  phone?: string;
}

export interface UpdateSalesPersonInput {
  name?: string;
  phone?: string;
}

// ── Invoice ──

export type DocType = 'Invoice' | 'CreditNote' | 'DebitNote' | 'Receipt';
export type InvoiceStatus = 'paid' | 'pending' | 'overdue' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'credit' | 'cheque';

export interface InvoiceDTO {
  id: string;
  documentNo: string;
  date: string;
  docType: DocType;
  description?: string;
  amount: number;
  received: number;
  balanceDue: number;
  status: InvoiceStatus;
  chequeNo?: string;
  storeId: string;
  storeName?: string;
  storeRoute?: string;
  salesPersonId: string;
  salesPersonName?: string;
  payments?: PaymentDTO[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateInvoiceInput {
  storeId: string;
  salesPersonId: string;
  date?: string;
  docType?: DocType;
  description?: string;
  amount: number;
  received?: number;
  chequeNo?: string;
  status?: InvoiceStatus;
}

export interface UpdateInvoiceInput {
  description?: string;
  chequeNo?: string;
  status?: InvoiceStatus;
  date?: string;
}

// ── Payment ──

export interface PaymentDTO {
  id: string;
  date: string;
  amountPaid: number;
  description?: string;
  paymentMethod: PaymentMethod;
  chequeNo?: string;
  invoiceId: string;
  invoiceDocumentNo?: string;
  invoiceAmount?: number;
  invoiceBalanceDue?: number;
  invoiceStatus?: InvoiceStatus;
  storeName?: string;
}

export interface CreatePaymentInput {
  invoiceId: string;
  date?: string;
  amountPaid: number;
  description?: string;
  paymentMethod?: PaymentMethod;
  chequeNo?: string;
}

export interface BulkPaymentInput {
  payments: Array<{
    invoiceId: string;
    date?: string;
    amountPaid: number;
    description?: string;
    paymentMethod?: PaymentMethod;
    chequeNo?: string;
  }>;
}

// ── Pagination ──

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ── API Response Wrapper ──

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: PaginationMeta;
}

// ── Invoice Summary ──

export interface InvoiceSummary {
  totalBilled: number;
  totalReceived: number;
  totalOutstanding: number;
  count: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  collectionRate: string;
}

// ── Query Params ──

export interface StoreQueryParams {
  search?: string;
  route?: string;
  page?: number;
  limit?: number;
}

export interface SalesPersonQueryParams {
  search?: string;
  page?: number;
  limit?: number;
}

export interface InvoiceQueryParams {
  search?: string;
  storeId?: string;
  salesPersonId?: string;
  status?: InvoiceStatus;
  docType?: DocType;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface PaymentQueryParams {
  invoiceId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}