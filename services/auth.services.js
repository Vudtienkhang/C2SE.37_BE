import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { supabase } from '../lib/supabase.js';

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

export const getUserById = async (id) => {
  const numericId = parseInt(id, 10);
  const user = await prisma.user.findUnique({
    where: { id: numericId },
  });

  if (!user) {
    throw new Error('Người dùng không tồn tại.');
  }

  // Get dynamic fields like avatarUrl and totalRides from other tables if needed later.
  const customer = await prisma.customer.findUnique({
    where: { userId: numericId }
  });

  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    roleId: user.roleId,
    avatarUrl: customer?.avatarUrl || "https://i.pravatar.cc/300",
    totalRides: 0,
    rating: 5.0,
  };
};

export const uploadUserAvatarToSupabase = async (id, fileBuffer, mimeType) => {
  // 1. Tạo tên file độc nhất
  const fileName = `${id}_${Date.now()}.png`;
  const filePath = `${fileName}`;

  // 2. Upload file dạng buffer lên Supabase Storage bucket 'avatars'
  const { data, error } = await supabase.storage
    .from('avatars')
    .upload(filePath, fileBuffer, {
      contentType: mimeType || 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Lỗi upload Supabase:', error);
    throw new Error('Lỗi khi tải ảnh lên máy chủ.');
  }

  // 3. Lấy Public URL của ảnh vừa tạo
  const { data: publicUrlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath);

  const publicUrl = publicUrlData.publicUrl;

  const numericId = parseInt(id, 10);
  // 4. Cập nhật Public URL vào database của Customer
  const updatedCustomer = await prisma.customer.upsert({
    where: { userId: numericId },
    update: { avatarUrl: publicUrl },
    create: {
      userId: numericId,
      avatarUrl: publicUrl,
    }
  });

  return publicUrl;
};

export const updateUser = async (id, { fullName, phone, email }) => {
  const numericId = parseInt(id, 10);

  // 1. Kiểm tra xem người dùng có tồn tại không
  const user = await prisma.user.findUnique({
    where: { id: numericId },
  });

  if (!user) {
    throw new Error('Người dùng không tồn tại.');
  }

  // 2. Kiểm tra nếu phone hoặc email mới đã được sử dụng bởi người dùng khác
  if (phone && phone !== user.phone) {
    const existingPhone = await prisma.user.findUnique({
      where: { phone },
    });
    if (existingPhone) {
      throw new Error('Số điện thoại đã được sử dụng.');
    }
  }

  if (email && email !== user.email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email },
    });
    if (existingEmail) {
      throw new Error('Email đã được sử dụng.');
    }
  }

  // 3. Cập nhật thông tin
  const updatedUser = await prisma.user.update({
    where: { id: numericId },
    data: {
      fullName: fullName || user.fullName,
      phone: phone || user.phone,
      email: email || user.email,
    },
  });

  // 4. Nếu là Customer, cập nhật cả fullName trong bảng Customer (nếu cần thiết theo business logic)
  if (updatedUser.roleId === 3) {
      await prisma.customer.update({
          where: { userId: numericId },
          data: { fullName: fullName || user.fullName }
      });
  }

  return {
    id: updatedUser.id,
    fullName: updatedUser.fullName,
    phone: updatedUser.phone,
    email: updatedUser.email,
    roleId: updatedUser.roleId,
  };
};
