import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkUsers() {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, fullName: true, phone: true }
    });
    console.log('--- List of Users ---');
    users.forEach(u => console.log(`ID: ${u.id}, Name: ${u.fullName}, Phone: ${u.phone}`));
  } catch (err) {
    console.error('Error checking users:', err);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
