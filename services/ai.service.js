import Groq from "groq-sdk";
import logger from '../lib/logger.js';

/**
 * Service to handle Groq cloud for question generation.
 */
class AIService {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    if (this.apiKey) {
      this.groq = new Groq({ apiKey: this.apiKey });
      // Llama 3 models on Groq
      this.availableModels = [
          "llama-3.3-70b-versatile",
          "llama-3.1-8b-instant"
      ];
    } else {
      logger.warn("GROQ_API_KEY is not defined in environment variables. AI features won't work.");
    }
  }

  async generateQuestions(moduleData, counts, examples = []) {
    if (!this.groq) {
      throw new Error("AI Setup Incomplete: Missing GROQ_API_KEY in .env");
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

ĐỊNH DẠNG TRẢ VỀ: Trả về một đối tượng JSON có thuộc tính "questions" là một mảng các đối tượng:
{
  "questions": [
    {
      "questionText": string,
      "options": string[4],
      "correctAnswerIndex": number (0-3),
      "difficulty": "EASY" | "MEDIUM" | "HARD"
    }
  ]
}`;

    const userPrompt = `Hãy tạo ${totalCount} câu hỏi mới cho Module: "${moduleData.name}".
Mô tả: ${moduleData.description || 'N/A'}
Nội dung bài học:
${contentContext}

Yêu cầu phân bổ: ${easyCount} Dễ (EASY), ${mediumCount} Trung bình (MEDIUM), ${hardCount} Khó (HARD).
${exampleBlock}`;

    let lastError;
    for (const modelName of this.availableModels) {
        try {
            logger.info(`Đang thử sinh câu hỏi bằng Groq model: ${modelName}`);
            const completion = await this.groq.chat.completions.create({
                messages: [
                    { role: "system", content: systemInstruction },
                    { role: "user", content: userPrompt }
                ],
                model: modelName,
                temperature: 0.3,
                max_tokens: 4096,
                response_format: { type: "json_object" }
            });

            const responseText = completion.choices[0]?.message?.content;
            if (!responseText) throw new Error("AI không trả về nội dung.");

            try {
                const parsedData = JSON.parse(responseText.trim());
                const questions = Array.isArray(parsedData) ? parsedData : (parsedData.questions || []);
                
                logger.info(`Đã sinh ${questions.length} câu hỏi thành công bằng model: ${modelName}`);
                return questions;
            } catch (pError) {
                logger.error(`Lỗi parse JSON từ Groq (${modelName}): ${pError.message}`);
                throw new Error("Dữ liệu AI trả về bị lỗi định dạng JSON.");
            }

        } catch (error) {
            lastError = error;
            logger.warn(`Model Groq ${modelName} thất bại: ${error.message}`);
            // Nếu lỗi 429 hoặc lỗi service thì thử model tiếp theo
            if (error.message.includes('429') || error.message.includes('500') || error.message.includes('503')) continue; 
            break;
        }
    }

    throw new Error(lastError?.message || 'Lỗi sinh câu hỏi AI bằng Groq');
  }
}

export default new AIService();
