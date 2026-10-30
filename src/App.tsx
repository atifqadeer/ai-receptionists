import { useState } from 'react';
import Dashboard from './components/Dashboard';
import SetupForm from './components/SetupForm';
import Automation from './components/Automation';
import CallSimulator from './components/CallSimulator';
import RealCallSimulator from './components/RealCallSimulator';
import Analytics from './components/Analytics';
import Settings from './components/Settings';
import { downloadPythonBackend } from './utils/downloadZip';

type Page = 'dashboard' | 'setup' | 'automation' | 'simulator' | 'realcall' | 'analytics' | 'settings';

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
      alert('Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const navItems: { id: Page; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-line' },
    { id: 'setup', label: 'Agent Setup', icon: 'fa-robot' },
    { id: 'automation', label: 'Automation', icon: 'fa-gears' },
    { id: 'realcall', label: 'Make a Call', icon: 'fa-phone-volume' },
    { id: 'simulator', label: 'Text Simulator', icon: 'fa-comments' },
    { id: 'analytics', label: 'Analytics', icon: 'fa-chart-bar' },
    { id: 'settings', label: 'Settings', icon: 'fa-sliders' },
  ];

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'setup': return <SetupForm />;
      case 'automation': return <Automation />;
      case 'realcall': return <RealCallSimulator />;
      case 'simulator': return <CallSimulator />;
      case 'analytics': return <Analytics />;
      case 'settings': return <Settings />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-gray-900 border-r border-gray-800 flex flex-col transition-all duration-300`}>
        <div className="p-4 border-b border-gray-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <i className="fa-solid fa-robot text-white text-lg"></i>
          </div>
          {sidebarOpen && (
            <div>
              <h1 className="font-bold text-sm text-white">AI Receptionist</h1>
              <p className="text-xs text-gray-400">Automation Hub</p>
            </div>
          )}
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                currentPage === item.id
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <i className={`fa-solid ${item.icon} w-5 text-center`}></i>
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-800 space-y-2">
          {/* Download Button */}
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className={`fa-solid ${downloading ? 'fa-spinner fa-spin' : downloadSuccess ? 'fa-check' : 'fa-download'} w-5 text-center`}></i>
            {sidebarOpen && (
              <span>
                {downloading ? 'Creating ZIP...' : downloadSuccess ? 'Downloaded!' : 'Download Backend'}
              </span>
            )}
          </button>
          
          {/* Collapse Button */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-all"
          >
            <i className={`fa-solid ${sidebarOpen ? 'fa-angles-left' : 'fa-angles-right'} w-5 text-center`}></i>
            {sidebarOpen && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        {/* Top Bar */}
        <header className="sticky top-0 z-10 bg-gray-950/80 backdrop-blur-xl border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white capitalize">
              {currentPage === 'simulator' ? 'Text Call Simulator' : 
               currentPage === 'realcall' ? 'Make a Voice Call' : 
               currentPage}
            </h2>
            <p className="text-sm text-gray-400">
              {currentPage === 'dashboard' && 'Overview of your AI receptionist performance'}
              {currentPage === 'setup' && 'Configure your AI agent personality and behavior'}
              {currentPage === 'automation' && 'Set up call routing and automated workflows'}
              {currentPage === 'realcall' && 'Speak to the AI agent using your microphone'}
              {currentPage === 'simulator' && 'Test your AI agent with text-based conversations'}
              {currentPage === 'analytics' && 'View call history and performance metrics'}
              {currentPage === 'settings' && 'System configuration and integrations'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
              <span className="text-xs text-emerald-300 font-medium">Agent Online</span>
            </div>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <i className="fa-solid fa-user text-white text-sm"></i>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-6">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

export default App;
