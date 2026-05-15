import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma/prisma.js';
import notificationService from './notification.service.js';
import { getIO } from './socket.service.js';
import { invalidateProfileCache } from './auth.services.js';
const JWT_SECRET = process.env.JWT_SECRET || 'safeway_super_secret_key';

export const loginUser = async ({ email, password }) => {
    const user = await prisma.user.findUnique({
        where: { email },
        include: { role: true }
    });

    if (!user) {
        throw new Error('Email hoặc mật khẩu không chính xác.');
    }

    if (user.status !== 'active') {
        throw new Error('Tài khoản của bạn đã bị vô hiệu hoá.');
    }

    // KIỂM TRA QUYỀN HẠN DYNAMIC (PBAC):
    // Ghi chú: Chúng tôi cho phép tất cả người dùng đăng nhập vào Portal Web, 
    // nhưng việc truy cập Dashboard Admin sẽ được kiểm tra bởi Permission ở Frontend và Middleware ở Backend.


    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
        throw new Error('Email hoặc mật khẩu không chính xác.');
    }

    const token = jwt.sign(
        { id: user.id, email: user.email, roleId: user.roleId },
        JWT_SECRET,
        { expiresIn: '1d' }
    );

    return {
        user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            phone: user.phone,
            roleId: user.roleId,
            roleName: user.role.name,
        },
        token,
    };
};

export const getAllUsers = async (page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
        prisma.user.findMany({
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' }
        }),
        prisma.user.count()
    ]);

    return {
        data: users,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };
};

export const getAllDrivers = async (page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    
    // 1. Lấy danh sách tài xế phân trang
    const [drivers, total] = await Promise.all([
        prisma.driver.findMany({
            skip,
            take: limit,
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        phone: true,
                        email: true,
                    }
                },
                DriverRank: true,
                documents: {
                    include: {
                        documentType: true
                    }
                },
                vehicles: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        }),
        prisma.driver.count()
    ]);

    if (drivers.length === 0) {
        return { data: [], meta: { total, page, limit, totalPages: 0 } };
    }

    // 2. Tối ưu hóa: Lấy thống kê cho TẤT CẢ tài xế trong trang hiện tại chỉ bằng 1 truy vấn groupBy
    const driverIds = drivers.map(d => d.id);
    
    const tripStats = await prisma.trip.groupBy({
        by: ['driverId', 'status'],
        where: {
            driverId: { in: driverIds },
            status: { in: ['completed', 'cancelled'] }
        },
        _count: {
            _all: true
        }
    });

    // Chuyển đổi tripStats sang dạng Map để lookup nhanh hơn
    // Map<driverId, { completed: number, cancelled: number }>
    const statsMap = new Map();
    tripStats.forEach(stat => {
        const id = stat.driverId;
        if (!statsMap.has(id)) {
            statsMap.set(id, { completed: 0, cancelled: 0 });
        }
        const current = statsMap.get(id);
        if (stat.status === 'completed') current.completed = stat._count._all;
        if (stat.status === 'cancelled') current.cancelled = stat._count._all;
    });

    // 3. Ghép stats vào driver data
    const driversWithStats = drivers.map(driver => {
        const stats = statsMap.get(driver.id) || { completed: 0, cancelled: 0 };
        const totalWork = stats.completed + stats.cancelled;
        let rate = 100;
        
        if (totalWork > 0) {
            rate = (stats.completed / totalWork) * 100;
        } else if (driver.totalTrips > 0) {
            rate = 100;
        }

        return {
            ...driver,
            vehicles: driver.vehicles || [],
            documents: driver.documents || [],
            user: driver.user,
            stats: {
                completed: stats.completed,
                cancelled: stats.cancelled,
                completionRate: Math.round(rate)
            }
        };
    });

    return {
        data: driversWithStats,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };
};

