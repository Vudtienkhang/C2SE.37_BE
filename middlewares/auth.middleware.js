import jwt from 'jsonwebtoken';
import prisma from '../prisma/prisma.js';

const JWT_SECRET = process.env.JWT_SECRET || 'safeway_super_secret_key';

/**
 * Middleware xác thực Token Admin cơ bản
 */
export const verifyAdminToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Không tìm thấy Access Token. Vui lòng đăng nhập.',
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // Kiểm tra trong DB để đảm bảo user vẫn tồn tại và là Admin/Staff
        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            include: { role: true }
        });

        if (!user || user.status !== 'active') {
             return res.status(403).json({
                success: false,
                message: 'Tài khoản không tồn tại hoặc đã bị khóa.',
            });
        }

        // Lưu thông tin vào request
        req.admin = {
            ...decoded,
            roleName: user.role.name
        };
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token đã hết hạn. Vui lòng đăng nhập lại.',
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Token không hợp lệ hoặc đã bị thay đổi.',
        });
    }
};

/**
 * Middleware kiểm tra quyền hạn cụ thể (PBAC)
 * @param {string} permissionCode - Mã quyền cần kiểm tra (ví dụ: 'VIEW_REVENUE')
 */
export const checkPermission = (permissionCode) => {
    return async (req, res, next) => {
        try {
            // Đảm bảo đã qua verifyAdminToken trước đó
            if (!req.admin) {
                return res.status(401).json({ success: false, message: 'Yêu cầu xác thực Admin.' });
            }

            // Kiểm tra quyền của Role trong Database (Real-time)
            const rolePermission = await prisma.rolePermission.findFirst({
                where: {
                    roleId: req.admin.roleId,
                    permission: {
                        code: permissionCode
                    }
                }
            });

            if (!rolePermission) {
                return res.status(403).json({
                    success: false,
                    message: `Bạn không có quyền thực hiện hành động này (${permissionCode}).`
                });
            }

            next();
        } catch (error) {
            console.error('[AUTH ERROR]', error);
            res.status(500).json({ success: false, message: 'Lỗi kiểm tra quyền hạn.' });
        }
    };
};

export const verifyToken = (req, res, next) => {
    try {
        let token = null;
        const authHeader = req.headers.authorization;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        } else if (req.query.token) {
            token = req.query.token;
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Không tìm thấy Access Token. Vui lòng đăng nhập.',
            });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        req.user = decoded; 
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token đã hết hạn. Vui lòng đăng nhập lại.',
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Token không hợp lệ hoặc đã bị thay đổi.',
        });
    }
};

export const optionalVerifyToken = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        req.user = decoded; 
        next();
    } catch (error) {
        next();
    }
};

/**
 * Middleware giới hạn quyền truy cập theo Role
 * @param  {...string} roles - Danh sách vai trò được phép (ví dụ: 'ADMIN', 'STAFF')
 */
export const restrictTo = (...roles) => {
    return async (req, res, next) => {
        try {
            // Kiểm tra user đã được xác thực ở verifyToken/verifyAdminToken chưa
            const user = req.user || req.admin;
            if (!user) {
                return res.status(401).json({ success: false, message: 'Bạn chưa đăng nhập.' });
            }

            // Lấy role đầy đủ từ DB nếu user chỉ có payload token
            let roleName = user.roleName;
            if (!roleName) {
                const fullUser = await prisma.user.findUnique({
                    where: { id: user.id },
                    include: { role: true }
                });
                roleName = fullUser?.role?.name;
            }

            if (!roles.includes(roleName)) {
                return res.status(403).json({
                    success: false,
                    message: `Bạn không có quyền thực hiện hành động này. Yêu cầu: ${roles.join(' or ')}`
                });
            }

            next();
        } catch (error) {
            console.error('[RESTRICT ERROR]', error);
            res.status(500).json({ success: false, message: 'Lỗi kiểm tra quyền truy cập.' });
        }
    };
};

