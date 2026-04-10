import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../prisma/prisma.js';
import notificationService from './notification.service.js';
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
    // Chỉ cho phép đăng nhập nếu Role của user này có ít nhất 1 quyền được gán
    const permissionCount = await prisma.rolePermission.count({
        where: { roleId: user.roleId }
    });

    if (permissionCount === 0) {
        throw new Error('Bạn không có quyền hạn đăng nhập. Tính năng này chỉ dành cho nhân viên có quyền quản trị.');
    }

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

export const getAllUsers = async () => {
    return await prisma.user.findMany({
        orderBy: { createdAt: 'desc' }
    });
};

export const getAllDrivers = async () => {
    const drivers = await prisma.driver.findMany({
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
            _count: {
                select: {
                    trips: {
                        where: { status: 'completed' }
                    }
                }
            }
        },
        orderBy: {
            createdAt: 'desc'
        }
    });

    // Bổ sung thêm đếm số chuyến bị huỷ thủ công (Prisma _count lồng nhau có giới hạn)
    const driversWithStats = await Promise.all(drivers.map(async (driver) => {
        const driverId = Number(driver.id);
        const [completedCount, cancelledCount] = await Promise.all([
            prisma.trip.count({ where: { driverId: driverId, status: 'completed' } }),
            prisma.trip.count({ where: { driverId: driverId, status: 'cancelled' } })
        ]);

        const totalWork = completedCount + cancelledCount;
        let rate = 100;
        
        if (totalWork > 0) {
            rate = (completedCount / totalWork) * 100;
        } else if (driver.totalTrips > 0) {
            rate = 100; // Giả định hoàn thành tốt nếu có số liệu cũ mà không có record Trip
        }

        return {
            ...driver,
            stats: {
                completed: completedCount,
                cancelled: cancelledCount,
                completionRate: Math.round(rate)
            }
        };
    }));

    return driversWithStats;
};

export const updateDriverStatus = async (id, status, reason = null) => {
    const updatedDriver = await prisma.driver.update({
        where: { id: parseInt(id) },
        data: { status, reason },
        include: { user: true }
    });

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

    return updatedDriver;
};

export const updateDocumentStatus = async (id, status, reviewedById) => {
    return await prisma.driverDocument.update({
        where: { id: parseInt(id) },
        data: { 
            status, 
            reviewedById: parseInt(reviewedById),
            reviewedAt: new Date()
        }
    });
};

export const lockDriver = async (id, hours, reason) => {
    const suspendedUntil = hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;
    return await prisma.driver.update({
        where: { id: parseInt(id) },
        data: { 
            status: 'suspended',
            suspendedUntil,
            reason
        }
    });
};

export const unlockDriver = async (id) => {
    return await prisma.driver.update({
        where: { id: parseInt(id) },
        data: { 
            status: 'approved',
            suspendedUntil: null,
            reason: null
        }
    });
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
export const getAllTrips = async () => {
    return await prisma.trip.findMany({
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
    });
};

/**
 * Lấy chi tiết một chuyến đi (dành cho Admin)
 * @param {number} tripId 
 */
export const getTripDetailAdmin = async (tripId) => {
    return await prisma.trip.findUnique({
        where: { id: parseInt(tripId) },
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
