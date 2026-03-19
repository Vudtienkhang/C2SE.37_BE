import prisma from '../prisma/prisma.js';

export const getVehiclesByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const customer = await prisma.customer.findUnique({
      where: { userId: parseInt(userId) },
      include: { vehicles: true }
    });

    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy thông tin khách hàng' });
    }

    res.json(customer.vehicles);
  } catch (error) {
    console.error('Error fetching customer vehicles:', error);
    res.status(500).json({ message: 'Lỗi server khi lấy danh sách xe' });
  }
};
