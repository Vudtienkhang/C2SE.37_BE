import prisma from '../prisma/prisma.js';

/**
 * Lấy mốc thời gian dựa trên period (today, week, month, year, all, custom, year_YYYY)
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
        const diffInMs = currentEnd.getTime() - currentStart.getTime();
        prevStart = new Date(currentStart.getTime() - diffInMs - 1000);
        prevStart.setHours(0, 0, 0, 0);
        prevEnd = new Date(currentStart.getTime() - 1000);
    } else if (period && period.startsWith('year_')) {
        const year = parseInt(period.split('_')[1]);
        currentStart = new Date(year, 0, 1);
        currentStart.setHours(0, 0, 0, 0);
        currentEnd = new Date(year, 11, 31, 23, 59, 59, 999);
        if (year === now.getFullYear()) currentEnd = new Date(now);
        prevStart = new Date(year - 1, 0, 1);
        prevEnd = new Date(year - 1, 11, 31, 23, 59, 59, 999);
    } else {
        currentStart = new Date(2023, 0, 1);
        prevStart = null;
    }

    return { currentStart, currentEnd, prevStart, prevEnd };
};

/**
 * Lấy thống kê doanh thu tổng hợp - NÂNG CẤP LỌC NÂNG CAO
 */
export const getRevenueStats = async (period = 'all', startDate, endDate) => {
    const { currentStart, currentEnd, prevStart, prevEnd } = getPeriodRanges(period, startDate, endDate);

    const diffDays = Math.ceil((currentEnd - currentStart) / (1000 * 60 * 60 * 24));
    let chartMode = 'month';
    if (diffDays <= 1) chartMode = 'hour';
    else if (diffDays <= 65) chartMode = 'day';

    // Chuẩn bị Raw SQL cho Biểu đồ
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

    const fetchMetrics = async (start, end) => {
        if (!start || !end) return null;
        return prisma.$queryRaw`
            SELECT 
                SUM(CASE WHEN T.status = 'completed' THEN COALESCE(T."finalPrice", 0) ELSE 0 END)::float as gross,
                SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0)) ELSE 0 END)::float as net,
                SUM(CASE WHEN T.status = 'completed' THEN (COALESCE(C."commissionAmount", 0) + COALESCE(FB.system_fee, 0) - COALESCE(VU.discount, 0)) ELSE 0 END)::float as profit,
                SUM(CASE WHEN T.status = 'completed' THEN COALESCE(C."commissionAmount", 0) ELSE 0 END)::float as comm,
                SUM(CASE WHEN T.status = 'completed' THEN COALESCE(VU.discount, 0) ELSE 0 END)::float as voucher
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
    };

    const [basicStatsRaw, comparisonsRaw, pendingWithdrawals, rawChartData] = await Promise.all([
        fetchMetrics(currentStart, currentEnd),
        fetchMetrics(prevStart, prevEnd),
        prisma.withdrawalRequest.aggregate({ where: { status: 'pending' }, _sum: { amount: true } }),
        chartPromise
    ]);

    const curr = (basicStatsRaw && basicStatsRaw[0]) || { gross: 0, net: 0, profit: 0, comm: 0, voucher: 0 };
    const prev = (comparisonsRaw && comparisonsRaw[0]) || { gross: 0, net: 0, profit: 0, comm: 0, voucher: 0 };

    const currNet = curr.profit; // Thực tế là Profit (đã trừ voucher)
    const prevNet = prev.profit;

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

    return {
        stats: {
            netRevenue: { [period]: curr.profit },
            grossVolume: { [period]: curr.gross },
            driverEarnings: { [period]: Math.max(0, curr.gross - curr.profit) },
            commissions: { [period]: curr.comm },
            voucherCost: { [period]: curr.voucher },
            pendingSettlement: pendingWithdrawals._sum?.amount || 0,
            comparisons: {
                netRevenue: { yesterday: prev.profit, lastMonth: prev.profit, lastYear: prev.profit },
                grossVolume: { yesterday: prev.gross, lastMonth: prev.gross, lastYear: prev.gross },
                driverEarnings: { yesterday: Math.max(0, prev.gross - prev.profit), lastMonth: Math.max(0, prev.gross - prev.profit), lastYear: Math.max(0, prev.gross - prev.profit) },
                commissions: { yesterday: prev.comm, lastMonth: prev.comm, lastYear: prev.comm },
                voucherCost: { yesterday: prev.voucher, lastMonth: prev.voucher, lastYear: prev.voucher }
            }
        },
        chartData
    };
};

export const getRecentTransactions = async (limit = 10) => {
    const payments = await prisma.payment.findMany({
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { trip: { include: { customer: { select: { fullName: true } } } } }
    });
    return payments.map(p => ({
        id: `PAY-${p.id}`,
        tripId: `TR-${p.tripId}`,
        rawTripId: p.tripId,
        customer: p.trip?.customer?.fullName || 'Khách vãng lai',
        amount: p.amount,
        method: p.method === 'CASH' ? 'Tiền mặt' : (p.method === 'WALLET' ? 'Ví điện tử' : p.method),
        rawMethod: p.method,
        time: p.createdAt,
        status: p.status === 'success' ? 'Thành công' : (p.status === 'pending' ? 'Đang xử lý' : 'Thất bại'),
        statusColor: p.status === 'success' ? 'bg-emerald-100 text-emerald-700' : (p.status === 'pending' ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700')
    }));
};
