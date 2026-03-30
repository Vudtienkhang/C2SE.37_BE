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
  const newUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        fullName,
        phone,
        password: hashedPassword,
        roleId: roleId || 3,
      },
    });

    // Nếu là Customer (role 3), tự động tạo bản ghi trong bảng Customer
    if (user.roleId === 3) {
      await tx.customer.create({
        data: {
          userId: user.id,
          fullName: user.fullName,
        },
      });
    }

    // TỰ ĐỘNG TẠO VÍ (WALLET) CHO TẤT CẢ USER MỚI
    await tx.wallet.create({
      data: {
        userId: user.id,
        balance: 0,
      },
    });

    return user;
  });

  return newUser;
};

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'safeway_super_secret_key';

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

  // 4. Tìm thông tin tài xế nếu là driver
  const driver = await prisma.driver.findUnique({
    where: { userId: user.id }
  });

  // 5. Tạo token
  const token = jwt.sign(
    { id: user.id, phone: user.phone, roleId: user.roleId },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // 6. Trả về thông tin người dùng và token
  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      roleId: user.roleId,
      driver: driver ? { id: driver.id, status: driver.status } : null
    },
    token
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

  const customer = await prisma.customer.findUnique({
    where: { userId: numericId }
  });

  const driver = await prisma.driver.findUnique({
    where: { userId: numericId },
    include: { DriverRank: true }
  });

  const wallet = await prisma.wallet.findUnique({
    where: { userId: numericId },
    include: {
      transactions: {
        orderBy: { createdAt: 'desc' },
        take: 20
      }
    }
  });

  // Tính toán thông tin hạng tiếp theo cho tài xế
  let nextRankInfo = null;
  if (driver && driver.DriverRank) {
    const nextRank = await prisma.driverRank.findFirst({
      where: {
        minPoints: { gt: driver.DriverRank.minPoints || 0 }
      },
      orderBy: { minPoints: 'asc' }
    });

    if (nextRank) {
      nextRankInfo = {
        name: nextRank.name,
        pointsNeeded: (nextRank.minPoints || 0) - driver.totalPoints,
        progress: driver.totalPoints / (nextRank.minPoints || 1)
      };
    }
  }

  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    roleId: user.roleId,
    avatarUrl: customer?.avatarUrl || "https://i.pravatar.cc/300",
    totalRides: driver?.totalTrips || 0,
    rating: driver?.ratingAvg || 5.0,
    driver: driver ? { 
      id: driver.id, 
      status: driver.status,
      totalPoints: driver.totalPoints,
      rank: driver.DriverRank,
      nextRank: nextRankInfo
    } : null,
    wallet: wallet ? { 
      id: wallet.id, 
      balance: wallet.balance,
      transactions: wallet.transactions 
    } : { balance: 0, transactions: [] }
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

export const registerDriver = async ({ userId, fullName, cccdNumber, licenseNumber, licenseType }) => {
  const numericUserId = parseInt(userId, 10);

  // 1. Kiểm tra người dùng
  const user = await prisma.user.findUnique({
    where: { id: numericUserId },
  });

  if (!user) {
    throw new Error('Người dùng không tồn tại.');
  }

  // 2. Chuyển role sang Driver (roleId = 2)
  await prisma.user.update({
    where: { id: numericUserId },
    data: {
      roleId: 2,
      fullName: fullName || user.fullName
    },
  });

  // 3. Tạo hoặc cập nhật thông tin trong bảng Driver
  const driver = await prisma.driver.upsert({
    where: { userId: numericUserId },
    update: {
      fullName: fullName || user.fullName,
      cccdNumber,
      licenseNumber,
      licenseType,
      status: 'pending',
    },
    create: {
      userId: numericUserId,
      fullName: fullName || user.fullName,
      cccdNumber,
      licenseNumber,
      licenseType,
      status: 'pending',
    },
  });

  return driver;
};
