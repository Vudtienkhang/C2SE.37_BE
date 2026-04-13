import express from 'express';
import { verifyAdminToken, checkPermission } from '../middlewares/auth.middleware.js';
import adminTestController from '../controllers/admin.test.controller.js';
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
router.get('/questions/template', adminTestController.downloadTemplate);

router.use(verifyAdminToken, checkPermission('SYSTEM_CONFIG_MANAGE'));

router.get('/questions', adminTestController.getQuestions);
router.post('/questions', adminTestController.createQuestion);
router.post('/questions/import', upload.single('file'), adminTestController.importQuestions);
router.put('/questions/:id', adminTestController.updateQuestion);
router.delete('/questions/:id', adminTestController.deleteQuestion);

router.get('/history', adminTestController.getTestHistories);
router.get('/history/:id', adminTestController.getTestHistoryDetail);

// QUẢN LÝ QUIZ TRONG MODULE
router.get('/modules/:moduleId/quizzes', adminTestController.getQuizzesByModule);
router.post('/quizzes', adminTestController.createQuiz);
router.put('/quizzes/:id', adminTestController.updateQuiz);
router.delete('/quizzes/:id', adminTestController.deleteQuiz);

// QUẢN LÝ CÂU HỎI TRONG QUIZ
router.get('/quizzes/:id/questions', adminTestController.getQuestionsByQuiz);
router.post('/quizzes/:id/assign', adminTestController.assignQuestionsToQuiz);
router.post('/quizzes/:id/assign-random', adminTestController.assignRandomQuestionsToQuiz);

export default router;
