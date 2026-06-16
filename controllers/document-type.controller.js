import * as documentTypeService from '../services/document-type.service.js';

/**
 * Lấy danh sách loại giấy tờ
 */
export const getDocumentTypes = async (req, res) => {
    try {
        const documentTypes = await documentTypeService.getAllDocumentTypes();
        return res.status(200).json({
            success: true,
            data: documentTypes
        });
    } catch (error) {
        console.error('Lỗi getDocumentTypes controller:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi máy chủ nội bộ'
        });
    }
};

/**
 * Thêm loại giấy tờ mới
 */
export const createDocumentType = async (req, res) => {
    try {
        const { name, code } = req.body;
        
        if (!name || !code) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ tên và mã loại giấy tờ.'
            });
        }

        const newDocType = await documentTypeService.createDocumentType(req.body);
        return res.status(201).json({
            success: true,
            message: 'Thêm loại giấy tờ thành công',
            data: newDocType
        });
    } catch (error) {
        if (error.message === 'Mã loại giấy tờ này đã tồn tại.') {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
        console.error('Lỗi createDocumentType controller:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi máy chủ nội bộ'
        });
    }
};

/**
 * Cập nhật loại giấy tờ
 */
export const updateDocumentType = async (req, res) => {
    try {
        const { id } = req.params;
        const updatedDocType = await documentTypeService.updateDocumentType(id, req.body);
        
        return res.status(200).json({
            success: true,
            message: 'Cập nhật loại giấy tờ thành công',
            data: updatedDocType
        });
    } catch (error) {
        if (error.message === 'Không tìm thấy loại giấy tờ này.' || error.message === 'Mã loại giấy tờ này đã tồn tại.') {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }
        console.error('Lỗi updateDocumentType controller:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi máy chủ nội bộ'
        });
    }
};

/**
 * Xoá loại giấy tờ
 */
export const deleteDocumentType = async (req, res) => {
    try {
        const { id } = req.params;
        await documentTypeService.deleteDocumentType(id);
        
        return res.status(200).json({
            success: true,
            message: 'Xoá loại giấy tờ thành công'
        });
    } catch (error) {
        if (error.message === 'Không tìm thấy loại giấy tờ này.') {
            return res.status(404).json({
                success: false,
                message: error.message
            });
        }
        console.error('Lỗi deleteDocumentType controller:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi máy chủ nội bộ'
        });
    }
};
