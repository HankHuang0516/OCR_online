
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const performOCR = async (base64Image: string): Promise<string> => {
  const ai = getAI();
  
  // 修正解析邏輯
  const match = base64Image.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
  const mimeType = match ? match[1] : 'image/jpeg';
  const imageData = match ? match[2] : (base64Image.includes(',') ? base64Image.split(',')[1] : base64Image);

  const imagePart = {
    inlineData: { mimeType, data: imageData },
  };

  const textPart = {
    text: "辨識圖片中的繁體中文文字。只需輸出純文字內容。若無文字回覆「無文字」。"
  };

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: [imagePart, textPart] },
    });
    return response.text?.trim() || "無文字";
  } catch (error) {
    console.error("OCR Error:", error);
    throw new Error("辨識失敗。");
  }
};
