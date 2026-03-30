import * as disputeService from '../services/dispute.service.js';
import { uploadDisputeEvidenceToSupabase } from '../services/upload.service.js';

/**
 * Xử lý tạo khiếu nại mới (kèm upload bằng chứng)
 */
export const createDispute = async (req, res) => {
  try {
    const { tripId, createdById, reason, description } = req.body;
    const files = req.files || []; // Nhận mảng file từ multer

    if (!tripId || !createdById || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin bắt buộc (tripId, createdById, reason).',
      });
    }

    // 1. Upload các file bằng chứng lên Supabase nếu có
    const evidenceUrls = [];
    if (files.length > 0) {
      for (const file of files) {
        const url = await uploadDisputeEvidenceToSupabase(
          createdById,
          tripId,
          file.buffer,
          file.mimetype
        );
        evidenceUrls.push(url);
      }
    }

    // 2. Gọi service tạo khiếu nại
    const dispute = await disputeService.createDispute({
      tripId,
      createdById,
      reason,
      description,
      evidenceUrls,
    });

    return res.status(201).json({
      success: true,
      data: dispute,
      message: 'Khiếu nại của bạn đã được ghi nhận và đang được xử lý.',
    });
  } catch (error) {
    console.error('Lỗi khi tạo khiếu nại:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi hệ thống khi tạo khiếu nại.',
    });
  }
};

/**
 * Lấy chi tiết khiếu nại
 */
export const getDisputeDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const dispute = await disputeService.getDisputeById(id);

    if (!dispute) {
      return res.status(404).json({
        success: false,
        message: 'Không tìm thấy khiếu nại.',
      });
    }

    return res.status(200).json({
      success: true,
      data: dispute,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi khi lấy thông tin khiếu nại.',
    });
  }
};

/**
 * Lấy lịch sử khiếu nại của một chuyến đi
 */
export const getTripDisputes = async (req, res) => {
  try {
    const { tripId } = req.params;
    const disputes = await disputeService.getDisputesByTrip(tripId);

    return res.status(200).json({
      success: true,
      data: disputes,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi khi lấy danh sách khiếu nại.',
    });
  }
};

/**
 * Cập nhật trạng thái khiếu nại (Admin)
 */
export const updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminId, note } = req.body;

    if (!status || !adminId) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp trạng thái mới và ID người thực hiện.',
      });
    }

    const updatedDispute = await disputeService.updateDisputeStatus(id, status, adminId, note);

    return res.status(200).json({
      success: true,
      data: updatedDispute,
      message: `Đã cập nhật trạng thái khiếu nại thành ${status}.`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi khi cập nhật trạng thái khiếu nại.',
    });
  }
};

/**
 * Giải quyết khiếu nại kèm hoàn tiền
 */
export const resolveRefund = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId, refundAmount, note } = req.body;

    if (!adminId || !refundAmount) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin adminId hoặc số tiền hoàn.' });
    }

    const result = await disputeService.resolveWithRefund(id, adminId, refundAmount, note);
    return res.status(200).json({ success: true, data: result, message: 'Đã hoàn tiền và đóng khiếu nại thành công.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Giải quyết khiếu nại kèm phạt tài xế
 */
export const resolvePenalty = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminId, penaltyPoints, reason } = req.body;

    if (!adminId || !penaltyPoints) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin adminId hoặc điểm phạt.' });
    }

    const result = await disputeService.resolveWithPenalty(id, adminId, penaltyPoints, reason);
    return res.status(200).json({ success: true, data: result, message: 'Đã thực hiện phạt tài xế và đóng khiếu nại thành công.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Lấy toàn bộ khiếu nại (Admin)
 */
export const listAllDisputes = async (req, res) => {
  try {
    const { status, reason, skip, take } = req.query;
    console.log(`[DisputeController] Listing all disputes with filters:`, { status, reason, skip, take });
    const result = await disputeService.getAllDisputes({ status, reason, skip, take });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi khi lấy danh sách khiếu nại toàn cục.',
    });
  }
};
