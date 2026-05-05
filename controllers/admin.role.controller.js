import * as roleService from '../services/admin.role.service.js';
import { io } from '../services/socket.service.js';

export const getPermissions = async (req, res) => {
    try {
        const permissions = await roleService.getAllPermissions();
        res.status(200).json({ success: true, data: permissions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getRoles = async (req, res) => {
    try {
        const roles = await roleService.getAllRoles();
        res.status(200).json({ success: true, data: roles });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createRole = async (req, res) => {
    try {
        const role = await roleService.createRole(req.body);
        res.status(201).json({ success: true, data: role });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateRolePermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const { permissionIds } = req.body;
        await roleService.updateRolePermissions(id, permissionIds);

        // REAL-TIME: Thông báo cho tất cả Admin là quyền hạn đã thay đổi
        if (io) {
            console.log('[SOCKET] Emitting admin:permissions_changed');
            io.emit('admin:permissions_changed', { roleId: parseInt(id) });
        }

        res.status(200).json({ success: true, message: 'Cập nhật quyền thành công' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getUsersInRole = async (req, res) => {
    try {
        const { id } = req.params;
        const users = await roleService.getUsersByRole(id);
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const createStaff = async (req, res) => {
    try {
        const staff = await roleService.createStaffUser(req.body);
        res.status(201).json({ success: true, data: staff });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'Email hoặc số điện thoại đã tồn tại trên hệ thống.'
            });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getMyPermissions = async (req, res) => {
    try {
        const userId = req.admin.id;
        console.log('[PERMISSIONS] Fetching for userId:', userId);
        
        const [permissions, user] = await Promise.all([
            roleService.getUserPermissions(userId),
            roleService.getUserProfile(userId)
        ]);

        if (!user) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin người dùng.' });
        }

        res.status(200).json({ 
            success: true, 
            data: {
                permissions,
                user
            } 
        });
    } catch (error) {
        console.error('[GET MY PERMISSIONS ERROR]', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

export const downloadTemplate = async (req, res) => {
    try {
        const buffer = roleService.generateStaffTemplate();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Mau_Nhap_Nhan_Vien.xlsx');
        res.status(200).send(buffer);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const importStaff = async (req, res) => {
    try {
        const { roleId } = req.body;
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng tải lên file Excel.' });
        }
        if (!roleId) {
            return res.status(400).json({ success: false, message: 'Thiếu Role ID.' });
        }

        const result = await roleService.importStaffFromExcel(req.file.buffer, roleId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
export const updateStaffStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const updaterId = req.admin.id;

        await roleService.updateStaffStatus(id, status, updaterId);
        res.status(200).json({ 
            success: true, 
            message: `Đã ${status === 'active' ? 'mở khóa' : 'khóa'} tài khoản nhân viên.` 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
