import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'safeway_super_secret_key';

export const loginUser = async ({ email, password }) => {
    const user = await prisma.user.findUnique({
        where: { email },
    });

    if (!user) {
        throw new Error('Email hoặc mật khẩu không chính xác.');
    }

    if (user.roleId !== 1) {
        throw new Error('Bạn không có quyền hạn đăng nhập. Tính năng này chỉ dành cho Admin.');
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
    return await prisma.driver.findMany({
        include: {
            user: {
                select: {
                    id: true,
                    fullName: true,
                    phone: true,
                    email: true,
                }
            },
            documents: {
                include: {
                    documentType: true
                }
            }
        },
        orderBy: {
            createdAt: 'desc'
        }
    });
};

export const updateDriverStatus = async (id, status) => {
    const updatedDriver = await prisma.driver.update({
        where: { id: parseInt(id) },
        data: { status },
        include: { user: true }
    });

    // Nếu duyệt tài xế, tự động chuyển role user sang Driver (roleId = 2)
    if (status === 'approved') {
        await prisma.user.update({
            where: { id: updatedDriver.userId },
            data: { roleId: 2 }
        });
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
