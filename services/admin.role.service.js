import prisma from '../prisma/prisma.js';
import * as XLSX from 'xlsx';

/**
 * Láy danh sách tất cả các quyền có sẵn trong hệ thống
 */
export const getAllPermissions = async () => {
    return await prisma.permission.findMany({
        orderBy: { group: 'asc' }
    });
};

/**
 * Lấy danh sách Roles kèm theo các quyền của chúng
 */
export const getAllRoles = async () => {
    return await prisma.role.findMany({
        include: {
            _count: { select: { users: true } },
            permissions: {
                include: { permission: true }
            }
        }
    });
};

/**
 * Tạo Role mới kèm danh sách quyền
 */
export const createRole = async (data) => {
    const { name, permissionIds } = data;
    
    return await prisma.$transaction(async (tx) => {
        const role = await tx.role.create({
            data: { name }
        });

        if (permissionIds && permissionIds.length > 0) {
            await tx.rolePermission.createMany({
                data: permissionIds.map(id => ({
                    roleId: role.id,
                    permissionId: id
                }))
            });
        }

        return role;
    });
};

/**
 * Cập nhật Role và gán lại quyền (Ghi đè)
 */
export const updateRolePermissions = async (roleId, permissionIds) => {
    return await prisma.$transaction(async (tx) => {
        // 1. Xóa hết quyền cũ
        await tx.rolePermission.deleteMany({
            where: { roleId: parseInt(roleId) }
        });

        // 2. Thêm quyền mới
        if (permissionIds && permissionIds.length > 0) {
            await tx.rolePermission.createMany({
                data: permissionIds.map(id => ({
                    roleId: parseInt(roleId),
                    permissionId: id
                }))
            });
        }

        return { success: true };
    });
};

/**
 * Láy danh sách nhân viên thuộc một Role cụ thể
 */
export const getUsersByRole = async (roleId) => {
    return await prisma.user.findMany({
        where: { roleId: parseInt(roleId) },
        select: {
            id: true,
            email: true,
            fullName: true,
            phone: true,
            status: true,
            createdAt: true
        }
    });
};

/**
 * Tạo nhân viên mới và gán Role trực tiếp
 */
export const createStaffUser = async (data) => {
    const { email, fullName, phone, roleId, password } = data;
    
    // Mật khẩu mặc định nếu không có
    const defaultPassword = password || '12345678';
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.default.hash(defaultPassword, 10);

    return await prisma.user.create({
        data: {
            email,
            fullName,
            phone,
            password: hashedPassword,
            roleId: parseInt(roleId),
            status: 'active'
        }
    });
};

/**
 * Lấy thông tin profile rút gọn của nhân viên
 */
export const getUserProfile = async (userId) => {
    const user = await prisma.user.findUnique({
        where: { id: parseInt(userId) },
        include: { role: true }
    });
    
    if (!user) return null;

    return {
        fullName: user.fullName,
        email: user.email,
        roleName: user.role.name,
        avatarUrl: user.avatarUrl
    };
};

/**
 * Lấy danh sách quyền của User hiện tại (Dùng cho Frontend)
 */
export const getUserPermissions = async (userId) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            role: {
                include: {
                    permissions: {
                        include: { permission: true }
                    }
                }
            }
        }
    });

    if (!user) return [];
    return user.role.permissions.map(rp => rp.permission.code);
};

/**
 * Tạo file Excel mẫu để nhập nhân viên
 */
export const generateStaffTemplate = () => {
    const data = [
        ['Họ và tên', 'Email', 'Số điện thoại'], // Headers
        ['Nguyễn Văn A', 'nguyenvana@gmail.com', '0912345678'], // Sample
        ['Trần Thị B', 'tranthib@gmail.com', '0987654321'] // Sample
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template Import Nhan Vien');

    // Cấu hình độ rộng cột
    worksheet['!cols'] = [
        { wch: 25 }, // Họ tên
        { wch: 30 }, // Email
        { wch: 15 }  // SĐT
    ];

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

/**
 * Xử lý nhập nhân viên từ Excel
 */
export const importStaffFromExcel = async (buffer, roleId) => {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet);

    if (rawData.length === 0) {
        throw new Error('File Excel trống hoặc sai định dạng.');
    }

    const bcrypt = await import('bcryptjs');
    const defaultPassword = '12345678';
    const hashedPassword = await bcrypt.default.hash(defaultPassword, 10);

    const results = {
        success: 0,
        failed: 0,
        errors: []
    };

    // Chúng ta lặp qua từng bản ghi để có thể xử lý lỗi chi tiết cho từng người
    // và gán roleId cụ thể
    for (const row of rawData) {
        const fullName = row['Họ và tên'];
        const email = row['Email'];
        const phone = row['Số điện thoại'] ? String(row['Số điện thoại']) : null;

        if (!email || !fullName) {
            results.failed++;
            results.errors.push(`Dòng thiếu Email hoặc Họ tên: ${JSON.stringify(row)}`);
            continue;
        }

        try {
            await prisma.user.create({
                data: {
                    fullName,
                    email,
                    phone,
                    password: hashedPassword,
                    roleId: parseInt(roleId),
                    status: 'active'
                }
            });
            results.success++;
        } catch (error) {
            results.failed++;
            if (error.code === 'P2002') {
                results.errors.push(`${email} hoặc ${phone} đã tồn tại trên hệ thống.`);
            } else {
                results.errors.push(`Lỗi khi tạo ${email}: ${error.message}`);
            }
        }
    }

    return results;
};
/**
 * Cập nhật trạng thái hoạt động của nhân viên (Khóa/Mở khóa)
 */
export const updateStaffStatus = async (staffId, status, updaterId) => {
    // Không cho phép tự khóa chính mình
    if (parseInt(staffId) === parseInt(updaterId)) {
        throw new Error('Bạn không thể tự khóa tài khoản của chính mình.');
    }

    return await prisma.user.update({
        where: { id: parseInt(staffId) },
        data: { status }
    });
};
