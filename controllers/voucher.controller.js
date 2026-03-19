import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ─── GET ALL ──────────────────────────────────────────────────────────────────
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
