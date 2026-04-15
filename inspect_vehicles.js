import prisma from './prisma/prisma.js';

async function inspectVehicles() {
  try {
    const vehicles = await prisma.driverVehicle.findMany({
      include: {
        driver: true,
      },
    });

    console.log('--- ALL DRIVER VEHICLES ---');
    vehicles.forEach((v) => {
      console.log(`ID: ${v.id}, DriverID: ${v.driverId}, DriverName: ${v.driver.fullName}, Plate: ${v.plateNumber}, Type: ${v.type}, Status: ${v.status}, Default: ${v.isDefault}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

inspectVehicles();
