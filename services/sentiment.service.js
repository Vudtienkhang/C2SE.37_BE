import { spawn } from 'child_process';

/**
 * Phân tích cảm xúc của bình luận bằng mô hình PhoBERT (Python) chuyên biệt cho Taxi/Lái hộ
 * @param {string} text - Nội dung bình luận
 * @returns {Promise<Object>} - Kết quả { label, score }
 */
export const analyzeSentiment = (text) => {
  return new Promise((resolve, reject) => {
    const pythonScript = 'd:/Desktop/TrainAI/sentiment-local/infer_demo.py';
    const pythonDir = 'd:/Desktop/TrainAI/sentiment-local';
    
    // Thử dùng 'python' hoặc 'py' (Windows thường có cả hai)
    const pythonExe = 'python'; 

    console.log(`[AI-Service] Starting Python for: "${text.substring(0, 30)}..."`);
    
    // Sử dụng environment variable để ép Python dùng UTF-8
    const pyProcess = spawn(pythonExe, [pythonScript, text], { 
      cwd: pythonDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let result = '';
    let errorOutput = '';

    pyProcess.stdout.on('data', (data) => {
      result += data.toString();
    });

    pyProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    pyProcess.on('error', (err) => {
      console.error(`[AI-Service] Failed to start python: ${err.message}`);
      resolve({ label: 'Lỗi khởi động Python', score: 0 });
    });

    pyProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`[AI-Service] Error (Code ${code}): ${errorOutput}`);
        return resolve({ label: 'Lỗi AI', score: 0 });
      }
      
      try {
        // Làm sạch output (xóa các ký tự thừa)
        const cleanOutput = result.trim();
        const jsonMatch = cleanOutput.match(/\{.*\}/); // Tìm chuỗi JSON trong output
        
        if (jsonMatch) {
          const parsedResult = JSON.parse(jsonMatch[0]);
          console.log(`[AI-Service] Success: ${parsedResult.label}`);
          resolve(parsedResult);
        } else {
          console.warn(`[AI-Service] No JSON in output: ${cleanOutput}`);
          // Nếu không thấy JSON nhưng có chữ, thử lấy dòng cuối cùng làm nhãn dự phòng
          resolve({ label: 'N/A', score: 0 });
        }
      } catch (e) {
        console.error(`[AI-Service] JSON Parse Error: ${e.message}. Raw: ${result}`);
        resolve({ label: 'Lỗi xử lý', score: 0 });
      }
    });
  });
};
