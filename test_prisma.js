import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  try {
    console.log('Models in Prisma Client:', Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('$')));
    const count = await prisma.driverRank.count();
    console.log('DriverRank count:', count);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
