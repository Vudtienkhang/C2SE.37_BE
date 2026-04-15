import { GoogleGenerativeAI } from "@google/generative-ai";
import logger from '../lib/logger.js';

/**
 * Service to handle Google Generative AI for question generation.
 */
class AIService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (this.apiKey) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      // Sử dụng Gemini 2.5/2.0 Flash - các mẫu mới nhất khả dụng trong môi trường của bạn
      this.availableModels = [
          "gemini-2.5-flash", 
          "gemini-2.0-flash"
      ];
    } else {
      logger.warn("GEMINI_API_KEY is not defined in environment variables. AI features won't work.");
    }
  }

  async generateQuestions(moduleData, counts, examples = []) {
    if (!this.genAI) {
      throw new Error("AI Setup Incomplete: Missing GEMINI_API_KEY in .env");
    }

    const { easyCount = 0, mediumCount = 0, hardCount = 0 } = counts;
    const totalCount = easyCount + mediumCount + hardCount;
    if (totalCount === 0) return [];

    const contentContext = moduleData.contents?.map(c => `- ${c.type}: ${c.title}`).join('\n') || 'Không có nội dung bài học cụ thể.';
    const exampleBlock = examples.length > 0 
      ? `Dưới đây là một số CÂU HỎI MẪU để tham khảo văn phong:\n${examples.map((e, i) => 
          `Ví dụ ${i+1}: Q: ${e.questionText} | Options: [${e.options.join(', ')}] | CorrectIndex: ${e.correctAnswerIndex} | Difficulty: ${e.difficulty}`
        ).join('\n')}`
      : 'Hiện chưa có câu hỏi mẫu, hãy tự sáng tạo.';

    const systemInstruction = `Bạn là chuyên gia ra đề thi trắc nghiệm tại "Học viện Tài xế".
Nhiệm vụ: Tạo đúng số lượng câu hỏi trắc nghiệm dưới dạng JSON.
Đối tượng: Tài xế xe máy/ô tô công nghệ.
Phong cách: Thực tế, chuyên nghiệp, sát với quy trình vận hành và an toàn giao thông.

ĐỊNH DẠNG TRẢ VỀ: Một mảng các đối tượng JSON có cấu trúc:
{
  "questionText": string,
  "options": string[4],
  "correctAnswerIndex": number (0-3),
  "difficulty": "EASY" | "MEDIUM" | "HARD"
}`;

    const userPrompt = `Hãy tạo ${totalCount} câu hỏi mới cho Module: "${moduleData.name}".
Mô tả: ${moduleData.description || 'N/A'}
Nội dung bài học:
${contentContext}

Yêu cầu phân bổ: ${easyCount} Dễ, ${mediumCount} Trung bình, ${hardCount} Khó.
${exampleBlock}`;

    let lastError;
    for (const modelName of this.availableModels) {
        try {
            const model = this.genAI.getGenerativeModel({ 
                model: modelName,
                systemInstruction: systemInstruction 
            });

            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: userPrompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.2, 
                    maxOutputTokens: 4096, // Tăng giới hạn để tránh bị cắt cụt JSON
                }
            });

            let responseText = result.response.text();
            
            // Xử lý trường hợp AI trả về markdown code block dù đã set JSON mode
            if (responseText.includes('```json')) {
                responseText = responseText.split('```json')[1].split('```')[0].trim();
            } else if (responseText.includes('```')) {
                responseText = responseText.split('```')[1].split('```')[0].trim();
            }

            try {
                const parsedData = JSON.parse(responseText.trim());
                logger.info(`Đã sinh câu hỏi thành công bằng model: ${modelName} (JSON Mode)`);
                return Array.isArray(parsedData) ? parsedData : (parsedData.questions || []);
            } catch (pError) {
                logger.error(`Lỗi parse JSON từ AI (${modelName}): ${pError.message}`);
                logger.debug(`Nội dung lỗi: ${responseText}`);
                throw new Error("Dữ liệu AI trả về bị lỗi định dạng. Vui lòng thử lại.");
            }

        } catch (error) {
            lastError = error;
            logger.warn(`Model ${modelName} thất bại: ${error.message}`);
            if (error.message.includes('429')) continue; 
            if (!error.message.includes('503')) break;
        }
    }

    throw new Error(lastError?.message || 'Lỗi sinh câu hỏi AI');
  }
}

export default new AIService();
