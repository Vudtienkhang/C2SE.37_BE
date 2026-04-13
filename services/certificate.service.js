import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const certificateService = {
  /**
   * Tạo chứng chỉ PDF cho tài xế
   */
  generateCertificate: async (driverId) => {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      include: { user: true }
    });

    if (!driver) throw new Error('Không tìm thấy thông tin tài xế');
    if (!driver.isCertified) throw new Error('Tài xế chưa đạt yêu cầu cấp chứng chỉ');

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margin: 0
        });

        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // --- BACKGROUND / DESIGN ---
        // Vẽ khung viền trang trí
        doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40)
           .lineWidth(5)
           .strokeColor('#F97316') // Orange border
           .stroke();

        doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60)
           .lineWidth(1)
           .strokeColor('#E5E7EB')
           .stroke();

        // --- CONTENT ---
        doc.moveDown(4);
        
        // Logo hoặc Header
        doc.fillColor('#111827')
           .fontSize(40)
           .font('Helvetica-Bold')
           .text('CHỨNG NHẬN HOÀN THÀNH', { align: 'center' });
        
        doc.moveDown(0.5);
        doc.fontSize(20)
           .font('Helvetica')
           .text('KHÓA ĐÀO TẠO KIẾN THỨC TÀI XẾ CHUYÊN NGHIỆP', { align: 'center' });

        doc.moveDown(2);
        doc.fontSize(16)
           .text('Chứng chỉ này được trân trọng cấp cho:', { align: 'center' });

        doc.moveDown(1);
        doc.fillColor('#F97316')
           .fontSize(36)
           .font('Helvetica-Bold')
           .text(driver.user.fullName?.toUpperCase() || 'TAI XE ANONYMOUS', { align: 'center' });

        doc.moveDown(1);
        doc.fillColor('#4B5563')
           .fontSize(14)
           .font('Helvetica')
           .text(`Số điện thoại: ${driver.user.phone}`, { align: 'center' });
        
        doc.moveDown(1.5);
        doc.fontSize(16)
           .text('Vì đã hoàn thành xuất sắc tất cả các Module đào tạo kiến thức,', { align: 'center' });
        doc.text('quy tắc an toàn và quy trình nghiệp vụ của hệ thống.', { align: 'center' });

        // --- FOOTER / DATE ---
        const certDate = driver.certifiedAt || new Date();
        const dateString = `Ngày cấp: ${certDate.toLocaleDateString('vi-VN')}`;

        doc.moveDown(3);
        doc.fontSize(12)
           .text(dateString, 60, 480);
        
        doc.text('GIÁM ĐỐC ĐIỀU HÀNH', 600, 480);
        doc.font('Helvetica-Bold')
           .text('(Đã ký điện tử)', 600, 500);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
};

export default certificateService;
