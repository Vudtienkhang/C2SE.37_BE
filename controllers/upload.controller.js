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
