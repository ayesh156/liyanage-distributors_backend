// ─────────────────────────────────────────────────────────────
// LIYANAGE DISTRIBUTORS - PRODUCTION READY SEEDER
// Clears mock data and initializes essential system architecture only.
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import bcrypt from 'bcryptjs';

const adapterUrl = process.env.DATABASE_URL;
if (!adapterUrl) {
  console.error('❌ DATABASE_URL environment variable is not set.');
  process.exit(1);
}
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(adapterUrl),
});

async function main() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  INITIALIZING PRODUCTION DATABASE');
  console.log('═══════════════════════════════════════════════\n');

  // ── Step 1: Wipe everything out completely ──────
  console.log('🗑️  Wiping out all mock/test records from tables...');
  await prisma.payment.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.salesPerson.deleteMany();
  await prisma.store.deleteMany();
  await prisma.route.deleteMany();
  console.log('✅ Tables completely truncated.\n');

  // ── Step 2: Seed critical Admin authentication record ──
  console.log('🔐 Initializing production default administrator...');
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
  console.log('✅ Admin initialized successfully (User: admin).\n');

  console.log('🎉 SYSTEM IS NOW 100% READY FOR PRODUCTION DEPLOYMENT! \n');
}

main()
  .catch((e) => {
    console.error('\n❌ Initialization failed:', e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });