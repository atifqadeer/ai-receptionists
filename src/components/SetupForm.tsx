import { useState } from 'react';
import VoicePreview from './VoicePreview';
import { useLocalStorage } from '../hooks/useLocalStorage';

export default function SetupForm() {
  const [activeTab, setActiveTab] = useState('identity');
  const [saved, setSaved] = useState(false);

  // Use localStorage hook for persistence
  const [identity, setIdentity] = useLocalStorage('agent-identity', {
    agentName: 'Aria',
    companyName: 'TechCorp Solutions',
    language: 'English',
    voice: 'skylar',
    speakingRate: 1.0,
    pitch: 1.0,
  });

  const [behavior, setBehavior] = useLocalStorage('agent-behavior', {
    greeting: 'Hello! Thank you for calling TechCorp Solutions. I\'m Aria, your AI assistant. How can I help you today?',
    farewell: 'Thank you for calling! Have a wonderful day.',
    holdMessage: 'Thank you for your patience. I\'m looking into that for you right now.',
    transferPhrase: 'Let me connect you with a specialist who can better assist you.',
    maxCallDuration: 15,
    silenceTimeout: 8,
    allowInterrupts: true,
    personality: 'professional',
  });

  const [knowledge, setKnowledge] = useLocalStorage('agent-knowledge', {
    businessHours: 'Monday to Friday, 9:00 AM to 6:00 PM EST',
    address: '123 Innovation Drive, Suite 400, San Francisco, CA 94102',
    phone: '+1 (555) 123-4567',
    email: 'support@techcorp.com',
    services: 'Web Development, Mobile Apps, Cloud Solutions, AI Integration',
    faqs: [
      { q: 'What are your business hours?', a: 'We are open Monday to Friday, 9 AM to 6 PM EST.' },
      { q: 'How do I book an appointment?', a: 'I can help you book an appointment right now. What date and time works best for you?' },
      { q: 'What services do you offer?', a: 'We offer web development, mobile apps, cloud solutions, and AI integration services.' },
    ],
  });

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const tabs = [
    { id: 'identity', label: 'Identity & Voice', icon: 'fa-id-badge' },
    { id: 'behavior', label: 'Behavior & Scripts', icon: 'fa-comments' },
    { id: 'knowledge', label: 'Knowledge Base', icon: 'fa-book' },
  ];

  return (
    <div className="space-y-6">
      {/* Save Notification */}
      {saved && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-500/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 animate-pulse">
          <i className="fa-solid fa-check-circle"></i>
          <span className="text-sm font-medium">Configuration saved successfully!</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <i className={`fa-solid ${tab.icon}`}></i>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Identity Tab */}
      {activeTab === 'identity' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-id-badge text-violet-400"></i>
              Agent Identity
            </h3>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Agent Name</label>
              <input
                type="text"
                value={identity.agentName}
                onChange={(e) => setIdentity({ ...identity, agentName: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Company Name</label>
              <input
                type="text"
                value={identity.companyName}
                onChange={(e) => setIdentity({ ...identity, companyName: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Primary Language</label>
              <select
                value={identity.language}
                onChange={(e) => setIdentity({ ...identity, language: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
              >
                <option>English</option>
                <option>Spanish</option>
                <option>French</option>
                <option>German</option>
                <option>Chinese</option>
                <option>Japanese</option>
                <option>Portuguese</option>
              </select>
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-microphone text-violet-400"></i>
              Voice Settings
            </h3>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Speaking Rate: {identity.speakingRate}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={identity.speakingRate}
                onChange={(e) => setIdentity({ ...identity, speakingRate: parseFloat(e.target.value) })}
                className="w-full accent-violet-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Slow</span>
                <span>Normal</span>
                <span>Fast</span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Pitch: {identity.pitch}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={identity.pitch}
                onChange={(e) => setIdentity({ ...identity, pitch: parseFloat(e.target.value) })}
                className="w-full accent-violet-500"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>Low</span>
                <span>Normal</span>
                <span>High</span>
              </div>
            </div>
            
            {/* Voice Preview Component */}
            <VoicePreview 
              selectedVoice={identity.voice}
              speakingRate={identity.speakingRate}
              pitch={identity.pitch}
              onSelectVoice={(voiceId) => setIdentity({ ...identity, voice: voiceId })}
            />
          </div>
        </div>
      )}

      {/* Behavior Tab */}
      {activeTab === 'behavior' && (
        <div className="space-y-6">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-comments text-violet-400"></i>
              Call Scripts
            </h3>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Greeting Message</label>
              <textarea
                value={behavior.greeting}
                onChange={(e) => setBehavior({ ...behavior, greeting: e.target.value })}
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Farewell Message</label>
              <textarea
                value={behavior.farewell}
                onChange={(e) => setBehavior({ ...behavior, farewell: e.target.value })}
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Hold Message</label>
              <textarea
                value={behavior.holdMessage}
                onChange={(e) => setBehavior({ ...behavior, holdMessage: e.target.value })}
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Transfer Phrase</label>
              <textarea
                value={behavior.transferPhrase}
                onChange={(e) => setBehavior({ ...behavior, transferPhrase: e.target.value })}
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none resize-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <i className="fa-solid fa-sliders text-violet-400"></i>
                Call Parameters
              </h3>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Max Call Duration (minutes): {behavior.maxCallDuration}
                </label>
                <input
                  type="range"
                  min="5"
                  max="30"
                  value={behavior.maxCallDuration}
                  onChange={(e) => setBehavior({ ...behavior, maxCallDuration: parseInt(e.target.value) })}
                  className="w-full accent-violet-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Silence Timeout (seconds): {behavior.silenceTimeout}
                </label>
                <input
                  type="range"
                  min="3"
                  max="15"
                  value={behavior.silenceTimeout}
                  onChange={(e) => setBehavior({ ...behavior, silenceTimeout: parseInt(e.target.value) })}
                  className="w-full accent-violet-500"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-300">Allow Barge-in</p>
                  <p className="text-xs text-gray-500">Let callers interrupt the agent</p>
                </div>
                <button
                  onClick={() => setBehavior({ ...behavior, allowInterrupts: !behavior.allowInterrupts })}
                  className={`relative w-12 h-6 rounded-full transition-all ${behavior.allowInterrupts ? 'bg-violet-600' : 'bg-gray-700'}`}
                >
                  <div 
                    className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200 ease-in-out"
                    style={{ transform: behavior.allowInterrupts ? 'translateX(24px)' : 'translateX(0)' }}
                  ></div>
                </button>
              </div>
            </div>

            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <i className="fa-solid fa-face-smile text-violet-400"></i>
                Personality
              </h3>
              <div className="space-y-3">
                {[
                  { id: 'professional', label: 'Professional', desc: 'Formal, concise, business-focused' },
                  { id: 'friendly', label: 'Friendly', desc: 'Warm, conversational, approachable' },
                  { id: 'casual', label: 'Casual', desc: 'Relaxed, humorous, personable' },
                  { id: 'empathetic', label: 'Empathetic', desc: 'Understanding, patient, caring' },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setBehavior({ ...behavior, personality: p.id })}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      behavior.personality === p.id
                        ? 'border-violet-500 bg-violet-500/10'
                        : 'border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <p className="text-sm font-medium text-white">{p.label}</p>
                    <p className="text-xs text-gray-400">{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Knowledge Base Tab */}
      {activeTab === 'knowledge' && (
        <div className="space-y-6">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-building text-violet-400"></i>
              Business Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Business Hours</label>
                <input
                  type="text"
                  value={knowledge.businessHours}
                  onChange={(e) => setKnowledge({ ...knowledge, businessHours: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Phone Number</label>
                <input
                  type="text"
                  value={knowledge.phone}
                  onChange={(e) => setKnowledge({ ...knowledge, phone: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                <input
                  type="text"
                  value={knowledge.email}
                  onChange={(e) => setKnowledge({ ...knowledge, email: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Address</label>
                <input
                  type="text"
                  value={knowledge.address}
                  onChange={(e) => setKnowledge({ ...knowledge, address: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Services Offered</label>
              <textarea
                value={knowledge.services}
                onChange={(e) => setKnowledge({ ...knowledge, services: e.target.value })}
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none resize-none"
              />
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <i className="fa-solid fa-question-circle text-violet-400"></i>
                FAQ Entries
              </h3>
              <button
                onClick={() => setKnowledge({ ...knowledge, faqs: [...knowledge.faqs, { q: '', a: '' }] })}
                className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700 transition-all flex items-center gap-1"
              >
                <i className="fa-solid fa-plus text-xs"></i>
                Add FAQ
              </button>
            </div>
            <div className="space-y-3">
              {knowledge.faqs.map((faq, idx) => (
                <div key={idx} className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-violet-400">FAQ #{idx + 1}</span>
                    <button
                      onClick={() => setKnowledge({ ...knowledge, faqs: knowledge.faqs.filter((_, i) => i !== idx) })}
                      className="text-gray-500 hover:text-red-400 transition-all"
                    >
                      <i className="fa-solid fa-trash text-xs"></i>
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Question..."
                    value={faq.q}
                    onChange={(e) => {
                      const newFaqs = [...knowledge.faqs];
                      newFaqs[idx] = { ...newFaqs[idx], q: e.target.value };
                      setKnowledge({ ...knowledge, faqs: newFaqs });
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none"
                  />
                  <textarea
                    placeholder="Answer..."
                    value={faq.a}
                    onChange={(e) => {
                      const newFaqs = [...knowledge.faqs];
                      newFaqs[idx] = { ...newFaqs[idx], a: e.target.value };
                      setKnowledge({ ...knowledge, faqs: newFaqs });
                    }}
                    rows={2}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none resize-none"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end gap-3">
        <button className="px-6 py-2.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 transition-all">
          Reset to Default
        </button>
        <button
          onClick={handleSave}
          className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium hover:from-violet-700 hover:to-indigo-700 transition-all flex items-center gap-2"
        >
          <i className="fa-solid fa-save"></i>
          Save Configuration
        </button>
      </div>
    </div>
  );
}
