import { getVehiclesByUserId, createVehicle } from '../services/customer.services.js';

export const getMyVehicles = async (req, res) => {
    try {
        const { userId } = req.params;
        const vehicles = await getVehiclesByUserId(userId);

        return res.status(200).json({
            success: true,
            data: vehicles,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || 'Lỗi hệ thống khi lấy danh sách xe.',
        });
    }
};

export const addVehicle = async (req, res) => {
    try {
        const { userId } = req.params;
        const vehicleData = req.body;

        if (!vehicleData.plateNumber) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp biển số xe.',
            });
        }

        const vehicle = await createVehicle(userId, vehicleData);

        return res.status(201).json({
            success: true,
            message: 'Thêm xe thành công.',
            data: vehicle,
        });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(409).json({
                success: false,
                message: 'Biển số xe đã tồn tại trên hệ thống.',
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Lỗi hệ thống khi thêm xe.',
        });
    }
};