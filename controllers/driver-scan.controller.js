import logger from '../lib/logger.js';
import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';
import { getConfig } from '../services/config.service.js';
import { 
  RekognitionClient, 
  CompareFacesCommand, 
  DetectFacesCommand 
} from "@aws-sdk/client-rekognition";

export const findNearbyDrivers = async (req, res) => {
  const { lat, lng, radius = 5 } = req.query; // Radius mặc định 5km
  logger.info({ lat, lng, radius }, '[BACKEND] Finding nearby drivers');

  if (!lat || !lng) {
    return res.status(400).json({ message: 'Vui lòng cung cấp tọa độ lat và lng' });
  }

  try {
    // 0. Lấy bảng hệ số ưu tiên từ Config
    const priorities = await getConfig('DRIVER_RANK_PRIORITY', {
      SILVER: 1.0,
      GOLD: 1.1,
      PLATINUM: 1.25,
      DIAMOND: 1.5
    });

    // 1. Sử dụng Redis GEOSEARCH để tìm các driverId trong bán kính radius
    const nearbyDriverIds = await redis.geosearch(
      'drivers:locations',
      'FROMLONLAT', lng, lat,
      'BYRADIUS', radius, 'km',
      'WITHDIST',
      'ASC'
    );

    if (!nearbyDriverIds || nearbyDriverIds.length === 0) {
      logger.debug({ radius }, '[BACKEND] No drivers found in Redis');
      return res.status(200).json([]);
    }

    const driverIds = nearbyDriverIds.map(item => parseInt(item[0]));

    // 2. Lấy thông tin chi tiết từ DB (chỉ lấy những ông đang online và không bận)
    const driversInfo = await prisma.driver.findMany({
      where: {
        id: { in: driverIds },
        isOnline: true,
        isBusy: false,
        status: 'approved'
      },
      include: {
        user: { select: { fullName: true, phone: true } },
        DriverRank: true // Lấy thêm Rank để tính ưu tiên
      }
    });

    logger.debug({ count: driversInfo.length }, '[BACKEND] After filtering DB');

    // 3. Tính toán "Khoảng cách hiệu dụng" (Effective Distance) dựa trên Rank
    const results = driversInfo.map(driver => {
      const redisData = nearbyDriverIds.find(item => parseInt(item[0]) === driver.id);
      const actualDistance = redisData ? parseFloat(redisData[1]) : 0;
      
      // Lấy hệ số ưu tiên từ Rank (mặc định 1.0)
      const multiplier = priorities[driver.DriverRank?.code] || 1.0;
      const effectiveDistance = actualDistance / multiplier;

      return {
        ...driver,
        actualDistance,
        effectiveDistance,
        priorityMultiplier: multiplier
      };
    }).sort((a, b) => a.effectiveDistance - b.effectiveDistance); // Sắp xếp theo khoảng cách hiệu dụng

    res.status(200).json(results);
  } catch (error) {
    logger.error(error, 'Error finding nearby drivers');
    res.status(500).json({ message: 'Lỗi server khi tìm tài xế' });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { isOnline } = req.body;
    logger.info({ driverId, isOnline }, '[BACKEND] Received updateStatus request');

    const driver = await prisma.driver.update({
      where: { id: parseInt(driverId) },
      data: { isOnline: !!isOnline },
    });

    res.json({ success: true, isOnline: driver.isOnline });
  } catch (error) {
    logger.error(error, 'Error updating driver status');
    res.status(500).json({ message: 'Lỗi khi cập nhật trạng thái' });
  }
};

