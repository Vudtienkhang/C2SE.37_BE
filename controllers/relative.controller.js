import prisma from '../prisma/prisma.js';

export const getRelatives = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const relatives = await prisma.relative.findMany({
      where: { userId: parseInt(userId, 10) },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ success: true, data: relatives });
  } catch (error) {
    console.error("Error getting relatives:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const addRelative = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, phone } = req.body;

    const newRelative = await prisma.relative.create({
      data: {
        userId: parseInt(userId, 10),
        name,
        phone
      }
    });

    res.status(201).json({ success: true, data: newRelative, message: "Người thân đã được thêm thành công" });
  } catch (error) {
    console.error("Error adding relative:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const updateRelative = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone } = req.body;

    const updatedRelative = await prisma.relative.update({
      where: { id: parseInt(id, 10) },
      data: {
        name,
        phone
      }
    });

    res.status(200).json({ success: true, data: updatedRelative, message: "Cập nhật thông tin thành công" });
  } catch (error) {
    console.error("Error updating relative:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const deleteRelative = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.relative.delete({
      where: { id: parseInt(id, 10) }
    });

    res.status(200).json({ success: true, message: "Đã xóa người thân khỏi danh sách" });
  } catch (error) {
    console.error("Error deleting relative:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};
