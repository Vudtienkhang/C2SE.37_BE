import prisma from './prisma/prisma.js';

async function checkDrivers() {
  try {
    const drivers = await prisma.driver.findMany({
      include: {
        user: true,
        vehicles: true,
      },
    });

    console.log('--- DRIVERS STATE ---');
    drivers.forEach((driver) => {
      console.log(`ID: ${driver.id}, Name: ${driver.fullName}, isOnline: ${driver.isOnline}, isBusy: ${driver.isBusy}, Status: ${driver.status}, Test: ${driver.hasPassedKnowledgeTest}`);
      console.log(`Vehicles: ${driver.vehicles.length}`);
      driver.vehicles.forEach(v => {
        console.log(`  - Type: ${v.type}, Status: ${v.status}, Default: ${v.isDefault}`);
      });
      console.log('---------------------');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

checkDrivers();
