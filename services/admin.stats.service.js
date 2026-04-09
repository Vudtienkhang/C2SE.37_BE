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

    // 5. Thống kê Phân bổ Trạng thái Chuyến đi (Mới)
    const statusCounts = await prisma.trip.groupBy({
        by: ['status'],
        _count: { id: true }
    });

    const statusDistribution = {
        requested: 0,
        accepted: 0,
        arrived: 0,
        started: 0,
        completed: 0,
        cancelled: 0
    };
    statusCounts.forEach(item => {
        statusDistribution[item.status] = item._count.id;
    });

    // 6. Thống kê Phân bổ Phương tiện (Dựa trên vehicleType)
    const vehicleDistribution = await prisma.customerVehicle.groupBy({
        by: ['vehicleType'],
        _count: { id: true }
    });

    // 7. Top 5 Tài xế xuất sắc (Dựa trên số chuyến hoàn thành & Rating)
    const topDriversRaw = await prisma.driver.findMany({
        where: { status: 'approved' },
        take: 5,
        orderBy: [
            { totalTrips: 'desc' },
            { ratingAvg: 'desc' }
        ],
        include: {
            user: { select: { fullName: true, avatarUrl: true } },
            DriverRank: true,
            _count: {
                select: {
                    trips: { where: { status: 'completed' } }
                }
            }
        }
    });

    // Tính tỉ lệ hoàn thành cho từng top driver
    const topDrivers = await Promise.all(topDriversRaw.map(async (d) => {
        // Lấy ID tài xế một cách an toàn
        const driverId = Number(d.id);
        
        const [completedCount, cancelledCount] = await Promise.all([
            prisma.trip.count({ where: { driverId: driverId, status: 'completed' } }),
            prisma.trip.count({ where: { driverId: driverId, status: 'cancelled' } })
        ]);
        
        const totalWork = completedCount + cancelledCount;
        // Nếu không có dữ liệu chuyến đi thực tế trong bảng Trip, sử dụng totalTrips làm căn cứ tạm thời (mặc định 100% nếu có totalTrips)
        let rate = 100;
        if (totalWork > 0) {
            rate = (completedCount / totalWork) * 100;
        } else if (d.totalTrips > 0) {
            rate = 100; // Giả định là hoàn thành hết nếu có số liệu cũ mà không có record Trip
        }

        return {
            id: d.id,
            name: d.user?.fullName || d.fullName || 'N/A',
            avatar: d.user?.avatarUrl || d.avatarUrl,
            rating: d.ratingAvg || 0,
            trips: d.totalTrips,
            rank: d.DriverRank?.name || 'Thành viên',
            completionRate: Math.round(rate)
        };
    }));

    // 8. Dữ liệu biểu đồ 7 ngày gần nhất (Trips & Lợi nhuận thực tế)
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
                active: activeTrips,
                statusDistribution // Mới
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
            },
            vehicles: vehicleDistribution.map(v => ({
                type: v.vehicleType || 'Khác',
                count: v._count.id
            }))
        },
        chartData,
        topDrivers
    };
};