export const updateDriverStatus = async (id, status, reason = null, reviewedById = null) => {
    const driverId = parseInt(id);
    const updatedDriver = await prisma.driver.update({
        where: { id: driverId },
        data: { status, reason },
        include: { user: true }
    });

    // TỰ ĐỘNG DUYỆT/TỪ CHỐI TẤT CẢ GIẤY TỜ VÀ PHƯƠNG TIỆN ĐANG CHỜ
    if (status === 'approved' || status === 'rejected') {
        const itemStatus = status === 'approved' ? 'approved' : 'rejected';
        
        // Cập nhật giấy tờ
        await prisma.driverDocument.updateMany({
            where: { driverId: driverId, status: 'pending' },
            data: { 
                status: itemStatus,
                reviewedById: reviewedById ? parseInt(reviewedById) : null,
                reviewedAt: status === 'approved' ? new Date() : null
            }
        });

        // Cập nhật phương tiện
        await prisma.driverVehicle.updateMany({
            where: { driverId: driverId, status: 'pending' },
            data: { status: itemStatus }
        });
    }

    // Nếu duyệt tài xế, tự động chuyển role user sang Driver (roleId = 2)
    if (status === 'approved') {
        await prisma.user.update({
            where: { id: updatedDriver.userId },
            data: { roleId: 2 }
        });

        // Gửi thông báo phê duyệt
        await notificationService.createNotification(
            updatedDriver.userId,
            "Hồ sơ tài xế đã được duyệt",
            "Chúc mừng! Hồ sơ đăng ký tài xế của bạn đã được phê duyệt. Bạn có thể bắt đầu hoạt động ngay bây giờ.",
            "SUCCESS"
        );
    } else if (status === 'rejected') {
        // Gửi thông báo từ chối
        await notificationService.createNotification(
            updatedDriver.userId,
            "Hồ sơ tài xế bị từ chối",
            `Rất tiếc, hồ sơ của bạn đã bị từ chối. Lý do: ${reason || 'Không có lý do cụ thể.'}`,
            "DANGER"
        );
    }

    // XÓA CACHE PROFILE ĐỂ APP CẬP NHẬT QUYỀN HẠN MỚI TỨC THÌ
    await invalidateProfileCache(updatedDriver.userId);

    // PHÁT SỰ KIỆN SOCKET ĐỂ APP TỰ ĐỘNG REFETCH
    try {
        const io = getIO();
        if (io) {
            io.to(`user_${updatedDriver.userId}`).emit('user:profile_updated', {
                userId: updatedDriver.userId,
                status: status,
                roleId: status === 'approved' ? 2 : undefined
            });
            console.log(`[SOCKET] Emitted user:profile_updated to user_${updatedDriver.userId}`);
        }
    } catch (err) {
        console.error('[SOCKET_ERROR] Failed to emit profile update:', err);
    }

    return updatedDriver;
};

export const updateDocumentStatus = async (id, status, reviewedById, expiryDate = null) => {
    return await prisma.driverDocument.update({
        where: { id: parseInt(id) },
        data: { 
            status, 
            reviewedById: parseInt(reviewedById),
            reviewedAt: new Date(),
            expiryDate: expiryDate ? new Date(expiryDate) : null
        }
    });
};

export const lockDriver = async (id, hours, reason) => {
    const suspendedUntil = hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;
    const updatedDriver = await prisma.driver.update({
        where: { id: parseInt(id) },
        data: { 
            status: 'suspended',
            suspendedUntil,
            reason
        }
    });

    const { invalidateProfileCache } = await import('./auth.services.js');
    await invalidateProfileCache(updatedDriver.userId);

    return updatedDriver;
};

export const unlockDriver = async (id) => {
    const updatedDriver = await prisma.driver.update({
        where: { id: parseInt(id) },
        data: { 
            status: 'approved',
            suspendedUntil: null,
            reason: null
        }
    });

    const { invalidateProfileCache } = await import('./auth.services.js');
    await invalidateProfileCache(updatedDriver.userId);

    return updatedDriver;
};

export const createDriverAdmin = async (data) => {
    const { fullName, phone, email, password, cccdNumber, licenseNumber, licenseType } = data;
    
    // 1. Mã hóa mật khẩu
    const hashedPassword = await bcrypt.hash(password, 10);

    // 2. Sử dụng transaction để tạo User và Driver cùng lúc
    return await prisma.$transaction(async (tx) => {
        // Tạo User
        const user = await tx.user.create({
            data: {
                fullName,
                phone,
                email,
                password: hashedPassword,
                roleId: 3, // Mặc định là User/Customer, sẽ lên Role 2 khi được Duyệt
                status: 'active',
                isVerified: true
            }
        });

        // Tạo Driver
        const driver = await tx.driver.create({
            data: {
                userId: user.id,
                fullName,
                cccdNumber,
                licenseNumber,
                licenseType,
                status: 'pending' 
            }
        });

        return { user, driver };
    });
};

/**
 * Lấy thống kê số lượng tài xế
 */
export const getDriverStats = async () => {
    const totalDrivers = await prisma.driver.count();
    return { totalDrivers };
};

/**
 * Lấy danh sách hạng tài xế kèm số lượng tài xế mỗi hạng
 */
export const getDriverRanks = async () => {
    const ranks = await prisma.driverRank.findMany({
        include: {
            _count: {
                select: { Driver: true }
            }
        },
        orderBy: { minTrips: 'asc' }
    });
    
    // Ánh xạ lại tên trường của _count để khớp với frontend mong đợi (drivers)
    return ranks.map(rank => ({
        ...rank,
        _count: {
            drivers: rank._count.Driver
        }
    }));
};


/**
 * Cập nhật thông tin hạng tài xế
 */
export const updateDriverRank = async (id, data) => {
    const { minTrips, minPoints, acceptanceRate } = data;
    return await prisma.driverRank.update({
        where: { id: parseInt(id) },
        data: {
            minTrips: parseInt(minTrips),
            minPoints: parseFloat(minPoints || 0),
            acceptanceRate,
            updatedAt: new Date()
        }
    });
};

