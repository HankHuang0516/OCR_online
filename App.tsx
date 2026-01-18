
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Upload, RefreshCw, Copy, Check, Trash2, History, Scan, Loader2, AlertCircle, CameraOff, Volume2, VolumeX, Settings2, X, Pause, Play, ChevronLeft, Cpu, Sparkles, Zap, Brain } from 'lucide-react';
import { performGeminiOCR, performLocalOCR } from './services/ocrService';
import { AppStatus, ScanResult } from './types';

const SCAN_INTERVAL = 5;

// 簡單的文字相似度演算法 (Jaccard Index)
const calculateSimilarity = (s1: string, s2: string): number => {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const set1 = new Set(s1.split(''));
  const set2 = new Set(s2.split(''));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
};

const App: React.FC = () => {
  const [mode, setMode] = useState<'upload' | 'live'>('live');
  const [ocrModel, setOcrModel] = useState<'gemini' | 'local'>('gemini');
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [resultText, setResultText] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);

  const [latestScan, setLatestScan] = useState<(ScanResult & { isPending?: boolean, isSpeaking?: boolean }) | null>(null);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [countdown, setCountdown] = useState(SCAN_INTERVAL);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isAutoTTS, setIsAutoTTS] = useState(true);
  const [isSmartSpeech, setIsSmartSpeech] = useState(true); // 智慧朗讀開關
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusRef = useRef<AppStatus>(AppStatus.IDLE);
  const isSpeakingRef = useRef(false);
  const currentSpeakingTextRef = useRef<string>('');

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

  const stopAllSpeech = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    currentSpeakingTextRef.current = '';
  };

  const playTTS = (text: string, force: boolean = false) => {
    if (!text || text.includes("正在辨識") || text.includes("辨識失敗") || text === "無文字") return;

    if (isSmartSpeech && isSpeaking && !force) {
      const similarity = calculateSimilarity(text, currentSpeakingTextRef.current);
      if (similarity >= 0.25) return;
    }

    stopAllSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const chineseVoice = voices.find(v => v.lang.includes('zh-TW')) ||
      voices.find(v => v.lang.includes('zh-HK')) ||
      voices.find(v => v.lang.includes('zh-CN'));
    if (chineseVoice) utterance.voice = chineseVoice;
    utterance.rate = speechRate;

    utterance.onstart = () => {
      setIsSpeaking(true);
      currentSpeakingTextRef.current = text;
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      currentSpeakingTextRef.current = '';
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      currentSpeakingTextRef.current = '';
    };
    window.speechSynthesis.speak(utterance);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      if (videoRef.current) { videoRef.current.srcObject = stream; setIsLiveActive(true); }
    } catch (err) { setMode('upload'); }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsLiveActive(false);
  };

  const captureAndProcess = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !isLiveActive || isPaused) return;
    if (statusRef.current === AppStatus.PROCESSING) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.videoWidth === 0) return;

    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 100);

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const tempId = Date.now().toString();

    setStatus(AppStatus.PROCESSING);
    setOcrProgress(0);
    setErrorMsg(null);
    setLatestScan({ id: tempId, timestamp: Date.now(), imageUrl: dataUrl, text: "正在辨識中...", isPending: true });

    try {
      const text = ocrModel === 'gemini'
        ? await performGeminiOCR(dataUrl)
        : await performLocalOCR(dataUrl, (p) => setOcrProgress(p * 100));

      if (!text || text === "無文字" || text.trim().length === 0) {
        setLatestScan(null);
        setResultText('');
        setStatus(AppStatus.IDLE);
        return;
      }
      setLatestScan({ id: tempId, timestamp: Date.now(), imageUrl: dataUrl, text, isPending: false });
      setResultText(text);
      setHistory(prev => [{ id: tempId, timestamp: Date.now(), imageUrl: dataUrl, text }, ...prev.slice(0, 49)]);
      setStatus(AppStatus.SUCCESS);

      if (isAutoTTS) {
        playTTS(text);
      }
    } catch (err: any) {
      console.error("OCR Failure:", err);
      const msg = err.message || "辨識失敗";
      setErrorMsg(msg);
      setLatestScan({ id: tempId, timestamp: Date.now(), imageUrl: dataUrl, text: `辨識失敗: ${msg}`, isPending: false });
      setStatus(AppStatus.ERROR);
      // 發生錯誤時增加下一次掃描的間隔，避免在 API 限制狀態下頻繁重試
      setCountdown(SCAN_INTERVAL + 5);
    }
  }, [isLiveActive, isAutoTTS, isSmartSpeech, isSpeaking, speechRate, isPaused, ocrModel]);

  useEffect(() => {
    let timer: number;
    if (mode === 'live' && isLiveActive && !isPaused) {
      timer = window.setInterval(() => {
        setCountdown(prev => prev <= 1 ? SCAN_INTERVAL : prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [mode, isLiveActive, isPaused]);

  useEffect(() => {
    if (countdown === SCAN_INTERVAL && mode === 'live' && isLiveActive && !isPaused) {
      captureAndProcess();
    }
  }, [countdown, mode, isLiveActive, captureAndProcess, isPaused]);

  useEffect(() => {
    if (mode === 'live') startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [mode]);

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black text-white font-sans overflow-hidden select-none">
      {/* 頂部控制列 */}
      {mode === 'live' && isLiveActive && !showHistory && (
        <div className="absolute top-6 inset-x-0 z-50 flex items-center justify-between px-6 pointer-events-none">
          <div className="flex items-center gap-2 pointer-events-auto">
            <button onClick={() => setMode('upload')} title="上傳照片" className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white/80 hover:bg-white/20">
              <Upload size={18} />
            </button>
            <button onClick={() => setShowHistory(true)} title="掃描歷史" className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white/80 hover:bg-white/20">
              <History size={18} />
            </button>
            <button onClick={() => setShowSettings(true)} title="設定" className="w-10 h-10 bg-black/40 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white/80 hover:bg-white/20">
              <Settings2 size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md p-1.5 rounded-full border border-white/10 pointer-events-auto shadow-2xl">
            <button
              onClick={() => { setOcrModel(ocrModel === 'gemini' ? 'local' : 'gemini'); setErrorMsg(null); }}
              title={ocrModel === 'gemini' ? "當前：AI (Gemini)" : "當前：本地 (Tesseract)"}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${ocrModel === 'gemini' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-700 text-slate-300'}`}
            >
              {ocrModel === 'gemini' ? <Sparkles size={12} /> : <Cpu size={12} />}
              {ocrModel === 'gemini' ? 'AI' : 'Local'}
            </button>

            <div className="w-[1px] h-4 bg-white/10" />

            <button
              onClick={() => setIsSmartSpeech(!isSmartSpeech)}
              title={isSmartSpeech ? "智慧朗讀：開啟" : "智慧朗讀：關閉"}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${isSmartSpeech ? 'text-blue-400 bg-blue-500/10' : 'text-white/40'}`}
            >
              <Brain size={16} />
            </button>

            <button onClick={() => setIsPaused(!isPaused)} title={isPaused ? "恢復掃描" : "暫停掃描"} className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${isPaused ? 'bg-red-500 text-white' : 'text-white/80 hover:bg-white/10'}`}>
              {isPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
            </button>

            <div className="w-[1px] h-4 bg-white/10" />

            <div className="flex items-center gap-2 px-1">
              <input type="range" min="0.5" max="2" step="0.1" value={speechRate} onChange={(e) => setSpeechRate(parseFloat(e.target.value))} className="w-10 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer" />
            </div>

            <button onClick={() => setIsAutoTTS(!isAutoTTS)} title={isAutoTTS ? "自動朗讀：開啟" : "自動朗讀：關閉"} className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${isAutoTTS ? 'text-amber-400' : 'text-white/40'}`}>
              {isAutoTTS ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
        </div>
      )}

      {/* 設定面板 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-slate-900 rounded-3xl border border-white/10 p-8 max-w-lg w-full shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black flex items-center gap-2"><Settings2 size={24} className="text-blue-500" /> 設定</h2>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-white/60 mb-2">Gemini API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="貼上您的 API Key..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20"
                />
                <button
                  onClick={() => { localStorage.setItem('gemini_api_key', apiKey); setErrorMsg(null); setShowSettings(false); }}
                  className="mt-3 w-full bg-blue-600 hover:bg-blue-700 py-3 rounded-xl font-black transition-all"
                >
                  儲存 API Key
                </button>
              </div>

              <div className="border-t border-white/10 pt-6">
                <h3 className="text-sm font-black text-white/80 mb-3">📖 如何取得 Gemini API Key？</h3>
                <ol className="text-sm text-white/60 space-y-2 list-decimal list-inside">
                  <li>前往 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">Google AI Studio</a></li>
                  <li>使用 Google 帳號登入</li>
                  <li>點擊「Create API key」按鈕</li>
                  <li>複製產生的 API Key 並貼到上方欄位</li>
                </ol>
                <p className="mt-4 text-xs text-white/40">💡 小提示：API Key 會儲存在您的瀏覽器中，不會被上傳至任何伺服器。</p>
              </div>

              {apiKey && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 flex items-center gap-3">
                  <Check size={20} className="text-green-500" />
                  <span className="text-sm text-green-400 font-bold">API Key 已設定</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 主要內容區 */}
      <main className="w-full h-full relative">
        {showHistory ? (
          <div className="absolute inset-0 bg-slate-950 text-white z-[100] overflow-y-auto p-6">
            <HistoryView history={history} setHistory={setHistory} onClose={() => setShowHistory(false)} onSelect={(item) => {
              setImage(item.imageUrl);
              setResultText(item.text);
              setErrorMsg(null);
              setStatus(AppStatus.SUCCESS);
              setMode('upload');
              setShowHistory(false);
            }} />
          </div>
        ) : mode === 'live' ? (
          <div className="w-full h-full relative">
            <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            {isFlashing && <div className="absolute inset-0 bg-white/40 z-10 animate-out fade-out duration-100" />}

            {!isLiveActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 p-8">
                <div className="w-20 h-20 bg-blue-600/20 rounded-3xl flex items-center justify-center text-blue-500 mb-6 border border-blue-500/20"><Scan size={40} /></div>
                <h2 className="text-xl font-black mb-6 tracking-widest uppercase">繁中 OCR 助手</h2>
                <button onClick={startCamera} className="bg-blue-600 px-10 py-4 rounded-full font-black shadow-2xl active:scale-95">啟動辨識鏡頭</button>
              </div>
            )}

            <div className="absolute bottom-8 right-8 z-20 flex items-center gap-4">
              {latestScan && !latestScan.isPending && (
                <div className="w-16 h-16 rounded-2xl border-2 border-white/20 shadow-2xl overflow-hidden ring-4 ring-black/20 animate-in slide-in-from-right duration-500">
                  <img src={latestScan.imageUrl} className="w-full h-full object-cover" />
                </div>
              )}
              <div className={`bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-3 flex items-center gap-3 shadow-2xl transition-all ${isPaused ? 'opacity-40 grayscale' : 'opacity-100'}`}>
                <div className="relative w-8 h-8 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-white/10" />
                    <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="3" fill="transparent" className={`${isPaused ? 'text-white/30' : 'text-blue-500'} transition-all duration-1000`} strokeDasharray={88} strokeDashoffset={88 * (1 - countdown / (status === AppStatus.ERROR ? SCAN_INTERVAL + 5 : SCAN_INTERVAL))} />
                  </svg>
                  <span className="absolute text-[10px] font-mono font-black">{isPaused ? '--' : countdown}</span>
                </div>
              </div>
            </div>

            {/* 文字疊加層 */}
            {(resultText || status === AppStatus.PROCESSING || errorMsg) && (
              <div className="absolute inset-x-0 bottom-[15%] flex items-center justify-center p-6 pointer-events-none">
                <div className={`max-w-xl w-full bg-black/60 backdrop-blur-md border ${errorMsg ? 'border-red-500/30' : 'border-white/10'} rounded-3xl p-6 shadow-2xl pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-500`}>
                  <div className="flex justify-between items-center mb-3 text-white/50 border-b border-white/5 pb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-amber-400' : errorMsg ? 'bg-red-500' : 'bg-blue-500'} animate-pulse`} />
                      <span className="text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
                        {isSpeaking ? (
                          <>正在朗讀 {isSmartSpeech && <Brain size={10} className="text-blue-400" />}</>
                        ) : status === AppStatus.PROCESSING ? `${ocrModel === 'gemini' ? 'AI' : 'Local'} 分析中` : errorMsg ? '辨識失敗' : '辨識結果'}
                      </span>
                    </div>
                    <div className="flex gap-4">
                      {resultText && <button onClick={() => playTTS(resultText, true)} title="強制重新播放" className={`hover:text-amber-400 transition-colors ${isSpeaking ? 'text-amber-400' : ''}`}><Volume2 size={16} /></button>}
                      <button onClick={() => { setResultText(''); setErrorMsg(null); setLatestScan(null); stopAllSpeech(); }} className="hover:text-red-400 transition-colors"><X size={16} /></button>
                    </div>
                  </div>

                  {status === AppStatus.PROCESSING && (
                    <div className="w-full h-1 bg-white/10 rounded-full mb-4 overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: ocrModel === 'local' ? `${ocrProgress}%` : '50%' }} />
                    </div>
                  )}

                  <div className="max-h-[30vh] overflow-y-auto custom-scrollbar">
                    {status === AppStatus.PROCESSING && !resultText ? (
                      <div className="flex items-center gap-3 py-4 opacity-40">
                        <Loader2 className="animate-spin" size={16} />
                        <span className="text-xs font-bold">
                          {ocrModel === 'local'
                            ? (ocrProgress < 10 ? '優化影像畫質中...' : `分析文字中... ${Math.round(ocrProgress)}%`)
                            : 'AI 雲端分析中...'}
                        </span>
                      </div>
                    ) : errorMsg ? (
                      <div className="flex items-start gap-3 py-2 text-red-400/90">
                        <AlertCircle size={18} className="mt-1 flex-shrink-0" />
                        <p className="text-sm font-bold leading-relaxed">{errorMsg}</p>
                      </div>
                    ) : (
                      <p className={`text-lg md:text-xl font-bold leading-relaxed tracking-tight text-white/95 whitespace-pre-wrap ${isSpeaking ? 'text-amber-50' : ''}`}>
                        {resultText}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-8 overflow-y-auto">
            <button onClick={() => setMode('live')} className="absolute top-6 left-6 flex items-center gap-2 text-white/60 hover:text-white transition-colors font-bold text-sm">
              <ChevronLeft size={20} /> 返回即時辨識
            </button>
            {!image ? (
              <div onClick={() => fileInputRef.current?.click()} className="w-full max-w-lg border-2 border-dashed border-white/20 rounded-[2.5rem] p-16 bg-white/5 flex flex-col items-center justify-center transition-all hover:bg-white/10 group cursor-pointer">
                <div className="w-16 h-16 bg-blue-600/20 rounded-2xl flex items-center justify-center text-blue-500 mb-6 group-hover:scale-110 transition-transform"><Upload size={32} /></div>
                <h2 className="text-xl font-black mb-2 tracking-tight">點擊上傳照片</h2>
                <p className="text-white/40 text-xs font-bold">支援所有圖片格式進行 OCR 辨識</p>
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = () => { setImage(reader.result as string); setResultText(''); setErrorMsg(null); setStatus(AppStatus.IDLE); };
                    reader.readAsDataURL(file);
                  }
                }} />
              </div>
            ) : (
              <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                <div className="relative group">
                  <img src={image} className="w-full rounded-3xl border border-white/10 shadow-2xl max-h-[60vh] object-contain bg-black/40" />
                  <button onClick={() => { setImage(null); setResultText(''); setErrorMsg(null); }} className="absolute top-4 right-4 bg-red-500/80 text-white p-2 rounded-full hover:bg-red-600 shadow-xl transition-all active:scale-95"><Trash2 size={18} /></button>
                </div>
                <div className="bg-white/5 p-8 rounded-3xl border border-white/10 min-h-[400px] flex flex-col">
                  <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/5">
                    <span className="text-[10px] font-black uppercase text-white/40 tracking-widest">分析結果 ({ocrModel})</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setOcrModel(ocrModel === 'gemini' ? 'local' : 'gemini'); setErrorMsg(null); }} className="text-[10px] font-black bg-white/5 px-3 py-1.5 rounded-full hover:bg-white/10 transition-colors border border-white/10">切換模型</button>
                      {resultText && <button onClick={() => copyToClipboard(resultText)} className="text-[10px] font-black text-blue-400 bg-blue-500/10 px-3 py-1.5 rounded-full border border-blue-500/10">{copied ? '已複製' : '複製文字'}</button>}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {status === AppStatus.PROCESSING ? (
                      <div className="flex flex-col items-center justify-center py-20 gap-3">
                        <Loader2 className="animate-spin text-blue-500 opacity-60" size={32} />
                        <span className="text-[10px] opacity-40 uppercase font-black tracking-widest">正在分析內容</span>
                      </div>
                    ) : errorMsg ? (
                      <div className="flex flex-col items-center justify-center py-20 text-red-400 gap-4">
                        <AlertCircle size={40} className="opacity-40" />
                        <p className="text-sm font-bold text-center">{errorMsg}</p>
                      </div>
                    ) : (
                      <p className="text-lg font-bold whitespace-pre-wrap leading-relaxed">{resultText || "尚未開始分析..."}</p>
                    )}
                  </div>
                  {!resultText && status !== AppStatus.PROCESSING && (
                    <button onClick={async () => {
                      setStatus(AppStatus.PROCESSING);
                      setErrorMsg(null);
                      try {
                        const text = ocrModel === 'gemini' ? await performGeminiOCR(image) : await performLocalOCR(image);
                        setResultText(text); setStatus(AppStatus.SUCCESS); playTTS(text, true);
                      } catch (err: any) {
                        setErrorMsg(err.message || "分析失敗");
                        setStatus(AppStatus.ERROR);
                      }
                    }} className="mt-6 w-full bg-blue-600 hover:bg-blue-700 py-4 rounded-2xl font-black shadow-xl shadow-blue-600/20 transition-all active:scale-[0.98]">執行 OCR 辨識</button>
                  )}
                  {resultText && (
                    <button onClick={() => playTTS(resultText, true)} className={`mt-6 w-full py-4 rounded-2xl font-black border border-white/10 hover:bg-white/5 transition-all flex items-center justify-center gap-2 ${isSpeaking ? 'text-amber-400 border-amber-500/20 bg-amber-500/5' : ''}`}>
                      <Volume2 size={20} /> {isSpeaking ? '停止朗讀' : '朗讀結果'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        input[type='range'] { -webkit-appearance: none; background: transparent; }
        input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; height: 12px; width: 12px; border-radius: 50%; background: #3b82f6; cursor: pointer; border: 2px solid white; }
      `}</style>
    </div>
  );
};

const HistoryView: React.FC<{ history: ScanResult[], setHistory: any, onClose: any, onSelect: any }> = ({ history, setHistory, onClose, onSelect }) => (
  <div className="space-y-8 max-w-4xl mx-auto py-10">
    <div className="flex items-center justify-between border-b border-white/10 pb-6">
      <div className="flex items-center gap-4"><History className="text-blue-500" size={32} /><h2 className="text-2xl font-black tracking-tight">掃描歷史</h2></div>
      <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white/60 transition-colors"><X size={24} /></button>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {history.length === 0 ? (
        <div className="col-span-full py-40 text-center opacity-20 font-black uppercase tracking-widest">目前尚無歷史紀錄</div>
      ) : (
        history.map((item) => (
          <div key={item.id} className="bg-white/5 p-4 rounded-3xl border border-white/5 flex gap-4 hover:border-blue-500/50 cursor-pointer transition-all group" onClick={() => onSelect(item)}>
            <img src={item.imageUrl} className="w-20 h-20 object-cover rounded-2xl shadow-lg" />
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <span className="text-[9px] font-black text-white/30 mb-1">{new Date(item.timestamp).toLocaleString()}</span>
              <p className="font-bold text-sm line-clamp-2 leading-tight">{item.text}</p>
              <button
                onClick={(e) => { e.stopPropagation(); setHistory(history.filter(h => h.id !== item.id)); }}
                className="mt-2 text-[10px] text-red-400/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity self-start"
              >
                刪除這筆
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);

export default App;