export const verifyFace = async (req, res) => {
  try {
    const { driverId } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ message: 'Vui lòng đưa khuôn mặt vào khung ảnh' });
    }

    logger.info({ driverId }, '[BACKEND] Verify face online');

    // If AWS credentials don't exist in env, we will mock success 
    if (!process.env.AWS_ACCESS_KEY_ID) {
      logger.warn('[BACKEND] AWS credentials not found. Mocking successful face verification.');
      await new Promise(resolve => setTimeout(resolve, 800)); // Nhanh hơn mock cũ
      
      const driver = await prisma.driver.update({
        where: { id: parseInt(driverId) },
        data: { isOnline: true },
      });
      return res.json({ success: true, isOnline: driver.isOnline, message: 'Xác minh thành công (Mocked AWS)' });
    }

    // Logic AWS thực tế
    const client = new RekognitionClient({ region: process.env.AWS_REGION || 'ap-southeast-1' });
    const driver = await prisma.driver.findUnique({ where: { id: parseInt(driverId) } });
    
    if (!driver || !driver.avatarUrl) {
      return res.status(404).json({ message: 'Tài xế chưa có ảnh hồ sơ gốc để đối chiếu' });
    }

    try {
      const sourceImageBuffer = req.file.buffer;
      const challengeType = req.body.challengeType; // 'look_left', 'look_right', 'look_straight'
      
      // ============================================
      // 1. TỐI ƯU: REDIS CACHING CHO MASTER IMAGE
      // ============================================
      const cacheKey = `driver:face_buffer:${driverId}`;
      let targetImageBuffer;

      const cachedBufferHex = await redis.get(cacheKey);
      if (cachedBufferHex) {
        logger.debug({ driverId }, '[CACHE_HIT] Using cached master image buffer');
        targetImageBuffer = Buffer.from(cachedBufferHex, 'hex');
      } else {
        logger.info({ driverId }, '[CACHE_MISS] Fetching master image from storage');
        const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;
        const imageUrl = driver.avatarUrl.startsWith('http') 
            ? driver.avatarUrl 
            : `${baseUrl}${driver.avatarUrl.startsWith('/') ? '' : '/'}${driver.avatarUrl}`;
            
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error('Không thể fetch ảnh gốc');
        
        const arrayBuffer = await imageResponse.arrayBuffer();
        targetImageBuffer = Buffer.from(arrayBuffer);
        
        // Lưu vào cache (HEX string) trong 1 giờ
        await redis.setex(cacheKey, 3600, targetImageBuffer.toString('hex'));
      }

      // ============================================
      // 2. TỐI ƯU: PARALLEL EXECUTION (AWS CALLS)
      // ============================================
      const promises = [];

      // Luôn gọi so khớp nhân dạng
      const compareCommand = new CompareFacesCommand({
        SourceImage: { Bytes: sourceImageBuffer },
        TargetImage: { Bytes: targetImageBuffer },
        SimilarityThreshold: 85
      });
      promises.push(client.send(compareCommand));

      // Nếu có challenge, gọi thêm detect faces song song
      if (challengeType) {
        const detectCommand = new DetectFacesCommand({
          Image: { Bytes: sourceImageBuffer },
          Attributes: ["ALL"]
        });
        promises.push(client.send(detectCommand));
      }

      const results = await Promise.all(promises);
      const compareResponse = results[0];
      const detectResponse = challengeType ? results[1] : null;

      // Phân tích kết quả LIVENESS (nếu có)
      if (challengeType && detectResponse) {
        if (!detectResponse.FaceDetails || detectResponse.FaceDetails.length === 0) {
           return res.status(400).json({ message: 'Không tìm thấy khuôn mặt nào trong ảnh.' });
        }

        const faceDetail = detectResponse.FaceDetails[0];
        const yaw = faceDetail.Pose?.Yaw || 0; 
        
        if (challengeType === 'look_left' && yaw < 15) {
           return res.status(400).json({ message: 'Chưa xoay mặt sang TRÁI.' });
        }
        if (challengeType === 'look_right' && yaw > -15) {
           return res.status(400).json({ message: 'Chưa xoay mặt sang PHẢI.' });
        }
        if (challengeType === 'look_straight' && (yaw > 15 || yaw < -15)) {
           return res.status(400).json({ message: 'Vui lòng NHÌN THẲNG.' });
        }
        logger.debug({ challengeType, yaw: yaw.toFixed(2) }, '[BACKEND] Liveness Passed');
      }

      // Phân tích kết quả VERIFICATION
      if (!compareResponse.FaceMatches || compareResponse.FaceMatches.length === 0) {
        return res.status(400).json({ message: 'Gương mặt không trùng khớp với hồ sơ.' });
      }

      const match = compareResponse.FaceMatches[0];
      logger.info({ driverId, similarity: match.Similarity?.toFixed(2) }, '[BACKEND] Face match success');

      // Cập nhật trạng thái trực tuyến
      const updatedDriver = await prisma.driver.update({
        where: { id: parseInt(driverId) },
        data: { isOnline: true },
      });
      
      return res.json({ 
        success: true, 
        isOnline: updatedDriver.isOnline, 
        message: 'Xác thực thành công',
        similarity: match.Similarity 
      });

    } catch (awsError) {
      logger.error(awsError, '[AWSRekognition] Error');
      if (awsError.name === 'InvalidParameterException') {
        return res.status(400).json({ message: 'Ảnh chụp bị mờ hoặc không hợp lệ.' });
      }
      return res.status(500).json({ message: 'Lỗi dịch vụ phân tích hình ảnh AI' });
    }
  } catch (error) {
    logger.error(error, 'Error verifying face');
    res.status(500).json({ message: 'Lỗi hệ thống khi phân tích khuôn mặt' });
  }
};
