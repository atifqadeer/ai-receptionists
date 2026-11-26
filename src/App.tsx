import { useEffect, useState } from 'react';
import { widgetApi } from './utils/widgetApi';
import Dashboard from './components/Dashboard';
import RealCallSimulator from './components/RealCallSimulator';
import OutboundCalls from './components/OutboundCalls';
import InboundCalls from './components/InboundCalls';
import Analytics from './components/Analytics';
import SettingsHub from './components/SettingsHub';
import WebsiteChat from './components/WebsiteChat';
import DncList from './components/DncList';
import NotInterestedList from './components/NotInterestedList';
import HungUpList from './components/HungUpList';
import FollowUpsList from './components/FollowUpsList';
import { API_BASE } from './utils/agentApi';
import { AuthUser, signOut } from './utils/auth';

type Page = 'dashboard' | 'webchat' | 'realcall' | 'jobcalls' | 'followups' | 'dnc' | 'notinterested' | 'hungup' | 'inbound' | 'analytics' | 'settings';

// Green dot with a heartbeat ring: there are unread chat messages.
function UnreadDot({ className = '' }: { className?: string }) {
  return (
    <span className={`relative flex h-2.5 w-2.5 ${className}`} aria-label="Unread chat messages">
      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping"></span>
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]"></span>
    </span>
  );
}

function App({ user }: { user: AuthUser }) {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // Unread website chat messages, for the pulsing dot on "Chat" in the menu.
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.hidden) return;
      widgetApi.visitors()
        .then((r) => { if (alive) setChatUnread(r.visitors.reduce((a, v) => a + (v.unread || 0), 0)); })
        .catch(() => { /* backend down: keep the last value */ });
    };
    check();
    const t = window.setInterval(check, 5000);
    document.addEventListener('visibilitychange', check);
    return () => { alive = false; window.clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, []);

  // "Download Database": the whole MySQL database as a compressed .sql.gz
  // file from one consistent snapshot (backend app/services/db_backup.py).
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/api/backup/database`);
      if (!res.ok) {
        const detail = await res.json().then((d) => d?.detail).catch(() => '');
        throw new Error(detail || `The backend answered ${res.status}`);
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1]
        || `database-${new Date().toISOString().slice(0, 10)}.sql.gz`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (error: any) {
      console.error('Database download failed:', error);
      alert(`The database could not be downloaded: ${error?.message || error}`);
    } finally {
      setDownloading(false);
    }
  };

  const navItems: { id: Page; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-line' },
    { id: 'analytics', label: 'Analytics', icon: 'fa-chart-bar' },
    { id: 'webchat', label: 'Chat', icon: 'fa-comments' },
    { id: 'realcall', label: 'Make a Call', icon: 'fa-phone-volume' },
    { id: 'inbound', label: 'Inbound Calls', icon: 'fa-headset' },
    { id: 'jobcalls', label: 'Job Calls', icon: 'fa-briefcase' },
    { id: 'followups', label: 'Follow-ups', icon: 'fa-calendar-check' },
    { id: 'dnc', label: 'Do Not Call', icon: 'fa-ban' },
    { id: 'notinterested', label: 'Not Interested', icon: 'fa-thumbs-down' },
    { id: 'hungup', label: 'Hung Up', icon: 'fa-phone-slash' },
    { id: 'settings', label: 'Settings', icon: 'fa-sliders' },
  ];

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'realcall': return <RealCallSimulator />;
      case 'jobcalls': return <OutboundCalls />;
      case 'dnc': return <DncList />;
      case 'notinterested': return <NotInterestedList />;
      case 'hungup': return <HungUpList />;
      case 'followups': return <FollowUpsList />;
      case 'inbound': return <InboundCalls />;
      case 'webchat': return <WebsiteChat />;
      case 'analytics': return <Analytics />;
      case 'settings': return <SettingsHub />;
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
              <span className="relative w-5 text-center">
                <i className={`fa-solid ${item.icon}`}></i>
                {item.id === 'webchat' && chatUnread > 0 && !sidebarOpen && <UnreadDot className="absolute -top-1 -right-1.5" />}
              </span>
              {sidebarOpen && <span>{item.label}</span>}
              {item.id === 'webchat' && chatUnread > 0 && sidebarOpen && (
                <span className="ml-auto flex items-center gap-2" title={`${chatUnread} unread chat message${chatUnread === 1 ? '' : 's'}`}>
                  <span className="text-[11px] font-semibold text-emerald-300">{chatUnread > 99 ? '99+' : chatUnread}</span>
                  <UnreadDot />
                </span>
              )}
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
            <i className={`fa-solid ${downloading ? 'fa-spinner fa-spin' : downloadSuccess ? 'fa-check' : 'fa-database'} w-5 text-center`}></i>
            {sidebarOpen && (
              <span>
                {downloading ? 'Exporting…' : downloadSuccess ? 'Downloaded!' : 'Download Database'}
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
              {currentPage === 'realcall' ? 'Make a Voice Call' :
               currentPage === 'jobcalls' ? 'Job Calls' : 
               currentPage === 'dnc' ? 'Do Not Call list' : 
               currentPage === 'notinterested' ? 'Not interested contacts' : 
               currentPage === 'hungup' ? 'Hung up calls' :
               currentPage === 'followups' ? 'Follow-ups' :
               currentPage === 'inbound' ? 'Inbound Calls' : 
               currentPage === 'webchat' ? 'Chat' : 
               currentPage}
            </h2>
            <p className="text-sm text-gray-400">
              {currentPage === 'dashboard' && 'Overview of your AI receptionist performance'}
              {currentPage === 'realcall' && 'Dial any number for the AI agent to call, or test it in your browser'}
              {currentPage === 'webchat' && 'Website chat conversations by visitor email, a test chat with your agent, and the widget for your site'}
              {currentPage === 'inbound' && 'Every call the agent answered on your inbound extension: transcripts, recordings and history'}
              {currentPage === 'jobcalls' && 'The AI agent calls contacts about matching jobs from your CRM or a CSV'}
              {currentPage === 'dnc' && 'People who asked not to be contacted again: the agent never calls these numbers'}
              {currentPage === 'notinterested' && 'People who turned a role down on a call: held for the Call Rules days, then they may be called about other roles'}
              {currentPage === 'hungup' && 'Calls where the contact put the phone down before the agent finished'}
              {currentPage === 'followups' && 'Callback and meeting requests from chat and calls: who asked, when for, and what happens next'}
              {currentPage === 'analytics' && 'View call history and performance metrics'}
              {currentPage === 'settings' && 'Agent, calling, automation and system settings in one place'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
              <span className="text-xs text-emerald-300 font-medium">Agent Online</span>
            </div>
            <div className="relative">
              <button onClick={() => setMenuOpen(!menuOpen)} aria-label="Account" aria-expanded={menuOpen}
                title={user.email}
                className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-sm font-semibold hover:ring-2 hover:ring-violet-400/50">
                {(user.name || user.email).trim().charAt(0).toUpperCase() || <i className="fa-solid fa-user text-sm"></i>}
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)}></div>
                  <div className="absolute right-0 mt-2 w-60 z-20 rounded-xl border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800">
                      <p className="text-sm font-medium text-white truncate">{user.name || 'Signed in'}</p>
                      <p className="text-xs text-gray-400 truncate">{user.email}</p>
                      <span className="inline-block mt-1.5 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">{user.role}</span>
                    </div>
                    <button onClick={signOut}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 hover:text-white flex items-center gap-2">
                      <i className="fa-solid fa-right-from-bracket text-xs"></i>Sign out
                    </button>
                  </div>
                </>
              )}
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
