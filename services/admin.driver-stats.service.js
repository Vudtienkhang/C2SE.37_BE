import prisma from '../prisma/prisma.js';

/**
 * Lấy thống kê doanh thu và số chuyến của một tài xế theo Tuần, Tháng, Năm
 */
export const getDriverRevenueStats = async (driverId, period = 'week') => {
    const id = parseInt(driverId);
    
    // Xác định mốc thời gian bắt đầu
    const now = new Date();
    let startDate = new Date();
    let groupByFormat = 'day'; // day, month, year

    if (period === 'week') {
        startDate.setDate(now.getDate() - 7);
        groupByFormat = 'day';
    } else if (period === 'month') {
        startDate.setFullYear(now.getFullYear(), now.getMonth() - 11, 1); // 12 tháng gần nhất
        groupByFormat = 'month';
    } else if (period === 'year') {
        startDate.setFullYear(now.getFullYear() - 4, 0, 1); // 5 năm gần nhất
        groupByFormat = 'year';
    }

    // 1. Lấy tất cả các chuyến đi hoàn thành của tài xế này trong khoảng thời gian
    const trips = await prisma.trip.findMany({
        where: {
            driverId: id,
            status: 'completed',
            createdAt: { gte: startDate }
        },
        include: {
            feeBreakdowns: true,
            driver: { include: { DriverRank: true } }
        },
        orderBy: { createdAt: 'asc' }
    });

    // 2. Gom nhóm dữ liệu
    const statsMap = new Map();

    // Khởi tạo các mốc thời gian để đảm bảo không bị trống (gap filling)
    if (period === 'week') {
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(now.getDate() - i);
            const label = d.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit' });
            statsMap.set(label, { label, revenue: 0, trips: 0 });
        }
    } else if (period === 'month') {
        for (let i = 11; i >= 0; i--) {
            const d = new Date();
            d.setMonth(now.getMonth() - i);
            const label = d.toLocaleDateString('vi-VN', { month: 'short', year: 'numeric' });
            statsMap.set(label, { label, revenue: 0, trips: 0 });
        }
    } else if (period === 'year') {
        for (let i = 4; i >= 0; i--) {
            const label = (now.getFullYear() - i).toString();
            statsMap.set(label, { label, revenue: 0, trips: 0 });
        }
    }

    // 3. Tính toán 
    trips.forEach(trip => {
        let label = '';
        const date = new Date(trip.createdAt);

        if (period === 'week') {
            label = date.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit' });
        } else if (period === 'month') {
            label = date.toLocaleDateString('vi-VN', { month: 'short', year: 'numeric' });
        } else if (period === 'year') {
            label = date.getFullYear().toString();
        }

        if (statsMap.has(label)) {
            const current = statsMap.get(label);
            
            // Tính doanh thu thực nhận của tài xế
            // Driver Earnings = (BaseFare - Commission) + Surcharges
            const baseFareRecord = trip.feeBreakdowns.find(f => f.feeType === 'base_fare');
            const baseFare = baseFareRecord ? baseFareRecord.amount : (trip.priceEstimate || 0);
            
            const surcharges = trip.feeBreakdowns
                .filter(f => f.feeType.startsWith('surcharge_'))
                .reduce((sum, f) => sum + f.amount, 0);

            const rate = trip.driver?.DriverRank?.platformRate ?? 20;
            const commissionAmount = baseFare * (rate / 100);
            const driverEarnings = (baseFare - commissionAmount) + surcharges;

            current.revenue += driverEarnings;
            current.trips += 1;
            statsMap.set(label, current);
        }
    });

    return Array.from(statsMap.values());
};
