import prisma from '../prisma/prisma.js';
import notificationService from './notification.service.js';

/**
 * Kiểm tra các tài liệu sắp hết hạn và gửi thông báo cho tài xế
 */
export const checkDocumentExpirations = async () => {
    console.log('[EXPIRY_CHECK] Bắt đầu kiểm tra tài liệu hết hạn...');
    
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Các mốc thời gian cần thông báo (30 ngày, 7 ngày, 1 ngày)
        const checkDays = [30, 7, 1];
        
        for (const days of checkDays) {
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + days);
            
            const nextDate = new Date(targetDate);
            nextDate.setDate(targetDate.getDate() + 1);
            
            // Tìm các tài liệu hết hạn vào đúng ngày targetDate
            const expiringDocs = await prisma.driverDocument.findMany({
                where: {
                    status: 'approved',
                    expiryDate: {
                        gte: targetDate,
                        lt: nextDate
                    }
                },
                include: {
                    driver: {
                        include: { user: true }
                    },
                    documentType: true
                }
            });
            
            console.log(`[EXPIRY_CHECK] Tìm thấy ${expiringDocs.length} tài liệu hết hạn sau ${days} ngày.`);
            
            for (const doc of expiringDocs) {
                const title = `Giấy tờ sắp hết hạn (${days} ngày)`;
                const content = `Tài liệu "${doc.documentType.name}" của bạn sẽ hết hạn vào ngày ${doc.expiryDate.toLocaleDateString('vi-VN')}. Vui lòng cập nhật sớm để tránh gián đoạn hoạt động.`;
                
                await notificationService.createNotification(
                    doc.driver.userId,
                    title,
                    content,
                    'WARNING',
                    JSON.stringify({
                        type: 'DOCUMENT_EXPIRY',
                        documentId: doc.id,
                        expiryDate: doc.expiryDate
                    })
                );
            }
        }
        
        // Kiểm tra các tài liệu ĐÃ hết hạn
        const expiredDocs = await prisma.driverDocument.findMany({
            where: {
                status: 'approved',
                expiryDate: {
                    lt: today
                }
            },
            include: {
                driver: {
                    include: { user: true }
                },
                documentType: true
            }
        });
        
        console.log(`[EXPIRY_CHECK] Tìm thấy ${expiredDocs.length} tài liệu đã hết hạn.`);
        
        for (const doc of expiredDocs) {
            // Cập nhật trạng thái tài liệu sang 'expired' nếu cần (tùy logic business)
            // Ở đây tạm thời chỉ gửi thông báo
            
            const title = `Giấy tờ ĐÃ HẾT HẠN`;
            const content = `Tài liệu "${doc.documentType.name}" của bạn đã hết hạn vào ngày ${doc.expiryDate.toLocaleDateString('vi-VN')}. Bạn cần cập nhật ngay lập tức.`;
            
            await notificationService.createNotification(
                doc.driver.userId,
                title,
                content,
                'DANGER',
                JSON.stringify({
                    type: 'DOCUMENT_EXPIRED',
                    documentId: doc.id,
                    expiryDate: doc.expiryDate
                })
            );
        }
        
        console.log('[EXPIRY_CHECK] Hoàn tất kiểm tra.');
    } catch (error) {
        console.error('[EXPIRY_CHECK_ERROR] Lỗi khi kiểm tra tài liệu hết hạn:', error);
    }
};