/**
 * Tạo mới hạng tài xế
 */
export const createDriverRank = async (data) => {
    const { name, code, minTrips, minPoints, driverRate, platformRate, acceptanceRate } = data;
    return await prisma.driverRank.create({
        data: {
            name,
            code,
            minTrips: parseInt(minTrips),
            minPoints: parseFloat(minPoints || 0),
            driverRate: parseFloat(driverRate),
            platformRate: parseFloat(platformRate),
            acceptanceRate: acceptanceRate || "92%",
            updatedAt: new Date()
        }
    });
};

/**
 * Tăng số chuyến đi và kiểm tra nâng hạng cho tài xế sau khi hoàn thành chuyến
 */
export const updateDriverRankAfterTrip = async (driverId) => {
    try {
        // 1. Tăng số chuyến đi của tài xế
        const driver = await prisma.driver.update({
            where: { id: parseInt(driverId) },
            data: { totalTrips: { increment: 1 } },
            include: { DriverRank: true }
        });

        console.log(`[RANK] Driver ${driverId} totalTrips: ${driver.totalTrips}, totalPoints: ${driver.totalPoints}`);

        // 2. Lấy danh sách hạng sắp xếp theo độ ưu tiên (điểm và số chuyến)
        // Ưu tiên theo minPoints trước, sau đó là minTrips
        const ranks = await prisma.driverRank.findMany({
            orderBy: [
                { minPoints: 'desc' },
                { minTrips: 'desc' }
            ]
        });

        // 3. Tìm hạng cao nhất phù hợp (Thỏa mãn CẢ HAI hoặc Ưu tiên điểm số)
        const newRank = ranks.find(r => 
            driver.totalPoints >= (r.minPoints || 0) && 
            driver.totalTrips >= r.minTrips
        );

        // 4. Cập nhật nếu hạng mới khác hạng cũ
        if (newRank && newRank.id !== driver.rankId) {
            await prisma.driver.update({
                where: { id: driver.id },
                data: { rankId: newRank.id }
            });
            console.log(`[RANK] Driver ${driverId} upgraded to ${newRank.name}`);
            return { upgraded: true, oldRank: driver.DriverRank?.name, newRank: newRank.name };
        }

        return { upgraded: false };
    } catch (error) {
        console.error('Lỗi updateDriverRankAfterTrip:', error);
        return { upgraded: false, error: error.message };
    }
};

/**
 * Lấy cấu hình hệ thống theo key
 */
export const getSystemConfig = async (key) => {
    return await prisma.systemConfig.findUnique({
        where: { key }
    });
};

/**
 * Cập nhật hoặc tạo mới cấu hình hệ thống
 */
export const updateSystemConfig = async (key, data) => {
    const { value, description } = data;
    const config = await prisma.systemConfig.upsert({
        where: { key },
        update: { 
            value: value.toString(), 
            description,
            updatedAt: new Date()
        },
        create: { 
            key, 
            value: value.toString(), 
            description,
            updatedAt: new Date()
        }
    });

    // Nếu cập nhật tỷ lệ mặc định, tự động cập nhật cho tất cả các hạng tài xế
    if (key === 'default_commission') {
        const rate = parseFloat(value);
        await prisma.driverRank.updateMany({
            data: {
                driverRate: rate,
                platformRate: 100 - rate,
                updatedAt: new Date()
            }
        });
    }

    return config;
};



/**
 * Lấy tất cả các chuyến đi cho Admin quản lý
 */
export const getAllTrips = async (page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    
    const [trips, total] = await Promise.all([
        prisma.trip.findMany({
            skip,
            take: limit,
            include: {
                customer: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    }
                },
                driver: {
                    select: {
                        id: true,
                        fullName: true,
                        avatarUrl: true,
                    }
                },
                payments: true,
            },
            orderBy: {
                createdAt: 'desc'
            }
        }),
        prisma.trip.count()
    ]);

    return {
        data: trips,
        meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        }
    };
};

/**
 * Lấy chi tiết một chuyến đi (dành cho Admin)
 * @param {number} tripId 
 */
export const getTripDetailAdmin = async (tripId) => {
    const id = parseInt(tripId);
    if (isNaN(id)) return null;

    return await prisma.trip.findUnique({
        where: { id },
        include: {
            customer: {
                include: { 
                    user: { select: { id: true, fullName: true, phone: true, avatarUrl: true, email: true } },
                    _count: { select: { trips: true } }
                }
            },
            driver: {
                include: { user: { select: { id: true, fullName: true, phone: true, avatarUrl: true, email: true } } }
            },
            vehicle: true,
            payments: true,
            feeBreakdowns: true,
            commissions: true,
            review: true,
            disputes: {
                include: {
                    createdBy: { select: { fullName: true, roleId: true } }
                }
            },
            locationHistory: {
                orderBy: { createdAt: 'asc' }
            }
        }
    });
};
