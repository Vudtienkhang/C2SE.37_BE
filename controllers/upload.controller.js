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
