import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const roles = [
    { id: 1, name: "Admin" },
    { id: 2, name: "Driver" },
    { id: 3, name: "Customer" },
  ];

  console.log(`Bắt đầu chạy seed dữ liệu Role...`);

  for (const role of roles) {
    const existingRole = await prisma.role.findUnique({
      where: { id: role.id },
    });

    if (!existingRole) {
      await prisma.role.create({
        data: role,
      });
      console.log(`Đã tạo role mới: ${role.name}`);
    } else {
      console.log(`Role ${role.name} đã tồn tại, bỏ qua.`);
    }
  }

  console.log(`Seed hoàn tất.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
