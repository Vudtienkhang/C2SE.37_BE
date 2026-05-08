import prisma from '../prisma/prisma.js';

// ─── GET ALL ──────────────────────────────────────────────────────────────────
/**
 * Lấy danh sách tất cả voucher (có lọc theo trạng thái và tìm kiếm)
 */
export const getAllVouchers = async (req, res) => {
  try {
    const { status, search } = req.query;

    const where = {};

    if (search) {
      where.code = { contains: search.toUpperCase(), mode: 'insensitive' };
    }

    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    const vouchers = await prisma.voucher.findMany({
      where,
      orderBy: { id: 'desc' },
      include: { _count: { select: { usages: true } } },
    });

    // Sync usedCount with real usage records
    const formatted = vouchers.map((v) => ({
      ...v,
      usedCount: v._count.usages,
      _count: undefined,
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error('getAllVouchers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET BY ID ────────────────────────────────────────────────────────────────
/**
 * Lấy chi tiết một voucher theo ID
 */
export const getVoucherById = async (req, res) => {
  try {
    const { id } = req.params;
    const voucher = await prisma.voucher.findUnique({
      where: { id: parseInt(id) },
    });
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Voucher không tìm thấy' });
    }
    res.status(200).json({ success: true, data: voucher });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── CREATE ───────────────────────────────────────────────────────────────────
/**
 * Tạo mới một voucher
 */
export const createVoucher = async (req, res) => {
  try {
    const {
      code,
      discountType,
      discountValue,
      maxDiscount,
      minOrderValue,
      usageLimit,
      target,
      startDate,
      endDate,
      isActive,
      isOneTimePerUser,
    } = req.body;

    if (!code || !discountType || discountValue === undefined || !startDate) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin bắt buộc: code, discountType, discountValue, startDate',
      });
    }

    const voucher = await prisma.voucher.create({
      data: {
        code: code.trim().toUpperCase(),
        discountType,
        discountValue: parseFloat(discountValue),
        maxDiscount: maxDiscount ? parseFloat(maxDiscount) : null,
        minOrderValue: minOrderValue ? parseFloat(minOrderValue) : null,
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        target: target || 'all',
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
        isOneTimePerUser: isOneTimePerUser !== undefined ? Boolean(isOneTimePerUser) : true,
      },
    });

    res.status(201).json({ success: true, data: voucher });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Mã voucher đã tồn tại. Vui lòng chọn mã khác.',
      });
    }
    console.error('createVoucher error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── UPDATE ───────────────────────────────────────────────────────────────────
/**
 * Cập nhật thông tin voucher
 */
export const updateVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      code,
      discountType,
      discountValue,
      maxDiscount,
      minOrderValue,
      usageLimit,
      target,
      startDate,
      endDate,
      isActive,
      isOneTimePerUser,
    } = req.body;

    const existing = await prisma.voucher.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Voucher không tìm thấy' });
    }

    const voucher = await prisma.voucher.update({
      where: { id: parseInt(id) },
      data: {
        code: code ? code.trim().toUpperCase() : undefined,
        discountType: discountType || undefined,
        discountValue: discountValue !== undefined ? parseFloat(discountValue) : undefined,
        maxDiscount: maxDiscount !== undefined ? (maxDiscount ? parseFloat(maxDiscount) : null) : undefined,
        minOrderValue:
          minOrderValue !== undefined ? (minOrderValue ? parseFloat(minOrderValue) : null) : undefined,
        usageLimit: usageLimit !== undefined ? (usageLimit ? parseInt(usageLimit) : null) : undefined,
        target: target || undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate !== undefined ? (endDate ? new Date(endDate) : null) : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        isOneTimePerUser: isOneTimePerUser !== undefined ? Boolean(isOneTimePerUser) : undefined,
      },
    });

    res.status(200).json({ success: true, data: voucher });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: 'Mã voucher đã tồn tại. Vui lòng chọn mã khác.',
      });
    }
    console.error('updateVoucher error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── TOGGLE STATUS ────────────────────────────────────────────────────────────
/**
 * Thay đổi trạng thái hoạt động (Bật/Tắt) của voucher
 */
export const toggleVoucherStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.voucher.findUnique({ where: { id: parseInt(id) } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Voucher không tìm thấy' });
    }

    const voucher = await prisma.voucher.update({
      where: { id: parseInt(id) },
      data: { isActive: !existing.isActive },
    });

    res.status(200).json({ success: true, data: voucher });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────
/**
 * Xóa voucher khỏi hệ thống (nếu chưa có lịch sử sử dụng)
 */
export const deleteVoucher = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if voucher has been used
    const usageCount = await prisma.voucherUsage.count({
      where: { voucherId: parseInt(id) },
    });

    if (usageCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Không thể xóa voucher đã được sử dụng ${usageCount} lần.`,
      });
    }

    await prisma.voucher.delete({ where: { id: parseInt(id) } });
    res.status(200).json({ success: true, message: 'Xóa voucher thành công' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── GET PUBLIC VOUCHERS ──────────────────────────────────────────────────────
/**
 * Lấy danh sách các voucher đang khả dụng cho người dùng
 */
export const getPublicVouchers = async (req, res) => {
  try {
    const now = new Date();
    const condition = {
      isActive: true,
      startDate: { lte: now },
      OR: [
        { endDate: null },
        { endDate: { gte: now } }
      ]
    };

    if (req.user) {
      const usedVouchers = await prisma.voucherUsage.findMany({
        where: { userId: req.user.id },
        select: { voucherId: true }
      });
      const usedIds = usedVouchers.map(u => u.voucherId);

      if (usedIds.length > 0) {
        condition.AND = [
          {
            OR: [
              { isOneTimePerUser: false },
              { id: { notIn: usedIds } }
            ]
          }
        ];
      }
    }

    const vouchers = await prisma.voucher.findMany({
      where: condition,
      orderBy: { discountValue: 'desc' },
      take: 20 // top 20 vouchers
    });
    
    // Filter out those that reached their global usageLimit
    const availableVouchers = vouchers.filter(v => {
      if (v.usageLimit && v.usedCount >= v.usageLimit) return false;
      return true;
    });

    res.status(200).json({ success: true, data: availableVouchers });
  } catch (error) {
    console.error('getPublicVouchers error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─── VALIDATE ─────────────────────────────────────────────────────────────────
/**
 * Kiểm tra tính hợp lệ và tính toán số tiền giảm giá của voucher
 */
export const validateVoucher = async (req, res) => {
  try {
    const { code, orderValue } = req.body;
    
    if (!code) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập mã voucher' });
    }

    const voucher = await prisma.voucher.findUnique({
      where: { code: code.trim().toUpperCase() }
    });

    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Mã giảm giá không tồn tại' });
    }

    if (!voucher.isActive) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá đã ngừng hoạt động' });
    }

    const now = new Date();
    if (voucher.startDate && now < voucher.startDate) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá chưa đến thời gian áp dụng' });
    }
    
    if (voucher.endDate && now > voucher.endDate) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá đã hết hạn' });
    }

    if (voucher.usageLimit && voucher.usedCount >= voucher.usageLimit) {
      return res.status(400).json({ success: false, message: 'Mã giảm giá đã hết lượt sử dụng' });
    }

    if (voucher.minOrderValue && orderValue < voucher.minOrderValue) {
      return res.status(400).json({ 
        success: false, 
        message: `Đơn hàng tối thiểu để áp dụng là ${voucher.minOrderValue.toLocaleString('vi-VN')}đ` 
      });
    }

    // Kiểm tra giới hạn 1 lần sử dụng cho mỗi tài khoản
    if (voucher.isOneTimePerUser) {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: 'Vui lòng đăng nhập để sử dụng mã này' });
      }

      const existingUsage = await prisma.voucherUsage.findFirst({
        where: {
          voucherId: voucher.id,
          userId: userId,
          // Có thể thêm điều kiện Trip status nếu cần, 
          // nhưng hiện tại chỉ cần check xem đã có bản ghi nào chưa
        }
      });

      if (existingUsage) {
        return res.status(400).json({ success: false, message: 'Bạn đã sử dụng mã giảm giá này cho một đơn hàng khác.' });
      }
    }

    // Tính toán số tiền được giảm
    let discountAmount = 0;
    if (voucher.discountType === 'percent') {
      discountAmount = (orderValue * voucher.discountValue) / 100;
      if (voucher.maxDiscount && discountAmount > voucher.maxDiscount) {
        discountAmount = voucher.maxDiscount;
      }
    } else {
      discountAmount = voucher.discountValue;
    }

    // Không giảm quá tổng giá trị đơn hàng
    if (discountAmount > orderValue) {
      discountAmount = orderValue;
    }

    res.status(200).json({
      success: true,
      data: {
        id: voucher.id,
        code: voucher.code,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        discountAmount: discountAmount
      }
    });

  } catch (error) {
    console.error('validateVoucher error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
// ─── GET VOUCHER USAGE HISTORY ───────────────────────────────────────────────
/**
 * Lấy lịch sử sử dụng của một voucher cụ thể
 */
export const getVoucherUsage = async (req, res) => {
  try {
    const { id } = req.params;

    const usages = await prisma.voucherUsage.findMany({
      where: { voucherId: parseInt(id) },
      include: {
        user: {
          select: {
            fullName: true,
            phone: true,
            email: true
          }
        },
        trip: {
          select: {
            id: true,
            status: true,
            createdAt: true
          }
        }
      },
      orderBy: { usedAt: 'desc' }
    });

    const totalDiscountAmount = usages.reduce((sum, u) => sum + u.discountAmount, 0);

    res.status(200).json({
      success: true,
      data: {
        usages,
        totalDiscountAmount
      }
    });
  } catch (error) {
    console.error('getVoucherUsage error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
