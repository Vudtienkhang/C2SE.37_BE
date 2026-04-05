import prisma from '../prisma/prisma.js';

/**
 * Lấy tất cả các loại giấy tờ
 */
export const getAllDocumentTypes = async () => {
    return await prisma.documentType.findMany({
        where: { isActive: true },
        orderBy: { id: 'asc' }
    });
};

/**
 * Tạo mới một loại giấy tờ
 */
export const createDocumentType = async (data) => {
    const { name, code, description, isRequired } = data;
    
    // Kiểm tra xem code đã tồn tại chưa
    const existing = await prisma.documentType.findUnique({
        where: { code }
    });
    
    if (existing) {
        throw new Error('Mã loại giấy tờ này đã tồn tại.');
    }

    return await prisma.documentType.create({
        data: {
            name,
            code,
            description,
            isRequired: isRequired ?? true,
            isActive: true
        }
    });
};

/**
 * Cập nhật loại giấy tờ
 */
export const updateDocumentType = async (id, data) => {
    const { name, code, description, isRequired, isActive } = data;

    // Kiểm tra ID có tồn tại không
    const existing = await prisma.documentType.findUnique({
        where: { id: parseInt(id) }
    });

    if (!existing) {
        throw new Error('Không tìm thấy loại giấy tờ này.');
    }

    // Nếu cập nhật code, kiểm tra xem code mới có trùng với bản ghi khác không
    if (code && code !== existing.code) {
        const duplicateCode = await prisma.documentType.findUnique({
            where: { code }
        });
        if (duplicateCode) {
            throw new Error('Mã loại giấy tờ này đã tồn tại.');
        }
    }

    return await prisma.documentType.update({
        where: { id: parseInt(id) },
        data: {
            name,
            code,
            description,
            isRequired,
            isActive
        }
    });
};
