import academyService from '../services/academy.service.js';
import certificateService from '../services/certificate.service.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const academyController = {
  // --- ADMIN: Module CRUD ---
  getModules: async (req, res) => {
    try {
      const modules = await academyService.getModules();
      res.status(200).json({ data: modules });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  createModule: async (req, res) => {
    try {
      const module = await academyService.createModule(req.body);
      res.status(201).json({ message: 'Tạo module thành công', data: module });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  updateModule: async (req, res) => {
    try {
      const module = await academyService.updateModule(req.params.id, req.body);
      res.status(200).json({ message: 'Cập nhật module thành công', data: module });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  deleteModule: async (req, res) => {
    try {
      await academyService.deleteModule(req.params.id);
      res.status(200).json({ message: 'Xóa module thành công' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // --- ADMIN: Content Management ---
  addContent: async (req, res) => {
    try {
      const content = await academyService.addContent(req.params.moduleId, req.body);
      res.status(201).json({ data: content });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // --- DRIVER: Academy Flow ---
  getAcademyStatus: async (req, res) => {
    try {
      let driverId = req.user.driverId;
      if (!driverId) {
        const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } });
        driverId = driver.id;
      }
      const status = await academyService.getDriverAcademyStatus(driverId);
      res.status(200).json({ data: status });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  startLearning: async (req, res) => {
    try {
      let driverId = req.user.driverId;
      if (!driverId) {
        const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } });
        driverId = driver.id;
      }
      const prog = await academyService.startLearningModule(driverId, parseInt(req.params.moduleId));
      res.status(200).json({ data: prog });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  },

  downloadCertificate: async (req, res) => {
    try {
      let driverId = req.user.driverId;
      if (!driverId) {
        const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } });
        driverId = driver.id;
      }
      
      const pdfBuffer = await certificateService.generateCertificate(driverId);
      
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=certificate.pdf',
        'Content-Length': pdfBuffer.length
      });
      
      res.send(pdfBuffer);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
};

export default academyController;
