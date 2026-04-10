import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkDB() {
    console.log('--- DIAGNOSTIC START ---');
    
    const roles = await prisma.role.findMany({
        include: {
            _count: { select: { permissions: true, users: true } }
        }
    });
    console.log('Roles:', JSON.stringify(roles, null, 2));

    const allPerms = await prisma.permission.findMany();
    console.log('All Permission Codes in DB:', allPerms.map(p => p.code).join(', '));

    const totalPerms = await prisma.permission.count();
    console.log('Total Permissions in DB:', totalPerms);

    const adminRole = await prisma.role.findFirst({
        where: { name: { contains: 'Admin', mode: 'insensitive' } },
        include: {
            permissions: {
                include: { permission: true }
            }
        }
    });

    if (adminRole) {
        console.log(`Admin Role Found: ${adminRole.name} (ID: ${adminRole.id})`);
        console.log(`Permissions Count: ${adminRole.permissions.length}`);
        // console.log('Permissions:', adminRole.permissions.map(p => p.permission.code).join(', '));
    } else {
        console.warn('No Admin role found!');
    }

    const allUsers = await prisma.user.findMany({
        include: { role: true }
    });
    console.log('All Users & Role Details:', JSON.stringify(allUsers.map(u => ({ 
        id: u.id, 
        email: u.email, 
        roleId: u.roleId, 
        roleName: u.role?.name 
    })), null, 2));

    const rolesWithIds = await prisma.role.findMany();
    console.log('Roles with IDs:', JSON.stringify(rolesWithIds.map(r => ({ id: r.id, name: r.name })), null, 2));

    console.log('--- DIAGNOSTIC END ---');
}

checkDB()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
