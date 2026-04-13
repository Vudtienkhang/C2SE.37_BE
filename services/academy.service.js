import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const academyService = {
  // --- ADMIN METHODS ---
  getModules: async () => {
    return await prisma.knowledgeModule.findMany({
      orderBy: { orderIndex: 'asc' },
      include: { 
        contents: { orderBy: { orderIndex: 'asc' } },
        quizzes: {
          orderBy: { orderIndex: 'asc' },
          include: {
            _count: { select: { questions: true } }
          }
        },
        _count: { select: { contents: true } } 
      }
    });
  },

  createModule: async (data) => {
    return await prisma.knowledgeModule.create({
      data: {
        name: data.name,
        description: data.description,
        orderIndex: data.orderIndex || 0,
        isActive: data.isActive !== undefined ? data.isActive : true
      }
    });
  },

  updateModule: async (id, data) => {
    return await prisma.knowledgeModule.update({
      where: { id: parseInt(id) },
      data: {
        ...data,
        id: undefined 
      }
    });
  },

  deleteModule: async (id) => {
    return await prisma.knowledgeModule.delete({
      where: { id: parseInt(id) }
    });
  },

  // Content Management
  addContent: async (moduleId, data) => {
    return await prisma.moduleContent.create({
      data: {
        moduleId: parseInt(moduleId),
        title: data.title,
        description: data.description,
        type: data.type || 'VIDEO',
        contentUrl: data.contentUrl,
        orderIndex: data.orderIndex || 0
      }
    });
  },

  updateContent: async (contentId, data) => {
    return await prisma.moduleContent.update({
      where: { id: parseInt(contentId) },
      data
    });
  },

  deleteContent: async (contentId) => {
    return await prisma.moduleContent.delete({
      where: { id: parseInt(contentId) }
    });
  },

  // --- DRIVER METHODS ---
  
  /**
   * Lấy danh sách module và trạng thái của tài xế (kèm danh sách quizz)
   */
  getDriverAcademyStatus: async (driverId) => {
    const allModules = await prisma.knowledgeModule.findMany({
      where: { isActive: true },
      orderBy: { orderIndex: 'asc' },
      include: {
        contents: { orderBy: { orderIndex: 'asc' } },
        quizzes: {
          where: { isActive: true },
          orderBy: { orderIndex: 'asc' },
          include: {
            _count: { select: { questions: true } }
          }
        }
      }
    });

    const moduleProgress = await prisma.driverModuleProgress.findMany({
      where: { driverId }
    });

    const quizProgress = await prisma.driverQuizProgress.findMany({
      where: { driverId }
    });

    let previousCompleted = true; 

    return allModules.map((mod) => {
      const modProg = moduleProgress.find(p => p.moduleId === mod.id);
      
      // Tổng hợp trạng thái Module từ các bài Quiz con
      const quizzes = mod.quizzes.map(q => {
        const qProg = quizProgress.find(qp => qp.quizId === q.id);
        const isReady = (q._count?.questions || 0) >= q.questionCount;
        
        return {
          ...q,
          status: qProg?.status || 'IDLE',
          score: qProg?.score || 0,
          completedAt: qProg?.completedAt || null,
          isReady
        };
      });

      const isAllMandatoryPassed = quizzes
        .filter(q => q.isMandatory)
        .every(q => q.status === 'COMPLETED');

      let status = modProg?.status || 'LOCKED';
      
      if (status === 'LOCKED' && previousCompleted) {
        status = 'IDLE'; 
      }

      const result = {
        ...mod,
        status,
        quizzes,
        isCompleted: isAllMandatoryPassed,
        isLocked: !previousCompleted && status === 'LOCKED'
      };

      previousCompleted = isAllMandatoryPassed && (status === 'COMPLETED');
      
      return result;
    });
  },

  /**
   * Bắt đầu học một module
   */
  startLearningModule: async (driverId, moduleId) => {
    const currentModule = await prisma.knowledgeModule.findUnique({ where: { id: moduleId } });
    if (!currentModule) throw new Error('Module không tồn tại');

    const previousModules = await prisma.knowledgeModule.findMany({
      where: { orderIndex: { lt: currentModule.orderIndex }, isActive: true },
      orderBy: { orderIndex: 'desc' },
      take: 1
    });

    if (previousModules.length > 0) {
      const prevProg = await prisma.driverModuleProgress.findUnique({
        where: { driverId_moduleId: { driverId, moduleId: previousModules[0].id } }
      });
      if (!prevProg || prevProg.status !== 'COMPLETED') {
        throw new Error('Bạn cần hoàn thành module trước đó để mở khóa module này.');
      }
    }

    return await prisma.driverModuleProgress.upsert({
      where: { driverId_moduleId: { driverId, moduleId } },
      update: { status: 'LEARNING' },
      create: { driverId, moduleId, status: 'LEARNING' }
    });
  }
};

export default academyService;
