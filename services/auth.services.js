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

export const loginUser = async ({ phone, password }) => {
  // 1. Tìm người dùng theo số điện thoại
  const user = await prisma.user.findUnique({
    where: { phone },
  });

  // 2. Kiểm tra xem người dùng có tồn tại không
  if (!user) {
    throw new Error('Số điện thoại hoặc mật khẩu không chính xác.');
  }

  // 3. So sánh mật khẩu
  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    throw new Error('Số điện thoại hoặc mật khẩu không chính xác.');
  }

  // 4. Trả về thông tin người dùng (không trả về password)
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    roleId: user.roleId,
  };
};
