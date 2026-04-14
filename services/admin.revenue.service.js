import prisma from '../prisma/prisma.js';

/**
 * Láy thống kê doanh thu tổng hợp (hôm nay, tuần này, tháng này, chờ thanh toán)
 */
export const getRevenueStats = async () => {
    const now = new Date();
    
    // 1. Xác định mốc thời gian (Không mutate now)
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1)); // Thứ 2 đầu tuần
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 2. Truy vấn đồng thời
    const [
        todayTrips, 
        weekTrips, 
        monthTrips, 
        pendingWithdrawals,
        todayCommissions,
        monthCommissions,
        todaySystemFees,
        monthSystemFees
    ] = await Promise.all([
        // Tổng doanh thu (Gross)
        prisma.trip.aggregate({
            where: { status: 'completed', createdAt: { gte: todayStart } },
            _sum: { finalPrice: true }
        }),
        prisma.trip.aggregate({
            where: { status: 'completed', createdAt: { gte: weekStart } },
            _sum: { finalPrice: true }
        }),
        prisma.trip.aggregate({
            where: { status: 'completed', createdAt: { gte: monthStart } },
            _sum: { finalPrice: true }
        }),
        // Chờ thanh toán
        prisma.withdrawalRequest.aggregate({
            where: { status: 'pending' },
            _sum: { amount: true }
        }),
        // Hoa hồng (%) - Chỉ tính chuyến đã hoàn thành
        prisma.tripCommission.aggregate({
            where: { 
                createdAt: { gte: todayStart },
                trip: { status: 'completed' }
            },
            _sum: { commissionAmount: true }
        }),
        prisma.tripCommission.aggregate({
            where: { 
                createdAt: { gte: monthStart },
                trip: { status: 'completed' }
            },
            _sum: { commissionAmount: true }
        }),
        // Phí hệ thống (Flat) - Chỉ tính chuyến đã hoàn thành
        prisma.tripFeeBreakdown.aggregate({
            where: { 
                feeType: 'system_fee', 
                createdAt: { gte: todayStart },
                trip: { status: 'completed' }
            },
            _sum: { amount: true }
        }),
        prisma.tripFeeBreakdown.aggregate({
            where: { 
                feeType: 'system_fee', 
                createdAt: { gte: monthStart },
                trip: { status: 'completed' }
            },
            _sum: { amount: true }
        })
    ]);

    // Tính toán doanh thu thực tế của hệ thống (Commission + System Fee)
    const todayNetRevenue = (todayCommissions._sum.commissionAmount || 0) + (todaySystemFees._sum.amount || 0);
    const monthNetRevenue = (monthCommissions._sum.commissionAmount || 0) + (monthSystemFees._sum.amount || 0);

    // 3. Dữ liệu biểu đồ 7 ngày gần nhất (Doanh thu ròng - Gross)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const dailyRevenueTrend = await prisma.trip.findMany({
        where: {
            status: 'completed',
            createdAt: { gte: sevenDaysAgo }
        },
        select: {
            finalPrice: true,
            createdAt: true
        }
    });

    const dailyStats = {};
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dayStr = d.toLocaleDateString('vi-VN', { weekday: 'short' });
        dailyStats[dayStr] = 0;
    }

    dailyRevenueTrend.forEach(trip => {
        const dayStr = new Date(trip.createdAt).toLocaleDateString('vi-VN', { weekday: 'short' });
        if (dailyStats[dayStr] !== undefined) {
            dailyStats[dayStr] += (trip.finalPrice || 0);
        }
    });

    const chartData = Object.keys(dailyStats).map(day => ({
        name: day,
        value: dailyStats[day]
    })).reverse();

    return {
        stats: {
            netRevenue: {
                today: todayNetRevenue,
                month: monthNetRevenue
            },
            grossVolume: {
                today: (todayTrips._sum.finalPrice || 0),
                month: (monthTrips._sum.finalPrice || 0)
            },
            pendingSettlement: (pendingWithdrawals._sum.amount || 0)
        },
        chartData
    };
};

/**
 * Lấy danh sách giao dịch gần đây
 */
export const getRecentTransactions = async (limit = 10) => {
    const payments = await prisma.payment.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
            trip: {
                include: {
                    customer: {
                        select: { fullName: true }
                    }
                }
            }
        }
    });

    return payments.map(p => ({
        id: `PAY-${p.id}`,
        tripId: `TR-${p.tripId}`,
        customer: p.trip?.customer?.fullName || 'Khách vãng lai',
        amount: p.amount,
        method: p.method === 'CASH' ? 'Tiền mặt' : (p.method === 'WALLET' ? 'Ví điện tử' : p.method),
        time: p.createdAt,
        status: p.status === 'success' ? 'Thành công' : (p.status === 'pending' ? 'Đang xử lý' : 'Thất bại'),
        statusColor: p.status === 'success' ? 'bg-emerald-100 text-emerald-700' : (p.status === 'pending' ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700')
    }));
};
