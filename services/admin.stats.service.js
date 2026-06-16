import prisma from '../prisma/prisma.js';

/**
 * Tính toán mốc thời gian linh hoạt (Hôm nay, Tuần, Tháng, Năm, Tùy chọn, Theo năm cụ thể)
 */
const getPeriodRanges = (period, startDate, endDate) => {
    const now = new Date();
    let currentStart = new Date(now);
    let currentEnd = new Date(now);
    let prevStart = new Date(now);
    let prevEnd = new Date(now);

    if (period === 'today') {
        currentStart.setHours(0, 0, 0, 0);
        prevStart.setDate(prevStart.getDate() - 1);
        prevStart.setHours(0, 0, 0, 0);
        prevEnd.setDate(prevEnd.getDate() - 1);
        prevEnd.setHours(23, 59, 59, 999);
    } else if (period === 'week') {
        const day = now.getDay();
        const diff = now.getDate() - (day === 0 ? 6 : day - 1);
        currentStart.setDate(diff);
        currentStart.setHours(0, 0, 0, 0);
        prevStart = new Date(currentStart);
        prevStart.setDate(prevStart.getDate() - 7);
        prevEnd = new Date(currentStart);
        prevEnd.setMilliseconds(-1);
    } else if (period === 'month') {
        currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
        currentStart.setHours(0, 0, 0, 0);
        prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        prevEnd = new Date(currentStart);
        prevEnd.setMilliseconds(-1);
    } else if (period === 'year') {
        currentStart = new Date(now.getFullYear(), 0, 1);
        currentStart.setHours(0, 0, 0, 0);
        prevStart = new Date(now.getFullYear() - 1, 0, 1);
        prevEnd = new Date(currentStart);
        prevEnd.setMilliseconds(-1);
    } else if (period === 'custom' && startDate && endDate) {
        currentStart = new Date(startDate);
        currentStart.setHours(0, 0, 0, 0);
        currentEnd = new Date(endDate);
        currentEnd.setHours(23, 59, 59, 999);

        // So sánh với khoảng thời gian bằng độ dài trước đó
        const diffInMs = currentEnd.getTime() - currentStart.getTime();
        prevStart = new Date(currentStart.getTime() - diffInMs - 1000);
        prevStart.setHours(0, 0, 0, 0);
        prevEnd = new Date(currentStart.getTime() - 1000);
    } else if (period && period.startsWith('year_')) {
        const year = parseInt(period.split('_')[1]);
        currentStart = new Date(year, 0, 1);
        currentStart.setHours(0, 0, 0, 0);
        currentEnd = new Date(year, 11, 31, 23, 59, 59, 999);
        if (year === now.getFullYear()) {
            currentEnd = new Date(now);
        }
        prevStart = new Date(year - 1, 0, 1);
        prevEnd = new Date(year - 1, 11, 31, 23, 59, 59, 999);
    } else {
        // 'all'
        currentStart = new Date(2023, 0, 1);
        prevStart = null;
    }

    return { currentStart, currentEnd, prevStart, prevEnd };
};

