import bcrypt from 'bcryptjs';
import { supabase } from '../lib/supabase.js';
import redis from '../lib/redis.js';
import prisma from '../prisma/prisma.js';
import logger from '../lib/logger.js';
import { getIO } from './socket.service.js';

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

    // Phát sự kiện cho Admin Dashboard
    try {
        const io = getIO();
        if (io) io.emit('admin:new_user', { id: newUser.id, roleId: newUser.roleId });
    } catch (err) {
        logger.warn('Socket emit failed in registerUser');
    }

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

  // 4. Tìm thông tin tài xế & Ví
  const [driver, wallet] = await Promise.all([
    prisma.driver.findUnique({
      where: { userId: user.id },
      include: { DriverRank: true }
    }),
    prisma.wallet.findUnique({
      where: { userId: user.id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    })
  ]);

  // 5. Xác định quyền hạn (Nếu tài xế chưa được duyệt, cho phép đăng nhập và sử dụng với quyền Customer)
  let roleIdToUse = user.roleId;
  if (user.roleId === 2 && driver && driver.status === 'pending') {
    roleIdToUse = 3;
  }

  // 6. Tạo token
  const token = jwt.sign(
    { id: user.id, phone: user.phone, roleId: roleIdToUse },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // 7. Trả về thông tin người dùng và token
  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      roleId: roleIdToUse,
      avatarUrl: (roleIdToUse === 2 && driver?.avatarUrl) ? driver.avatarUrl : (user.avatarUrl || "https://i.pravatar.cc/300"),
      driver: driver ? { 
        id: driver.id, 
        status: driver.status, 
        isOnline: driver.isOnline, 
        rank: driver.DriverRank,
        cccdNumber: driver.cccdNumber,
        licenseNumber: driver.licenseNumber,
        licenseType: driver.licenseType,
        avatarUrl: driver.avatarUrl
      } : null,
      wallet: wallet ? {
        id: wallet.id,
        balance: wallet.balance,
        transactions: wallet.transactions
      } : { balance: 0, transactions: [] }
    },
    token
  };
};


export const invalidateProfileCache = async (id) => {
  try {
    const numericId = parseInt(id, 10);
    const cacheKey = `user:profile:${numericId}`;
    
    // Thêm timeout 3 giây cho lệnh xóa để không làm treo các giao dịch (Rút tiền, Cập nhật...)
    await Promise.race([
      redis.del(cacheKey),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis del timeout')), 3000))
    ]);
    
    logger.debug({ cacheKey }, '[REDIS] Clearing key');
  } catch (err) {
    logger.warn(err, '[REDIS_ERROR/TIMEOUT] Failed to clear key, skipping');
  }
};


export const getUserById = async (id) => {
  const numericId = parseInt(id, 10);
  const cacheKey = `user:profile:${numericId}`;

  // 1. Thử lấy từ Redis với cơ chế Timeout (3 giây) để tránh treo API
  try {
    const cached = await Promise.race([
      redis.get(cacheKey),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis timeout')), 3000))
    ]);
    
    if (cached) {
      logger.debug({ userId: numericId }, '[CACHE_HIT] Profile for user');
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn(err, '[REDIS_TIMEOUT/ERROR] Skipping cache');
  }

  logger.info({ userId: numericId }, '[DB_FETCH] Fetching profile for user');

  // 2. Lấy dữ liệu từ DB song song (Parallel) để tăng tốc độ
  const [user, customer, driver, wallet] = await Promise.all([
    prisma.user.findUnique({ where: { id: numericId } }),
    prisma.customer.findUnique({ where: { userId: numericId } }),
    prisma.driver.findUnique({ where: { userId: numericId }, include: { DriverRank: true, documents: true } }),
    prisma.wallet.findUnique({ 
      where: { userId: numericId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } }
    })
  ]);

  if (!user) {
    throw new Error('Người dùng không tồn tại.');
  }

  // 3. Xác định quyền hạn tạm thời
  let roleIdToUse = user.roleId;
  if (user.roleId === 2 && driver && driver.status === 'pending') {
    roleIdToUse = 3;
  }

  // 4. Tính toán thông tin hạng tiếp theo (nếu là tài xế)
  let nextRankInfo = null;
  if (driver && driver.DriverRank) {
    const nextRank = await prisma.driverRank.findFirst({
      where: { minPoints: { gt: driver.DriverRank.minPoints || 0 } },
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

  const result = {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    roleId: roleIdToUse,
    avatarUrl: (roleIdToUse === 2 && driver?.avatarUrl) ? driver.avatarUrl : (customer?.avatarUrl || user.avatarUrl || "https://i.pravatar.cc/300"),
    totalRides: driver?.totalTrips || 0,
    totalRides: driver?.totalTrips || 0,
    rating: driver?.ratingAvg || 5.0,
    driver: driver ? { 
      id: driver.id, 
      status: driver.status,
      isOnline: driver.isOnline,
      totalPoints: driver.totalPoints,
      rank: driver.DriverRank,
      nextRank: nextRankInfo,
      cccdNumber: driver.cccdNumber,
      licenseNumber: driver.licenseNumber,
      licenseType: driver.licenseType,
      avatarUrl: driver.avatarUrl,
      documents: driver.documents
    } : null,
    wallet: wallet ? { 
      id: wallet.id, 
      balance: wallet.balance,
      transactions: wallet.transactions 
    } : { balance: 0, transactions: [] }
  };

  // 4. Lưu vào Redis (Background - không bắt user đợi)
  redis.set(cacheKey, JSON.stringify(result), 'EX', 1800).catch(err => {
    logger.warn(err, '[REDIS_WRITE_ERROR]');
  });

  return result;
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
    logger.error(error, 'Lỗi upload Supabase');
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

  // 5. Clear Profile Cache
  await redis.del(`user:profile:${numericId}`).catch(() => {});

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

  // 5. Clear Profile Cache
  await redis.del(`user:profile:${numericId}`).catch(() => {});

  return {
    id: updatedUser.id,
    fullName: updatedUser.fullName,
    phone: updatedUser.phone,
    email: updatedUser.email,
    roleId: updatedUser.roleId,
  };
};

export const registerDriver = async ({ userId, fullName, cccdNumber, licenseNumber, licenseType, avatarUrl }) => {
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
      avatarUrl: avatarUrl || undefined,
      status: 'pending',
    },
    create: {
      userId: numericUserId,
      fullName: fullName || user.fullName,
      cccdNumber,
      licenseNumber,
      licenseType,
      avatarUrl: avatarUrl || null,
      status: 'pending',
    },
  });

  // Phát sự kiện cho Admin Dashboard
  try {
      const io = getIO();
      if (io) io.emit('admin:driver_registered', { id: driver.id, userId: driver.userId });
  } catch (err) {
      logger.warn('Socket emit failed in registerDriver');
  }

  return driver;
};
