import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';
import { getConfig } from '../services/config.service.js';
import { RekognitionClient, CompareFacesCommand, DetectFacesCommand } from "@aws-sdk/client-rekognition";

export const findNearbyDrivers = async (req, res) => {
  const { lat, lng, radius = 5 } = req.query; // Radius mặc định 5km
  console.log(`[BACKEND] Finding nearby drivers at: lat=${lat}, lng=${lng}, radius=${radius}`);

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
    console.error('Error finding nearby drivers:', error);
    res.status(500).json({ message: 'Lỗi server khi tìm tài xế' });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { isOnline } = req.body;
    console.log(`[BACKEND] Received updateStatus request: driverId=${driverId}, isOnline=${isOnline}`);

    const driver = await prisma.driver.update({

      where: { id: parseInt(driverId) },
      data: { isOnline: !!isOnline },
    });

    res.json({ success: true, isOnline: driver.isOnline });
  } catch (error) {
    console.error('Error updating driver status:', error);
    res.status(500).json({ message: 'Lỗi khi cập nhật trạng thái' });
  }
};

export const verifyFace = async (req, res) => {
  try {
    const { driverId } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ message: 'Vui lòng đưa khuôn mặt vào khung ảnh' });
    }

    console.log(`[BACKEND] Verify face online for driverId=${driverId}`);

    // If AWS credentials don't exist in env, we will mock success to unblock UX and layout tests
    if (!process.env.AWS_ACCESS_KEY_ID) {
      console.warn('[BACKEND] AWS credentials not found. Mocking successful face verification.');
      
      // Giả lập thời gian load giống AI xử lý
      await new Promise(resolve => setTimeout(resolve, 1500));
      
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
      // 1. Tải ảnh gốc (Master Image) từ URL và chuyển thành Buffer
      const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 8080}`;
      const imageUrl = driver.avatarUrl.startsWith('http') 
          ? driver.avatarUrl 
          : `${baseUrl}${driver.avatarUrl.startsWith('/') ? '' : '/'}${driver.avatarUrl}`;
          
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
         throw new Error('Không thể fetch ảnh gốc từ máy chủ lưu trữ');
      }
      
      const arrayBuffer = await imageResponse.arrayBuffer();
      const targetImageBuffer = Buffer.from(arrayBuffer);
      const sourceImageBuffer = req.file.buffer;
      const challengeType = req.body.challengeType; // 'smile' or 'neutral'

      // ============================================
      // BƯỚC 1: LIVENESS CHECK (Chống ảnh tĩnh 2D)
      // Sử dụng DetectFacesCommand để đọc sắc thái
      // ============================================
      if (challengeType) {
        console.log(`[BACKEND] Vefifying Liveness: Lệnh yêu cầu [${challengeType}]`);
        const detectCommand = new DetectFacesCommand({
          Image: { Bytes: sourceImageBuffer },
          Attributes: ["ALL"] // Yêu cầu trả về chi tiết cảm xúc (Smile, EyesOpen...)
        });

        const detectResponse = await client.send(detectCommand);
        
        if (!detectResponse.FaceDetails || detectResponse.FaceDetails.length === 0) {
           return res.status(400).json({ message: 'Không tìm thấy khuôn mặt nào trong khung ảnh để kiểm tra.' });
        }

        const faceDetail = detectResponse.FaceDetails[0];
        const pose = faceDetail.Pose;
        const yaw = pose?.Yaw || 0; 

        // Theo chuẩn AWS Rekognition: 
        // Yaw > 15: Xoay mặt sang TRÁI (Looking Left)
        // Yaw < -15: Xoay mặt sang PHẢI (Looking Right)
        console.log(`[BACKEND] Liveness Result: Yaw=${yaw.toFixed(2)} độ`);

        // Đánh giá dựa trên yêu cầu ngẫu nhiên
        if (challengeType === 'look_left' && yaw < 15) {
           return res.status(400).json({ message: 'Liveness thất bại: Yêu cầu XOAY MẶT SANG TRÁI nhưng ảnh đang nhìn thẳng hoặc xoay phải.' });
        }
        
        if (challengeType === 'look_right' && yaw > -15) {
           return res.status(400).json({ message: 'Liveness thất bại: Yêu cầu XOAY MẶT SANG PHẢI nhưng ảnh đang nhìn thẳng hoặc xoay trái.' });
        }

        if (challengeType === 'look_straight' && (yaw > 15 || yaw < -15)) {
           return res.status(400).json({ message: 'Liveness thất bại: Yêu cầu NHÌN THẲNG nhưng ảnh đang bị xoay mặt.' });
        }

        console.log(`[BACKEND] Liveness Passed: Tài xế đã làm đúng challenge.`);
      }

      // ============================================
      // BƯỚC 2: VERIFICATION (So khớp nhân dạng)
      // ============================================
      const command = new CompareFacesCommand({
        SourceImage: { Bytes: sourceImageBuffer },
        TargetImage: { Bytes: targetImageBuffer },
        SimilarityThreshold: 85 // Ngưỡng giống nhau yêu cầu đạt 85%
      });

      const response = await client.send(command);

      // 3. Phân tích kết quả
      if (!response.FaceMatches || response.FaceMatches.length === 0) {
        return res.status(400).json({ message: 'Nhận diện thất bại: Gương mặt không trùng khớp với hồ sơ.' });
      }

      const match = response.FaceMatches[0];
      console.log(`[BACKEND] Face match success! Similarity: ${match.Similarity?.toFixed(2)}%`);

      // Cập nhật trạng thái trực tuyến nếu thành công
      const updatedDriver = await prisma.driver.update({
        where: { id: parseInt(driverId) },
        data: { isOnline: true },
      });
      
      return res.json({ 
        success: true, 
        isOnline: updatedDriver.isOnline, 
        message: 'Xác thực khuôn mặt thành công',
        similarity: match.Similarity 
      });

    } catch (awsError) {
      console.error('[AWSRekognition] Error:', awsError);
      
      if (awsError.name === 'InvalidParameterException') {
        return res.status(400).json({ message: 'Ảnh chụp bị mờ hoặc không tìm thấy khuôn mặt rõ ràng nào để đối chiếu.' });
      }
      
      return res.status(500).json({ message: 'Lỗi dịch vụ phân tích hình ảnh AI' });
    }

  } catch (error) {
    console.error('Error verifying face:', error);
    res.status(500).json({ message: 'Lỗi hệ thống khi phân tích khuôn mặt' });
  }
};
