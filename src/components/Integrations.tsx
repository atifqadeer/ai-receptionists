import { useState } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface ServiceConfig {
  apiKey: string;
  enabled: boolean;
}

interface IntegrationsState {
  // AI Brain
  openai: ServiceConfig & { model: string };
  anthropic: ServiceConfig & { model: string };
  
  // Voice Provider (TTS) - User picks ONE
  voiceProvider: 'elevenlabs' | 'cartesia';
  elevenlabs: ServiceConfig & { voiceId: string };
  cartesia: ServiceConfig & { voiceId: string };
  
  // Speech-to-Text (STT)
  deepgram: ServiceConfig & { model: string };
  
  // Phone Calls
  twilio: ServiceConfig & { accountSid: string; phoneNumber: string };
  
  // Optional Integrations
  slack: ServiceConfig & { channelId: string };
  sendgrid: ServiceConfig & { fromEmail: string };
  googleCalendar: ServiceConfig;
}

export default function Integrations() {
  const [saved, setSaved] = useState(false);
  
  // Use localStorage hook for persistence
  const [config, setConfig] = useLocalStorage<IntegrationsState>('integrations-config', {
    // AI Brain
    openai: { apiKey: '', enabled: true, model: 'gpt-4-turbo' },
    anthropic: { apiKey: '', enabled: false, model: 'claude-3-opus' },
    
    // Voice Provider
    voiceProvider: 'elevenlabs',
    elevenlabs: { apiKey: '', enabled: true, voiceId: '21m00Tcm4TlvDq8ikWAM' },
    cartesia: { apiKey: '', enabled: false, voiceId: 'sonic-english' },
    
    // Speech-to-Text
    deepgram: { apiKey: '', enabled: true, model: 'nova-2' },
    
    // Phone Calls
    twilio: { apiKey: '', enabled: false, accountSid: '', phoneNumber: '' },
    
    // Optional
    slack: { apiKey: '', enabled: false, channelId: '' },
    sendgrid: { apiKey: '', enabled: false, fromEmail: '' },
    googleCalendar: { apiKey: '', enabled: false },
  });

  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const toggleShowKey = (key: string) => {
    setShowKey(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateService = (service: string, field: string, value: any) => {
    setConfig(prev => ({
      ...prev,
      [service]: { ...(prev as any)[service], [field]: value }
    }));
  };

  const services = [
    {
      category: 'AI Brain',
      subtitle: 'Powers the AI agent\'s conversation and intelligence',
      color: 'from-violet-500 to-indigo-600',
      icon: 'fa-brain',
      required: true,
      items: [
        {
          key: 'openai',
          name: 'OpenAI',
          description: 'Primary AI engine for conversations, intent detection, and response generation. Handles all chat logic and decision making.',
          url: 'https://platform.openai.com/api-keys',
          fields: [
            { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
            { name: 'model', label: 'Model', type: 'select', options: ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'] }
          ],
          cost: '$0.01-0.03 per call',
          status: config.openai.apiKey ? 'connected' : 'required'
        },
        {
          key: 'anthropic',
          name: 'Anthropic (Claude)',
          description: 'Alternative AI engine. Can be used as a backup or for specific conversation styles. Claude excels at nuanced, empathetic responses.',
          url: 'https://console.anthropic.com/',
          fields: [
            { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
            { name: 'model', label: 'Model', type: 'select', options: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'] }
          ],
          cost: '$0.01-0.05 per call',
          status: config.anthropic.enabled ? (config.anthropic.apiKey ? 'connected' : 'pending') : 'disabled'
        }
      ]
    },
    {
      category: 'Voice Synthesis (TTS)',
      subtitle: 'Converts AI text responses into natural speech for callers',
      color: 'from-pink-500 to-rose-600',
      icon: 'fa-volume-high',
      required: true,
      note: 'Choose ONE voice provider below',
      items: []
    },
    {
      category: 'Speech Recognition (STT)',
      subtitle: 'Converts caller\'s speech into text for the AI to understand',
      color: 'from-blue-500 to-cyan-600',
      icon: 'fa-microphone-lines',
      required: true,
      items: [
        {
          key: 'deepgram',
          name: 'Deepgram',
          description: 'Real-time speech-to-text conversion. Listens to caller\'s voice and converts it to text so the AI can understand and respond. Nova-2 model offers 95%+ accuracy.',
          url: 'https://console.deepgram.com/',
          fields: [
            { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Your Deepgram API key' },
            { name: 'model', label: 'Model', type: 'select', options: ['nova-2', 'nova', 'enhanced', 'base'] }
          ],
          cost: '$0.0043 per minute',
          status: config.deepgram.apiKey ? 'connected' : 'required'
        }
      ]
    },
    {
      category: 'Phone System',
      subtitle: 'Handles real phone calls from customers',
      color: 'from-emerald-500 to-teal-600',
      icon: 'fa-phone-volume',
      required: false,
      items: [
        {
          key: 'twilio',
          name: 'Twilio',
          description: 'Telephony platform that receives real phone calls, routes them to the AI agent, and manages call lifecycle (ringing, active, hold, transfer, end).',
          url: 'https://console.twilio.com/',
          fields: [
            { name: 'apiKey', label: 'Auth Token', type: 'password', placeholder: 'Your Twilio auth token' },
            { name: 'accountSid', label: 'Account SID', type: 'text', placeholder: 'ACxxxxxxxxxx' },
            { name: 'phoneNumber', label: 'Phone Number', type: 'text', placeholder: '+1234567890' }
          ],
          cost: '$1/month + $0.01/min',
          status: config.twilio.apiKey ? 'connected' : 'not-configured'
        }
      ]
    },
    {
      category: 'Notifications & Integrations',
      subtitle: 'Optional services to enhance your AI receptionist',
      color: 'from-amber-500 to-orange-600',
      icon: 'fa-bell',
      required: false,
      items: [
        {
          key: 'slack',
          name: 'Slack',
          description: 'Sends real-time notifications to your team\'s Slack channel when calls come in, escalations happen, or important events occur.',
          url: 'https://api.slack.com/apps',
          fields: [
            { name: 'apiKey', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...' },
            { name: 'channelId', label: 'Channel ID', type: 'text', placeholder: 'C0123456789' }
          ],
          cost: 'Free',
          status: config.slack.enabled ? (config.slack.apiKey ? 'connected' : 'pending') : 'disabled'
        },
        {
          key: 'sendgrid',
          name: 'SendGrid',
          description: 'Sends automated emails for call summaries, appointment confirmations, voicemail notifications, and follow-up messages to callers.',
          url: 'https://app.sendgrid.com/settings/api_keys',
          fields: [
            { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'SG....' },
            { name: 'fromEmail', label: 'From Email', type: 'text', placeholder: 'receptionist@yourcompany.com' }
          ],
          cost: 'Free (100 emails/day)',
          status: config.sendgrid.enabled ? (config.sendgrid.apiKey ? 'connected' : 'pending') : 'disabled'
        },
        {
          key: 'googleCalendar',
          name: 'Google Calendar',
          description: 'Automatically books, updates, and cancels appointments in your Google Calendar when callers request appointments through the AI agent.',
          url: 'https://console.cloud.google.com/',
          fields: [],
          cost: 'Free',
          status: config.googleCalendar.enabled ? 'connected' : 'disabled'
        }
      ]
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600/10 to-indigo-600/10 rounded-xl border border-violet-500/20 p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <i className="fa-solid fa-plug text-white text-xl"></i>
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-bold text-white mb-1">Service Integrations</h3>
            <p className="text-sm text-gray-300">
              Configure the external services that power your AI Receptionist. Each service has a specific role in the system.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-xs px-2 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">
                <i className="fa-solid fa-asterisk mr-1 text-[8px]"></i>Required
              </span>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-700 text-gray-300">
                Optional
              </span>
              <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                <i className="fa-solid fa-check mr-1"></i>Connected
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Other Services */}
      {services.filter(s => s.category !== 'AI Brain' && s.category !== 'Voice Synthesis (TTS)' && s.category !== 'Speech Recognition (STT)').map((category, catIdx) => (
        <div key={catIdx} className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${category.color} flex items-center justify-center`}>
              <i className={`fa-solid ${category.icon} text-white`}></i>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-white">{category.category}</h3>
              <p className="text-xs text-gray-400">{category.subtitle}</p>
            </div>
            {category.required && (
              <span className="text-xs px-2 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">
                <i className="fa-solid fa-asterisk mr-1 text-[8px]"></i>Required
              </span>
            )}
            {category.note && (
              <span className="text-xs px-2 py-1 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">
                <i className="fa-solid fa-circle-info mr-1"></i>{category.note}
              </span>
            )}
          </div>

          <div className="space-y-3">
            {category.items.map((service) => {
              const serviceConfig = config[service.key as keyof IntegrationsState] as any;
              const isEnabled = serviceConfig?.enabled !== false;

              return (
                <div key={service.key} className={`p-4 rounded-lg border transition-all ${
                  isEnabled ? 'bg-gray-800/30 border-gray-700/50' : 'bg-gray-800/10 border-gray-800 opacity-60'
                }`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-semibold text-white">{service.name}</h4>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          service.status === 'connected' ? 'bg-emerald-500/10 text-emerald-400' :
                          service.status === 'required' ? 'bg-red-500/10 text-red-400' :
                          service.status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
                          'bg-gray-700 text-gray-400'
                        }`}>
                          {service.status === 'connected' && <i className="fa-solid fa-check mr-1"></i>}
                          {service.status === 'required' && <i className="fa-solid fa-asterisk mr-1 text-[8px]"></i>}
                          {service.status}
                        </span>
                        <span className="text-xs text-gray-500">{service.cost}</span>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed">{service.description}</p>
                    </div>
                    {service.key !== 'openai' && (
                      <button
                        onClick={() => updateService(service.key as any, 'enabled', !isEnabled)}
                        className={`relative w-11 h-6 rounded-full transition-all flex-shrink-0 ml-3 ${isEnabled ? 'bg-violet-600' : 'bg-gray-700'}`}
                      >
                        <div 
                          className="absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform duration-200 ease-in-out"
                          style={{ transform: isEnabled ? 'translateX(20px)' : 'translateX(0)' }}
                        ></div>
                      </button>
                    )}
                  </div>

                  {isEnabled && service.fields.length > 0 && (
                    <div className="space-y-2 pt-3 border-t border-gray-700/50">
                      {service.fields.map((field) => (
                        <div key={field.name}>
                          <label className="block text-xs text-gray-400 mb-1">{field.label}</label>
                          {field.type === 'select' ? (
                            <select
                              value={serviceConfig[field.name] || ''}
                              onChange={(e) => updateService(service.key as any, field.name, e.target.value)}
                              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none"
                            >
                              {field.options?.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (
                            <div className="relative">
                              <input
                                type={field.type === 'password' && !showKey[`${service.key}-${field.name}`] ? 'password' : 'text'}
                                value={serviceConfig[field.name] || ''}
                                onChange={(e) => updateService(service.key as any, field.name, e.target.value)}
                                placeholder={field.placeholder}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none pr-10 font-mono"
                              />
                              {field.type === 'password' && (
                                <button
                                  onClick={() => toggleShowKey(`${service.key}-${field.name}`)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-gray-400 hover:text-white"
                                >
                                  <i className={`fa-solid ${showKey[`${service.key}-${field.name}`] ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      <a
                        href={service.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 mt-1"
                      >
                        <i className="fa-solid fa-arrow-up-right-from-square"></i>
                        Get API key from {service.name}
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Save Button */}
      <div className="flex justify-end gap-3">
        <button
          onClick={() => {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
          className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium hover:from-violet-700 hover:to-indigo-700 transition-all flex items-center gap-2"
        >
          <i className="fa-solid fa-save"></i>
          Save Configuration
        </button>
      </div>

      {saved && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-500/90 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2">
          <i className="fa-solid fa-check-circle"></i>
          <span className="text-sm font-medium">Integrations saved successfully!</span>
        </div>
      )}
    </div>
  );
}
