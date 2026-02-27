import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export const registerUser = async ({ fullName, phone, password, roleId }) => {
  // 1. Kiểm tra xem người dùng đã tồn tại chưa (dựa vào số điện thoại)
  const existingUser = await prisma.user.findUnique({
    where: { phone },
  });

  if (existingUser) {
    throw new Error('Số điện thoại đã được sử dụng.');
  }

  // 2. Mã hóa mật khẩu
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // 3. Tạo người dùng mới trong database
  const newUser = await prisma.user.create({
    data: {
      fullName,
      phone,
      password: hashedPassword,
      roleId: roleId || 3, 

    },
  });

  return newUser;
};
