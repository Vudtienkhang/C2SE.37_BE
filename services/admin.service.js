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
