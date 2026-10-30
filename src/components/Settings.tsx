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
    // Common fields
    phoneNumber: '+1 (555) 123-4567',
    webhookUrl: 'https://api.techcorp.com/webhooks/calls',
    maxConcurrentCalls: 10,
    enableSip: false,
    
    // Twilio specific
    twilioAccountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    twilioAuthToken: '••••••••••••••••••••••••',
    
    // Telnyx specific
    telnyxApiKey: '',
    telnyxConnectionId: '',
    telnyxMessagingProfileId: '',
    
    // Vonage specific
    vonageApiKey: '',
    vonageApiSecret: '',
    vonageApplicationId: '',
    vonagePrivateKey: '',
    
    // Plivo specific
    plivoAuthId: '',
    plivoAuthToken: '',
    
    // Bandwidth specific
    bandwidthAccountId: '',
    bandwidthApiToken: '',
    bandwidthApiSecret: '',
    
    // SignalWire specific
    signalWireProjectId: '',
    signalWireApiToken: '',
    signalWireSpaceUrl: '',
    
    // Amazon Connect specific
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    awsRegion: 'us-east-1',
    connectInstanceId: '',
    connectContactFlowId: '',
    
    // DialogFlow specific
    dialogFlowProjectId: '',
    dialogFlowServiceAccount: '',
    
    // MessageBird specific
    messageBirdAccessKey: '',
    messageBirdSigningKey: '',
    
    // Sinch specific
    sinchKeyId: '',
    sinchKeySecret: '',
    sinchServicePlanId: '',
    
    // Self-hosted (Asterisk/FreeSWITCH)
    sipServer: '',
    sipPort: '5060',
    sipUsername: '',
    sipPassword: '',
    sipTransport: 'udp',
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

          {/* Telephony Settings */}
          {activeSection === 'telephony' && (
            <div className="space-y-6">
              {/* Provider Selection Header */}
              <div className="bg-gradient-to-r from-emerald-600/10 to-teal-600/10 rounded-xl border border-emerald-500/20 p-5">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center flex-shrink-0">
                    <i className="fa-solid fa-phone-volume text-white text-xl"></i>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white mb-1">Telephony Provider Configuration</h3>
                    <p className="text-sm text-gray-300">
                      Select your telephony provider to handle incoming and outgoing calls. Each provider offers different features, pricing, and coverage.
                    </p>
                  </div>
                </div>
              </div>

              {/* Provider Grid Selection */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <i className="fa-solid fa-list-check text-emerald-400"></i>
                  Select Provider
                </h3>
                
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
                  {[
                    { id: 'twilio', name: 'Twilio', icon: 'fa-phone', color: 'from-red-500 to-red-600', desc: 'Most popular', popular: true },
                    { id: 'telnyx', name: 'Telnyx', icon: 'fa-phone-volume', color: 'from-blue-500 to-blue-600', desc: 'Cost-effective', popular: true },
                    { id: 'vonage', name: 'Vonage', icon: 'fa-mobile-screen', color: 'from-orange-500 to-orange-600', desc: 'Enterprise' },
                    { id: 'plivo', name: 'Plivo', icon: 'fa-tower-broadcast', color: 'from-purple-500 to-purple-600', desc: 'Developer-friendly' },
                    { id: 'bandwidth', name: 'Bandwidth', icon: 'fa-satellite-dish', color: 'from-cyan-500 to-cyan-600', desc: 'Direct carrier' },
                    { id: 'signalwire', name: 'SignalWire', icon: 'fa-wifi', color: 'from-pink-500 to-pink-600', desc: 'Freeswitch-based' },
                    { id: 'amazon', name: 'Amazon Connect', icon: 'fa-cloud', color: 'from-yellow-500 to-orange-500', desc: 'AWS Service' },
                    { id: 'messagebird', name: 'MessageBird', icon: 'fa-message', color: 'from-indigo-500 to-indigo-600', desc: 'Multi-channel' },
                    { id: 'sinch', name: 'Sinch', icon: 'fa-tower-cell', color: 'from-teal-500 to-teal-600', desc: 'CPaaS leader' },
                    { id: 'dialogflow', name: 'DialogFlow CX', icon: 'fa-robot', color: 'from-violet-500 to-violet-600', desc: 'Google Cloud' },
                    { id: 'asterisk', name: 'Asterisk', icon: 'fa-server', color: 'from-gray-500 to-gray-600', desc: 'Self-hosted' },
                    { id: 'freeswitch', name: 'FreeSWITCH', icon: 'fa-network-wired', color: 'from-slate-500 to-slate-600', desc: 'Self-hosted' },
                  ].map((provider) => (
                    <button
                      key={provider.id}
                      onClick={() => setTelephony({ ...telephony, provider: provider.id })}
                      className={`relative p-4 rounded-xl border transition-all text-left ${
                        telephony.provider === provider.id
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
                      }`}
                    >
                      {provider.popular && (
                        <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                          Popular
                        </span>
                      )}
                      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${provider.color} flex items-center justify-center mb-2`}>
                        <i className={`fa-solid ${provider.icon} text-white`}></i>
                      </div>
                      <p className="text-sm font-semibold text-white">{provider.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{provider.desc}</p>
                      {telephony.provider === provider.id && (
                        <div className="absolute top-2 left-2">
                          <i className="fa-solid fa-circle-check text-emerald-400"></i>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Provider-Specific Configuration */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <i className="fa-solid fa-gear text-emerald-400"></i>
                  {telephony.provider === 'twilio' && 'Twilio Configuration'}
                  {telephony.provider === 'telnyx' && 'Telnyx Configuration'}
                  {telephony.provider === 'vonage' && 'Vonage Configuration'}
                  {telephony.provider === 'plivo' && 'Plivo Configuration'}
                  {telephony.provider === 'bandwidth' && 'Bandwidth Configuration'}
                  {telephony.provider === 'signalwire' && 'SignalWire Configuration'}
                  {telephony.provider === 'amazon' && 'Amazon Connect Configuration'}
                  {telephony.provider === 'messagebird' && 'MessageBird Configuration'}
                  {telephony.provider === 'sinch' && 'Sinch Configuration'}
                  {telephony.provider === 'dialogflow' && 'DialogFlow CX Configuration'}
                  {telephony.provider === 'asterisk' && 'Asterisk Configuration'}
                  {telephony.provider === 'freeswitch' && 'FreeSWITCH Configuration'}
                </h3>

                {/* Provider Description */}
                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
                  {telephony.provider === 'twilio' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">Twilio</strong> - The most widely used cloud communications platform. Offers voice, SMS, video, and email APIs with global coverage.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ 180+ countries</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Excellent docs</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Pay-as-you-go</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.0085/min</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'telnyx' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">Telnyx</strong> - Cost-effective alternative to Twilio with direct carrier connections. Lower latency and better pricing for high-volume calls.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ 50% cheaper than Twilio</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Direct carrier</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Mission Control portal</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.004/min</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'vonage' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">Vonage (Nexmo)</strong> - Enterprise-grade communications API with strong focus on business messaging and voice services.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Enterprise features</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Number Insights</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Verify API</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.01/min</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'plivo' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">Plivo</strong> - Developer-friendly CPaaS with simple APIs and competitive pricing. Great for startups and mid-size businesses.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Simple API</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Powerpack for SMS</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ PHLO visual builder</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.007/min</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'bandwidth' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">Bandwidth</strong> - Direct carrier with own network infrastructure. Lowest latency and best for high-volume US/Canada calls.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Own network</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Lowest latency</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Enterprise SLA</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.004/min</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'signalwire' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">SignalWire</strong> - Built by FreeSWITCH creators. Compatible with existing FreeSWITCH setups with modern API layer.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ FreeSWITCH compatible</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Low latency</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Competitive pricing</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.005/min</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'amazon' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">Amazon Connect</strong> - AWS contact center service with omnichannel support. Integrates with AWS ecosystem and Lambda functions.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ AWS integration</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Contact flows</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Pay per use</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.008/min</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'messagebird' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">MessageBird</strong> - Multi-channel communications platform with strong focus on messaging, voice, and verification services.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Multi-channel</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Flow builder</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Global reach</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.009/min</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'sinch' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">Sinch</strong> - Leading CPaaS provider with comprehensive voice, SMS, and video services. Strong European presence.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Global coverage</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Enterprise grade</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Strong in EU</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.008/min</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'dialogflow' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">DialogFlow CX</strong> - Google Cloud's conversational AI platform with telephony integration. Combines NLU with voice services.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Google Cloud</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Advanced NLU</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Visual builder</span>
                        <span className="px-2 py-1 rounded bg-blue-500/10 text-blue-300">$0.01/min + NLU</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'asterisk' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">Asterisk</strong> - Open-source PBX software. Self-hosted solution with complete control. Requires technical expertise.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Open source</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Full control</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ No per-minute fees</span>
                        <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-300">⚠ Self-hosted</span>
                      </div>
                    </div>
                  )}
                  {telephony.provider === 'freeswitch' && (
                    <div>
                      <p className="text-sm text-gray-300 mb-2">
                        <strong className="text-white">FreeSWITCH</strong> - Open-source telephony platform. Scalable and flexible, used by many large enterprises.
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Open source</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Highly scalable</span>
                        <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">✓ Enterprise proven</span>
                        <span className="px-2 py-1 rounded bg-amber-500/10 text-amber-300">⚠ Self-hosted</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Provider-Specific Fields */}
                {telephony.provider === 'twilio' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Account SID</label>
                        <input
                          type="text"
                          value={telephony.twilioAccountSid}
                          onChange={(e) => setTelephony({ ...telephony, twilioAccountSid: e.target.value })}
                          placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Auth Token</label>
                        <input
                          type="password"
                          value={telephony.twilioAuthToken}
                          onChange={(e) => setTelephony({ ...telephony, twilioAuthToken: e.target.value })}
                          placeholder="Your Twilio auth token"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from Twilio Console
                    </a>
                  </div>
                )}

                {telephony.provider === 'telnyx' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">API Key</label>
                      <input
                        type="password"
                        value={telephony.telnyxApiKey}
                        onChange={(e) => setTelephony({ ...telephony, telnyxApiKey: e.target.value })}
                        placeholder="KEY0xxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Connection ID</label>
                        <input
                          type="text"
                          value={telephony.telnyxConnectionId}
                          onChange={(e) => setTelephony({ ...telephony, telnyxConnectionId: e.target.value })}
                          placeholder="Voice connection ID"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Messaging Profile ID</label>
                        <input
                          type="text"
                          value={telephony.telnyxMessagingProfileId}
                          onChange={(e) => setTelephony({ ...telephony, telnyxMessagingProfileId: e.target.value })}
                          placeholder="Optional - for SMS"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://portal.telnyx.com" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from Telnyx Mission Control
                    </a>
                  </div>
                )}

                {telephony.provider === 'vonage' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">API Key</label>
                        <input
                          type="text"
                          value={telephony.vonageApiKey}
                          onChange={(e) => setTelephony({ ...telephony, vonageApiKey: e.target.value })}
                          placeholder="Your Vonage API key"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">API Secret</label>
                        <input
                          type="password"
                          value={telephony.vonageApiSecret}
                          onChange={(e) => setTelephony({ ...telephony, vonageApiSecret: e.target.value })}
                          placeholder="Your Vonage API secret"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Application ID</label>
                        <input
                          type="text"
                          value={telephony.vonageApplicationId}
                          onChange={(e) => setTelephony({ ...telephony, vonageApplicationId: e.target.value })}
                          placeholder="Voice application ID"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Private Key</label>
                        <input
                          type="password"
                          value={telephony.vonagePrivateKey}
                          onChange={(e) => setTelephony({ ...telephony, vonagePrivateKey: e.target.value })}
                          placeholder="RSA private key"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://dashboard.nexmo.com" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from Vonage Dashboard
                    </a>
                  </div>
                )}

                {telephony.provider === 'plivo' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Auth ID</label>
                        <input
                          type="text"
                          value={telephony.plivoAuthId}
                          onChange={(e) => setTelephony({ ...telephony, plivoAuthId: e.target.value })}
                          placeholder="MAXXXXXXXXXXXXXXXXXX"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Auth Token</label>
                        <input
                          type="password"
                          value={telephony.plivoAuthToken}
                          onChange={(e) => setTelephony({ ...telephony, plivoAuthToken: e.target.value })}
                          placeholder="Your Plivo auth token"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://console.plivo.com" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from Plivo Console
                    </a>
                  </div>
                )}

                {telephony.provider === 'bandwidth' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Account ID</label>
                        <input
                          type="text"
                          value={telephony.bandwidthAccountId}
                          onChange={(e) => setTelephony({ ...telephony, bandwidthAccountId: e.target.value })}
                          placeholder="Your Bandwidth account ID"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">API Token</label>
                        <input
                          type="password"
                          value={telephony.bandwidthApiToken}
                          onChange={(e) => setTelephony({ ...telephony, bandwidthApiToken: e.target.value })}
                          placeholder="Your API token"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">API Secret</label>
                        <input
                          type="password"
                          value={telephony.bandwidthApiSecret}
                          onChange={(e) => setTelephony({ ...telephony, bandwidthApiSecret: e.target.value })}
                          placeholder="Your API secret"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://dev.bandwidth.com" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from Bandwidth Developer Portal
                    </a>
                  </div>
                )}

                {telephony.provider === 'signalwire' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Project ID</label>
                        <input
                          type="text"
                          value={telephony.signalWireProjectId}
                          onChange={(e) => setTelephony({ ...telephony, signalWireProjectId: e.target.value })}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">API Token</label>
                        <input
                          type="password"
                          value={telephony.signalWireApiToken}
                          onChange={(e) => setTelephony({ ...telephony, signalWireApiToken: e.target.value })}
                          placeholder="PTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Space URL</label>
                        <input
                          type="text"
                          value={telephony.signalWireSpaceUrl}
                          onChange={(e) => setTelephony({ ...telephony, signalWireSpaceUrl: e.target.value })}
                          placeholder="your-space.signalwire.com"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://mysignalwire.com" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from SignalWire Dashboard
                    </a>
                  </div>
                )}

                {telephony.provider === 'amazon' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">AWS Access Key ID</label>
                        <input
                          type="text"
                          value={telephony.awsAccessKeyId}
                          onChange={(e) => setTelephony({ ...telephony, awsAccessKeyId: e.target.value })}
                          placeholder="AKIAxxxxxxxxxxxxxxxx"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">AWS Secret Access Key</label>
                        <input
                          type="password"
                          value={telephony.awsSecretAccessKey}
                          onChange={(e) => setTelephony({ ...telephony, awsSecretAccessKey: e.target.value })}
                          placeholder="Your AWS secret key"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">AWS Region</label>
                        <select
                          value={telephony.awsRegion}
                          onChange={(e) => setTelephony({ ...telephony, awsRegion: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                        >
                          <option value="us-east-1">US East (N. Virginia)</option>
                          <option value="us-west-2">US West (Oregon)</option>
                          <option value="eu-central-1">EU (Frankfurt)</option>
                          <option value="eu-west-2">EU (London)</option>
                          <option value="ap-southeast-2">Asia Pacific (Sydney)</option>
                          <option value="ca-central-1">Canada (Central)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Connect Instance ID</label>
                        <input
                          type="text"
                          value={telephony.connectInstanceId}
                          onChange={(e) => setTelephony({ ...telephony, connectInstanceId: e.target.value })}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Contact Flow ID (Optional)</label>
                        <input
                          type="text"
                          value={telephony.connectContactFlowId}
                          onChange={(e) => setTelephony({ ...telephony, connectContactFlowId: e.target.value })}
                          placeholder="Default contact flow ID"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://console.aws.amazon.com/connect" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from AWS Console
                    </a>
                  </div>
                )}

                {telephony.provider === 'messagebird' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Access Key</label>
                        <input
                          type="password"
                          value={telephony.messageBirdAccessKey}
                          onChange={(e) => setTelephony({ ...telephony, messageBirdAccessKey: e.target.value })}
                          placeholder="Your MessageBird access key"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Signing Key (Optional)</label>
                        <input
                          type="password"
                          value={telephony.messageBirdSigningKey}
                          onChange={(e) => setTelephony({ ...telephony, messageBirdSigningKey: e.target.value })}
                          placeholder="For webhook verification"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://dashboard.messagebird.com" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from MessageBird Dashboard
                    </a>
                  </div>
                )}

                {telephony.provider === 'sinch' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Key ID</label>
                        <input
                          type="text"
                          value={telephony.sinchKeyId}
                          onChange={(e) => setTelephony({ ...telephony, sinchKeyId: e.target.value })}
                          placeholder="Your Sinch key ID"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Key Secret</label>
                        <input
                          type="password"
                          value={telephony.sinchKeySecret}
                          onChange={(e) => setTelephony({ ...telephony, sinchKeySecret: e.target.value })}
                          placeholder="Your Sinch key secret"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Service Plan ID</label>
                        <input
                          type="text"
                          value={telephony.sinchServicePlanId}
                          onChange={(e) => setTelephony({ ...telephony, sinchServicePlanId: e.target.value })}
                          placeholder="Your service plan ID"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://dashboard.sinch.com" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from Sinch Dashboard
                    </a>
                  </div>
                )}

                {telephony.provider === 'dialogflow' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Project ID</label>
                        <input
                          type="text"
                          value={telephony.dialogFlowProjectId}
                          onChange={(e) => setTelephony({ ...telephony, dialogFlowProjectId: e.target.value })}
                          placeholder="your-gcp-project-id"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Service Account JSON</label>
                        <input
                          type="password"
                          value={telephony.dialogFlowServiceAccount}
                          onChange={(e) => setTelephony({ ...telephony, dialogFlowServiceAccount: e.target.value })}
                          placeholder="Path to service account JSON or paste content"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                    </div>
                    <a href="https://dialogflow.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-sm text-violet-400 hover:text-violet-300 flex items-center gap-1">
                      <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                      Get credentials from DialogFlow Console
                    </a>
                  </div>
                )}

                {(telephony.provider === 'asterisk' || telephony.provider === 'freeswitch') && (
                  <div className="space-y-4">
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 mb-4">
                      <p className="text-sm text-amber-300 flex items-start gap-2">
                        <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
                        <span>Self-hosted solution requires technical expertise. Ensure your PBX is properly configured and accessible.</span>
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">SIP Server</label>
                        <input
                          type="text"
                          value={telephony.sipServer}
                          onChange={(e) => setTelephony({ ...telephony, sipServer: e.target.value })}
                          placeholder="sip.yourdomain.com"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">SIP Port</label>
                        <input
                          type="text"
                          value={telephony.sipPort}
                          onChange={(e) => setTelephony({ ...telephony, sipPort: e.target.value })}
                          placeholder="5060"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">SIP Username</label>
                        <input
                          type="text"
                          value={telephony.sipUsername}
                          onChange={(e) => setTelephony({ ...telephony, sipUsername: e.target.value })}
                          placeholder="ai_receptionist"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">SIP Password</label>
                        <input
                          type="password"
                          value={telephony.sipPassword}
                          onChange={(e) => setTelephony({ ...telephony, sipPassword: e.target.value })}
                          placeholder="Your SIP password"
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Transport Protocol</label>
                        <select
                          value={telephony.sipTransport}
                          onChange={(e) => setTelephony({ ...telephony, sipTransport: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                        >
                          <option value="udp">UDP (Default)</option>
                          <option value="tcp">TCP</option>
                          <option value="tls">TLS (Secure)</option>
                          <option value="ws">WebSocket</option>
                          <option value="wss">WebSocket Secure</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Common Fields for All Providers */}
                <div className="pt-5 border-t border-gray-800 space-y-4">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                    <i className="fa-solid fa-globe text-emerald-400"></i>
                    Common Settings
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1.5">Phone Number</label>
                      <input
                        type="text"
                        value={telephony.phoneNumber}
                        onChange={(e) => setTelephony({ ...telephony, phoneNumber: e.target.value })}
                        placeholder="+1 (555) 123-4567"
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
                      placeholder="https://yourdomain.com/webhooks/calls"
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      URL where call events will be sent. Must be publicly accessible.
                    </p>
                  </div>
                </div>

                {/* SIP Trunking Toggle */}
                <div className="flex items-center justify-between pt-3 border-t border-gray-800">
                  <div>
                    <p className="text-sm font-medium text-gray-300">Enable SIP Trunking</p>
                    <p className="text-xs text-gray-500">Connect via SIP protocol for on-premise PBX integration</p>
                  </div>
                  <button
                    onClick={() => setTelephony({ ...telephony, enableSip: !telephony.enableSip })}
                    className={`relative w-11 h-6 rounded-full transition-all ${telephony.enableSip ? 'bg-violet-600' : 'bg-gray-700'}`}
                  >
                    <div 
                      className="absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform duration-200 ease-in-out"
                      style={{ transform: telephony.enableSip ? 'translateX(20px)' : 'translateX(0)' }}
                    ></div>
                  </button>
                </div>
              </div>

              {/* Save Button */}
              <div className="flex justify-end gap-3">
                <button className="px-6 py-2.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 transition-all">
                  Test Connection
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
                      className={`relative w-11 h-6 rounded-full transition-all ${ai[toggle.key as keyof typeof ai] ? 'bg-violet-600' : 'bg-gray-700'}`}
                    >
                      <div 
                        className="absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform duration-200 ease-in-out"
                        style={{ transform: ai[toggle.key as keyof typeof ai] ? 'translateX(20px)' : 'translateX(0)' }}
                      ></div>
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
