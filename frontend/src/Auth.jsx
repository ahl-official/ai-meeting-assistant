import { useState } from 'react';
import { Mic, Mail, Loader2, User, Building } from 'lucide-react';

export default function Auth({ onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // We read this from localStorage or hardcode it for now.
  const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || localStorage.getItem('APPS_SCRIPT_URL');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!APPS_SCRIPT_URL) {
      setError("Please set the Google Apps Script URL first!");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const action = isLogin ? 'login' : 'register';
      const payload = isLogin 
        ? { action, userId: emailOrPhone }
        : { action, userId: emailOrPhone, name, department };

      const response = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Save user to localStorage
        localStorage.setItem("meeting_user", JSON.stringify(data.user));
        onLoginSuccess(data.user);
      } else {
        setError(data.error || "Authentication failed");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to connect to the database.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 selection:bg-indigo-100 selection:text-indigo-900">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden transform transition-all duration-500 hover:-translate-y-1 hover:shadow-2xl">
        <div className="bg-indigo-600 p-8 flex flex-col justify-center items-center text-white">
          <div className="bg-white/20 p-4 rounded-full mb-4 shadow-inner ring-4 ring-white/10 backdrop-blur-sm">
            <Mic size={36} />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">AI Meeting Assistant</h1>
          <p className="text-indigo-200 mt-2 text-center text-sm font-medium">Enterprise Employee Portal</p>
        </div>

        <div className="p-8 pb-10">
          <h2 className="text-2xl font-bold text-slate-800 mb-6 text-center">
            {isLogin ? 'Employee Sign In' : 'Employee Registration'}
          </h2>

          {error && (
             <div className="bg-rose-50 text-rose-600 p-4 rounded-xl text-sm mb-6 font-medium ring-1 ring-rose-200 shadow-inner">
               {error}
             </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5 pl-1">Email or Phone Number</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                  <Mail size={18} />
                </div>
                <input
                  type="text"
                  required
                  value={emailOrPhone}
                  onChange={(e) => setEmailOrPhone(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-all outline-none text-slate-900 shadow-sm"
                  placeholder="e.g. johndoe@company.com or 555-1234"
                />
              </div>
            </div>

            {!isLogin && (
              <>
                <div className="animate-in fade-in slide-in-from-top-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5 pl-1">Full Name</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                      <User size={18} />
                    </div>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-all outline-none text-slate-900 shadow-sm"
                      placeholder="Jane Doe"
                    />
                  </div>
                </div>

                <div className="animate-in fade-in slide-in-from-top-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5 pl-1">Department</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                      <Building size={18} />
                    </div>
                    <input
                      type="text"
                      required
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:bg-white transition-all outline-none text-slate-900 shadow-sm"
                      placeholder="e.g. Engineering, Sales"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition-all shadow-md hover:shadow-lg disabled:opacity-70 mt-6"
            >
              {isLoading ? <Loader2 className="animate-spin" size={20} /> : null}
              {isLogin ? 'Sign In instantly' : 'Complete Registration'}
            </button>
          </form>

          <div className="mt-8 text-center text-sm font-medium">
            <span className="text-slate-500">
              {isLogin ? "New employee? " : "Already registered? "}
            </span>
            <button
              onClick={() => { setIsLogin(!isLogin); setError(null); }}
              className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline transition-all"
            >
              {isLogin ? 'Register your ID.' : 'Sign in.'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
