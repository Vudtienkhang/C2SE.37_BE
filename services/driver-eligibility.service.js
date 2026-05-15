import prisma from '../prisma/prisma.js';

/**
 * Kiểm tra xem tài xế có bất kỳ giấy tờ nào đã hết hạn hay không
 * @param {number} driverId 
 * @returns {Promise<{isExpired: boolean, expiredDocs: string[]}>}
 */
export const checkExpiredDocuments = async (driverId) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiredDocuments = await prisma.driverDocument.findMany({
        where: {
            driverId: parseInt(driverId),
            status: 'approved',
            expiryDate: {
                lt: today
            }
        },
        include: {
            documentType: true
        }
    });

    if (expiredDocuments.length > 0) {
        return {
            isExpired: true,
            expiredDocs: expiredDocuments.map(doc => doc.documentType.name)
        };
    }

    return {
        isExpired: false,
        expiredDocs: []
    };
};