const calculateGrowth = (current, previous) => {
    if (!previous || previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
};

const fetchMetricsGroup = async (filter) => {
    if (!filter || !filter.createdAt) return null;
    const start = filter.createdAt.gte;
    const end = filter.createdAt.lte;

    // Chuyển sang SQL Raw để đảm bảo tính nhất quán qua JOIN
    const metricsRaw = await prisma.$queryRaw`
        SELECT 
            COUNT(T.id)::int as trips,
            SUM(CASE WHEN T.status = 'completed' THEN COALESCE(T."finalPrice", 0) ELSE 0 END)::float as gross,
            SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0)) ELSE 0 END)::float as net,
            SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0) - COALESCE(VU.discount, 0)) ELSE 0 END)::float as profit,
            COUNT(CASE WHEN T.status = 'completed' THEN 1 END)::int as completed,
            COUNT(CASE WHEN T.status = 'cancelled' THEN 1 END)::int as cancelled
        FROM "Trip" T
        LEFT JOIN "TripCommission" C ON T.id = C."tripId"
        LEFT JOIN (
            SELECT "tripId", SUM(amount) as system_fee 
            FROM "TripFeeBreakdown" WHERE "feeType" = 'system_fee' GROUP BY "tripId"
        ) FB ON T.id = FB."tripId"
        LEFT JOIN (
            SELECT "tripId", SUM("discountAmount") as discount 
            FROM "VoucherUsage" GROUP BY "tripId"
        ) VU ON T.id = VU."tripId"
        WHERE T."createdAt" >= ${start} AND T."createdAt" <= ${end}`;

    const [drivers, customers] = await Promise.all([
        prisma.driver.count({ where: { createdAt: filter.createdAt } }),
        prisma.user.count({ where: { createdAt: filter.createdAt, driver: null } })
    ]);

    const m = metricsRaw[0] || { trips: 0, gross: 0, net: 0, profit: 0, completed: 0, cancelled: 0 };

    return {
        drivers, customers, 
        trips: m.trips,
        completed: m.completed,
        cancelled: m.cancelled,
        grossRevenue: m.gross,
        netProfit: m.profit, 
        driverEarnings: Math.max(0, m.gross - m.profit) // Đảm bảo không bị âm khi dữ liệu bất thường
    };
};

/**
 * Lấy thống kê toàn diện hệ thống cho Dashboard Admin - ĐÃ NÂNG CẤP LỌC NÂNG CAO & RAW SQL
 */
export const getComprehensiveStats = async (period = 'all', startDate, endDate) => {
    const { currentStart, currentEnd, prevStart, prevEnd } = getPeriodRanges(period, startDate, endDate);
    const dateFilter = { createdAt: { gte: currentStart, lte: currentEnd } };
    const prevDateFilter = prevStart ? { createdAt: { gte: prevStart, lte: prevEnd } } : null;

    // Xác định chế độ hiển thị biểu đồ dựa trên độ dài khoảng thời gian
    const diffDays = Math.ceil((currentEnd - currentStart) / (1000 * 60 * 60 * 24));
    let chartMode = 'month'; // Mặc định theo tháng
    if (diffDays <= 1) chartMode = 'hour';
    else if (diffDays <= 65) chartMode = 'day';

    let chartPromise;
    if (chartMode === 'hour') {
        chartPromise = prisma.$queryRaw`
            SELECT 
                EXTRACT(HOUR FROM T."createdAt")::int as name_num, 
                COUNT(T.id)::int as trips,
                SUM(CASE WHEN T.status = 'completed' THEN T."finalPrice" ELSE 0 END)::float as gross,
                SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0)) ELSE 0 END)::float as net,
                SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0) - COALESCE(VU.discount, 0)) ELSE 0 END)::float as profit
            FROM "Trip" T
            LEFT JOIN "TripCommission" C ON T.id = C."tripId"
            LEFT JOIN (
                SELECT "tripId", SUM(amount) as system_fee 
                FROM "TripFeeBreakdown" WHERE "feeType" = 'system_fee' GROUP BY "tripId"
            ) FB ON T.id = FB."tripId"
            LEFT JOIN (
                SELECT "tripId", SUM("discountAmount") as discount 
                FROM "VoucherUsage" GROUP BY "tripId"
            ) VU ON T.id = VU."tripId"
            WHERE T."createdAt" >= ${currentStart} AND T."createdAt" <= ${currentEnd}
            GROUP BY name_num ORDER BY name_num`;
    } else if (chartMode === 'day') {
        chartPromise = prisma.$queryRaw`
            SELECT 
                T."createdAt"::date as name_num, 
                COUNT(T.id)::int as trips,
                SUM(CASE WHEN T.status = 'completed' THEN T."finalPrice" ELSE 0 END)::float as gross,
                SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0)) ELSE 0 END)::float as net,
                SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0) - COALESCE(VU.discount, 0)) ELSE 0 END)::float as profit
            FROM "Trip" T
            LEFT JOIN "TripCommission" C ON T.id = C."tripId"
            LEFT JOIN (
                SELECT "tripId", SUM(amount) as system_fee 
                FROM "TripFeeBreakdown" WHERE "feeType" = 'system_fee' GROUP BY "tripId"
            ) FB ON T.id = FB."tripId"
            LEFT JOIN (
                SELECT "tripId", SUM("discountAmount") as discount 
                FROM "VoucherUsage" GROUP BY "tripId"
            ) VU ON T.id = VU."tripId"
            WHERE T."createdAt" >= ${currentStart} AND T."createdAt" <= ${currentEnd}
            GROUP BY name_num ORDER BY name_num`;
    } else {
        chartPromise = prisma.$queryRaw`
            SELECT 
                EXTRACT(MONTH FROM T."createdAt")::int as month_num,
                EXTRACT(YEAR FROM T."createdAt")::int as year_num,
                COUNT(T.id)::int as trips,
                SUM(CASE WHEN T.status = 'completed' THEN T."finalPrice" ELSE 0 END)::float as gross,
                SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0)) ELSE 0 END)::float as net,
                SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0) - COALESCE(VU.discount, 0)) ELSE 0 END)::float as profit
            FROM "Trip" T
            LEFT JOIN "TripCommission" C ON T.id = C."tripId"
            LEFT JOIN (
                SELECT "tripId", SUM(amount) as system_fee 
                FROM "TripFeeBreakdown" WHERE "feeType" = 'system_fee' GROUP BY "tripId"
            ) FB ON T.id = FB."tripId"
            LEFT JOIN (
                SELECT "tripId", SUM("discountAmount") as discount 
                FROM "VoucherUsage" GROUP BY "tripId"
            ) VU ON T.id = VU."tripId"
            WHERE T."createdAt" >= ${currentStart} AND T."createdAt" <= ${currentEnd}
            GROUP BY year_num, month_num ORDER BY year_num, month_num`;
    }

    const [
        snapshots,
        currentMetrics,
        prevMetrics,
        statusCounts,
        healthStats,
        topDriversRaw,
        rawChartData
    ] = await Promise.all([
        Promise.all([
            prisma.driver.count({ where: { isOnline: true } }),
            prisma.driver.count(),
            prisma.driver.count({ where: { status: 'approved' } }),
            prisma.driver.count({ where: { status: 'pending' } }),
            prisma.user.count()
        ]),
        fetchMetricsGroup(dateFilter),
        fetchMetricsGroup(prevDateFilter),
        prisma.trip.groupBy({ where: dateFilter, by: ['status'], _count: { id: true } }),
        Promise.all([
            prisma.trip.count({ where: dateFilter }),
            prisma.trip.count({ where: { ...dateFilter, driverId: { not: null } } }),
            prisma.driver.count({ where: { isOnline: true, isBusy: false, status: 'approved' } }),
            prisma.sOSAlert.count({ where: { status: 'active' } }).catch(() => 0),
            prisma.dispute.count({ where: { status: 'open' } }).catch(() => 0),
            prisma.review.aggregate({ _avg: { rating: true }, where: { createdAt: dateFilter.createdAt } })
        ]),
        prisma.driver.findMany({
            where: { status: 'approved' },
            take: 6,
            orderBy: [{ totalTrips: 'desc' }, { ratingAvg: 'desc' }],
            include: { user: { select: { fullName: true, avatarUrl: true } }, DriverRank: true }
        }),
        chartPromise
    ]);

    const [onlineDrivers, totalDrivers, approvedDrivers, pendingDrivers, totalUsers] = snapshots;
    const [totalRequestedTrips, matchedTrips, onlineReadyDrivers, pendingSOS, pendingDisputes, avgRating] = healthStats;

    // Batching dữ liệu Top Drivers cực nhanh
    const driverIds = topDriversRaw.map(d => d.id);
    const batchDriverStats = driverIds.length > 0 ? await prisma.trip.groupBy({
        where: { driverId: { in: driverIds } },
        by: ['driverId', 'status'],
        _count: { id: true },
        _sum: { finalPrice: true }
    }) : [];

    const topDrivers = topDriversRaw.map(d => {
        const dStats = batchDriverStats.filter(s => s.driverId === d.id);
        const comp = dStats.find(s => s.status === 'completed')?._count.id || 0;
        const canc = dStats.find(s => s.status === 'cancelled')?._count.id || 0;
        const rev = dStats.find(s => s.status === 'completed')?._sum.finalPrice || 0;

        return {
            id: d.id,
            name: d.fullName || d.user?.fullName || 'N/A',
            avatar: d.avatarUrl || d.user?.avatarUrl,
            rating: d.ratingAvg || 5.0,
            completedTrips: comp,
            cancelledTrips: canc,
            revenueGenerated: Number(rev),
            totalTrips: d.totalTrips,
            isOnline: d.isOnline,
            isBusy: d.isBusy,
            performance: (comp + canc) > 0 ? Math.round((comp / (comp + canc)) * 100) : 100,
            rank: d.DriverRank?.name || 'Đồng'
        };
    });

    // Formatting Chart Data
    let chartData = [];
    if (chartMode === 'hour') {
        const hourMap = {};
        rawChartData.forEach(row => { hourMap[row.name_num] = row; });
        for (let i = 0; i <= 23; i++) {
            const data = hourMap[i];
            chartData.push({ 
                name: `${i}h`, 
                gross: data?.gross || 0,
                net: data?.net || 0,
                profit: data?.profit || 0,
                trips: data?.trips || 0
            });
        }
    } else if (chartMode === 'day') {
        const dateMap = {};
        rawChartData.forEach(row => {
            const label = new Date(row.name_num).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' });
            dateMap[label] = row;
        });
        for (let i = 0; i < diffDays; i++) {
            const d = new Date(currentStart);
            d.setDate(d.getDate() + i);
            const label = d.toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' });
            const data = dateMap[label];
            chartData.push({ 
                name: label, 
                gross: data?.gross || 0,
                net: data?.net || 0,
                profit: data?.profit || 0,
                trips: data?.trips || 0
            });
        }
    } else {
        // Month mode
        rawChartData.forEach(row => {
            chartData.push({ 
                name: `T${row.month_num}/${row.year_num}`, 
                gross: row.gross || 0, 
                net: row.net || 0,
                profit: row.profit || 0,
                trips: row.trips || 0 
            });
        });
    }

    const completionRate = currentMetrics.trips > 0
        ? Math.round((currentMetrics.completed / (currentMetrics.completed + currentMetrics.cancelled || 1)) * 100)
        : 100;

    const statusDistribution = { requested: 0, accepted: 0, arrived: 0, started: 0, completed: 0, cancelled: 0 };
    let totalFilteredTrips = 0;
    statusCounts.forEach(item => {
        statusDistribution[item.status] = item._count.id;
        totalFilteredTrips += item._count.id;
    });

    return {
        summary: {
            financial: {
                total: currentMetrics.grossRevenue,
                netProfit: currentMetrics.netProfit,
                driverEarnings: currentMetrics.driverEarnings,
                growth: calculateGrowth(currentMetrics.netProfit, prevMetrics?.netProfit || 0)
            },
            trips: {
                total: currentMetrics.trips,
                completed: currentMetrics.completed,
                cancelled: currentMetrics.cancelled,
                completionRate,
                growth: calculateGrowth(currentMetrics.trips, prevMetrics?.trips || 0),
                distribution: Object.keys(statusDistribution).map(key => ({
                    status: key,
                    count: statusDistribution[key],
                    percentage: totalFilteredTrips > 0 ? Math.round((statusDistribution[key] / totalFilteredTrips) * 100) : 0
                })),
                activePulse: {
                    requested: statusDistribution.requested, accepted: statusDistribution.accepted,
                    arrived: statusDistribution.arrived, started: statusDistribution.started,
                }
            },
            drivers: {
                total: totalDrivers, active: approvedDrivers, pending: pendingDrivers,
                online: onlineDrivers, ready: onlineReadyDrivers, new: currentMetrics.drivers,
                growth: calculateGrowth(currentMetrics.drivers, prevMetrics?.drivers || 0)
            },
            customers: {
                total: totalUsers - totalDrivers,
                new: currentMetrics.customers,
                growth: calculateGrowth(currentMetrics.customers, prevMetrics?.customers || 0)
            },
            health: {
                pendingSOS, pendingDisputes,
                systemRating: Math.round((avgRating._avg.rating || 5.0) * 10) / 10,
                matchRate: totalRequestedTrips > 0 ? Math.round((matchedTrips / totalRequestedTrips) * 100) : 100,
                completionRate
            }
        },
        topDrivers,
        chartData
    };
};
