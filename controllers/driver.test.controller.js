import driverTestService from '../services/driver.test.service.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const driverTestController = {
  startTest: async (req, res) => {
    try {
      let driverId = req.user.driverId;
      if (!driverId) {
         const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } });
         if (!driver) return res.status(403).json({ error: 'User is not a driver' });
         driverId = driver.id;
         req.user.driverId = driverId;
      }
      
      const { quizId } = req.body;
      const testData = await driverTestService.startTest(driverId, quizId);
      return res.status(200).json({ message: 'Bắt đầu bài thi thành công', data: testData });
    } catch (error) {
      console.error(error);
      return res.status(400).json({ error: error.message });
    }
  },

  submitTest: async (req, res) => {
    try {
      let driverId = req.user.driverId;
      if (!driverId) {
         const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } });
         driverId = driver.id;
         req.user.driverId = driverId;
      }
      
      const { sessionId, answers } = req.body;
      if (!sessionId || !answers) {
         return res.status(400).json({ error: 'Thiếu dữ liệu phiên thi hoặc đáp án' });
      }

      const result = await driverTestService.submitTest(driverId, sessionId, answers);
      return res.status(200).json({ message: 'Nộp bài thi thành công', data: result });
    } catch (error) {
      console.error(error);
      return res.status(400).json({ error: error.message });
    }
  }
};

export default driverTestController;
