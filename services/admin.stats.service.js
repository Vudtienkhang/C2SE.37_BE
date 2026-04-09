import prisma from '../prisma/prisma.js';

/**
 * Lấy thống kê toàn diện hệ thống cho Dashboard Admin
 */
export const getComprehensiveStats = async () => {
    // 1. Thống kê Tài xế & Khách hàng
    const [totalUsers, totalDrivers, pendingDrivers, approvedDrivers] = await Promise.all([
        prisma.user.count(),
        prisma.driver.count(),
        prisma.driver.count({ where: { status: 'pending' } }),
        prisma.driver.count({ where: { status: 'approved' } })
    ]);

    // 2. Thống kê Chuyến đi (Tổng quát)
    const [totalTrips, completedTrips, cancelledTrips, activeTrips] = await Promise.all([
        prisma.trip.count(),
        prisma.trip.count({ where: { status: 'completed' } }),
        prisma.trip.count({ where: { status: 'cancelled' } }),
        prisma.trip.count({ where: { status: { in: ['accepted', 'started'] } } })
    ]);

    // 3. Thống kê Tài chính
    // - Tổng doanh thu (Gross): Tổng finalPrice của các chuyến completed (Số tiền khách trả thực tế)
    // - Hoa hồng hệ thống (Net): Tổng commissionAmount từ TripCommission (Đã bao gồm % hoa hồng + phí hệ thống)
    // - Chi phí Voucher: Tổng discountAmount đã áp dụng cho các chuyến thành công
    const [financialStats, netCommission, totalVoucherDiscount] = await Promise.all([
        prisma.trip.aggregate({
            where: { status: 'completed' },
            _sum: { finalPrice: true }
        }),
        prisma.tripCommission.aggregate({
            _sum: { commissionAmount: true }
        }),
        prisma.voucherUsage.aggregate({
            where: { trip: { status: 'completed' } },
            _sum: { discountAmount: true }
        })
    ]);

    const grossRevenue = financialStats._sum.finalPrice || 0;
    const totalComissionReceived = netCommission._sum.commissionAmount || 0;
    const voucherCost = totalVoucherDiscount._sum.discountAmount || 0;
    
    // Lợi nhuận thực tế (Net Profit) = Tổng hoa hồng thu được - Chi phí bù Voucher cho tài xế
    const netProfit = totalComissionReceived - voucherCost;

    // 4. Thống kê An toàn & Khiếu nại
    const [pendingSOS, pendingDisputes] = await Promise.all([
        prisma.sOSAlert.count({ where: { status: 'active' } }).catch(() => 0),
        prisma.dispute.count({ where: { status: 'open' } }).catch(() => 0)
    ]);

    // 5. Dữ liệu biểu đồ 7 ngày gần nhất (Trips & Lợi nhuận thực tế)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const commissionsTrend = await prisma.tripCommission.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true, commissionAmount: true }
    });

    const tripsCountTrend = await prisma.trip.findMany({
        where: { 
            createdAt: { gte: sevenDaysAgo },
            status: 'completed'
        },
        select: { createdAt: true }
    });

    // Gom nhóm dữ liệu theo ngày
    const dailyStats = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayStr = d.toLocaleDateString('vi-VN', { weekday: 'short' });
        dailyStats[dayStr] = { trips: 0, revenue: 0 };
    }

    commissionsTrend.forEach(comm => {
        const dayStr = new Date(comm.createdAt).toLocaleDateString('vi-VN', { weekday: 'short' });
        if (dailyStats[dayStr]) {
            dailyStats[dayStr].revenue += (comm.commissionAmount || 0);
        }
    });

    tripsCountTrend.forEach(trip => {
        const dayStr = new Date(trip.createdAt).toLocaleDateString('vi-VN', { weekday: 'short' });
        if (dailyStats[dayStr]) {
            dailyStats[dayStr].trips += 1;
        }
    });

    // Chuyển sang mảng để frontend dễ vẽ biểu đồ
    const chartData = Object.keys(dailyStats).map(day => ({
        name: day,
        trips: dailyStats[day].trips,
        revenue: dailyStats[day].revenue
    })).reverse();

    // 6. Hoạt động gần đây (Lấy 5 chuyến đi mới nhất)
    const recentTripsList = await prisma.trip.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
            customer: { select: { fullName: true } },
            driver: { select: { fullName: true } }
        }
    });

    return {
        summary: {
            users: {
                total: totalUsers,
                drivers: totalDrivers,
                customers: totalUsers - totalDrivers,
                pendingDrivers,
                approvedDrivers
            },
            trips: {
                total: totalTrips,
                completed: completedTrips,
                cancelled: cancelledTrips,
                active: activeTrips
            },
            financial: {
                grossRevenue: grossRevenue,
                netCommission: totalComissionReceived,
                netProfit: netProfit,
                voucherCost: voucherCost,
                avgTripPrice: completedTrips > 0 ? (grossRevenue / completedTrips) : 0
            },
            safety: {
                pendingSOS,
                pendingDisputes
            }
        },
        chartData,
        recentTrips: recentTripsList.map(t => ({
            id: `#TR-${t.id}`,
            customer: t.customer?.fullName || 'N/A',
            driver: t.driver?.fullName || 'N/A',
            route: t.pickupAddress && t.dropoffAddress 
                ? `${t.pickupAddress.split(',')[0]} → ${t.dropoffAddress.split(',')[0]}`
                : 'Chưa rõ hành trình',
            status: t.status,
            time: t.createdAt
        }))
    };
};
