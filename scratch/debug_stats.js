import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const khangId = 1;
  const khangCompleted = await prisma.trip.count({
    where: { driverId: khangId, status: 'completed' }
  });
  const khangCancelled = await prisma.trip.count({
    where: { driverId: khangId, status: 'cancelled' }
  });
  console.log(`--- KHANG STATS ---`);
  console.log(`Completed: ${khangCompleted}, Cancelled: ${khangCancelled}`);
}

check().catch(console.error).finally(() => prisma.$disconnect());
