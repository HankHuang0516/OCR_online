
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import Tesseract from 'tesseract.js';

const getAI = () => {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) throw new Error("API Key 未設定");
  return new GoogleGenAI({ apiKey });
};

/**
 * 清理 OCR 產生的雜訊文字
 * 1. 過濾 Tesseract 常見的幻覺符號 (如 | \ _ ~ ^ `)
 * 2. 移除中文字之間夾雜的無意義單個符號
 * 3. 規範化空白與換行
 */
const cleanOcrText = (text: string): string => {
  if (!text) return "";

  // 1. 移除常見的 OCR 雜訊字元
  let cleaned = text.replace(/[|\\_~^`]/g, '');

  // 2. 處理中文字之間穿插的無意義符號 (例如: "這 $ 是一 $ 個" -> "這是一個")
  // 匹配：(中文字)(非中文非英文非數字的單一符號)(中文字)
  // 並將中間的符號移除
  const chineseCharPattern = /[\u4e00-\u9fa5]/;
  const chars = cleaned.split('');
  const result: string[] = [];

  for (let i = 0; i < chars.length; i++) {
    const prev = chars[i - 1];
    const curr = chars[i];
    const next = chars[i + 1];

    // 如果當前是特殊符號，且前後都是中文，則考慮過濾
    const isSpecialSymbol = /[^\u4e00-\u9fa5a-zA-Z0-9\s，。！?？：；（）「」『』]/.test(curr);
    if (isSpecialSymbol && prev && next && chineseCharPattern.test(prev) && chineseCharPattern.test(next)) {
      continue; // 跳過此雜訊符號
    }
    result.push(curr);
  }

  cleaned = result.join('');

  // 3. 移除連續重複的標點符號 (如 !!!!!!! -> !)
  cleaned = cleaned.replace(/([!！?？,，.。])\1+/g, '$1');

  // 4. 清理多餘空白
  cleaned = cleaned.replace(/[ ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();

  return cleaned;
};

// 影像預處理：提升 Tesseract 辨識率，並確保輸出格式正確
const preprocessImage = (base64Image: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (img.width === 0 || img.height === 0) {
        resolve(base64Image);
        return;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(base64Image);
        return;
      }

      // 限制最大尺寸以優化辨識速度與避免內存問題
      const maxDim = 1600;
      let width = img.width;
      let height = img.height;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (maxDim / width) * height;
          width = maxDim;
        } else {
          width = (maxDim / height) * width;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // 影像優化：轉灰階 + 簡單二值化效果
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        // 增強對比：低於 128 的變更黑，高於 128 的變更白
        const color = avg < 120 ? Math.max(0, avg - 40) : Math.min(255, avg + 40);
        
        data[i] = color;
        data[i + 1] = color;
        data[i + 2] = color;
      }

      ctx.putImageData(imageData, 0, 0);
      const finalDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      
      // 確保不是無效的 data URL
      if (finalDataUrl === "data:," || finalDataUrl.length < 100) {
        resolve(base64Image);
      } else {
        resolve(finalDataUrl);
      }
    };
    img.onerror = () => resolve(base64Image);
    img.src = base64Image;
  });
};

// Gemini AI OCR
export const performGeminiOCR = async (base64Image: string): Promise<string> => {
  try {
    const ai = getAI();
    
    // 使用 Regex 安全地提取 MIME 類型與 Base64 數據
    const base64Regex = /^data:(image\/\w+);base64,(.+)$/;
    const matches = base64Image.match(base64Regex);
    
    let mimeType = 'image/jpeg';
    let imageData = '';

    if (matches && matches.length === 3) {
      mimeType = matches[1];
      imageData = matches[2];
    } else if (base64Image.includes(',')) {
      imageData = base64Image.split(',')[1];
    } else {
      imageData = base64Image;
    }

    if (!imageData || imageData.length < 10) {
      throw new Error("影像數據格式錯誤，請重新拍攝。");
    }

    const imagePart = {
      inlineData: { mimeType, data: imageData },
    };

    const textPart = {
      text: "辨識圖片中的繁體中文文字。只需輸出純文字內容，保持段落。若無文字則回覆「無文字」。"
    };

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: { parts: [imagePart, textPart] },
    });

    return response.text?.trim() || "無文字";
  } catch (error: any) {
    console.error("Gemini OCR Error:", error);
    if (error.message?.includes('429')) {
      throw new Error("API 請求頻率達到限制 (免費版)，請稍等幾秒後重試。");
    }
    if (error.message?.includes('INVALID_ARGUMENT') || error.message?.includes('MIME type')) {
      throw new Error("影像格式不相容或數據受損，請嘗試重新拍照。");
    }
    throw new Error(`AI 辨識異常: ${error.message || '未知錯誤'}`);
  }
};

// Tesseract.js 本地 OCR
export const performLocalOCR = async (base64Image: string, onProgress?: (p: number) => void): Promise<string> => {
  try {
    const processedImage = await preprocessImage(base64Image);
    
    const { data: { text } } = await Tesseract.recognize(
      processedImage,
      'chi_tra+eng',
      {
        logger: m => {
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(m.progress);
          }
        }
      }
    );
    
    // 執行強化清理邏輯
    const cleanedText = cleanOcrText(text);
    return cleanedText.length > 0 ? cleanedText : "無文字";
  } catch (error: any) {
    console.error("Local OCR Error:", error);
    throw new Error(`本地辨識失敗: ${error.message || '引擎未響應'}`);
  }
};
