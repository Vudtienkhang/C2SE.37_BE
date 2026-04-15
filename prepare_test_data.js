import prisma from './prisma/prisma.js';

async function prepareTestData() {
  try {
    // 1. Cho phép Tài xế 17, 1 và 5 vượt qua bài thi (Để test ngay)
    const testDriverIds = [17, 1, 5];
    
    await prisma.driver.updateMany({
      where: { id: { in: testDriverIds } },
      data: { 
        hasPassedKnowledgeTest: true,
        isCertified: true,
        status: 'approved'
      }
    });
    console.log('Updated 3 drivers to passed knowledge test');

    // 2. Thêm xe cho Driver 1 và 5 (Nếu chưa có)
    const d1 = await prisma.driverVehicle.findFirst({ where: { driverId: 1 } });
    if (!d1) {
      await prisma.driverVehicle.create({
        data: {
          driverId: 1,
          plateNumber: '92B-12345',
          brand: 'Honda',
          model: 'Air Blade',
          type: 'bike',
          status: 'approved',
          isDefault: true
        }
      });
      console.log('Added bike to Driver 1');
    } else {
        await prisma.driverVehicle.updateMany({ where: { driverId: 1 }, data: { status: 'approved', isDefault: true } });
    }

    const d5 = await prisma.driverVehicle.findFirst({ where: { driverId: 5 } });
    if (!d5) {
      await prisma.driverVehicle.create({
        data: {
          driverId: 5,
          plateNumber: '43A-56789',
          brand: 'Toyota',
          model: 'Vios',
          type: 'car_4',
          status: 'approved',
          isDefault: true
        }
      });
      console.log('Added car_4 to Driver 5');
    } else {
        await prisma.driverVehicle.updateMany({ where: { driverId: 5 }, data: { status: 'approved', isDefault: true } });
    }

    // Đảm bảo Driver 17 có isDefault: true
    await prisma.driverVehicle.updateMany({
        where: { driverId: 17 },
        data: { isDefault: true, status: 'approved' }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

prepareTestData();
