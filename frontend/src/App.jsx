import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, CheckCircle2, Upload, Copy, Check, Globe, Plus, Trash2, LogOut, History, LayoutDashboard } from 'lucide-react';
import Auth from './Auth';

function App() {
  const [user, setUser] = useState(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [viewMode, setViewMode] = useState('dashboard');
  const [historyMeetings, setHistoryMeetings] = useState([]);

  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("Initializing pipeline...");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [todos, setTodos] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || localStorage.getItem('APPS_SCRIPT_URL');
  const FASTAPI_URL = import.meta.env.VITE_FASTAPI_URL || "http://localhost:8000";

  // Auth Listener (Local Storage)
  useEffect(() => {
    const storedUser = localStorage.getItem("meeting_user");
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setIsAuthChecking(false);
  }, []);

  // Timer Effect
  useEffect(() => {
    let interval;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const fetchHistory = async (force = false) => {
    if (!APPS_SCRIPT_URL || !user) return;
    if (!force && historyLoaded) return; // Use cache, skip re-fetch
    setIsHistoryLoading(true);
    try {
       const response = await fetch(`${APPS_SCRIPT_URL}?action=getUserMeetings&userId=${encodeURIComponent(user.userId)}&t=${Date.now()}`, {
         cache: "no-store"
       });
       const data = await response.json();
       if (data.success) {
         setHistoryMeetings(data.meetings || []);
         setHistoryLoaded(true);
       }
    } catch(err) {
       console.error("Error fetching history", err);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  // Pre-fetch history silently in background right after user logs in
  useEffect(() => {
    if (user && APPS_SCRIPT_URL) fetchHistory();
  }, [user]);

  useEffect(() => {
    if (viewMode === 'history' && user) fetchHistory();
  }, [viewMode, user]);

  const formatTimer = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleTodoToggle = (id) => setTodos(todos.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  const handleTodoEdit = (id, field, value) => setTodos(todos.map(t => t.id === id ? { ...t, [field]: value } : t));
  const handleTodoDelete = (id) => setTodos(todos.filter(t => t.id !== id));
  const handleAddTodo = () => setTodos([...todos, { id: crypto.randomUUID(), assignee: "", task: "", completed: false }]);

  const handleSaveChanges = async () => {
    if (!result || !result.id) return;
    setIsSaving(true);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
           action: "updateMeeting",
           meetingId: result.id,
           title: meetingTitle,
           action_items: todos
        })
      });
      const data = await response.json();
      if (!data.success) throw new Error("Failed to save");
      
      // Update history in memory so it doesn't revert if they go back
      setHistoryMeetings(prev => prev.map(m => m.id === result.id ? { ...m, action_items: todos, title: meetingTitle } : m));
      setIsSaving(false);
    } catch (err) {
      console.error(err);
      alert("Error saving your updates.");
      setIsSaving(false);
    }
  };

  const handleCopyTranscript = () => {
    if (result && result.transcript) {
      navigator.clipboard.writeText(result.transcript);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleTranslateToEnglish = async () => {
    if (!result || !result.transcript) return;
    setIsTranslating(true);
    try {
      const response = await fetch(`${FASTAPI_URL}/translate-transcript/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: result.transcript })
      });
      if (!response.ok) throw new Error("Translation failed");
      const data = await response.json();
      setResult((prev) => ({ ...prev, transcript: data.translated_transcript }));
    } catch (err) {
      console.error(err);
      alert("Error translating the transcript.");
    } finally {
      setIsTranslating(false);
    }
  };

  const startMeeting = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = { mimeType: 'audio/webm;codecs=opus' };
      const recorder = new MediaRecorder(stream, options);
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        uploadAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      chunksRef.current = [];
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setRecordingTime(0);
      setIsRecording(true);
      setResult(null);
    } catch (err) {
      console.error(err);
      alert("Microphone access is required.");
    }
  };

  const endMeeting = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const pollMeetingStatus = async (docId) => {
    try {
      const response = await fetch(`${APPS_SCRIPT_URL}?action=getMeeting&id=${docId}&t=${Date.now()}`, {
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Failed to fetch status");
      const data = await response.json();
      
      if (!data.success) {
         if (data.error === "Meeting not found") {
             setTimeout(() => pollMeetingStatus(docId), 4000);
             return;
         }
         throw new Error(data.error);
      }
      
      const meeting = data.meeting;

      if (meeting.progress !== undefined) {
         setProgress(meeting.progress || 0);
         const texts = { 0: "Uploading securely...", 10: "Audio matrix engine...", 40: "Transcription array...", 85: "Gemini AI Neural Sync...", 100: "Done" };
         setStatusText(texts[meeting.progress] || "Processing...");
      }

      if (meeting.status === "completed") {
        setMeetingTitle(meeting.title || "");
        setResult({
          id: meeting.id,
          title: meeting.title,
          transcript: meeting.transcript,
          summary: meeting.summary,
          action_items: meeting.action_items,
        });
        if (meeting.action_items) {
           setTodos(meeting.action_items.map(item => ({ ...item, id: crypto.randomUUID(), completed: false })));
        } else {
           setTodos([]);
        }
        setIsLoading(false);
      } else if (meeting.status === "error") {
        throw new Error(meeting.summary || "Unknown server error processing audio");
      } else {
        setTimeout(() => pollMeetingStatus(docId), 4000);
      }
    } catch (err) {
      console.error(err);
      alert("Error checking meeting status.");
      setIsLoading(false);
    }
  };

  const uploadAudio = async (blob) => {
    setIsLoading(true);
    setProgress(0);
    setStatusText("Uploading securely...");
    try {
      const formData = new FormData();
      formData.append("file", blob, "meeting_recording.webm");
      formData.append("title", meetingTitle || "Untitled Meeting");
      formData.append("user_id", user.userId);

      const response = await fetch(`${FASTAPI_URL}/upload-audio/`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Server returned an error");

      const responseData = await response.json();
      const docId = responseData.document_id;
      
      if (docId) {
        setTimeout(() => pollMeetingStatus(docId), 4000);
      } else {
        throw new Error("No document ID returned from backend.");
      }
    } catch (error) {
      console.error(error);
      alert("Failed to process the meeting audio. Check console for details.");
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) uploadAudio(selectedFile);
  };

  const deleteMeeting = async (e, docId) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to permanently delete this meeting?")) return;
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
           action: "deleteMeeting",
           meetingId: docId,
           userId: user.userId
        })
      });
      const data = await response.json();
      if (!data.success) throw new Error("Failed to delete meeting");
      
      setHistoryMeetings(prev => prev.filter(m => m.id !== docId));
      if (result && result.id === docId) {
        setResult(null);
        setTodos([]);
      }
    } catch (err) {
      console.error(err);
      alert("Error deleting meeting.");
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem("meeting_user");
    setUser(null);
  }

  // --- LAYOUTS ---
  if (isAuthChecking) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="animate-spin text-indigo-600" size={48} /></div>;
  }
  
  if (!user) return <Auth onLoginSuccess={setUser} />;

  return (
    <div className="flex flex-col md:flex-row h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-50 via-slate-50 to-white font-sans text-slate-900 selection:bg-indigo-100 selection:text-indigo-900 overflow-hidden">
      
      {/* Desktop Sidebar (Hidden on Mobile) */}
      <div className="hidden md:flex w-72 bg-gradient-to-b from-slate-950 to-slate-900 border-r border-slate-800 text-white flex-col shadow-2xl z-20 shrink-0 h-full">
        <div className="p-8 mb-4 flex items-center gap-4 border-b border-white/5">
          <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center w-12 h-12 rounded-xl shadow-[0_0_20px_rgba(99,102,241,0.4)] border border-indigo-400/30">
            <Mic size={24} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-[18px] tracking-tight leading-tight">AI Assistant</h1>
            <span className="text-indigo-400 text-[11px] font-bold uppercase tracking-widest">Enterprise Pro</span>
          </div>
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-2">
          <button 
            onClick={() => { setViewMode('dashboard'); setResult(null); setMeetingTitle(""); }} 
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all font-semibold tracking-wide text-[15px] ${viewMode === 'dashboard' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
          >
            <LayoutDashboard size={18} /> Recording Dashboard
          </button>
          
          <button 
            onClick={() => setViewMode('history')} 
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all font-semibold tracking-wide text-[15px] ${viewMode === 'history' ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
          >
            <History size={18} /> Meeting History
          </button>
        </nav>
        
        <div className="p-6 border-t border-white/5 flex flex-col gap-4">
           <div className="bg-black/20 p-4 rounded-2xl border border-white/5 flex flex-col items-start backdrop-blur-sm">
             <span className="text-white font-bold text-sm mb-0.5">{user.name}</span>
             <span className="text-slate-400 text-xs mb-2 truncate w-full">{user.userId}</span>
             <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 px-2.5 py-1 rounded-full text-[10px] font-black tracking-widest uppercase">
               {user.department}
             </span>
           </div>
           <button onClick={handleSignOut} className="group flex items-center justify-center w-full gap-2 px-4 py-3 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 font-bold transition-all text-sm border border-transparent hover:border-rose-500/20">
             <LogOut size={16} className="group-hover:-translate-x-0.5 transition-transform" /> Sign Out
           </button>
        </div>
      </div>

      {/* Main Content Pane */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto pb-24 md:pb-12 relative h-full">
        {/* Subtle background decoration */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-400/5 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-sky-400/5 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="max-w-6xl mx-auto p-4 md:p-12 space-y-8 md:space-y-12 relative z-10 w-full">
          
          {viewMode === 'dashboard' && (
            <div className="w-full">
              {/* Dashboard Layout */}
              <header className="space-y-4 pt-2 md:pt-4">
                <h2 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900">
                  {result ? 'Meeting Overview' : 'New Recording'}
                </h2>
                <p className="text-slate-500 text-lg max-w-2xl">
                  {result ? 'Review your transcripts, AI-generated summaries, and trackable action items.' : 'Initialize a secure meeting recording or manually upload an audio file to the private pipeline.'}
                </p>
                <div className="pt-6 max-w-xl">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-2 uppercase tracking-widest">
                    <div className="w-2 h-2 rounded-full bg-indigo-500"></div> Meeting Title
                  </label>
                  <input 
                    type="text" 
                    placeholder="e.g. Q3 Architecture Review" 
                    value={meetingTitle}
                    onChange={(e) => setMeetingTitle(e.target.value)}
                    className="w-full bg-white/60 backdrop-blur-sm border-2 border-slate-200/60 rounded-2xl px-5 py-4 text-lg font-bold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 transition-all shadow-[0_2px_10px_rgb(0,0,0,0.02)]"
                  />
                </div>
              </header>

              {/* Recording Controls */}
              {!result && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-11 items-center gap-4 lg:gap-4 py-8 border-y border-slate-200/50 w-full mt-8">
                  {!isRecording ? (
                    <button
                      onClick={startMeeting}
                      disabled={isLoading}
                      className="lg:col-span-5 group flex items-center justify-center gap-3 px-8 py-5 bg-gradient-to-r from-slate-900 to-slate-800 hover:from-black hover:to-slate-900 text-white rounded-2xl font-bold text-lg transition-all disabled:opacity-50 shadow-xl shadow-slate-900/10 hover:shadow-2xl hover:shadow-slate-900/20 hover:-translate-y-0.5 w-full border border-slate-700"
                    >
                      <div className="bg-white/10 p-1.5 rounded-lg">
                        <Mic size={22} className="group-hover:scale-110 transition-transform text-indigo-300" />
                      </div>
                      Start Live Session
                    </button>
                  ) : (
                    <button
                      onClick={endMeeting}
                      className="lg:col-span-11 group flex items-center justify-center gap-5 px-10 py-5 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl transition-all shadow-xl shadow-rose-600/20 hover:shadow-2xl hover:shadow-rose-600/30 relative overflow-hidden w-full border border-rose-500"
                    >
                      <div className="absolute inset-0 bg-[url('noise.png')] opacity-20 mix-blend-overlay pointer-events-none"></div>
                      <Square size={20} className="fill-white relative z-10 animate-pulse" />
                      <span className="font-extrabold text-2xl font-mono tracking-wider relative z-10">{formatTimer(recordingTime)}</span>
                      <div className="w-px h-8 bg-white/30 relative z-10"></div>
                      <span className="text-sm font-black uppercase tracking-widest relative z-10">Stop Recording</span>
                    </button>
                  )}

                  {!isRecording && !isLoading && (
                    <>
                      <div className="lg:col-span-1 flex items-center justify-center">
                        <span className="text-slate-300 font-bold text-sm uppercase tracking-widest">OR</span>
                      </div>
                      <label className="lg:col-span-5 group flex flex-col md:flex-row items-center justify-center gap-3 cursor-pointer px-8 py-5 bg-white text-slate-700 border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50 hover:text-indigo-700 rounded-2xl font-bold transition-all text-base w-full shadow-sm hover:shadow-md">
                        <Upload size={20} className="group-hover:-translate-y-1 transition-transform" />
                        Manually Upload Media
                        <input type="file" accept="audio/*,video/mp4" className="hidden" onChange={handleFileUpload} />
                      </label>
                    </>
                  )}
                </div>
              )}

              {isLoading && (
                <div className="flex flex-col items-center justify-center py-24 space-y-8 animate-in fade-in zoom-in-95 duration-500 max-w-3xl mx-auto w-full">
                  <div className="relative w-24 h-24 mb-4">
                    <div className="absolute inset-0 bg-indigo-500 rounded-full blur-[40px] opacity-20 animate-pulse"></div>
                    <Loader2 className="animate-spin text-indigo-600 relative z-10 w-full h-full drop-shadow-md" />
                  </div>
                  
                  <div className="w-full bg-slate-200/50 rounded-full h-4 mb-4 overflow-hidden border border-slate-300/50 shadow-inner">
                    <div 
                      className="h-4 rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-all duration-1000 ease-out relative"
                      style={{ width: `${progress}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                    </div>
                  </div>
                  
                  <div className="flex w-full justify-between items-center px-4">
                    <h3 className="text-xl md:text-2xl text-slate-800 font-bold tracking-tight">
                      {statusText}
                    </h3>
                    <span className="text-indigo-700 font-black text-2xl md:text-3xl font-mono">
                      {progress}%
                    </span>
                  </div>
                  <p className="text-slate-500 w-full text-left px-4 text-[15px] leading-relaxed">Your audio is traversing the distributed cloud pipeline. Please keep this browser window active.</p>
                </div>
              )}

              {/* Dashboard Results Box */}
              {result && !isLoading && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-10 animate-in fade-in slide-in-from-bottom-8 duration-700 w-full">
                  
                  <div className="lg:col-span-12 xl:col-span-8 flex flex-col gap-8">
                    {/* Executive Summary Card */}
                    <div className="bg-white/80 backdrop-blur-md p-8 md:p-10 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-full pointer-events-none transition-transform group-hover:scale-110"></div>
                      <h2 className="text-2xl font-black mb-6 text-slate-900 border-b border-slate-100 pb-5">Executive Summary</h2>
                      <div className="text-slate-700 leading-relaxed bg-slate-50/50 p-6 md:p-8 rounded-2xl whitespace-pre-wrap text-[16px] border border-slate-100/80 shadow-inner">
                        {result.summary || "Summary generation in progress..."}
                      </div>
                    </div>

                    {/* SRT Transcript Card */}
                    <div className="bg-white/80 backdrop-blur-md p-8 md:p-10 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/50 relative">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 border-b border-slate-100 pb-5">
                        <h2 className="text-2xl font-black text-slate-900">Full Transcript</h2>
                        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                          <button onClick={handleTranslateToEnglish} disabled={isTranslating} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 rounded-xl transition-all disabled:opacity-50">
                            {isTranslating ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
                            {isTranslating ? "Translating..." : "Translate SRT"}
                          </button>
                          <button onClick={handleCopyTranscript} className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-700 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-xl transition-all">
                            {isCopied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                            {isCopied ? "Copied!" : "Copy"}
                          </button>
                        </div>
                      </div>
                      <div className="max-h-[500px] overflow-y-auto pr-4 custom-scrollbar text-[14px] font-mono leading-[1.7]">
                        <p className="text-slate-600 whitespace-pre-wrap">{result.transcript}</p>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-12 xl:col-span-4">
                    {/* Action Items Card - Sticky on XL */}
                    <div className="bg-white/90 backdrop-blur-xl p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-white sticky top-10 w-full xl:max-w-md">
                      <h2 className="text-xl font-black mb-6 text-slate-900 flex items-center gap-3 pb-5 border-b border-slate-100">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 border border-emerald-200"><CheckCircle2 size={18} /></div>
                        Action Items
                      </h2>
                      <ul className="space-y-4">
                        {todos.length > 0 ? (
                          todos.map((item) => (
                            <li key={item.id} className="flex gap-4 group items-start bg-slate-50/80 hover:bg-white p-5 rounded-2xl border border-slate-200/60 hover:border-indigo-300 transition-all shadow-sm hover:shadow-md relative">
                              <button onClick={() => handleTodoToggle(item.id)} className="mt-1 shrink-0 focus:outline-none cursor-pointer text-slate-300 hover:text-emerald-500 transition-colors">
                                <CheckCircle2 className={`${item.completed ? 'text-emerald-500 fill-emerald-50' : ''} transition-all duration-300`} size={24} />
                              </button>
                              <div className={`flex flex-col flex-grow w-full ${item.completed ? 'opacity-40 grayscale' : ''} transition-all duration-300`}>
                                <input 
                                  value={item.assignee} 
                                  placeholder="Assignee"
                                  onChange={(e) => handleTodoEdit(item.id, 'assignee', e.target.value)}
                                  className={`font-black text-slate-900 text-sm leading-tight bg-transparent border-b border-transparent focus:border-indigo-300 outline-none transition-all py-1 mb-1 ${item.completed ? 'line-through decoration-2 decoration-slate-400' : ''}`}
                                />
                                <textarea
                                  value={item.task}
                                  placeholder="Task description"
                                  onChange={(e) => handleTodoEdit(item.id, 'task', e.target.value)}
                                  rows={item.task.length > 40 ? 3 : 2}
                                  className={`text-slate-600 font-medium text-[13px] leading-relaxed bg-transparent border border-transparent focus:border-indigo-200 focus:bg-indigo-50/30 rounded-lg p-1 -ml-1 outline-none resize-none w-full transition-all ${item.completed ? 'line-through decoration-slate-300' : ''}`}
                                />
                              </div>
                              <button onClick={() => handleTodoDelete(item.id)} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all p-2 bg-white rounded-xl shadow-sm border border-slate-100 absolute -top-3 -right-3">
                                 <Trash2 size={16} />
                              </button>
                            </li>
                          ))
                        ) : (
                          <li className="text-slate-400 italic text-center py-12 font-medium bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">No action items detected.</li>
                        )}
                      </ul>
                      
                      <div className="mt-8 space-y-3">
                        <button 
                          onClick={handleAddTodo}
                          className="w-full flex items-center justify-center gap-2 py-3.5 border-2 border-dashed border-slate-300 text-slate-600 hover:text-indigo-700 hover:border-indigo-400 hover:bg-indigo-50/50 rounded-2xl transition-all font-bold text-[15px]"
                        >
                          <Plus size={18} /> Add Target Goal
                        </button>
                        
                        <button 
                          onClick={handleSaveChanges}
                          disabled={isSaving}
                          className="w-full flex items-center justify-center gap-3 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl transition-all font-black text-[15px] shadow-[0_0_15px_rgba(5,150,105,0.3)] hover:shadow-[0_0_25px_rgba(5,150,105,0.4)] hover:-translate-y-0.5 disabled:opacity-70 disabled:hover:translate-y-0 relative overflow-hidden"
                        >
                          <div className="absolute inset-0 bg-white/20 opacity-0 hover:opacity-100 transition-opacity"></div>
                          {isSaving ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}
                          {isSaving ? "SYNCING TO CLOUD..." : "SAVE & UPLOAD"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {viewMode === 'history' && (
            <div className="animate-in fade-in slide-in-from-bottom-8 duration-500 w-full">
              <header className="space-y-4 pt-4 mb-12 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                  <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900">Meeting History</h1>
                  <p className="text-slate-500 text-lg max-w-2xl mt-2">Securely review all previously mapped and generated meeting logic directly from your Google Sheets Cloud.</p>
                </div>
                <button 
                  onClick={() => fetchHistory(true)}
                  disabled={isHistoryLoading}
                  className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-indigo-300 font-bold rounded-xl shadow-sm transition-all text-sm shrink-0 disabled:opacity-50"
                >
                  {isHistoryLoading ? <Loader2 size={16} className="animate-spin" /> : <History size={16} />}
                  {isHistoryLoading ? "Refreshing..." : "Refresh"}
                </button>
              </header>

              {isHistoryLoading ? (
                /* Skeleton Loader */
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {[1,2,3].map(i => (
                    <div key={i} className="bg-white/80 p-8 rounded-[2rem] border border-slate-200 animate-pulse flex flex-col gap-4">
                      <div className="flex justify-between">
                        <div className="h-6 w-20 bg-slate-200 rounded-full"></div>
                        <div className="h-6 w-12 bg-slate-100 rounded-full"></div>
                      </div>
                      <div className="h-7 w-3/4 bg-slate-200 rounded-xl"></div>
                      <div className="h-4 w-1/3 bg-slate-100 rounded-xl"></div>
                      <div className="mt-auto space-y-2">
                        <div className="h-4 bg-slate-100 rounded-xl"></div>
                        <div className="h-4 bg-slate-100 rounded-xl w-4/5"></div>
                        <div className="h-4 bg-slate-100 rounded-xl w-2/3"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : historyMeetings.length === 0 ? (
                <div className="bg-white/60 backdrop-blur-sm rounded-[2rem] p-24 text-center border border-slate-200 shadow-sm flex flex-col items-center justify-center gap-6">
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center border border-slate-200 shadow-inner"><History size={32} className="text-slate-400" /></div>
                  <h3 className="text-xl font-bold text-slate-700">No Intelligence Indexed</h3>
                  <p className="text-slate-500 text-base max-w-sm">You haven't recorded or uploaded any meetings yet. Head back to the Dashboard to begin tracing.</p>
                  <button onClick={() => setViewMode('dashboard')} className="mt-4 px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-md hover:bg-indigo-700 transition-all">Go to Dashboard</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {historyMeetings.map(m => (
                    <div 
                      key={m.id} 
                      onClick={() => {
                        setResult(m);
                        setMeetingTitle(m.title || "Untitled Meeting");
                        if (m.action_items) { setTodos(m.action_items.map(item => ({ ...item, id: crypto.randomUUID(), completed: false }))); } else { setTodos([]); }
                        setViewMode('dashboard');
                      }}
                      className="group bg-white/90 backdrop-blur-md p-8 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-slate-200/80 flex flex-col cursor-pointer hover:shadow-[0_12px_30px_rgb(0,0,0,0.06)] hover:-translate-y-1.5 hover:border-indigo-300 transition-all duration-300 relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 w-2 h-full bg-indigo-500/0 group-hover:bg-indigo-500 transition-colors"></div>
                      
                      <div className="flex justify-between items-start mb-6">
                        <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${m.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100 shadow-sm' : m.status === 'processing' ? 'bg-amber-50 text-amber-600 border border-amber-100 animate-pulse' : 'bg-rose-50 text-rose-600 border border-rose-100'}`}>
                          {m.status}
                        </span>
                        
                        <div className="flex items-center gap-3">
                          {m.created_at && <span className="text-slate-400 font-bold text-xs">{new Date(m.created_at).toLocaleDateString(undefined, {month:'short', day:'numeric'})}</span>}
                          <button 
                            onClick={(e) => deleteMeeting(e, m.id)} 
                            className="text-slate-300 hover:text-white hover:bg-rose-500 transition-all p-2 bg-slate-50 border border-slate-100 rounded-xl shadow-sm md:opacity-0 md:group-hover:opacity-100"
                            title="Delete Meeting"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                      
                      <h3 className="text-xl font-black text-slate-900 mb-2 line-clamp-1 group-hover:text-indigo-700 transition-colors">{m.title || "Untitled Meeting"}</h3>
                      <p className="text-slate-400 text-xs mb-6 font-mono truncate">{m.id.split('-')[0]}...</p>
                      
                      <div className="mt-auto">
                        <p className="text-[13px] text-slate-600 bg-slate-50/80 p-5 rounded-2xl border border-slate-100/80 line-clamp-3 leading-relaxed font-medium">
                          {m.summary || "Pending NLP summary..."}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Mobile Bottom Navigation Bar (Hidden on Desktop) */}
      <div className="md:hidden fixed bottom-0 left-0 w-full bg-slate-950/90 backdrop-blur-lg border-t border-white/10 flex justify-around items-center px-4 py-4 z-50 pb-safe">
        <button 
          onClick={() => { setViewMode('dashboard'); setResult(null); setMeetingTitle(""); }} 
          className={`flex flex-col items-center gap-2 transition-all w-1/2 ${viewMode === 'dashboard' ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <LayoutDashboard size={24} className={viewMode === 'dashboard' ? 'drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]' : ''} />
          <span className="text-[10px] font-black uppercase tracking-widest">Dashboard</span>
        </button>
        <div className="w-px h-8 bg-white/10"></div>
        <button 
          onClick={() => setViewMode('history')} 
          className={`flex flex-col items-center gap-2 transition-all w-1/2 ${viewMode === 'history' ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}
        >
          <History size={24} className={viewMode === 'history' ? 'drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]' : ''} />
          <span className="text-[10px] font-black uppercase tracking-widest">History</span>
        </button>
      </div>
    </div>
  );
}

export default App;
