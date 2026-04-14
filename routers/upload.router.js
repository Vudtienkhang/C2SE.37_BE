import { Router } from 'express';
import multer from 'multer';
import { 
  uploadAvatar, 
  uploadDriverDocument, 
  uploadChatImage, 
  uploadWithdrawalProof, 
  uploadDriverAvatar,
  uploadAcademyContent
} from "../controllers/upload.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Route POST /api/auth/upload/academy-content
router.post('/academy-content', upload.single('file'), uploadAcademyContent);


// Route POST /api/auth/upload/withdrawal-proof/:id
router.post('/withdrawal-proof/:id', upload.single('proof'), uploadWithdrawalProof);

// Route POST /api/auth/profile/:id/avatar
router.post('/profile/:id/avatar', upload.single('avatar'), uploadAvatar);

// Route POST /api/auth/upload/driver-document/:userId/:documentTypeId
router.post('/driver-document/:userId/:documentTypeId', upload.single('document'), uploadDriverDocument);

// Route POST /api/auth/upload/chat/:tripId/image
router.post('/chat/:tripId/image', upload.single('image'), uploadChatImage);

// Route POST /api/auth/upload/driver-avatar/:userId
router.post('/driver-avatar/:userId', upload.single('avatar'), uploadDriverAvatar);

export default router;