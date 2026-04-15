import adminTestService from '../services/admin.test.service.js';
import XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const adminTestController = {
  getQuestions: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const search = req.query.search || '';
      
      const data = await adminTestService.getQuestions(page, limit, search);
      res.status(200).json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  createQuestion: async (req, res) => {
    try {
      const { questionText, options, correctAnswerIndex, difficulty, isActive } = req.body;
      if (!questionText || !options || options.length < 2 || typeof correctAnswerIndex !== 'number') {
        return res.status(400).json({ error: 'Dữ liệu câu hỏi không hợp lệ' });
      }

      const question = await adminTestService.createQuestion(req.body);
      res.status(201).json({ message: 'Tạo câu hỏi thành công', data: question });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  updateQuestion: async (req, res) => {
    try {
      const question = await adminTestService.updateQuestion(req.params.id, req.body);
      res.status(200).json({ message: 'Cập nhật câu hỏi thành công', data: question });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  deleteQuestion: async (req, res) => {
    try {
      await adminTestService.deleteQuestion(req.params.id);
      res.status(200).json({ message: 'Vô hiệu hóa câu hỏi thành công' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getTestHistories: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const status = req.query.status || '';
      
      const data = await adminTestService.getTestHistory(page, limit, status);
      res.status(200).json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getTestHistorySummary: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const search = req.query.search || '';
      
      const data = await adminTestService.getTestHistorySummary(page, limit, search);
      res.status(200).json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getDriverAttempts: async (req, res) => {
    try {
      const { driverId } = req.params;
      const data = await adminTestService.getDriverAttempts(driverId);
      res.status(200).json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getTestHistoryDetail: async (req, res) => {
    try {
      const data = await adminTestService.getTestHistoryDetail(req.params.id);
      if (!data) return res.status(404).json({ error: 'Không tìm thấy lịch sử thi' });
      res.status(200).json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  importQuestions: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Vui lòng cung cấp file Excel' });
      }

      const result = await adminTestService.importQuestionsFromBuffer(req.file.buffer);
      res.status(200).json({ 
        message: `Đã import thành công ${result.count} câu hỏi`, 
        data: result 
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  downloadTemplate: async (req, res) => {
    try {
      const data = [
        {
          'Question Text': 'Ví dụ: Đâu là quy tắc an toàn khi đón khách?',
          'Option 1': 'Đeo khẩu trang',
          'Option 2': 'Chạy quá tốc độ',
          'Option 3': 'Không thắt dây an toàn',
          'Option 4': 'Nghe điện thoại khi lái',
          'Correct Answer': 1,
          'Difficulty': 'EASY',
          'ModuleId': ''
        }
      ];

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Template Questions');

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename=knowledge_questions_template.xlsx',
        'Content-Length': buf.length
      });

      res.send(buf);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getQuizzesByModule: async (req, res) => {
    try {
      const data = await adminTestService.getQuizzesByModule(req.params.moduleId);
      res.status(200).json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  createQuiz: async (req, res) => {
    try {
      const data = await adminTestService.createQuiz(req.body);
      res.status(201).json({ message: 'Tạo bài thi thành công', data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  updateQuiz: async (req, res) => {
    try {
      const data = await adminTestService.updateQuiz(req.params.id, req.body);
      res.status(200).json({ message: 'Cập nhật bài thi thành công', data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  deleteQuiz: async (req, res) => {
    try {
      await adminTestService.deleteQuiz(req.params.id);
      res.status(200).json({ message: 'Xóa bài thi thành công' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  assignQuestionsToQuiz: async (req, res) => {
    try {
      const { questionIds } = req.body;
      if (!Array.isArray(questionIds)) return res.status(400).json({ error: 'questionIds must be an array' });
      const data = await adminTestService.assignQuestionsToQuiz(req.params.id, questionIds);
      res.status(200).json({ message: 'Gán câu hỏi thành công', data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  assignRandomQuestionsToQuiz: async (req, res) => {
    try {
      const data = await adminTestService.assignRandomQuestionsToQuiz(req.params.id, req.body);
      res.status(200).json({ message: `Đã nạp thêm ${data.count} câu hỏi ngẫu nhiên`, data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getQuestionsByQuiz: async (req, res) => {
    try {
      const data = await adminTestService.getQuestionsByQuiz(req.params.id);
      res.status(200).json({ data });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

export default adminTestController;
