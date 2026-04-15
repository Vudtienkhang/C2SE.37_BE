import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function testConnection() {
    try {
        console.log('Testing database connection...');
        const driverCount = await prisma.driver.count();
        console.log('Connection successful! Total drivers:', driverCount);
    } catch (error) {
        console.error('Connection failed:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

testConnection();
