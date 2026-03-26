import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const drivers = await prisma.driver.findMany({
    include: {
      user: true,
      trips: {
        where: { status: 'completed' },
        take: 5
      }
    }
  });

  console.log('--- DRIVERS AND THEIR COMPLETED TRIPS ---');
  drivers.forEach(d => {
    console.log(`Driver ID: ${d.id}, User ID: ${d.userId}, Name: ${d.fullName}`);
    console.log(`Completed Trips Count: ${d.trips.length}`);
    d.trips.forEach(t => {
      console.log(`  - Trip ID: ${t.id}, FinalPrice: ${t.finalPrice}, Status: ${t.status}`);
    });
  });

  const allCompletedTrips = await prisma.trip.findMany({
    where: { status: 'completed' },
    take: 10,
    include: { driver: true }
  });

  console.log('\n--- ALL COMPLETED TRIPS ---');
  allCompletedTrips.forEach(t => {
    console.log(`Trip ID: ${t.id}, Driver ID: ${t.driverId}, FinalPrice: ${t.finalPrice}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
