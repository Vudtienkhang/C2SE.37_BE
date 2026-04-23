import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
const prisma = new PrismaClient();

const adminTestService = {
  getQuestions: async (page = 1, limit = 20, search = '', filters = {}) => {
    const skip = (page - 1) * limit;
    const where = {};
    if (search) {
      where.questionText = { contains: search, mode: 'insensitive' };
    }
    if (filters.moduleId) {
      where.OR = [
        { moduleAssignments: { some: { moduleId: parseInt(filters.moduleId) } } },
        { moduleId: parseInt(filters.moduleId) },
        { moduleId: null } // Cho phép lấy cả câu hỏi tự do để gán vào module/quiz
      ];
    }

    const [total, questions] = await Promise.all([
      prisma.knowledgeQuestion.count({ where }),
      prisma.knowledgeQuestion.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      })
    ]);

    return { total, questions, page, limit };
  },

  createQuestion: async (data) => {
    const mId = data.moduleId ? parseInt(data.moduleId) : null;
    return await prisma.knowledgeQuestion.create({
      data: {
        questionText: data.questionText,
        options: data.options,
        correctAnswerIndex: data.correctAnswerIndex,
        difficulty: data.difficulty || 'MEDIUM',
        moduleId: mId,
        isActive: data.isActive !== undefined ? data.isActive : true,
        moduleAssignments: mId ? {
          create: { moduleId: mId }
        } : undefined
      }
    });
  },

  updateQuestion: async (id, data) => {
    const qId = parseInt(id);
    const mId = data.moduleId ? parseInt(data.moduleId) : null;
    
    // Nếu đổi moduleId, cập nhật cả bảng liên kết
    if (mId) {
        await prisma.moduleQuestionAssignment.deleteMany({ where: { questionId: qId } });
        await prisma.moduleQuestionAssignment.create({
            data: { questionId: qId, moduleId: mId }
        });
    }

    return await prisma.knowledgeQuestion.update({
      where: { id: qId },
      data: {
        questionText: data.questionText,
        options: data.options,
        correctAnswerIndex: data.correctAnswerIndex,
        difficulty: data.difficulty,
        moduleId: mId,
        isActive: data.isActive
      }
    });
  },

  deleteQuestion: async (id) => {
    return await prisma.knowledgeQuestion.update({
      where: { id: parseInt(id) },
      data: { isActive: false }
    });
  },

  getModuleById: async (moduleId) => {
    return await prisma.knowledgeModule.findUnique({
      where: { id: parseInt(moduleId) },
      select: {
          id: true,
          name: true,
          description: true,
          contents: {
              select: { title: true, type: true }
          }
      }
    });
  },

  getExampleQuestions: async (moduleId, limit = 5) => {
    // 1. Lấy câu hỏi cùng module trước
    let questions = await prisma.knowledgeQuestion.findMany({
      where: { moduleId: parseInt(moduleId), isActive: true },
      take: limit,
      select: {
          questionText: true,
          options: true,
          correctAnswerIndex: true,
          difficulty: true
      }
    });

    // 2. Nếu không đủ, lấy thêm ngẫu nhiên từ kho chung
    if (questions.length < limit) {
        const extra = await prisma.knowledgeQuestion.findMany({
            where: { isActive: true },
            take: limit - questions.length,
            select: {
                questionText: true,
                options: true,
                correctAnswerIndex: true,
                difficulty: true
            }
        });
        questions = [...questions, ...extra];
    }

    return questions;
  },

  bulkCreateQuestions: async (questionsData) => {
    // Validate each question quickly here or in controller
    if (!Array.isArray(questionsData) || questionsData.length === 0) return { count: 0 };
    const createData = questionsData.map(q => ({
      questionText: q.questionText,
      options: q.options,
      correctAnswerIndex: parseInt(q.correctAnswerIndex),
      difficulty: q.difficulty || "MEDIUM",
      moduleId: q.moduleId ? parseInt(q.moduleId) : null, // Original owner
      isActive: true,
      moduleAssignments: q.moduleId ? {
        create: { moduleId: parseInt(q.moduleId) }
      } : undefined
    }));

    // createMany doesn't support nested creates, so we need a transaction or individual creates
    // For AI generation (usually 5-10 questions), individual creates are fine.
    const results = await prisma.$transaction(
        createData.map(data => prisma.knowledgeQuestion.create({ data }))
    );

    return { count: results.length };
  },

  assignQuestionsToModule: async (moduleId, questionIds) => {
    const mId = parseInt(moduleId);
    const assignments = questionIds.map(id => ({
      moduleId: mId,
      questionId: parseInt(id)
    }));

    return await prisma.moduleQuestionAssignment.createMany({
      data: assignments,
      skipDuplicates: true
    });
  },

  getTestHistory: async (page = 1, limit = 20, status = '') => {
    const skip = (page - 1) * limit;
    const where = {};
    if (status) {
      where.status = status;
    }

    // AUTO-TIMEOUT CLEANUP: Mark old 'in_progress' sessions as 'timeout'
    try {
      const now = new Date();
      const updated = await prisma.driverTestHistory.updateMany({
        where: {
          status: 'in_progress',
          expiresAt: { lt: now }
        },
        data: { status: 'timeout', completedAt: now }
      });

      if (updated.count > 0) {
        const { io } = await import('./socket.service.js');
        if (io) {
          io.emit('admin:test_updated', { source: 'auto_cleanup', count: updated.count });
        }
      }
    } catch (e) {
      console.error('[CLEANUP] Error auto-expiring tests:', e);
    }

    const [total, histories] = await Promise.all([
      prisma.driverTestHistory.count({ where }),
      prisma.driverTestHistory.findMany({
        where,
        skip,
        take: limit,
        include: {
          driver: {
            include: { user: { select: { fullName: true, phone: true } } }
          }
        },
        orderBy: { startedAt: 'desc' }
      })
    ]);
    return { total, histories, page, limit };
  },

  getTestHistorySummary: async (page = 1, limit = 20, search = '') => {
    const skip = (page - 1) * limit;
    
    // Tìm các driver có tham gia thi
    const where = {
      testHistories: { some: {} }
    };

    if (search) {
      where.OR = [
        { user: { fullName: { contains: search, mode: 'insensitive' } } },
        { user: { phone: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const [total, drivers] = await Promise.all([
      prisma.driver.count({ where }),
      prisma.driver.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: { select: { fullName: true, phone: true } },
          _count: { select: { testHistories: true } },
          testHistories: {
            orderBy: { startedAt: 'desc' },
            take: 1
          }
        },
        orderBy: { user: { fullName: 'asc' } }
      })
    ]);

    return { total, drivers, page, limit };
  },

  getDriverAttempts: async (driverId) => {
    return await prisma.driverTestHistory.findMany({
      where: { driverId: parseInt(driverId) },
      orderBy: { startedAt: 'desc' },
      include: {
        quiz: { select: { name: true } }
      }
    });
  },

  getTestHistoryDetail: async (historyId) => {
    return await prisma.driverTestHistory.findUnique({
      where: { id: parseInt(historyId) },
      include: {
        details: true,
        driver: {
          include: { user: { select: { fullName: true, phone: true } } }
        }
      }
    });
  },

  importQuestionsFromBuffer: async (buffer) => {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const questionsToCreate = rows.map(row => {
      // Giả sử các cột là: Question Text, Option 1, Option 2, Option 3, Option 4, Correct Answer (1-4), Difficulty, ModuleId
      const options = [
        row['Option 1']?.toString() || '',
        row['Option 2']?.toString() || '',
        row['Option 3']?.toString() || '',
        row['Option 4']?.toString() || ''
      ];

      let moduleIdRes = null;
      if (row['ModuleId']) {
          const parsed = parseInt(row['ModuleId']);
          if (!isNaN(parsed)) moduleIdRes = parsed;
      }

      return {
        questionText: row['Question Text']?.toString() || 'Untitled Question',
        options,
        correctAnswerIndex: (parseInt(row['Correct Answer']) || 1) - 1, // Chuyển từ 1-4 sang 0-3
        difficulty: (row['Difficulty']?.toString() || 'MEDIUM').toUpperCase(),
        moduleId: moduleIdRes,
        isActive: true
      };
    });

    return await prisma.knowledgeQuestion.createMany({
      data: questionsToCreate,
      skipDuplicates: true
    });
  },

  // --- QUIZ MANAGEMENT ---
  getQuizzesByModule: async (moduleId) => {
    return await prisma.knowledgeQuiz.findMany({
      where: { moduleId: parseInt(moduleId) },
      orderBy: { orderIndex: 'asc' },
      include: {
        _count: { select: { questions: true } }
      }
    });
  },

  createQuiz: async (data) => {
    return await prisma.knowledgeQuiz.create({
      data: {
        moduleId: parseInt(data.moduleId),
        name: data.name || 'Bài kiểm tra mới',
        description: data.description,
        questionCount: data.questionCount || 10,
        minScoreToPass: data.minScoreToPass || 80,
        easyPercentage: data.easyPercentage || 30,
        medPercentage: data.medPercentage || 40,
        hardPercentage: data.hardPercentage || 30,
        isMandatory: data.isMandatory !== undefined ? data.isMandatory : true,
        orderIndex: data.orderIndex || 0,
        isActive: true
      }
    });
  },

  updateQuiz: async (id, data) => {
    return await prisma.knowledgeQuiz.update({
      where: { id: parseInt(id) },
      data: {
        name: data.name,
        description: data.description,
        questionCount: data.questionCount !== undefined ? Number(data.questionCount) : undefined,
        minScoreToPass: data.minScoreToPass !== undefined ? Number(data.minScoreToPass) : undefined,
        easyPercentage: data.easyPercentage !== undefined ? Number(data.easyPercentage) : undefined,
        medPercentage: data.medPercentage !== undefined ? Number(data.medPercentage) : undefined,
        hardPercentage: data.hardPercentage !== undefined ? Number(data.hardPercentage) : undefined,
        isMandatory: data.isMandatory !== undefined ? Boolean(data.isMandatory) : undefined,
        orderIndex: data.orderIndex !== undefined ? Number(data.orderIndex) : undefined,
        isActive: data.isActive !== undefined ? Boolean(data.isActive) : undefined,
      }
    });
  },

  deleteQuiz: async (id) => {
    return await prisma.knowledgeQuiz.delete({
      where: { id: parseInt(id) }
    });
  },

  // --- QUESTION ASSIGNMENT ---
  assignQuestionsToQuiz: async (quizId, questionIds) => {
    const qId = parseInt(quizId);
    // Xóa các gán cũ (nếu muốn thay thế hoàn toàn) hoặc chỉ thêm mới
    // Ở đây ta thực hiện THAY THẾ hoàn toàn cho đơn giản
    await prisma.quizQuestionAssignment.deleteMany({
      where: { quizId: qId }
    });

    const assignments = questionIds.map(id => ({
      quizId: qId,
      questionId: parseInt(id)
    }));

    return await prisma.quizQuestionAssignment.createMany({
      data: assignments,
      skipDuplicates: true
    });
  },

  assignRandomQuestionsToQuiz: async (quizId, filters) => {
    const qId = parseInt(quizId);
    const quiz = await prisma.knowledgeQuiz.findUnique({ where: { id: qId } });
    if (!quiz) throw new Error('Bài kiểm tra không tồn tại.');

    const count = filters.count || quiz.questionCount;
    
    // Lấy list câu hỏi chưa có trong Quiz này
    const existingIds = (await prisma.quizQuestionAssignment.findMany({
      where: { quizId: qId },
      select: { questionId: true }
    })).map(a => a.questionId);

    const availableQuestions = await prisma.knowledgeQuestion.findMany({
      where: { 
        isActive: true,
        id: { notIn: existingIds },
        difficulty: filters.difficulty || undefined,
        moduleAssignments: {
            some: { moduleId: quiz.moduleId }
        }
      }
    });

    if (availableQuestions.length === 0) return { count: 0 };

    const shuffled = availableQuestions.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(count, availableQuestions.length));

    const assignments = selected.map(q => ({
      quizId: qId,
      questionId: q.id
    }));

    await prisma.quizQuestionAssignment.createMany({
      data: assignments,
      skipDuplicates: true
    });

    return { count: selected.length };
  },

  getQuestionsByQuiz: async (quizId) => {
    const assignments = await prisma.quizQuestionAssignment.findMany({
      where: { quizId: parseInt(quizId) },
      include: { question: true },
      orderBy: { createdAt: 'asc' }
    });
    return assignments.map(a => a.question);
  }
};

export default adminTestService;
