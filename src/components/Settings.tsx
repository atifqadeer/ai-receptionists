import { useState } from 'react';
import ApiKeysGuide from './ApiKeysGuide';
import Integrations from './Integrations';

export default function Settings() {
  const [activeSection, setActiveSection] = useState('integrations');
  const [saved, setSaved] = useState(false);

  const [general, setGeneral] = useState({
    systemName: 'AI Receptionist Hub',
    timezone: 'America/New_York',
    dateFormat: 'MM/DD/YYYY',
    enableNotifications: true,
    enableCallRecording: true,
    enableTranscripts: true,
    autoSaveTranscripts: true,
  });

  const [telephony, setTelephony] = useState({
    provider: 'twilio',
    accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    authToken: '••••••••••••••••••••••••',
    phoneNumber: '+1 (555) 123-4567',
    webhookUrl: 'https://api.techcorp.com/webhooks/calls',
    maxConcurrentCalls: 10,
    enableSip: false,
  });

  const [ai, setAi] = useState({
    provider: 'openai',
    model: 'gpt-4-turbo',
    apiKey: 'sk-••••••••••••••••••••••••',
    temperature: 0.7,
    maxTokens: 500,
    systemPrompt: 'You are Aria, a professional and friendly AI receptionist for TechCorp Solutions. You help callers with appointments, general inquiries, and route complex issues to the appropriate team.',
    enableFunctionCalling: true,
    enableMemory: true,
  });

  const [team, setTeam] = useState([
    { id: 1, name: 'Alex Thompson', role: 'Admin', email: 'alex@techcorp.com', status: 'active' },
    { id: 2, name: 'Maria Garcia', role: 'Manager', email: 'maria@techcorp.com', status: 'active' },
    { id: 3, name: 'James Wilson', role: 'Agent', email: 'james@techcorp.com', status: 'active' },
    { id: 4, name: 'Sophie Brown', role: 'Agent', email: 'sophie@techcorp.com', status: 'inactive' },
  ]);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const sections = [
    { id: 'general', label: 'General', icon: 'fa-cog' },
    { id: 'integrations', label: 'Integrations', icon: 'fa-plug' },
    { id: 'telephony', label: 'Telephony', icon: 'fa-phone-volume' },
    { id: 'ai', label: 'AI Model', icon: 'fa-brain' },
    { id: 'team', label: 'Team', icon: 'fa-users' },
    { id: 'api', label: 'API Keys Guide', icon: 'fa-key' },
  ];

  return (
    <div className="space-y-6">
      {/* Save Notification */}
      {saved && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-500/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2">
          <i className="fa-solid fa-check-circle"></i>
          <span className="text-sm font-medium">Settings saved successfully!</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Section Nav */}
        <div className="lg:w-56 flex lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeSection === section.id
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <i className={`fa-solid ${section.icon} w-5 text-center`}></i>
              {section.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 space-y-6">
          {/* General Settings */}
          {activeSection === 'general' && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
              <h3 className="text-lg font-semibold text-white">General Settings</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">System Name</label>
                  <input
                    type="text"
                    value={general.systemName}
                    onChange={(e) => setGeneral({ ...general, systemName: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Timezone</label>
                  <select
                    value={general.timezone}
                    onChange={(e) => setGeneral({ ...general, timezone: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                  >
                    <option>America/New_York</option>
                    <option>America/Chicago</option>
                    <option>America/Denver</option>
                    <option>America/Los_Angeles</option>
                    <option>Europe/London</option>
                    <option>Europe/Paris</option>
                    <option>Asia/Tokyo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Date Format</label>
                  <select
                    value={general.dateFormat}
                    onChange={(e) => setGeneral({ ...general, dateFormat: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                  >
                    <option>MM/DD/YYYY</option>
                    <option>DD/MM/YYYY</option>
                    <option>YYYY-MM-DD</option>
                  </select>
                </div>
              </div>
              <div className="space-y-3 pt-3 border-t border-gray-800">
                {[
                  { key: 'enableNotifications', label: 'Push Notifications', desc: 'Get notified about important events' },
                  { key: 'enableCallRecording', label: 'Call Recording', desc: 'Record all calls for quality assurance' },
                  { key: 'enableTranscripts', label: 'Auto Transcription', desc: 'Automatically transcribe calls' },
                  { key: 'autoSaveTranscripts', label: 'Auto-save Transcripts', desc: 'Save transcripts to database' },
                ].map((toggle) => (
                  <div key={toggle.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-300">{toggle.label}</p>
                      <p className="text-xs text-gray-500">{toggle.desc}</p>
                    </div>
                    <button
                      onClick={() => setGeneral({ ...general, [toggle.key]: !general[toggle.key as keyof typeof general] })}
                      className={`w-11 h-6 rounded-full transition-all ${general[toggle.key as keyof typeof general] ? 'bg-violet-600' : 'bg-gray-700'}`}
                    >
                      <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'white', transition: 'transform 0.2s', transform: general[toggle.key as keyof typeof general] ? 'translateX(22px)' : 'translateX(2px)' }}></div>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Integrations Settings */}
          {activeSection === 'integrations' && (
            <Integrations />
          )}

          {/* Telephony Settings */}
          {activeSection === 'telephony' && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
              <h3 className="text-lg font-semibold text-white">Telephony Configuration</h3>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Provider</label>
                <select
                  value={telephony.provider}
                  onChange={(e) => setTelephony({ ...telephony, provider: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                >
                  <option value="twilio">Twilio</option>
                  <option value="vonage">Vonage (Nexmo)</option>
                  <option value="plivo">Plivo</option>
                  <option value="bandwidth">Bandwidth</option>
                  <option value="asterisk">Asterisk (Self-hosted)</option>
                </select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Account SID</label>
                  <input
                    type="text"
                    value={telephony.accountSid}
                    onChange={(e) => setTelephony({ ...telephony, accountSid: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Auth Token</label>
                  <input
                    type="password"
                    value={telephony.authToken}
                    onChange={(e) => setTelephony({ ...telephony, authToken: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Phone Number</label>
                  <input
                    type="text"
                    value={telephony.phoneNumber}
                    onChange={(e) => setTelephony({ ...telephony, phoneNumber: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Max Concurrent Calls</label>
                  <input
                    type="number"
                    value={telephony.maxConcurrentCalls}
                    onChange={(e) => setTelephony({ ...telephony, maxConcurrentCalls: parseInt(e.target.value) })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Webhook URL</label>
                <input
                  type="text"
                  value={telephony.webhookUrl}
                  onChange={(e) => setTelephony({ ...telephony, webhookUrl: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                />
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-800">
                <div>
                  <p className="text-sm font-medium text-gray-300">Enable SIP Trunking</p>
                  <p className="text-xs text-gray-500">Connect via SIP protocol for on-premise PBX</p>
                </div>
                <button
                  onClick={() => setTelephony({ ...telephony, enableSip: !telephony.enableSip })}
                  className={`w-11 h-6 rounded-full transition-all ${telephony.enableSip ? 'bg-violet-600' : 'bg-gray-700'}`}
                >
                  <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'white', transition: 'transform 0.2s', transform: telephony.enableSip ? 'translateX(22px)' : 'translateX(2px)' }}></div>
                </button>
              </div>
            </div>
          )}

          {/* AI Model Settings */}
          {activeSection === 'ai' && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
              <h3 className="text-lg font-semibold text-white">AI Model Configuration</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">AI Provider</label>
                  <select
                    value={ai.provider}
                    onChange={(e) => setAi({ ...ai, provider: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="google">Google (Gemini)</option>
                    <option value="azure">Azure OpenAI</option>
                    <option value="local">Local (Ollama)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Model</label>
                  <select
                    value={ai.model}
                    onChange={(e) => setAi({ ...ai, model: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                  >
                    <option>gpt-4-turbo</option>
                    <option>gpt-4</option>
                    <option>gpt-3.5-turbo</option>
                    <option>claude-3-opus</option>
                    <option>claude-3-sonnet</option>
                    <option>gemini-pro</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">API Key</label>
                <input
                  type="password"
                  value={ai.apiKey}
                  onChange={(e) => setAi({ ...ai, apiKey: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Temperature: {ai.temperature}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={ai.temperature}
                    onChange={(e) => setAi({ ...ai, temperature: parseFloat(e.target.value) })}
                    className="w-full accent-violet-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Precise</span>
                    <span>Creative</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    Max Tokens: {ai.maxTokens}
                  </label>
                  <input
                    type="range"
                    min="100"
                    max="2000"
                    step="100"
                    value={ai.maxTokens}
                    onChange={(e) => setAi({ ...ai, maxTokens: parseInt(e.target.value) })}
                    className="w-full accent-violet-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Short</span>
                    <span>Long</span>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">System Prompt</label>
                <textarea
                  value={ai.systemPrompt}
                  onChange={(e) => setAi({ ...ai, systemPrompt: e.target.value })}
                  rows={4}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none resize-none"
                />
              </div>
              <div className="space-y-3 pt-3 border-t border-gray-800">
                {[
                  { key: 'enableFunctionCalling', label: 'Function Calling', desc: 'Allow AI to call external functions (calendar, CRM, etc.)' },
                  { key: 'enableMemory', label: 'Conversation Memory', desc: 'Remember context across the conversation' },
                ].map((toggle) => (
                  <div key={toggle.key} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-300">{toggle.label}</p>
                      <p className="text-xs text-gray-500">{toggle.desc}</p>
                    </div>
                    <button
                      onClick={() => setAi({ ...ai, [toggle.key]: !ai[toggle.key as keyof typeof ai] })}
                      className={`w-11 h-6 rounded-full transition-all ${ai[toggle.key as keyof typeof ai] ? 'bg-violet-600' : 'bg-gray-700'}`}
                    >
                      <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'white', transition: 'transform 0.2s', transform: ai[toggle.key as keyof typeof ai] ? 'translateX(22px)' : 'translateX(2px)' }}></div>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Team Settings */}
          {activeSection === 'team' && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold text-white">Team Members</h3>
                <button className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-all flex items-center gap-2">
                  <i className="fa-solid fa-user-plus text-xs"></i>
                  Invite Member
                </button>
              </div>
              <div className="space-y-3">
                {team.map((member) => (
                  <div key={member.id} className="flex items-center justify-between p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                        <span className="text-sm font-bold text-white">{member.name.charAt(0)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">{member.name}</p>
                        <p className="text-xs text-gray-400">{member.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">{member.role}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        member.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700 text-gray-400'
                      }`}>{member.status}</span>
                      <button className="text-gray-500 hover:text-gray-300 transition-all">
                        <i className="fa-solid fa-ellipsis"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* API Keys */}
          {activeSection === 'api' && (
            <div className="space-y-6">
              {/* API Keys Guide */}
              <ApiKeysGuide />

              <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
              <h3 className="text-lg font-semibold text-white">Your API Keys</h3>
              <div className="space-y-4">
                {[
                  { name: 'Production API Key', key: 'pk_live_••••••••••••••••••••', created: '2024-01-01', status: 'active' },
                  { name: 'Development API Key', key: 'pk_test_••••••••••••••••••••', created: '2024-01-05', status: 'active' },
                  { name: 'Webhook Secret', key: 'whsec_••••••••••••••••••••', created: '2024-01-01', status: 'active' },
                ].map((item, idx) => (
                  <div key={idx} className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-white">{item.name}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">{item.status}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs text-gray-400 bg-gray-800 px-3 py-1.5 rounded font-mono">{item.key}</code>
                      <button className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-all">
                        <i className="fa-solid fa-copy"></i>
                      </button>
                      <button className="px-2 py-1 rounded text-xs text-gray-400 hover:text-red-400 hover:bg-gray-700 transition-all">
                        <i className="fa-solid fa-rotate"></i>
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Created: {item.created}</p>
                  </div>
                ))}
              </div>
              <button className="w-full py-2.5 rounded-lg border border-dashed border-gray-700 text-sm text-gray-400 hover:border-violet-500 hover:text-violet-400 transition-all flex items-center justify-center gap-2">
                <i className="fa-solid fa-plus"></i>
                Generate New API Key
              </button>
            </div>
            </div>
          )}

          {/* Save Button */}
          <div className="flex justify-end gap-3">
            <button className="px-6 py-2.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 transition-all">
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium hover:from-violet-700 hover:to-indigo-700 transition-all flex items-center gap-2"
            >
              <i className="fa-solid fa-save"></i>
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
