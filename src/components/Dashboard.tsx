import { useState } from 'react';
import { downloadPythonBackend } from '../utils/downloadZip';
import DiagnosticTool from './DiagnosticTool';

export default function Dashboard() {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [timeRange, setTimeRange] = useState('today');
  const [downloading, setDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadPythonBackend();
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setDownloading(false);
    }
  };

  const stats = [
    { label: 'Total Calls', value: '1,247', change: '+12.5%', icon: 'fa-phone', color: 'from-violet-500 to-indigo-600' },
    { label: 'Calls Handled', value: '1,189', change: '+8.3%', icon: 'fa-headset', color: 'from-emerald-500 to-teal-600' },
    { label: 'Avg Response Time', value: '1.2s', change: '-15.2%', icon: 'fa-clock', color: 'from-amber-500 to-orange-600' },
    { label: 'Satisfaction Rate', value: '94.7%', change: '+3.1%', icon: 'fa-face-smile', color: 'from-pink-500 to-rose-600' },
  ];

  const recentCalls = [
    { id: 1, caller: 'John Smith', time: '2 min ago', duration: '3:24', status: 'resolved', intent: 'Appointment Booking' },
    { id: 2, caller: 'Sarah Johnson', time: '8 min ago', duration: '1:45', status: 'resolved', intent: 'Business Hours Inquiry' },
    { id: 3, caller: 'Mike Davis', time: '15 min ago', duration: '5:12', status: 'transferred', intent: 'Technical Support' },
    { id: 4, caller: 'Emily Chen', time: '22 min ago', duration: '2:30', status: 'resolved', intent: 'General Inquiry' },
    { id: 5, caller: 'Robert Wilson', time: '35 min ago', duration: '4:18', status: 'resolved', intent: 'Appointment Booking' },
    { id: 6, caller: 'Lisa Anderson', time: '42 min ago', duration: '1:55', status: 'escalated', intent: 'Complaint' },
  ];

  const intents = [
    { name: 'Appointment Booking', count: 423, percentage: 34 },
    { name: 'General Inquiry', count: 312, percentage: 25 },
    { name: 'Business Hours', count: 187, percentage: 15 },
    { name: 'Technical Support', count: 156, percentage: 13 },
    { name: 'Complaints', count: 89, percentage: 7 },
    { name: 'Other', count: 80, percentage: 6 },
  ];

  return (
    <div className="space-y-6">
      {/* Download Section */}
      <div className="bg-gradient-to-r from-violet-600/20 to-indigo-600/20 rounded-xl border border-violet-500/30 p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <i className="fa-solid fa-download text-white text-xl"></i>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Download Python Backend</h3>
              <p className="text-sm text-gray-300">
                Get the complete Python backend code as a ZIP file. Includes FastAPI server, AI agent, call management, and all setup scripts.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">Python 3.9+</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">FastAPI</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">OpenAI</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">Twilio</span>
              </div>
            </div>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="px-6 py-3 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-medium hover:from-violet-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
          >
            <i className={`fa-solid ${downloading ? 'fa-spinner fa-spin' : downloadSuccess ? 'fa-check' : 'fa-file-zipper'}`}></i>
            {downloading ? 'Creating ZIP...' : downloadSuccess ? 'Downloaded!' : 'Download ZIP'}
          </button>
        </div>
        
        {downloadSuccess && (
          <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
            <p className="text-sm text-emerald-300 flex items-center gap-2">
              <i className="fa-solid fa-circle-check"></i>
              ZIP file downloaded! Extract it and follow the instructions in QUICKSTART.md
            </p>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-gray-900 rounded-xl border border-gray-800 p-5 hover:border-gray-700 transition-all">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${stat.color} flex items-center justify-center`}>
                <i className={`fa-solid ${stat.icon} text-white text-sm`}></i>
              </div>
              <span className={`text-xs font-medium ${stat.change.startsWith('+') ? 'text-emerald-400' : 'text-amber-400'}`}>
                {stat.change}
              </span>
            </div>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-sm text-gray-400 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Calls */}
        <div className="lg:col-span-2 bg-gray-900 rounded-xl border border-gray-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Recent Calls</h3>
            <div className="flex gap-1">
              {['today', 'week', 'month'].map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                    timeRange === range ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  {range.charAt(0).toUpperCase() + range.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {recentCalls.map((call) => (
              <div key={call.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 hover:bg-gray-800 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center">
                    <i className="fa-solid fa-user text-gray-400 text-sm"></i>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{call.caller}</p>
                    <p className="text-xs text-gray-400">{call.intent}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-gray-400">{call.duration}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    call.status === 'resolved' ? 'bg-emerald-500/10 text-emerald-400' :
                    call.status === 'transferred' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-red-500/10 text-red-400'
                  }`}>
                    {call.status}
                  </span>
                  <span className="text-xs text-gray-500">{call.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Call Intents */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="font-semibold text-white mb-4">Call Intents</h3>
          <div className="space-y-4">
            {intents.map((intent, idx) => (
              <div key={idx}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-300">{intent.name}</span>
                  <span className="text-xs text-gray-400">{intent.count} ({intent.percentage}%)</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all"
                    style={{ width: `${intent.percentage}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Activity Timeline */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <h3 className="font-semibold text-white mb-4">Activity Timeline</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-bolt text-amber-400"></i>
              <span className="text-sm font-medium text-white">Peak Hours</span>
            </div>
            <p className="text-xs text-gray-400">9:00 AM - 11:00 AM</p>
            <p className="text-lg font-bold text-white mt-1">342 calls</p>
          </div>
          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-arrow-right-arrow-left text-violet-400"></i>
              <span className="text-sm font-medium text-white">Transfer Rate</span>
            </div>
            <p className="text-xs text-gray-400">Calls transferred to human</p>
            <p className="text-lg font-bold text-white mt-1">4.7%</p>
          </div>
          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
            <div className="flex items-center gap-2 mb-2">
              <i className="fa-solid fa-check-double text-emerald-400"></i>
              <span className="text-sm font-medium text-white">First Call Resolution</span>
            </div>
            <p className="text-xs text-gray-400">Resolved without transfer</p>
            <p className="text-lg font-bold text-white mt-1">91.3%</p>
          </div>
        </div>
      </div>

      {/* Diagnostic Tool */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-wrench text-violet-400"></i>
            Troubleshooting
          </h3>
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs hover:bg-violet-700 transition-all flex items-center gap-1"
          >
            <i className={`fa-solid ${showDiagnostics ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            {showDiagnostics ? 'Hide' : 'Show'} Diagnostics
          </button>
        </div>
        
        {showDiagnostics && <DiagnosticTool />}
        
        {!showDiagnostics && (
          <div className="space-y-2">
            <p className="text-sm text-gray-400">
              Having issues with buttons or features not working? Use the diagnostic tool to identify problems.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href="/TROUBLESHOOTING.md"
                target="_blank"
                className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
              >
                <i className="fa-solid fa-book"></i>
                View Troubleshooting Guide
              </a>
              <span className="text-xs text-gray-600">•</span>
              <button
                onClick={() => window.location.reload()}
                className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
              >
                <i className="fa-solid fa-rotate"></i>
                Refresh Page
              </button>
              <span className="text-xs text-gray-600">•</span>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
              >
                <i className="fa-solid fa-trash"></i>
                Clear Cache & Reload
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
