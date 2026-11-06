// ──────────────────────────────────────────────────────────────────────────────
// LIYANAGE DISTRIBUTORS — BACKEND TYPES
// Central DTO definitions for Store/SalesPerson/Invoice/Payment domains.
// Used for request/response contracts between controllers, services, and routes.
// ──────────────────────────────────────────────────────────────────────────────

// ── Store ──

export interface StoreRouteRelationDTO {
  id: number;
  name: string;
  routeCode?: string;
}

export interface StoreDTO {
  id: string;
  storeCode?: string;
  name: string;
  address?: string;
  routeId?: number | null;
  route?: StoreRouteRelationDTO | string;
  routeName?: string;
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
  storeCode?: string;
  address?: string;
  routeId?: number | string | null;
  route?: string;
  phone?: string;
  salesPersonId?: string;
}

export interface UpdateStoreInput {
  name?: string;
  storeCode?: string;
  address?: string;
  routeId?: number | string | null;
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

// ── Route ──

export interface RouteDTO {
  id: number;
  routeCode: string;
  name: string;
  areaCoverage?: string | null;
  deliverySchedule?: string[] | null;
  salesPerson?: {
    id: string;
    name: string;
    phone?: string;
  } | null;
  rep?: {
    id: string;
    name: string;
    phone?: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

// ── Invoice ──

export type DocType = 'Invoice' | 'CreditNote' | 'DebitNote' | 'Receipt';
export type InvoiceStatus = 'paid' | 'pending' | 'overdue' | 'cancelled';
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'credit' | 'cheque' | 'bank_slip';

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

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: string;
}

// ── User Management & Staff DTOs ──

export interface UserDTO {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export interface UpdateProfileInput {
  username?: string;
  name?: string;
  email?: string;
  currentPassword?: string;
  newPassword?: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  password?: string;
}

// ── Warehouse & Van Stock Domain Types ──

export type LocationType = 'MAIN_STORE' | 'VEHICLE' | 'DAMAGED_GOODS';

export type MovementType =
  | 'STORE_TO_VEHICLE_LOAD'
  | 'VEHICLE_TO_STORE_RETURN'
  | 'VEHICLE_SALES_OUTBOUND'
  | 'RETURN_TO_DAMAGED_POOL'
  | 'DAMAGED_WRITE_OFF'
  | 'DAMAGED_VENDOR_RETURN'
  | 'WAREHOUSE_AUDIT_ADJUSTMENT'
  | 'SUPPLIER_PURCHASE_INBOUND';

export type DamagedStatus = 'LOGGED' | 'INSPECTED' | 'WRITTEN_OFF' | 'VENDOR_RETURN';
export type VanStockStatus = 'PENDING_CONFIRMATION' | 'APPROVED' | 'REJECTED' | 'UNVERIFIED_BY_REP';

export interface InventoryLocationDTO {
  id: string;
  name: string;
  category: string;
  type: LocationType;
  vehicleId?: string | null;
  vehicleNumber?: string | null;
  driverName?: string | null;
  salesPersonId?: string | null;
  salesPersonName?: string | null;
  salesPersonPhone?: string | null;
  description?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductDTO {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  basePrice: number;
  companyDiscountPercent: number;
  targetCapacity: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  category?: string;
  unit?: string;
  basePrice?: number;
  companyDiscountPercent?: number;
  targetCapacity?: number;
  initialQuantity?: number;
}

export interface UpdateProductInput {
  sku?: string;
  name?: string;
  category?: string;
  unit?: string;
  basePrice?: number;
  companyDiscountPercent?: number;
  targetCapacity?: number;
}

export interface ProductQueryParams {
  search?: string;
  category?: string;
  page?: number;
  limit?: number;
}

export interface StockItemDTO {
  id: number;
  locationId: string;
  locationType: LocationType;
  vehicleId?: string | null;
  productId: number;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  basePrice: number;
  companyDiscountPercent: number;
  targetCapacity: number;
  status: VanStockStatus | string;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  repChecked: boolean;
  repCheckedAt?: string | null;
  discrepancyFlag: boolean;
  lastUpdatedBy?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  product?: ProductDTO;
}

export interface StockMovementDTO {
  id: number;
  movementType: MovementType;
  sourceLocation: string;
  targetLocation: string;
  productId: number;
  productName: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  previousQty?: number;
  newQty?: number;
  reference?: string | null;
  manifestNo?: string | null;
  performedBy?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface MovementQueryParams {
  startDate?: string;
  endDate?: string;
  movementType?: MovementType;
  locationId?: string;
  productId?: number;
  page?: number;
  limit?: number;
}

export interface DamagedGoodsRecordDTO {
  id: number;
  vehicleId: string;
  productId: number;
  productName: string;
  sku: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  reason: string;
  sourceInvoiceNo?: string | null;
  manifestNo?: string | null;
  reportedBy: string;
  status: DamagedStatus;
  isActive: boolean;
  resolutionNotes?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface DamagedGoodsQueryParams {
  status?: DamagedStatus;
  vehicleId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface DailyVanManifestDTO {
  id: string;
  manifestNo: string;
  manifestDate: string;
  vehicleId: string;
  vehicleNumber?: string | null;
  driverName?: string | null;
  routeId?: number | null;
  routeName?: string | null;
  salesPersonId?: string | null;
  repName?: string | null;
  repPhone?: string | null;
  ownerSignatureData?: string | null;
  ownerSignedBy?: string | null;
  ownerSignedAt?: string | null;
  repSignatureData?: string | null;
  repSignedBy?: string | null;
  repSignedAt?: string | null;
  status: string;
  manifestRevision: number;
  uncheckedCount: number;
  totalUnits: number;
  totalValue: number;
  itemsSnapshot?: any;
  items?: any[];
  createdAt: string;
  updatedAt?: string;
}

export interface ReceivePOItemInput {
  productId: number;
  quantity: number;
  basePrice?: number;
  discountPercent?: number;
}

export interface ReceivePurchaseOrderInput {
  supplierName: string;
  poNumber?: string;
  items: ReceivePOItemInput[];
  notes?: string;
  performedBy?: string;
}

export interface AdjustWarehouseStockInput {
  productId: number;
  delta: number;
  reason: string;
  notes?: string;
  performedBy?: string;
}

export interface LoadToVanInput {
  productId: number;
  quantity: number;
  repName?: string;
  notes?: string;
  vehicleId?: string;
}

export interface EditVanQtyInput {
  productId: number;
  newQuantity: number;
  notes?: string;
  performedBy?: string;
  vehicleId?: string;
}

export interface RecordRoadSaleItemInput {
  productId: number;
  quantity: number;
  unitPrice?: number;
  productName?: string;
  sku?: string;
}

export interface RecordRoadSaleInput {
  customerName?: string;
  invoiceNo?: string;
  items: RecordRoadSaleItemInput[];
  performedBy?: string;
  vehicleId?: string;
}

export interface ReturnToStoreInput {
  productId: number;
  quantity: number;
  reason?: string;
  performedBy?: string;
  vehicleId?: string;
}

export interface QuarantineDamagedInput {
  productId: number;
  fromLocation?: 'VEHICLE' | 'MAIN_STORE';
  quantity: number;
  reason: string;
  sourceInvoiceNo?: string;
  manifestNo?: string;
  sourceManifestNo?: string;
  loadDate?: string;
  reportedBy?: string;
  unitPrice?: number;
}

export interface UpdateDamagedStatusInput {
  status: DamagedStatus;
  resolutionNotes?: string;
}

export interface SignManifestByOwnerInput {
  manifestId?: string;
  dispatcherName?: string;
  signatureData?: string;
  notes?: string;
}

export interface VerifyManifestByRepInput {
  manifestNo?: string;
  signatureData?: string;
  repSignature?: string;
  signature?: string;
  repName?: string;
  items?: Array<{
    itemId: number;
    repChecked: boolean;
  }>;
}

export interface SaveOwnerSignatureInput {
  signatureData: string;
  signerName?: string;
}

export interface SystemSettingDTO {
  key: string;
  value: string;
  updatedBy?: string | null;
  updatedAt: string;
}
