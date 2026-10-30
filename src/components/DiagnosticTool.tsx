import { useState, useEffect } from 'react';

export default function DiagnosticTool() {
  const [diagnostics, setDiagnostics] = useState({
    browser: '',
    jsZip: false,
    speechSynthesis: false,
    voices: 0,
    localStorage: false,
    network: true,
  });
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const addLog = (message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] [${type.toUpperCase()}] ${message}`]);
  };

  const runDiagnostics = async () => {
    setIsRunning(true);
    setLogs([]);
    
    addLog('Starting diagnostics...', 'info');

    // Check browser
    const browser = navigator.userAgent;
    setDiagnostics(prev => ({ ...prev, browser }));
    addLog(`Browser: ${browser.substring(0, 50)}...`, 'info');

    // Check JSZip
    try {
      const jszip = await import('jszip');
      setDiagnostics(prev => ({ ...prev, jsZip: true }));
      addLog('✓ JSZip loaded successfully', 'success');
    } catch (e) {
      setDiagnostics(prev => ({ ...prev, jsZip: false }));
      addLog('✗ JSZip not available', 'error');
    }

    // Check Speech Synthesis
    if ('speechSynthesis' in window) {
      setDiagnostics(prev => ({ ...prev, speechSynthesis: true }));
      addLog('✓ Speech Synthesis API available', 'success');
      
      // Check voices
      const voices = window.speechSynthesis.getVoices();
      setDiagnostics(prev => ({ ...prev, voices: voices.length }));
      addLog(`✓ ${voices.length} voices available`, 'success');
    } else {
      setDiagnostics(prev => ({ ...prev, speechSynthesis: false }));
      addLog('✗ Speech Synthesis not supported', 'error');
    }

    // Check localStorage
    try {
      localStorage.setItem('test', 'test');
      localStorage.removeItem('test');
      setDiagnostics(prev => ({ ...prev, localStorage: true }));
      addLog('✓ localStorage available', 'success');
    } catch (e) {
      setDiagnostics(prev => ({ ...prev, localStorage: false }));
      addLog('✗ localStorage not available', 'error');
    }

    // Check network
    try {
      const response = await fetch('https://httpbin.org/get', { method: 'HEAD', mode: 'no-cors' });
      setDiagnostics(prev => ({ ...prev, network: true }));
      addLog('✓ Network connection available', 'success');
    } catch (e) {
      setDiagnostics(prev => ({ ...prev, network: false }));
      addLog('⚠ Network check failed (may be CORS issue)', 'error');
    }

    addLog('Diagnostics complete!', 'success');
    setIsRunning(false);
  };

  const testDownload = async () => {
    addLog('Testing download functionality...', 'info');
    try {
      const { downloadPythonBackend } = await import('../utils/downloadZip');
      await downloadPythonBackend();
      addLog('✓ Download test successful', 'success');
    } catch (e) {
      addLog(`✗ Download test failed: ${e}`, 'error');
    }
  };

  const testSpeech = () => {
    addLog('Testing speech synthesis...', 'info');
    try {
      const utterance = new SpeechSynthesisUtterance('Hello, this is a test of the speech synthesis system.');
      utterance.onend = () => addLog('✓ Speech test completed', 'success');
      utterance.onerror = (e) => addLog(`✗ Speech test failed: ${e.error}`, 'error');
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      addLog(`✗ Speech test failed: ${e}`, 'error');
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <i className="fa-solid fa-stethoscope text-violet-400"></i>
          Diagnostic Tool
        </h3>
        <button
          onClick={runDiagnostics}
          disabled={isRunning}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-all disabled:opacity-50 flex items-center gap-2"
        >
          <i className={`fa-solid ${isRunning ? 'fa-spinner fa-spin' : 'fa-play'}`}></i>
          {isRunning ? 'Running...' : 'Run Diagnostics'}
        </button>
      </div>

      {/* Diagnostics Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className={`p-3 rounded-lg border ${diagnostics.jsZip ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
          <p className="text-xs text-gray-400">JSZip</p>
          <p className={`text-sm font-medium ${diagnostics.jsZip ? 'text-emerald-400' : 'text-red-400'}`}>
            {diagnostics.jsZip ? '✓ Available' : '✗ Missing'}
          </p>
        </div>
        <div className={`p-3 rounded-lg border ${diagnostics.speechSynthesis ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
          <p className="text-xs text-gray-400">Speech API</p>
          <p className={`text-sm font-medium ${diagnostics.speechSynthesis ? 'text-emerald-400' : 'text-red-400'}`}>
            {diagnostics.speechSynthesis ? '✓ Available' : '✗ Missing'}
          </p>
        </div>
        <div className={`p-3 rounded-lg border ${diagnostics.voices > 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
          <p className="text-xs text-gray-400">Voices</p>
          <p className={`text-sm font-medium ${diagnostics.voices > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {diagnostics.voices} available
          </p>
        </div>
        <div className={`p-3 rounded-lg border ${diagnostics.localStorage ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
          <p className="text-xs text-gray-400">localStorage</p>
          <p className={`text-sm font-medium ${diagnostics.localStorage ? 'text-emerald-400' : 'text-red-400'}`}>
            {diagnostics.localStorage ? '✓ Available' : '✗ Missing'}
          </p>
        </div>
        <div className={`p-3 rounded-lg border ${diagnostics.network ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
          <p className="text-xs text-gray-400">Network</p>
          <p className={`text-sm font-medium ${diagnostics.network ? 'text-emerald-400' : 'text-amber-400'}`}>
            {diagnostics.network ? '✓ Connected' : '⚠ Check'}
          </p>
        </div>
      </div>

      {/* Test Buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={testDownload}
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-700 transition-all flex items-center gap-1"
        >
          <i className="fa-solid fa-download"></i>
          Test Download
        </button>
        <button
          onClick={testSpeech}
          className="px-3 py-1.5 rounded-lg bg-pink-600 text-white text-xs hover:bg-pink-700 transition-all flex items-center gap-1"
        >
          <i className="fa-solid fa-volume-high"></i>
          Test Speech
        </button>
        <button
          onClick={clearLogs}
          className="px-3 py-1.5 rounded-lg bg-gray-700 text-white text-xs hover:bg-gray-600 transition-all flex items-center gap-1"
        >
          <i className="fa-solid fa-trash"></i>
          Clear Logs
        </button>
      </div>

      {/* Logs */}
      <div className="bg-gray-950 rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
        {logs.length === 0 ? (
          <p className="text-gray-500">Click "Run Diagnostics" to start testing...</p>
        ) : (
          logs.map((log, idx) => (
            <div
              key={idx}
              className={`${
                log.includes('[SUCCESS]') ? 'text-emerald-400' :
                log.includes('[ERROR]') ? 'text-red-400' :
                'text-gray-300'
              }`}
            >
              {log}
            </div>
          ))
        )}
      </div>

      {/* Help Section */}
      <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <p className="text-sm text-blue-300 flex items-start gap-2">
          <i className="fa-solid fa-circle-info mt-0.5"></i>
          <span>
            <strong>Need Help?</strong> If diagnostics show issues, try: 
            (1) Hard refresh (Ctrl+Shift+R), 
            (2) Clear browser cache, 
            (3) Use Chrome/Edge browser, 
            (4) Check TROUBLESHOOTING.md for more help.
          </span>
        </p>
      </div>
    </div>
  );
}
