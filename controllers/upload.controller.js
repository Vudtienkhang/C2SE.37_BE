import * as uploadService from "../services/upload.service.js";

export const uploadAvatar = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;
    console.log("file", file);

    if (!id) {
      return res.status(400).json({ success: false, message: 'Thiếu ID người dùng.' });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy file ảnh.' });
    }

    // Call service to handle upload
    const avatarUrl = await uploadService.uploadUserAvatarToSupabase(id, file.buffer, file.mimetype);

    return res.status(200).json({
      success: true,
      message: 'Cập nhật ảnh đại diện thành công',
      data: { avatarUrl },
    });
  } catch (error) {
    console.error('Lỗi uploadAvatar controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ nội bộ',
    });
  }
};

export const uploadDriverDocument = async (req, res) => {
  try {
    const { userId, documentTypeId } = req.params;
    const file = req.file;

    if (!userId || !documentTypeId) {
      return res.status(400).json({ success: false, message: 'Thiếu userId hoặc documentTypeId.' });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy file tài liệu.' });
    }

    const doc = await uploadService.uploadDriverDocumentToSupabase(userId, documentTypeId, file.buffer, file.mimetype);

    return res.status(200).json({
      success: true,
      message: 'Tải lên tài liệu thành công',
      data: doc,
    });
  } catch (error) {
    console.error('Lỗi uploadDriverDocument controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi máy chủ nội bộ',
    });
  }
};

export const uploadChatImage = async (req, res) => {
  try {
    const { tripId } = req.params;
    const { senderId } = req.body;
    const file = req.file;

    if (!tripId) {
      return res.status(400).json({ success: false, message: 'Thiếu tripId.' });
    }

    if (!senderId) {
      return res.status(400).json({ success: false, message: 'Thiếu senderId.' });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy file ảnh.' });
    }

    const fileUrl = await uploadService.uploadChatImageToSupabase(tripId, senderId, file.buffer, file.mimetype);

    return res.status(200).json({
      success: true,
      message: 'Tải lên ảnh chat thành công',
      data: { fileUrl },
    });
  } catch (error) {
    console.error('Lỗi uploadChatImage controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi máy chủ nội bộ',
    });
  }
};

export const uploadWithdrawalProof = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Thiếu ID yêu cầu rút tiền.' });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: 'Không tìm thấy file ảnh minh chứng.' });
    }

    const proofUrl = await uploadService.uploadWithdrawalProofToSupabase(id, file.buffer, file.mimetype);

    return res.status(200).json({
      success: true,
      message: 'Tải lên ảnh minh chứng thành công',
      data: { proofUrl },
    });
  } catch (error) {
    console.error('Lỗi uploadWithdrawalProof controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi máy chủ nội bộ',
    });
  }
};
