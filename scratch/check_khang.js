import prisma from '../prisma/prisma.js';

async function checkDriver() {
  try {
    const drivers = await prisma.driver.findMany({
      where: { fullName: { contains: 'Vũ Đoàn Tiến Khang' } },
      select: { id: true, fullName: true, userId: true }
    });
    console.log('--- DRIVERS ---');
    console.log(JSON.stringify(drivers, null, 2));

    if (drivers.length > 0) {
      const driverId = drivers[0].id;
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const trips = await prisma.trip.groupBy({
        where: {
          driverId: driverId,
          createdAt: { gte: thirtyDaysAgo }
        },
        by: ['status'],
        _count: { id: true }
      });
      console.log('--- TRIPS LAST 30 DAYS ---');
      console.log(JSON.stringify(trips, null, 2));
    }
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

checkDriver();
