// ─────────────────────────────────────────────────────────────
// LIYANAGE DISTRIBUTORS - SYSTEM DATA SEEDER
// Seeds Stores, SalesPersons, Invoices, and Payments
// with production-realistic Sri Lankan hardware business data.
// Uses Prisma 7 adapter pattern for database connectivity.
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import bcrypt from 'bcryptjs';

const adapterUrl = process.env.DATABASE_URL;
if (!adapterUrl) {
  console.error('❌ DATABASE_URL environment variable is not set.');
  console.error('   Create a .env file with: DATABASE_URL="mysql://root:password@localhost:3306/liyanage_distributors"');
  process.exit(1);
}
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(adapterUrl),
});

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  DATABASE SEEDER - Liyanage Distributors');
  console.log('═══════════════════════════════════════════════\n');

  // ── Step 1: Clear existing data in dependency order ──────
  console.log('🗑️  Clearing existing data...');
  await prisma.payment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.salesPerson.deleteMany();
  await prisma.store.deleteMany();
  await prisma.route.deleteMany();
  console.log('✅ All tables cleared.\n');

  // ── Step 1.1: Seed authentication admin user ──────────────
  console.log('🔐 Seeding default admin user...');
  const hashedPassword = await bcrypt.hash('admin', 12);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });
  console.log('✅ Default admin created (username: admin).\n');

  // ── Step 2: Seed Routes + Stores (Customer/Business Entities) ─────
  console.log('🛣️  Seeding Routes...');

  const routes = await Promise.all([
    prisma.route.create({ data: { routeCode: 'RT-001', name: 'Kandy - Central', areaCoverage: 'Kandy commercial zone', deliverySchedule: ['Monday', 'Thursday'] } }),
    prisma.route.create({ data: { routeCode: 'RT-002', name: 'Kurunegala - North Western', areaCoverage: 'Kurunegala wholesale and retail belt', deliverySchedule: ['Tuesday', 'Friday'] } }),
    prisma.route.create({ data: { routeCode: 'RT-003', name: 'Colombo - Western', areaCoverage: 'Colombo metro distribution network', deliverySchedule: ['Monday', 'Wednesday', 'Saturday'] } }),
    prisma.route.create({ data: { routeCode: 'RT-004', name: 'Galle - Southern', areaCoverage: 'Galle town and coastal hardware line', deliverySchedule: ['Wednesday', 'Saturday'] } }),
    prisma.route.create({ data: { routeCode: 'RT-005', name: 'Batticaloa - Eastern', areaCoverage: 'Eastern province industrial route', deliverySchedule: ['Tuesday', 'Thursday'] } }),
    prisma.route.create({ data: { routeCode: 'RT-006', name: 'Matale - Central', areaCoverage: 'Matale and nearby engineering shops', deliverySchedule: ['Friday'] } }),
    prisma.route.create({ data: { routeCode: 'RT-007', name: 'Hambantota - Southern', areaCoverage: 'Hambantota and southern corridor', deliverySchedule: ['Monday', 'Friday'] } }),
    prisma.route.create({ data: { routeCode: 'RT-008', name: 'Wattala - Western', areaCoverage: 'Wattala city and suburbs', deliverySchedule: ['Tuesday', 'Saturday'] } }),
    prisma.route.create({ data: { routeCode: 'RT-009', name: 'Polonnaruwa - North Central', areaCoverage: 'North central mixed retail route', deliverySchedule: ['Thursday'] } }),
    prisma.route.create({ data: { routeCode: 'RT-010', name: 'Kadawatha - Western', areaCoverage: 'Kadawatha logistics-heavy zone', deliverySchedule: ['Monday', 'Thursday'] } }),
  ]);

  const routeByName = Object.fromEntries(routes.map((route) => [route.name, route]));
  console.log(`✅ Created ${routes.length} routes.\n`);

  console.log('🏪 Seeding Stores...');

  const stores = await Promise.all([
    prisma.store.create({
      data: {
        id: 'store-001',
        name: 'Shanthi Electricals',
        address: '45, Main Street, Kandy',
        routeId: routeByName['Kandy - Central'].id,
        phone: '+94 81 222 3456',
      },
    }),
    prisma.store.create({
      data: {
        id: 'store-002',
        name: 'Samagi Electrical Center',
        address: '78, Colombo Road, Kurunegala',
        routeId: routeByName['Kurunegala - North Western'].id,
        phone: '+94 37 222 7890',
      },
    }),
    prisma.store.create({
      data: {
        id: 'store-003',
        name: 'Metro Electrical House',
        address: '156, Galle Road, Colombo 04',
        routeId: routeByName['Colombo - Western'].id,
        phone: '+94 11 259 4567',
      },
    }),
    prisma.store.create({
      data: {
        id: 'store-004',
        name: 'Lanka Lighting Center',
        address: '23, Hospital Road, Galle',
        routeId: routeByName['Galle - Southern'].id,
        phone: '+94 91 222 5678',
      },
    }),
    prisma.store.create({
      data: {
        id: 'store-005',
        name: 'Jayantha Hardware & Electricals',
        address: '89, Trinco Road, Batticaloa',
        routeId: routeByName['Batticaloa - Eastern'].id,
        phone: '+94 65 222 3456',
      },
    }),
    prisma.store.create({
      data: {
        id: 'store-006',
        name: 'Nipuna Engineering Solutions',
        address: '12, Dambulla Road, Matale',
        routeId: routeByName['Matale - Central'].id,
        phone: '+94 66 222 8901',
      },
    }),
    prisma.store.create({
      data: {
        id: 'store-007',
        name: 'Ruhunu Electrical Suppliers',
        address: '55, Matara Road, Hambantota',
        routeId: routeByName['Hambantota - Southern'].id,
        phone: '+94 47 222 1234',
      },
    }),
    prisma.store.create({
      data: {
        id: 'store-008',
        name: 'Ceylon Cable Networks',
        address: '210, Negombo Road, Wattala',
        routeId: routeByName['Wattala - Western'].id,
        phone: '+94 11 293 4567',
      },
    }),
    prisma.store.create({
      data: {
        id: 'store-009',
        name: 'Delta Industrial Supplies',
        address: '67, Anuradhapura Road, Polonnaruwa',
        routeId: routeByName['Polonnaruwa - North Central'].id,
        phone: '+94 27 222 6789',
      },
    }),
    prisma.store.create({
      data: {
        id: 'store-010',
        name: 'Prime Electrical Trading',
        address: '34, Kandy Road, Kadawatha',
        routeId: routeByName['Kadawatha - Western'].id,
        phone: '+94 11 277 8901',
      },
    }),
  ]);

  console.log(`✅ Created ${stores.length} stores.\n`);

  // ── Step 3: Seed SalesPersons ─────────────────────────────
  console.log('👤 Seeding Sales Persons...');

  const salesPersons = await Promise.all([
    prisma.salesPerson.create({
      data: {
        id: 'sp-001',
        name: 'Sunil Perera',
        phone: '+94 71 555 1234',
      },
    }),
    prisma.salesPerson.create({
      data: {
        id: 'sp-002',
        name: 'Chaminda Silva',
        phone: '+94 77 888 4567',
      },
    }),
    prisma.salesPerson.create({
      data: {
        id: 'sp-003',
        name: 'Priyantha Jayawardena',
        phone: '+94 70 222 7890',
      },
    }),
    prisma.salesPerson.create({
      data: {
        id: 'sp-004',
        name: 'Dinesh Wickramasinghe',
        phone: '+94 76 333 2468',
      },
    }),
    prisma.salesPerson.create({
      data: {
        id: 'sp-005',
        name: 'Nimal Rajapaksha',
        phone: '+94 78 444 1357',
      },
    }),
  ]);

  console.log(`✅ Created ${salesPersons.length} sales persons.\n`);

  // ── Step 4: Seed Invoices with Payments ──────────────────
  console.log('📄 Seeding Invoices and Payments...');

  let createdInvoiceCount = 0;

  // Helper to create an invoice with optional payments
  async function createInvoiceWithPayments(invoiceData) {
    const {
      documentNo,
      date,
      docType = 'Invoice',
      description,
      amount,
      received = 0,
      status,
      chequeNo = null,
      storeId,
      salesPersonId,
      payments = [],
    } = invoiceData;

    const amountDecimal = parseFloat(amount);
    const receivedDecimal = parseFloat(received);
    const balanceDue = amountDecimal - receivedDecimal;

    const invoice = await prisma.invoice.create({
      data: {
        documentNo,
        date: new Date(date),
        docType,
        description,
        amount: amountDecimal,
        received: receivedDecimal,
        balanceDue,
        status,
        chequeNo,
        storeId,
        salesPersonId,
      },
    });

    // Create payment records if any
    for (const payment of payments) {
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          date: new Date(payment.date),
          amountPaid: parseFloat(payment.amountPaid),
          description: payment.description || `Payment for ${documentNo}`,
          paymentMethod: payment.paymentMethod || 'cash',
          chequeNo: payment.chequeNo || null,
        },
      });
    }

    createdInvoiceCount += 1;
    return invoice;
  }

  // ── INVOICE SET 1: Shanthi Electricals (store-001) ─────────
  // Sales Person: Sunil Perera (sp-001)

  await createInvoiceWithPayments({
    documentNo: 'INV-2600001',
    date: '2026-06-01',
    description: 'Supply of electrical cables, switches, and lighting fixtures',
    amount: 245000.00,
    received: 245000.00,
    status: 'paid',
    storeId: 'store-001',
    salesPersonId: 'sp-001',
    payments: [
      { date: '2026-06-01', amountPaid: '245000.00', paymentMethod: 'cash', description: 'Full payment - cash' },
    ],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600002',
    date: '2026-06-05',
    description: 'MCBs, distribution boards, and wiring accessories',
    amount: 182000.00,
    received: 100000.00,
    status: 'pending',
    storeId: 'store-001',
    salesPersonId: 'sp-001',
    payments: [
      { date: '2026-06-05', amountPaid: '100000.00', paymentMethod: 'cash', description: 'Partial payment' },
    ],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600003',
    date: '2026-06-10',
    description: 'LED panel lights, emergency lights, and fans',
    amount: 98000.00,
    received: 0,
    status: 'pending',
    storeId: 'store-001',
    salesPersonId: 'sp-001',
    payments: [],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600004',
    date: '2026-06-15',
    description: 'Copper cables, flexible wires, and switch gears - CHQ-458201',
    amount: 315000.00,
    received: 315000.00,
    status: 'paid',
    chequeNo: 'CHQ-458201',
    storeId: 'store-001',
    salesPersonId: 'sp-001',
    payments: [
      { date: '2026-06-15', amountPaid: '315000.00', paymentMethod: 'cheque', chequeNo: 'CHQ-458201', description: 'Payment by cheque CHQ-458201' },
    ],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600005',
    date: '2026-06-20',
    description: 'Street lighting equipment and accessories',
    amount: 420000.00,
    received: 200000.00,
    status: 'pending',
    storeId: 'store-001',
    salesPersonId: 'sp-001',
    payments: [
      { date: '2026-06-20', amountPaid: '200000.00', paymentMethod: 'bank_transfer', description: 'Advance payment - bank transfer' },
    ],
  });

  // ── INVOICE SET 2: Samagi Electrical Center (store-002) ────
  // Sales Person: Chaminda Silva (sp-002)

  await createInvoiceWithPayments({
    documentNo: 'INV-2600006',
    date: '2026-06-03',
    description: 'House wiring cables, sockets, and switches bulk order',
    amount: 168000.00,
    received: 168000.00,
    status: 'paid',
    storeId: 'store-002',
    salesPersonId: 'sp-002',
    payments: [
      { date: '2026-06-03', amountPaid: '168000.00', paymentMethod: 'cash', description: 'Full settlement' },
    ],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600007',
    date: '2026-06-08',
    description: 'Industrial cables, 3-phase distribution boards',
    amount: 289000.00,
    received: 150000.00,
    status: 'pending',
    storeId: 'store-002',
    salesPersonId: 'sp-002',
    payments: [
      { date: '2026-06-08', amountPaid: '150000.00', paymentMethod: 'bank_transfer', description: 'Partial bank transfer' },
    ],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600008',
    date: '2026-06-14',
    description: 'Solar panel wiring kits and inverters',
    amount: 550000.00,
    received: 0,
    status: 'pending',
    storeId: 'store-002',
    salesPersonId: 'sp-002',
    payments: [],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600009',
    date: '2026-06-22',
    description: 'UPS systems, batteries, and voltage stabilizers',
    amount: 175000.00,
    received: 175000.00,
    status: 'paid',
    chequeNo: 'CHQ-789012',
    storeId: 'store-002',
    salesPersonId: 'sp-002',
    payments: [
      { date: '2026-06-22', amountPaid: '175000.00', paymentMethod: 'cheque', chequeNo: 'CHQ-789012', description: 'Cheque payment' },
    ],
  });

  // ── INVOICE SET 3: Metro Electrical House (store-003) ─────
  // Sales Person: Priyantha Jayawardena (sp-003)

  await createInvoiceWithPayments({
    documentNo: 'INV-2600010',
    date: '2026-06-02',
    description: 'HVAC electrical components, contactors, relays',
    amount: 395000.00,
    received: 200000.00,
    status: 'pending',
    storeId: 'store-003',
    salesPersonId: 'sp-003',
    payments: [
      { date: '2026-06-02', amountPaid: '200000.00', paymentMethod: 'cash', description: 'Initial payment' },
    ],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600011',
    date: '2026-06-07',
    description: 'Security camera systems, CCTV cables, and accessories',
    amount: 280000.00,
    received: 280000.00,
    status: 'paid',
    storeId: 'store-003',
    salesPersonId: 'sp-003',
    payments: [
      { date: '2026-06-07', amountPaid: '280000.00', paymentMethod: 'bank_transfer', description: 'Full payment' },
    ],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600012',
    date: '2026-06-12',
    description: 'Fire alarm panels, smoke detectors, emergency systems',
    amount: 445000.00,
    received: 100000.00,
    status: 'pending',
    storeId: 'store-003',
    salesPersonId: 'sp-003',
    payments: [
      { date: '2026-06-12', amountPaid: '100000.00', paymentMethod: 'cash', description: 'Advance payment' },
    ],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600013',
    date: '2026-06-18',
    description: 'Electrical conduit pipes, fittings, and junction boxes',
    amount: 132000.00,
    received: 0,
    status: 'overdue',
    storeId: 'store-003',
    salesPersonId: 'sp-003',
    payments: [],
  });

  await createInvoiceWithPayments({
    documentNo: 'INV-2600014',
    date: '2026-06-25',
    description: 'Generator control panels and ATS systems',
    amount: 620000.00,
    received: 300000.00,
    status: 'pending',
    storeId: 'store-003',
    salesPersonId: 'sp-003',
    payments: [
      { date: '2026-06-25', amountPaid: '300000.00', paymentMethod: 'bank_transfer', description: 'Partial payment' },
    ],
  });

  // ── INVOICE SET 4: Other Stores ────────────────────────────

  // Lanka Lighting Center (store-004) - Sales Person: Dinesh (sp-004)
  await createInvoiceWithPayments({
    documentNo: 'INV-2600015',
    date: '2026-06-04',
    description: 'Decorative LED lighting, chandeliers, and bulbs',
    amount: 198000.00,
    received: 198000.00,
    status: 'paid',
    storeId: 'store-004',
    salesPersonId: 'sp-004',
    payments: [
      { date: '2026-06-04', amountPaid: '198000.00', paymentMethod: 'cash', description: 'Full payment' },
    ],
  });

  // Jayantha Hardware (store-005) - Sales Person: Nimal (sp-005)
  await createInvoiceWithPayments({
    documentNo: 'INV-2600016',
    date: '2026-06-09',
    description: 'General hardware items, power tools, and electrical fittings',
    amount: 256000.00,
    received: 256000.00,
    status: 'paid',
    storeId: 'store-005',
    salesPersonId: 'sp-005',
    payments: [
      { date: '2026-06-09', amountPaid: '256000.00', paymentMethod: 'cash', description: 'Cash settlement' },
    ],
  });

  // Nipuna Engineering (store-006) - Sales Person: Sunil (sp-001)
  await createInvoiceWithPayments({
    documentNo: 'INV-2600017',
    date: '2026-06-11',
    description: 'Engineering equipment motors, drives, and controllers',
    amount: 485000.00,
    received: 200000.00,
    status: 'pending',
    storeId: 'store-006',
    salesPersonId: 'sp-001',
    payments: [
      { date: '2026-06-11', amountPaid: '200000.00', paymentMethod: 'bank_transfer', description: 'Deposit' },
    ],
  });

  // Ruhunu Electrical (store-007) - Sales Person: Chaminda (sp-002)
  await createInvoiceWithPayments({
    documentNo: 'INV-2600018',
    date: '2026-06-16',
    description: 'Telecom cables, fiber optics accessories',
    amount: 178000.00,
    received: 100000.00,
    status: 'pending',
    storeId: 'store-007',
    salesPersonId: 'sp-002',
    payments: [
      { date: '2026-06-16', amountPaid: '100000.00', paymentMethod: 'cash', description: 'Half payment' },
    ],
  });

  // Ceylon Cable Networks (store-008) - Sales Person: Priyantha (sp-003)
  await createInvoiceWithPayments({
    documentNo: 'INV-2600019',
    date: '2026-06-19',
    description: 'Bulk network cables, RJ45 connectors, patch panels',
    amount: 210000.00,
    received: 210000.00,
    status: 'paid',
    chequeNo: 'CHQ-563421',
    storeId: 'store-008',
    salesPersonId: 'sp-003',
    payments: [
      { date: '2026-06-19', amountPaid: '210000.00', paymentMethod: 'cheque', chequeNo: 'CHQ-563421', description: 'Cheque CHQ-563421' },
    ],
  });

  // Delta Industrial (store-009) - Sales Person: Dinesh (sp-004)
  await createInvoiceWithPayments({
    documentNo: 'INV-2600020',
    date: '2026-06-21',
    description: 'Industrial automation components, sensors, PLC cables',
    amount: 520000.00,
    received: 0,
    status: 'overdue',
    storeId: 'store-009',
    salesPersonId: 'sp-004',
    payments: [],
  });

  // Prime Electrical (store-010) - Sales Person: Nimal (sp-005)
  await createInvoiceWithPayments({
    documentNo: 'INV-2600021',
    date: '2026-06-24',
    description: 'Wiring harnesses, terminal blocks, cable management',
    amount: 145000.00,
    received: 145000.00,
    status: 'paid',
    storeId: 'store-010',
    salesPersonId: 'sp-005',
    payments: [
      { date: '2026-06-24', amountPaid: '145000.00', paymentMethod: 'cash', description: 'Cash payment' },
    ],
  });

  // Shanthi Electricals - another pending (store-001) - sp-001
  await createInvoiceWithPayments({
    documentNo: 'INV-2600022',
    date: '2026-06-26',
    description: 'Water pump controllers, pressure switches, and starters',
    amount: 92000.00,
    received: 0,
    status: 'pending',
    storeId: 'store-001',
    salesPersonId: 'sp-001',
    payments: [],
  });

  // Samagi Electrical - overdue (store-002) - sp-002
  await createInvoiceWithPayments({
    documentNo: 'INV-2600023',
    date: '2026-05-20',
    description: 'Air conditioning electrical components and wiring',
    amount: 367000.00,
    received: 50000.00,
    status: 'overdue',
    storeId: 'store-002',
    salesPersonId: 'sp-002',
    payments: [
      { date: '2026-05-20', amountPaid: '50000.00', paymentMethod: 'cash', description: 'Partial - overdue balance' },
    ],
  });

  // Metro Electrical - paid via cheque (store-003) - sp-003
  await createInvoiceWithPayments({
    documentNo: 'INV-2600024',
    date: '2026-06-28',
    description: 'Earthing rods, lightning arrestors, and grounding cables',
    amount: 84000.00,
    received: 84000.00,
    status: 'paid',
    chequeNo: 'CHQ-901234',
    storeId: 'store-003',
    salesPersonId: 'sp-003',
    payments: [
      { date: '2026-06-28', amountPaid: '84000.00', paymentMethod: 'cheque', chequeNo: 'CHQ-901234', description: 'Cheque CHQ-901234' },
    ],
  });

  // ── Multi-year scenario expansion (2024-2026) for temporal analytics ──
  const multiYearScenarios = [
    { date: '2024-02-12', storeId: 'store-004', salesPersonId: 'sp-004', amount: 176000, received: 176000, description: 'Decorative lighting full settlement', paymentMethod: 'cash' },
    { date: '2024-03-07', storeId: 'store-002', salesPersonId: 'sp-002', amount: 228000, received: 110000, description: 'Industrial wiring partial settlement', paymentMethod: 'bank_transfer' },
    { date: '2024-04-19', storeId: 'store-009', salesPersonId: 'sp-004', amount: 342000, received: 0, description: 'Automation panel order with heavy carry' },
    { date: '2024-06-03', storeId: 'store-001', salesPersonId: 'sp-001', amount: 195000, received: 50000, description: 'Switchgear and breaker stock top-up', paymentMethod: 'cash' },
    { date: '2024-08-26', storeId: 'store-007', salesPersonId: 'sp-002', amount: 410000, received: 210000, description: 'Telecom accessory distribution run', paymentMethod: 'bank_transfer' },
    { date: '2024-11-14', storeId: 'store-005', salesPersonId: 'sp-005', amount: 132500, received: 132500, description: 'End-year branch replenishment', paymentMethod: 'cheque', chequeNo: 'CHQ-240114' },

    { date: '2025-01-10', storeId: 'store-003', salesPersonId: 'sp-003', amount: 520000, received: 200000, description: 'Security systems quarter-1 rollout', paymentMethod: 'bank_transfer' },
    { date: '2025-03-18', storeId: 'store-006', salesPersonId: 'sp-001', amount: 287000, received: 0, description: 'Motor drives and controls delayed settlement' },
    { date: '2025-05-05', storeId: 'store-008', salesPersonId: 'sp-003', amount: 164000, received: 164000, description: 'Cabling accessories full payment', paymentMethod: 'cash' },
    { date: '2025-07-27', storeId: 'store-010', salesPersonId: 'sp-005', amount: 301000, received: 120000, description: 'Terminal block batch with part collection', paymentMethod: 'cash' },
    { date: '2025-09-09', storeId: 'store-001', salesPersonId: 'sp-001', amount: 448000, received: 228000, description: 'Large cable project with staged payments', paymentMethod: 'bank_transfer' },
    { date: '2025-12-21', storeId: 'store-002', salesPersonId: 'sp-002', amount: 99000, received: 99000, description: 'Year-end closeout and settlement', paymentMethod: 'cheque', chequeNo: 'CHQ-251221' },

    { date: '2026-01-15', storeId: 'store-009', salesPersonId: 'sp-004', amount: 635000, received: 150000, description: 'Heavy industrial controls outstanding carry', paymentMethod: 'bank_transfer' },
    { date: '2026-02-11', storeId: 'store-004', salesPersonId: 'sp-004', amount: 82000, received: 82000, description: 'Fast-moving LED inventory full paid', paymentMethod: 'cash' },
    { date: '2026-03-30', storeId: 'store-007', salesPersonId: 'sp-002', amount: 257000, received: 99000, description: 'Southern route distribution partial paid', paymentMethod: 'cash' },
    { date: '2026-04-24', storeId: 'store-003', salesPersonId: 'sp-003', amount: 470000, received: 0, description: 'Project order awaiting collection' },
    { date: '2026-05-17', storeId: 'store-006', salesPersonId: 'sp-001', amount: 188000, received: 188000, description: 'Engineering accessories same-day settlement', paymentMethod: 'cheque', chequeNo: 'CHQ-260517' },
    { date: '2026-06-29', storeId: 'store-010', salesPersonId: 'sp-005', amount: 275000, received: 175000, description: 'Quarter close with remaining outstanding', paymentMethod: 'bank_transfer' },
  ];

  for (let i = 0; i < multiYearScenarios.length; i += 1) {
    const scenario = multiYearScenarios[i];
    const yearShort = String(new Date(scenario.date).getFullYear()).slice(-2);
    const documentNo = `INV-${yearShort}${String(1000 + i).padStart(5, '0')}`;
    const balanceDue = parseFloat((Number(scenario.amount) - Number(scenario.received || 0)).toFixed(2));
    const status = balanceDue <= 0 ? 'paid' : balanceDue > scenario.amount * 0.6 ? 'overdue' : 'pending';
    const normalizedMethod = scenario.paymentMethod || 'cash';

    const payments = [];
    if ((scenario.received || 0) > 0) {
      if (Number(scenario.received) < Number(scenario.amount) && Number(scenario.received) > 60000) {
        const firstSplit = parseFloat((Number(scenario.received) * 0.55).toFixed(2));
        const secondSplit = parseFloat((Number(scenario.received) - firstSplit).toFixed(2));
        payments.push({
          date: scenario.date,
          amountPaid: String(firstSplit),
          paymentMethod: normalizedMethod,
          chequeNo: scenario.chequeNo || null,
          description: 'Initial partial collection',
        });
        const secondDate = new Date(scenario.date);
        secondDate.setDate(secondDate.getDate() + 14);
        payments.push({
          date: secondDate.toISOString().split('T')[0],
          amountPaid: String(secondSplit),
          paymentMethod: normalizedMethod,
          chequeNo: scenario.chequeNo || null,
          description: 'Follow-up partial collection',
        });
      } else {
        payments.push({
          date: scenario.date,
          amountPaid: String(scenario.received),
          paymentMethod: normalizedMethod,
          chequeNo: scenario.chequeNo || null,
          description: Number(scenario.received) === Number(scenario.amount) ? 'Full settlement' : 'Single partial collection',
        });
      }
    }

    await createInvoiceWithPayments({
      documentNo,
      date: scenario.date,
      description: scenario.description,
      amount: scenario.amount,
      received: scenario.received,
      status,
      chequeNo: scenario.chequeNo || null,
      storeId: scenario.storeId,
      salesPersonId: scenario.salesPersonId,
      payments,
    });
  }

  console.log(`✅ Created ${createdInvoiceCount} invoices with payment records.\n`);

  // ── Summary ────────────────────────────────────────────────
  const summary = {
    stores: await prisma.store.count(),
    salesPersons: await prisma.salesPerson.count(),
    invoices: await prisma.invoice.count(),
    payments: await prisma.payment.count(),
  };

  const totals = await prisma.invoice.aggregate({
    _sum: { amount: true, received: true, balanceDue: true },
    _avg: { amount: true },
  });

  console.log('═══════════════════════════════════════════════');
  console.log('  SEED COMPLETE - DATABASE SUMMARY');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Stores:         ${summary.stores}`);
  console.log(`  Sales Persons:  ${summary.salesPersons}`);
  console.log(`  Invoices:       ${summary.invoices}`);
  console.log(`  Payments:       ${summary.payments}`);
  console.log(`───────────────────────────────────────────────`);
  console.log(`  Total Billed:        Rs. ${Number(totals._sum.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Total Received:      Rs. ${Number(totals._sum.received).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Total Balance Due:   Rs. ${Number(totals._sum.balanceDue).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log('═══════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('\n❌ Seed failed:', e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });