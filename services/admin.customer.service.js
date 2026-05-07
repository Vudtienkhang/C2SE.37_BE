import prisma from '../prisma/prisma.js';

/**
 * Lấy danh sách khách hàng (có phân trang, tìm kiếm)
 */
export const getAllCustomers = async (page = 1, limit = 10, search = '') => {
    const skip = (page - 1) * limit;

    const where = {
        roleId: 3, // 3 = Customer. 
        OR: search ? [
            { fullName: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
        ] : undefined,
    };

    const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
            where,
            skip,
            take: Number(limit),
            include: {
                customer: {
                    include: {
                        trips: { select: { finalPrice: true, id: true } } // Để tính tổng tiền / chuyến đi
                    }
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        }),
    ]);

    // Format dữ liệu trước khi trả về (Tính tổng chuyến đi, tổng chi tiêu)
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
 * Lấy chi tiết 1 khách hàng
 */
export const getCustomerDetail = async (userId) => {
    const user = await prisma.user.findUnique({
        where: { id: Number(userId) },
        include: {
            customer: {
                include: {
                    vehicles: true,
                    savedAddresses: true,
                }
            },
            wallet: true,
        },
    });

    if (!user || !user.customer) {
        throw new Error('Customer not found');
    }

    const totalTrips = await prisma.trip.count({
        where: { customerId: user.customer.id }
    });

    return {
        ...user,
        totalTrips
    };
};

/**
 * Cập nhật trạng thái khách hàng
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
 * Lấy thống kê khách hàng cho Admin Dashboard
 */
export const getCustomerStats = async () => {
    // Ngày đầu tháng hiện tại
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalCustomers, activeCustomers, newThisMonth] = await Promise.all([
        // 1. Tổng khách hàng/sum
        prisma.user.count({
            where: { roleId: 3 }
        }),
        // 2. Khách hàng đang hoạt động/online 
        prisma.user.count({
            where: { roleId: 3, status: 'active' }
        }),
        // 3. Khách hàng mới tháng này/ month 
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
