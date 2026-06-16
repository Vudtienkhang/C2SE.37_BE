import * as withdrawalService from '../services/withdrawal.service.js';

export const createWithdrawalRequest = async (req, res) => {
  try {
    const { userId, amount, bankName, bankCode, accountNumber, accountName, password } = req.body;

    if (!userId || !amount || !bankName || !accountNumber || !accountName || !password) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ thông tin: userId, amount, bankName, accountNumber, accountName, password.',
      });
    }

    const request = await withdrawalService.createWithdrawalRequest(userId, {
      amount,
      bankName,
      bankCode,
      accountNumber,
      accountName,
      password,
    });

    return res.status(201).json({
      success: true,
      message: 'Yêu cầu rút tiền của bạn đã được gửi và đang chờ duyệt.',
      data: request,
    });
  } catch (error) {
    console.error('Lỗi createWithdrawalRequest controller:', error.message);
    return res.status(400).json({
      success: false,
      message: error.message || 'Lỗi máy chủ nội bộ',
    });
  }
};

export const getUserWithdrawals = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp id người dùng.',
      });
    }

    const withdrawals = await withdrawalService.getUserWithdrawals(userId);

    return res.status(200).json({
      success: true,
      message: 'Lấy lịch sử rút tiền thành công',
      data: withdrawals,
    });
  } catch (error) {
    console.error('Lỗi getUserWithdrawals controller:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ nội bộ',
    });
  }
};

export const updateWithdrawalStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote, transactionId } = req.body;

    if (!id || !status) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp id yêu cầu và trạng thái mới.',
      });
    }

    const updatedRequest = await withdrawalService.updateWithdrawalStatus(id, status, adminNote, transactionId);

    return res.status(200).json({
      success: true,
      message: `Đã cập nhật trạng thái yêu cầu sang ${status} thành công.`,
      data: updatedRequest,
    });
  } catch (error) {
    console.error('Lỗi updateWithdrawalStatus controller:', error.message);
    return res.status(400).json({
      success: false,
      message: error.message || 'Lỗi máy chủ nội bộ',
    });
  }
};

export const getAllWithdrawals = async (req, res) => {
  try {
    const { status } = req.query;
    const withdrawals = await withdrawalService.getAllWithdrawals(status);
    
    return res.status(200).json({
      success: true,
      data: withdrawals,
    });
  } catch (error) {
    console.error('Lỗi getAllWithdrawals controller:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ nội bộ',
    });
  }
};

export const getPendingCount = async (req, res) => {
  try {
    const count = await withdrawalService.getPendingCount();
    
    return res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error('Lỗi getPendingCount controller:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ nội bộ',
    });
  }
};
