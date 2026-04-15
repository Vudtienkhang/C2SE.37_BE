import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function cleanup() {
    const deleted = await prisma.driverTestHistory.deleteMany({
        where: {
            driverId: 17,
            status: 'in_progress'
        }
    });
    console.log(`Deleted ${deleted.count} junk test sessions for driver 17.`);
}

cleanup()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
