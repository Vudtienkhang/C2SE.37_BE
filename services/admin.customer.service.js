import prisma from '../prisma/prisma.js';

/**
 * @file admin.customer.service.js
 * @description Service xử lý các nghiệp vụ liên quan đến quản lý khách hàng dành cho Admin.
 * Bao gồm các chức năng: lấy danh sách, xem chi tiết, cập nhật trạng thái và thống kê.
 */

/**
 * Lấy danh sách khách hàng với các tính năng phân trang, tìm kiếm và tính toán tổng chi tiêu.
 * 
 * @param {number} [page=1] - Số trang hiện tại (mặc định là 1).
 * @param {number} [limit=10] - Số lượng bản ghi trên mỗi trang (mặc định là 10).
 * @param {string} [search=''] - Từ khóa tìm kiếm (theo tên, số điện thoại hoặc email).
 * @returns {Promise<Object>} Trả về đối tượng chứa thông tin phân trang và danh sách khách hàng đã format.
 * @property {number} total - Tổng số khách hàng tìm thấy.
 * @property {number} page - Trang hiện tại.
 * @property {number} limit - Số lượng bản ghi mỗi trang.
 * @property {number} totalPages - Tổng số trang.
 * @property {Array} data - Danh sách khách hàng kèm theo thông tin tổng chuyến đi và tổng chi tiêu.
 */
export const getAllCustomers = async (page = 1, limit = 10, search = '') => {
    // Tính toán số lượng bản ghi cần bỏ qua cho phân trang
    const skip = (page - 1) * limit;

    // Cấu hình điều kiện tìm kiếm
    const where = {
        roleId: 3, // 3 tương ứng với vai trò Customer
        OR: search ? [
            { fullName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
        ] : undefined,
    };

    // Thực hiện đếm tổng và lấy dữ liệu đồng thời để tối ưu hiệu năng
    const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
            where,
            skip,
            take: Number(limit),
            include: {
                customer: {
                    include: {
                        trips: { select: { finalPrice: true, id: true } } // Chỉ lấy thông tin cần thiết để tính toán
                    }
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        }),
    ]);

    // Định dạng lại dữ liệu: Tính toán tổng số chuyến đi và tổng số tiền đã chi tiêu
    const formattedData = users.map(user => {
        const tripsCount = user.customer?.trips?.length || 0;
        const totalSpent = user.customer?.trips?.reduce((acc, t) => acc + (t.finalPrice || 0), 0) || 0;
        return {
            ...user,
            totalTrips: tripsCount,
            totalSpent: totalSpent
        };
    });

    return {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
        data: formattedData,
    };
};

/**
 * Lấy danh sách chuyến đi của một khách hàng có phân trang.
 */
export const getCustomerTrips = async (userId, page = 1, limit = 5) => {
    const skip = (page - 1) * limit;

    const user = await prisma.user.findUnique({
        where: { id: Number(userId) },
        select: { customer: { select: { id: true } } }
    });

    if (!user || !user.customer) throw new Error('Customer not found');

    const [trips, total] = await Promise.all([
        prisma.trip.findMany({
            where: { customerId: user.customer.id },
            skip,
            take: Number(limit),
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                finalPrice: true,
                status: true,
                createdAt: true,
                pickupAddress: true,
                dropoffAddress: true
            }
        }),
        prisma.trip.count({ where: { customerId: user.customer.id } })
    ]);

    return {
        data: trips,
        meta: {
            total,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(total / limit)
        }
    };
};

/**
 * Lấy thông tin chi tiết của một khách hàng cụ thể.
 * 
 * @param {number|string} userId - ID của người dùng (khách hàng).
 * @returns {Promise<Object>} Thông tin chi tiết khách hàng bao gồm ví, địa chỉ đã lưu và tổng số chuyến đi.
 * @throws {Error} Quăng lỗi nếu không tìm thấy khách hàng.
 */
export const getCustomerDetail = async (userId) => {
    // Lấy thông tin User cùng với các quan hệ liên quan
    const user = await prisma.user.findUnique({
        where: { id: Number(userId) },
        include: {
            customer: {
                include: {
                    vehicles: true,
                    savedAddresses: true,
                    trips: {
                        take: 5,
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true,
                            finalPrice: true,
                            status: true,
                            createdAt: true
                        }
                    }
                }
            },
            wallet: true,
        },
    });

    // Kiểm tra sự tồn tại của khách hàng
    if (!user || !user.customer) {
        throw new Error('Customer not found');
    }

    // Tính toán thống kê
    const allTrips = await prisma.trip.findMany({
        where: { customerId: user.customer.id },
        select: { finalPrice: true, status: true }
    });

    const totalTrips = allTrips.length;
    const totalSpent = allTrips.reduce((sum, trip) => sum + (trip.finalPrice || 0), 0);
    const completedTrips = allTrips.filter(t => t.status === 'completed').length;

    // Tính rating trung bình từ các review khách đã viết
    const avgRating = await prisma.review.aggregate({
        where: { customerId: user.customer.id },
        _avg: { rating: true }
    });

    return {
        ...user,
        stats: {
            totalTrips,
            totalSpent,
            completedTrips,
            ratingAvg: avgRating._avg.rating || 0
        },
        recentTrips: user.customer.trips,
        address: user.customer.savedAddresses.find(a => a.type === 'home')?.address || user.customer.savedAddresses[0]?.address
    };
};

/**
 * Cập nhật trạng thái hoạt động của khách hàng (ví dụ: khóa tài khoản, kích hoạt lại).
 * 
 * @param {number|string} userId - ID của người dùng.
 * @param {string} status - Trạng thái mới ('active', 'banned', 'suspended').
 * @returns {Promise<Object>} Đối tượng User sau khi đã cập nhật.
 * @throws {Error} Quăng lỗi nếu trạng thái không hợp lệ.
 */
export const changeCustomerStatus = async (userId, status) => {
    const validStatuses = ['active', 'banned', 'suspended'];
    if (!validStatuses.includes(status)) {
        throw new Error('Invalid status');
    }

    const user = await prisma.user.update({
        where: { id: Number(userId) },
        data: { status },
    });

    return user;
};

/**
 * Lấy các thông số thống kê về khách hàng phục vụ cho Dashboard Admin.
 * Thống kê bao gồm: Tổng số khách, số khách đang hoạt động và số khách mới trong tháng.
 * 
 * @returns {Promise<Object>} Đối tượng chứa các thông số thống kê.
 */
export const getCustomerStats = async () => {
    // Xác định mốc thời gian bắt đầu của tháng hiện tại
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalCustomers, activeCustomers, newThisMonth] = await Promise.all([
        // 1. Thống kê tổng số khách hàng hệ thống
        prisma.user.count({
            where: { roleId: 3 }
        }),
        // 2. Thống kê khách hàng có trạng thái đang hoạt động
        prisma.user.count({
            where: { roleId: 3, status: 'active' }
        }),
        // 3. Thống kê khách hàng mới đăng ký trong tháng này
        prisma.user.count({
            where: {
                roleId: 3,
                createdAt: {
                    gte: startOfMonth
                }
            }
        })
    ]);

    return {
        totalCustomers,
        activeCustomers,
        newThisMonth
    };
};
