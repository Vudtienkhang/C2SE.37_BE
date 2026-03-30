import { PrismaClient } from '@prisma/client';
import { supabase } from '../lib/supabase.js';

const prisma = new PrismaClient();

export const uploadUserAvatarToSupabase = async (id, fileBuffer, mimeType) => {
  // 1. Tạo tên file độc nhất
  const fileName = `${id}_${Date.now()}.png`;
  const filePath = `${fileName}`;

  // 2. Upload file dạng buffer lên Supabase Storage bucket 'avatars'
  const { data: buckets } = await supabase.storage.listBuckets();
  console.log('Danh sách bucket app thấy:', buckets?.map(b => b.name));

  const { data, error } = await supabase.storage
    .from('avatars')
    .upload(filePath, fileBuffer, {
      contentType: mimeType || 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Lỗi upload Supabase:', error);
    throw new Error('Lỗi khi tải ảnh lên máy chủ.');
  }

  // 3. Lấy Public URL của ảnh vừa tạo
  const { data: publicUrlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath);

  const publicUrl = publicUrlData.publicUrl;

  const numericId = parseInt(id, 10);
  // 4. Cập nhật Public URL vào database của Customer
  const updatedCustomer = await prisma.customer.upsert({
    where: { userId: numericId },
    update: { avatarUrl: publicUrl },
    create: {
      userId: numericId,
      avatarUrl: publicUrl,
    }
  });

  return publicUrl;
};

export const uploadDriverDocumentToSupabase = async (userId, documentTypeId, fileBuffer, mimeType) => {
  const numericUserId = parseInt(userId, 10);
  const numericDocTypeId = parseInt(documentTypeId, 10);

  // 1. Tìm thông tin Driver
  const driver = await prisma.driver.findUnique({
    where: { userId: numericUserId },
  });

  if (!driver) {
    throw new Error('Tài xế không tồn tại. Vui lòng hoàn tất thông tin cá nhân trước.');
  }

  // 2. Upload file lên bucket 'driver_documents'
  const fileName = `driver_${driver.id}_type_${numericDocTypeId}_${Date.now()}.png`;
  
  const { error } = await supabase.storage
    .from('driver_document')
    .upload(fileName, fileBuffer, {
      contentType: mimeType || 'image/png',
      upsert: true,
    });

  if (error) {
    console.error('Lỗi upload tài liệu Supabase:', error);
    // Nếu bucket chưa tồn tại, có thể báo lỗi hoặc thử tự tạo (tùy quyền hạn)
    throw new Error('Lỗi khi tải tài liệu lên máy chủ.');
  }

  // 3. Lấy URL
  const { data: publicUrlData } = supabase.storage
    .from('driver_document')
    .getPublicUrl(fileName);

  const fileUrl = publicUrlData.publicUrl;

  // 4. Lưu vào bảng DriverDocument
  const doc = await prisma.driverDocument.upsert({
    where: {
      // Vì không có unique constraint trên (driverId, documentTypeId), 
      // ta nên tạo mới hoặc tìm bản ghi cũ theo tổ hợp này nếu muốn cập nhật.
      // Tạm thời dùng findFirst để kiểm tra.
      id: (await prisma.driverDocument.findFirst({
        where: { driverId: driver.id, documentTypeId: numericDocTypeId }
      }))?.id || -1
    },
    update: { fileUrl, status: 'pending' },
    create: {
      driverId: driver.id,
      documentTypeId: numericDocTypeId,
      fileUrl,
      status: 'pending',
    }
  });

  return doc;
};
export const uploadChatMessageImageToSupabase = async (fileBuffer, mimeType) => {
  // 1. Tạo tên file độc nhất
  const fileName = `chat_${Date.now()}.png`;
  
  // 2. Upload file lên bucket 'MessageIMG'
  const { error } = await supabase.storage
    .from('MessageIMG')
    .upload(fileName, fileBuffer, {
      contentType: mimeType || 'image/png',

/**
 * Upload bằng chứng khiếu nại (Ảnh, Audio, Video...) lên Supabase
 * @param {number} userId 
 * @param {number} tripId 
 * @param {Buffer} fileBuffer 
 * @param {string} mimeType 
 * @returns {Promise<string>} - Public URL của evidence
 */
export const uploadDisputeEvidenceToSupabase = async (userId, tripId, fileBuffer, mimeType) => {
  // Xác định extension dựa trên mimeType
  let ext = 'bin';
  if (mimeType.includes('image')) ext = 'png';
  if (mimeType.includes('audio')) ext = 'mp3';
  if (mimeType.includes('pdf')) ext = 'pdf';

  const fileName = `dispute_u${userId}_t${tripId}_${Date.now()}.${ext}`;
  
  const { data, error } = await supabase.storage
    .from('dispute_evidence')
    .upload(fileName, fileBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    console.error('Lỗi upload ảnh chat Supabase:', error);
    throw new Error('Lỗi khi tải ảnh lên máy chủ.');
  }

  // 3. Lấy URL công khai
  const { data: publicUrlData } = supabase.storage
    .from('MessageIMG')
    console.error('Lỗi upload bằng chứng Supabase:', error);
    throw new Error('Lỗi khi tải bằng chứng lên máy chủ.');
  }

  const { data: publicUrlData } = supabase.storage
    .from('dispute_evidence')
    .getPublicUrl(fileName);

  return publicUrlData.publicUrl;
};
