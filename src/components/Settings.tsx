import { useState } from 'react';
import ApiKeysGuide from './ApiKeysGuide';
import Integrations from './Integrations';
import AiModelSettings from './AiModelSettings';
import { useLocalStorage } from '../hooks/useLocalStorage';

// `section` is set when shown inside the unified Settings page, which
// draws its own tabs; the built-in section list is then hidden.
export default function Settings({ section }: { section?: string } = {}) {
  const [ownSection, setActiveSection] = useState('integrations');
  const activeSection = section ?? ownSection;

  // Use localStorage hook for persistence
  const [general, setGeneral] = useLocalStorage('settings-general', {
    systemName: 'AI Receptionist Hub',
    timezone: 'America/New_York',
    dateFormat: 'MM/DD/YYYY',
    enableNotifications: true,
    enableCallRecording: true,
    enableTranscripts: true,
    autoSaveTranscripts: true,
  });

  const sections = [
    { id: 'general', label: 'General', icon: 'fa-cog' },
    { id: 'integrations', label: 'Integrations', icon: 'fa-plug' },
    { id: 'ai', label: 'AI Model', icon: 'fa-brain' },
    { id: 'api', label: 'API Keys Guide', icon: 'fa-key' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Section Nav */}
        {!section && (
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
        )}

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
                      className={`relative w-11 h-6 rounded-full transition-all ${general[toggle.key as keyof typeof general] ? 'bg-violet-600' : 'bg-gray-700'}`}
                    >
                      <div 
                        className="absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform duration-200 ease-in-out"
                        style={{ transform: general[toggle.key as keyof typeof general] ? 'translateX(20px)' : 'translateX(0)' }}
                      ></div>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Integrations Settings */}
          {activeSection === 'integrations' && (
            <div className="space-y-6">
              <Integrations />
            </div>
          )}

          {/* AI Model: saved in the backend (it has its own Save button) */}
          {activeSection === 'ai' && <AiModelSettings />}

          {/* API Keys */}
          {activeSection === 'api' && <ApiKeysGuide />}
        </div>
      </div>
    </div>
  );
}
