import SetupForm from './SetupForm';
import Settings from './Settings';
import Automation from './Automation';
import { useLocalStorage } from '../hooks/useLocalStorage';

// One Settings page for everything: the agent (identity, scripts,
// knowledge), calling (SIP account, inbound, outbound, call voice),
// automation rules and system settings. Each group has its own tabs;
// the forms underneath are the same components as before, so what is
// saved, and where, is unchanged.

type Tab = { id: string; label: string; icon: string };
type Group = { id: string; label: string; icon: string; desc: string; saveNote: string; tabs: Tab[] };

const GROUPS: Group[] = [
  {
    id: 'agent', label: 'Agent', icon: 'fa-robot', desc: 'Identity, scripts & knowledge',
    saveNote: 'Saved with Save Configuration and sent to the backend agent.',
    tabs: [
      { id: 'identity', label: 'Identity & Voice', icon: 'fa-id-badge' },
      { id: 'behavior', label: 'Behavior & Scripts', icon: 'fa-comments' },
      { id: 'knowledge', label: 'Knowledge Base', icon: 'fa-book' },
    ],
  },
  {
    id: 'calling', label: 'Calling', icon: 'fa-phone-volume', desc: 'SIP account, inbound & outbound',
    saveNote: 'Saved with Save VoIP Settings to the backend.',
    tabs: [
      { id: 'provider', label: 'SIP / VoIP Account', icon: 'fa-server' },
      { id: 'inbound', label: 'Inbound Calls', icon: 'fa-headset' },
      { id: 'rules', label: 'Outbound Calling', icon: 'fa-clock' },
      { id: 'voice', label: 'Call Voice & CRM', icon: 'fa-microphone-lines' },
    ],
  },
  {
    id: 'automation', label: 'Automation', icon: 'fa-gears', desc: 'Routing rules & workflows',
    saveNote: 'Changes are saved automatically in this browser.',
    tabs: [{ id: 'rules', label: 'Rules & Workflows', icon: 'fa-diagram-project' }],
  },
  {
    id: 'system', label: 'System', icon: 'fa-sliders', desc: 'Integrations, AI model & team',
    saveNote: 'Saved in this browser with Save Settings.',
    tabs: [
      { id: 'general', label: 'General', icon: 'fa-cog' },
      { id: 'integrations', label: 'Integrations', icon: 'fa-plug' },
      { id: 'ai', label: 'AI Model', icon: 'fa-brain' },
      { id: 'telephony', label: 'Telephony Guide', icon: 'fa-tower-broadcast' },
      { id: 'team', label: 'Team', icon: 'fa-users' },
      { id: 'api', label: 'API Keys', icon: 'fa-key' },
    ],
  },
];

export default function SettingsHub() {
  const [groupId, setGroupId] = useLocalStorage('settings-hub-group', 'agent');
  // The last tab opened in each group, so switching groups and back
  // returns to where you were.
  const [tabByGroup, setTabByGroup] = useLocalStorage<Record<string, string>>('settings-hub-tabs', {});

  const group = GROUPS.find((g) => g.id === groupId) ?? GROUPS[0];
  const tab = group.tabs.find((t) => t.id === tabByGroup[group.id]) ?? group.tabs[0];
  const selectTab = (id: string) => setTabByGroup({ ...tabByGroup, [group.id]: id });

  return (
    <div className="space-y-6">
      {/* Group tabs */}
      <div role="tablist" aria-label="Settings groups" className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {GROUPS.map((g) => {
          const active = g.id === group.id;
          return (
            <button
              key={g.id}
              role="tab"
              aria-selected={active}
              onClick={() => setGroupId(g.id)}
              className={`group relative text-left rounded-xl border p-4 transition-all overflow-hidden ${
                active
                  ? 'border-violet-500/50 bg-gradient-to-br from-violet-600/20 via-indigo-600/10 to-transparent shadow-lg shadow-violet-900/20'
                  : 'border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-900/70'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                  active
                    ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-400 group-hover:text-gray-200'
                }`}>
                  <i className={`fa-solid ${g.icon}`}></i>
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${active ? 'text-white' : 'text-gray-300'}`}>{g.label}</p>
                  <p className="text-xs text-gray-500 truncate">{g.desc}</p>
                </div>
              </div>
              {active && <span className="absolute left-0 right-0 bottom-0 h-0.5 bg-gradient-to-r from-violet-500 to-indigo-500"></span>}
            </button>
          );
        })}
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 border-b border-gray-800">
        <div role="tablist" aria-label={`${group.label} settings`} className="flex gap-1 overflow-x-auto -mb-px">
          {group.tabs.map((t) => {
            const active = t.id === tab.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-all ${
                  active
                    ? 'border-violet-500 text-violet-300'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                }`}
              >
                <i className={`fa-solid ${t.icon} text-xs`}></i>
                {t.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 pb-2.5 flex items-center gap-1.5 shrink-0">
          <i className="fa-solid fa-circle-info"></i>
          {group.saveNote}
        </p>
      </div>

      {/* Content. Agent and Calling share one form instance (it holds the
          VoIP settings across tabs), so edits survive switching tabs. */}
      <div key={group.id === 'calling' ? 'agent' : group.id}>
        {(group.id === 'agent' || group.id === 'calling') && <SetupForm section={tab.id} />}
        {group.id === 'automation' && <Automation />}
        {group.id === 'system' && <Settings section={tab.id} />}
      </div>
    </div>
  );
}
