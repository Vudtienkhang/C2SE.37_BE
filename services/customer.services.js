import { supabase } from '../lib/supabase.js';
import prisma from '../prisma/prisma.js';

export const getVehiclesByUserId = async (userId) => {
    const numericUserId = parseInt(userId, 10);

    // 1. Tìm hoặc Tự động tạo bản ghi Customer nếu chưa có (cho các tài khoản cũ)
    let customer = await prisma.customer.findUnique({
        where: { userId: numericUserId },
        include: { vehicles: true },
    });

    if (!customer) {
        // Kiểm tra xem user có tồn tại không
        const user = await prisma.user.findUnique({ where: { id: numericUserId } });
        if (!user) {
            throw new Error('Người dùng không tồn tại.');
        }

        // Tạo mới Customer
        customer = await prisma.customer.create({
            data: {
                userId: numericUserId,
                fullName: user.fullName,
            },
            include: { vehicles: true },
        });
    }

    // 2. Trả về danh sách xe
    return customer.vehicles;
};

export const createVehicle = async (userId, vehicleData) => {
    const numericUserId = parseInt(userId, 10);

    // 1. Tìm hoặc Tự động tạo bản ghi Customer nếu chưa có
    let customer = await prisma.customer.findUnique({
        where: { userId: numericUserId },
    });

    if (!customer) {
        const user = await prisma.user.findUnique({ where: { id: numericUserId } });
        if (!user) {
            throw new Error('Người dùng không tồn tại.');
        }

        customer = await prisma.customer.create({
            data: {
                userId: numericUserId,
                fullName: user.fullName,
            },
        });
    }

    // 2. Tạo xe mới
    const newVehicle = await prisma.customerVehicle.create({
        data: {
            customerId: customer.id,
            plateNumber: vehicleData.plateNumber,
            brand: vehicleData.brand,
            model: vehicleData.model,
            color: vehicleData.color,
            year: vehicleData.year ? parseInt(vehicleData.year, 10) : null,
            vehicleType: vehicleData.vehicleType,
            note: vehicleData.note,
            isDefault: vehicleData.isDefault || false,
        },
    });

    return newVehicle;
};

export const setDefaultVehicle = async (userId, vehicleId) => {
    const numericUserId = parseInt(userId, 10);
    const numericVehicleId = parseInt(vehicleId, 10);

    const customer = await prisma.customer.findUnique({
        where: { userId: numericUserId },
    });

    if (!customer) throw new Error('Người dùng không tồn tại.');

    // 1. Gỡ mặc định tất cả xe của user này
    await prisma.customerVehicle.updateMany({
        where: { customerId: customer.id },
        data: { isDefault: false },
    });

    // 2. Xét mặc định cho xe được chọn
    const updatedVehicle = await prisma.customerVehicle.update({
        where: { id: numericVehicleId },
        data: { isDefault: true },
    });

    return updatedVehicle;
};
