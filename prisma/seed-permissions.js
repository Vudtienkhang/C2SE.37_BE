import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    console.log('--- Đang khởi tạo danh sách quyền hệ thống ---');

    const permissions = [
        // Nhóm Hệ thống & Dashboard
        { code: 'DASHBOARD_VIEW', name: 'Xem Dashboard', group: 'SYSTEM', description: 'Cho phép xem các chỉ số tổng hợp tại trang chủ' },
        { code: 'ROLES_MANAGE', name: 'Quản lý Phân quyền', group: 'SYSTEM', description: 'Toàn quyền tạo role và gán quyền' },
        { code: 'STAFF_STATUS_MANAGE', name: 'Khóa/Mở nhân viên', group: 'SYSTEM', description: 'Có quyền khóa hoặc kích hoạt lại tài khoản nhân viên' },
        { code: 'SYSTEM_CONFIG_MANAGE', name: 'Cấu hình hệ thống', group: 'SYSTEM', description: 'Chỉnh sửa giá cước, cấu hình ngày lễ' },

        // Nhóm Tài xế
        { code: 'DRIVERS_VIEW', name: 'Xem danh sách tài xế', group: 'DRIVER', description: 'Xem danh sách và thông tin cơ bản tài xế' },
        { code: 'DRIVERS_STATUS_EDIT', name: 'Duyệt/Khóa tài xế', group: 'DRIVER', description: 'Thay đổi trạng thái hoạt động của tài xế' },
        { code: 'DRIVERS_DELETE', name: 'Xóa tài xế', group: 'DRIVER', description: 'Xóa vĩnh viễn tài khoản tài xế' },
        { code: 'DRIVERS_STATS_VIEW', name: 'Xem thống kê tài xế', group: 'DRIVER', description: 'Xem doanh thu và hiệu suất của từng tài xế' },
        { code: 'DRIVERS_RANKS_MANAGE', name: 'Quản lý hạng tài xế', group: 'DRIVER', description: 'Cấu hình các mức hạng và điểm thưởng' },

        // Nhóm Khách hàng
        { code: 'CUSTOMERS_VIEW', name: 'Xem danh sách khách hàng', group: 'CUSTOMER', description: 'Xem danh sách và thông tin khách hàng' },
        { code: 'CUSTOMERS_STATUS_EDIT', name: 'Khóa/Mở khách hàng', group: 'CUSTOMER', description: 'Thay đổi trạng thái hoạt động của khách hàng' },
        { code: 'CUSTOMERS_DELETE', name: 'Xóa khách hàng', group: 'CUSTOMER', description: 'Xóa vĩnh viễn tài khoản khách hàng' },

        // Nhóm Tài chính
        { code: 'REVENUE_VIEW', name: 'Xem doanh thu', group: 'FINANCE', description: 'Xem các biểu đồ và báo cáo doanh thu' },
        { code: 'WITHDRAWALS_VIEW', name: 'Xem yêu cầu rút tiền', group: 'FINANCE', description: 'Theo dõi các yêu cầu rút tiền của tài xế' },
        { code: 'WITHDRAWALS_APPROVE', name: 'Duyệt rút tiền', group: 'FINANCE', description: 'Phê duyệt hoặc từ chối lệnh rút tiền' },
        
        // Nhóm Vận hành
        { code: 'TRIPS_VIEW', name: 'Xem lịch sử chuyến đi', group: 'OPERATION', description: 'Xem chi tiết tất cả các chuyến đi' },
        { code: 'DISPUTES_MANAGE', name: 'Quản lý khiếu nại', group: 'OPERATION', description: 'Xử lý các khiếu nại giữa khách và tài xế' },
        { code: 'SOS_VIEW', name: 'Xem danh sách SOS', group: 'OPERATION', description: 'Theo dõi các tín hiệu khẩn cấp từ ứng dụng' },
        { code: 'SOS_MANAGE', name: 'Xử lý SOS', group: 'OPERATION', description: 'Tiếp nhận và xác nhận xử lý SOS' },

        // Nhóm Marketing & Khuyến mãi
        { code: 'VOUCHERS_VIEW', name: 'Xem danh sách Voucher', group: 'MARKETING', description: 'Xem danh sách các mã giảm giá hiện có' },
        { code: 'VOUCHERS_MANAGE', name: 'Quản lý khuyến mãi', group: 'MARKETING', description: 'Tạo, sửa và xóa các mã giảm giá' },
        { code: 'NOTIFICATIONS_VIEW', name: 'Xem thông báo', group: 'SYSTEM', description: 'Xem lịch sử thông báo hệ thống' },
        { code: 'NOTIFICATIONS_MANAGE', name: 'Gửi thông báo', group: 'SYSTEM', description: 'Tạo và gửi thông báo mới cho người dùng' },
    ];

    // 1. Tạo Permissions
    for (const p of permissions) {
        await prisma.permission.upsert({
            where: { code: p.code },
            update: p,
            create: p,
        });
    }

    // 2. Lấy Role Admin mặc định (ID = 1)
    const adminRole = await prisma.role.findUnique({ where: { id: 1 } });
    
    if (adminRole) {
        console.log(`--- Gán tất cả quyền cho Role: ${adminRole.name} ---`);
        const allPermissions = await prisma.permission.findMany();
        
        for (const p of allPermissions) {
            await prisma.rolePermission.upsert({
                where: {
                    roleId_permissionId: {
                        roleId: adminRole.id,
                        permissionId: p.id
                    }
                },
                update: {},
                create: {
                    roleId: adminRole.id,
                    permissionId: p.id
                }
            });
        }
    }

    console.log('--- Hoàn tất Seed Permissions ---');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
