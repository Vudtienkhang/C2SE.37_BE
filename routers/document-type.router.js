import express from 'express';
import * as documentTypeController from '../controllers/document-type.controller.js';

const router = express.Router();

router.get('/', documentTypeController.getDocumentTypes);
router.post('/', documentTypeController.createDocumentType);
router.put('/:id', documentTypeController.updateDocumentType);

export default router;
