import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const getSystemConfig = async (key, defaultValue) => {
  const config = await prisma.systemConfig.findUnique({ where: { key } });
  if (!config) return defaultValue;
  const parsed = parseInt(config.value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

const driverTestService = {
  /**
   * Bắt đầu bài thi theo Quiz ID
   */
  startTest: async (driverId, quizId) => {
    if (!quizId) throw new Error('Vui lòng chọn Bài kiểm tra để bắt đầu.');

    const maxAttempts = await getSystemConfig('KNOWLEDGE_TEST_MAX_ATTEMPT_PER_DAY', 3);
    const retryDelay = await getSystemConfig('KNOWLEDGE_TEST_RETRY_DELAY_MINUTES', 10);
    const timeLimit = await getSystemConfig('KNOWLEDGE_TEST_TIME_LIMIT_MINUTES', 20);
    const globalQuestionCount = await getSystemConfig('KNOWLEDGE_TEST_QUESTION_COUNT', 10);

    const quiz = await prisma.knowledgeQuiz.findUnique({ 
      where: { id: parseInt(quizId) },
      include: { module: true }
    });
    if (!quiz) throw new Error('Bài kiểm tra không tồn tại.');
    if (!quiz.isActive) throw new Error('Bài kiểm tra này hiện đang tạm đóng.');

    const questionCount = quiz.questionCount || globalQuestionCount;

    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const endOfDay = new Date(now.setHours(23, 59, 59, 999));

    // Kiểm tra giới hạn retry
    const todayAttempts = await prisma.driverTestHistory.count({
      where: { 
        driverId, 
        quizId: parseInt(quizId),
        startedAt: { gte: startOfDay, lte: endOfDay } 
      }
    });

    if (todayAttempts >= 5) {
      throw new Error('Bạn đã đạt giới hạn thi 5 lần trong ngày cho bài thi này.');
    }

    if (todayAttempts >= maxAttempts) {
      throw new Error(`Bạn đã đạt giới hạn thi tối đa (${maxAttempts} lần/lượt). Vui lòng thử lại sau.`);
    }

    const recentFailed = await prisma.driverTestHistory.findFirst({
      where: { driverId, quizId: parseInt(quizId), status: 'failed' },
      orderBy: { startedAt: 'desc' }
    });

    if (recentFailed) {
      const waitTimeMs = retryDelay * 60 * 1000;
      const timeSinceFailed = new Date() - new Date(recentFailed.startedAt);
      if (timeSinceFailed < waitTimeMs) {
        throw new Error(`Vui lòng chờ ${retryDelay} phút sau lần thi rớt trước để được thi lại.`);
      }
    }

    // Lấy câu hỏi từ Quiz (Thông qua bảng trung gian)
    const assignedQuestions = await prisma.quizQuestionAssignment.findMany({
      where: { quizId: parseInt(quizId), question: { isActive: true } },
      include: { question: true }
    });
    
    const allQuestions = assignedQuestions.map(a => a.question);
    
    if (allQuestions.length < questionCount) {
      throw new Error(`Ngân hàng câu hỏi của Bài kiểm tra này (${allQuestions.length}) chưa đủ số lượng để tạo đề (${questionCount} câu).`);
    }

    // --- ADAPTIVE & CUSTOM DISTRIBUTION LOGIC ---
    let selectedQuestions = [];
    const easyQ = allQuestions.filter(q => q.difficulty === 'EASY');
    const medQ = allQuestions.filter(q => q.difficulty === 'MEDIUM');
    const hardQ = allQuestions.filter(q => q.difficulty === 'HARD');

    let easyPct = (quiz.easyPercentage ?? 30) / 100;
    let medPct = (quiz.medPercentage ?? 40) / 100;
    let hardPct = (quiz.hardPercentage ?? 30) / 100;

    // Adaptive: Nếu lần trước sai nhiều (< 50%) -> Tăng EASY
    const prevProgress = await prisma.driverQuizProgress.findUnique({
      where: { driverId_quizId: { driverId, quizId: parseInt(quizId) } }
    });

    if (prevProgress && prevProgress.score !== null && (prevProgress.score / questionCount) < 0.5) {
      easyPct = 0.6;
      hardPct = 0.1;
      medPct = 0.3;
    } 

    let easyN = Math.floor(questionCount * easyPct);
    let hardN = Math.floor(questionCount * hardPct);
    let medN = questionCount - easyN - hardN;

    const pick = (list, n) => shuffleArray(list).slice(0, Math.max(0, n));
    
    const pickedEasy = pick(easyQ, easyN);
    const pickedHard = pick(hardQ, hardN);
    const pickedMed = pick(medQ, medN);

    selectedQuestions = [...pickedEasy, ...pickedHard, ...pickedMed];
    
    if (selectedQuestions.length < questionCount) {
       const ids = selectedQuestions.map(s => s.id);
       const pool = allQuestions.filter(q => !ids.includes(q.id));
       selectedQuestions = [...selectedQuestions, ...pick(pool, questionCount - selectedQuestions.length)];
    }

    const expiresAt = new Date(new Date().getTime() + timeLimit * 60 * 1000);

    const testHistory = await prisma.driverTestHistory.create({
      data: {
        driverId,
        quizId: parseInt(quizId),
        totalScore: questionCount,
        expiresAt,
        details: {
          create: shuffleArray(selectedQuestions).map(q => {
             const originalOptions = q.options;
             const correctOptionText = originalOptions[q.correctAnswerIndex];
             const newShuffledOptions = shuffleArray(originalOptions);
             const newCorrectIndex = newShuffledOptions.indexOf(correctOptionText);

             return {
               questionId: q.id,
               questionSnapshot: q.questionText,
               optionsSnapshot: newShuffledOptions,
               correctAnswerIndex: newCorrectIndex
             };
          })
        }
      },
      include: { details: true }
    });

    return {
      sessionId: testHistory.id,
      quizName: quiz.name,
      expiresAt: testHistory.expiresAt,
      questions: testHistory.details.map(d => ({
        detailId: d.id,
        questionText: d.questionSnapshot,
        options: d.optionsSnapshot
      }))
    };
  },

  submitTest: async (driverId, sessionId, answers) => {
    const suspiciousSubmitSeconds = await getSystemConfig('KNOWLEDGE_TEST_SUSPICIOUS_SUBMIT_SECONDS', 15);

    const testHistory = await prisma.driverTestHistory.findUnique({
      where: { id: sessionId },
      include: { details: true }
    });

    if (!testHistory || testHistory.driverId !== driverId) throw new Error('Phiên thi không hợp lệ.');
    if (testHistory.status !== 'in_progress') throw new Error('Bài thi này đã kết thúc.');

    const now = new Date();
    const timeTaken = (now - new Date(testHistory.startedAt)) / 1000;
    
    if (timeTaken < suspiciousSubmitSeconds) {
       await prisma.driverTestHistory.update({
         where: { id: sessionId },
         data: { status: 'blocked', completedAt: now, score: 0 }
       });
       throw new Error(`Hành vi giải đố bất thường (hoàn thành trong ${Math.round(timeTaken)} giây). Phiên thi bị khóa.`);
    }

    if (now > new Date(testHistory.expiresAt)) {
       await prisma.driverTestHistory.update({
         where: { id: sessionId },
         data: { status: 'timeout', completedAt: now }
       });
       throw new Error('Hết thời gian làm bài.');
    }

    let score = 0;
    const updatePromises = [];

    for (let detail of testHistory.details) {
       const submittedAnswer = answers.find(a => a.detailId === detail.id);
       const isCorrect = (submittedAnswer?.selectedAnswerIndex === detail.correctAnswerIndex);
       if (isCorrect) score++;

       updatePromises.push(
         prisma.driverTestDetail.update({
           where: { id: detail.id },
           data: { 
             selectedAnswerIndex: submittedAnswer?.selectedAnswerIndex ?? null, 
             isCorrect 
           }
         })
       );
    }

    await Promise.all(updatePromises);
    
    const quiz = await prisma.knowledgeQuiz.findUnique({ where: { id: testHistory.quizId } });
    if (!quiz) throw new Error('Không tìm thấy thông tin bài kiểm tra.');

    const percentage = (score / testHistory.totalScore) * 100;
    const isPassed = percentage >= quiz.minScoreToPass;

    await prisma.driverTestHistory.update({
      where: { id: sessionId },
      data: { score, status: isPassed ? 'passed' : 'failed', completedAt: now }
    });

    // 1. Cập nhật DriverQuizProgress (Lưu điểm cao nhất)
    const currentProgress = await prisma.driverQuizProgress.findUnique({
      where: { driverId_quizId: { driverId, quizId: quiz.id } }
    });

    await prisma.driverQuizProgress.upsert({
      where: { driverId_quizId: { driverId, quizId: quiz.id } },
      update: {
        score: Math.max(currentProgress?.score || 0, score),
        status: isPassed ? 'COMPLETED' : (currentProgress?.status || 'IDLE'),
        completedAt: isPassed ? (currentProgress?.completedAt || now) : currentProgress?.completedAt
      },
      create: {
        driverId,
        quizId: quiz.id,
        score,
        status: isPassed ? 'COMPLETED' : 'IDLE',
        completedAt: isPassed ? now : undefined
      }
    });

    // 2. Tự động kiểm tra và cập nhật DriverModuleProgress
    const allQuizInModule = await prisma.knowledgeQuiz.findMany({
      where: { moduleId: quiz.moduleId, isActive: true, isMandatory: true }
    });

    const passedMandatoryQuizzes = await prisma.driverQuizProgress.count({
      where: {
        driverId,
        status: 'COMPLETED',
        quiz: { moduleId: quiz.moduleId, isActive: true, isMandatory: true }
      }
    });

    if (passedMandatoryQuizzes >= allQuizInModule.length) {
      await prisma.driverModuleProgress.upsert({
        where: { driverId_moduleId: { driverId, moduleId: quiz.moduleId } },
        update: { status: 'COMPLETED', completedAt: now },
        create: { 
          driverId, 
          moduleId: quiz.moduleId, 
          status: 'COMPLETED', 
          completedAt: now 
        }
      });
    }

    // 3. Kiểm tra Chứng nhận toàn cục (Global Certification)
    if (isPassed) {
      const totalMandatoryQuizzesCount = await prisma.knowledgeQuiz.count({
        where: { 
          isActive: true, 
          isMandatory: true,
          module: { isActive: true, isMandatory: true }
        }
      });

      const driverPassedMandatoryQuizzesCount = await prisma.driverQuizProgress.count({
        where: {
          driverId,
          status: 'COMPLETED',
          quiz: { 
            isActive: true, 
            isMandatory: true,
            module: { isActive: true, isMandatory: true }
          }
        }
      });

      if (driverPassedMandatoryQuizzesCount >= totalMandatoryQuizzesCount) {
        await prisma.driver.update({
          where: { id: driverId },
          data: { isCertified: true, certifiedAt: now, hasPassedKnowledgeTest: true }
        });
      }
    }

    return { score, totalScore: testHistory.totalScore, percentage, isPassed };
  }
};

export default driverTestService;
