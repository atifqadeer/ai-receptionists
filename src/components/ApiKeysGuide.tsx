import { useState } from 'react';

export default function ApiKeysGuide() {
  const [activeTab, setActiveTab] = useState<'overview' | 'dev' | 'prod' | 'best'>('overview');

  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'fa-circle-info' },
    { id: 'dev', label: 'Development', icon: 'fa-code' },
    { id: 'prod', label: 'Production', icon: 'fa-rocket' },
    { id: 'best', label: 'Best Practices', icon: 'fa-shield-halved' },
  ];

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <i className="fa-solid fa-key text-violet-400"></i>
          API Keys: Development vs Production
        </h3>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
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

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Development Card */}
            <div className="p-5 rounded-xl bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/30">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <i className="fa-solid fa-code text-blue-400"></i>
                </div>
                <div>
                  <h4 className="font-semibold text-white">Development Keys</h4>
                  <p className="text-xs text-gray-400">For testing & local development</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-blue-400 mt-1 text-xs"></i>
                  <span>Test mode / sandbox environment</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-blue-400 mt-1 text-xs"></i>
                  <span>No real charges (or limited free tier)</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-blue-400 mt-1 text-xs"></i>
                  <span>Can be shared in team (not in git!)</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-blue-400 mt-1 text-xs"></i>
                  <span>Used with localhost / local testing</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-blue-400 mt-1 text-xs"></i>
                  <span>Prefix: <code className="text-blue-300 bg-blue-500/10 px-1 rounded">test_</code> or <code className="text-blue-300 bg-blue-500/10 px-1 rounded">sk-...</code></span>
                </li>
              </ul>
            </div>

            {/* Production Card */}
            <div className="p-5 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <i className="fa-solid fa-rocket text-emerald-400"></i>
                </div>
                <div>
                  <h4 className="font-semibold text-white">Production Keys</h4>
                  <p className="text-xs text-gray-400">For live / customer-facing use</p>
                </div>
              </div>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-emerald-400 mt-1 text-xs"></i>
                  <span>Live mode / real environment</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-emerald-400 mt-1 text-xs"></i>
                  <span>Real charges apply (pay-as-you-go)</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-emerald-400 mt-1 text-xs"></i>
                  <span>Keep SECRET - never share or commit</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-emerald-400 mt-1 text-xs"></i>
                  <span>Used with real domain / live server</span>
                </li>
                <li className="flex items-start gap-2">
                  <i className="fa-solid fa-check text-emerald-400 mt-1 text-xs"></i>
                  <span>Prefix: <code className="text-emerald-300 bg-emerald-500/10 px-1 rounded">live_</code> or <code className="text-emerald-300 bg-emerald-500/10 px-1 rounded">pk_live_</code></span>
                </li>
              </ul>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-sm text-amber-300 flex items-start gap-2">
              <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
              <span><strong>Important:</strong> Never use production keys in development! If a dev key is leaked, you can revoke it without affecting live customers. If a prod key is leaked, you may face real charges and security risks.</span>
            </p>
          </div>
        </div>
      )}

      {/* Development Tab */}
      {activeTab === 'dev' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20 mb-4">
            <p className="text-sm text-blue-300">
              <i className="fa-solid fa-lightbulb mr-2"></i>
              Use these keys while building, testing, and debugging on your local machine.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-white">Development Keys by Service:</h4>
            
            {[
              {
                service: 'OpenAI',
                devKey: 'sk-proj-... (test mode)',
                devUrl: 'https://platform.openai.com/api-keys',
                note: 'Same key, but monitor usage in dev. Set usage limits!',
                free: 'No free tier - pay as you go',
                icon: 'fa-brain',
                color: 'text-emerald-400'
              },
              {
                service: 'Twilio',
                devKey: 'Test Credentials (from console)',
                devUrl: 'https://console.twilio.com',
                note: 'Use Test SID & Token - no real calls, no charges',
                free: 'Free trial available',
                icon: 'fa-phone',
                color: 'text-red-400'
              },
              {
                service: 'ElevenLabs',
                devKey: 'Free tier API key',
                devUrl: 'https://elevenlabs.io/app/subscription',
                note: '10,000 characters/month free in dev',
                free: 'Free: 10k chars/month',
                icon: 'fa-microphone',
                color: 'text-purple-400'
              },
              {
                service: 'Deepgram',
                devKey: 'Free tier API key',
                devUrl: 'https://console.deepgram.com/',
                note: '$200 free credit for development',
                free: 'Free: $200 credit',
                icon: 'fa-ear-listen',
                color: 'text-blue-400'
              },
            ].map((item, idx) => (
              <div key={idx} className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <i className={`fa-solid ${item.icon} ${item.color}`}></i>
                    <h5 className="text-sm font-medium text-white">{item.service}</h5>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{item.free}</span>
                </div>
                <div className="space-y-1 text-xs">
                  <p className="text-gray-400">
                    <span className="text-gray-500">Key format:</span>{' '}
                    <code className="text-blue-300 bg-blue-500/10 px-1.5 py-0.5 rounded">{item.devKey}</code>
                  </p>
                  <p className="text-gray-400">
                    <span className="text-gray-500">Get from:</span>{' '}
                    <a href={item.devUrl} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300">
                      {item.devUrl} <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                    </a>
                  </p>
                  <p className="text-gray-400">
                    <span className="text-gray-500">Note:</span> {item.note}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
            <h4 className="text-sm font-semibold text-white mb-2">
              <i className="fa-solid fa-file-code text-blue-400 mr-2"></i>
              Example .env.development
            </h4>
            <pre className="text-xs text-gray-300 bg-gray-950 p-3 rounded-lg overflow-x-auto font-mono">
{`APP_ENV=development
APP_DEBUG=true

# OpenAI (use same key but set limits)
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-3.5-turbo  # Cheaper for dev

# Twilio TEST credentials (no real calls)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_test_auth_token
TWILIO_PHONE_NUMBER=+15005550006  # Twilio test number

# ElevenLabs (free tier)
ELEVENLABS_API_KEY=your_free_tier_key

# Deepgram (free credit)
DEEPGRAM_API_KEY=your_free_credit_key`}
            </pre>
          </div>
        </div>
      )}

      {/* Production Tab */}
      {activeTab === 'prod' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20 mb-4">
            <p className="text-sm text-emerald-300">
              <i className="fa-solid fa-rocket mr-2"></i>
              Use these keys when deploying to production with real customers.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-white">Production Keys by Service:</h4>
            
            {[
              {
                service: 'OpenAI',
                prodKey: 'sk-proj-... (live mode)',
                prodUrl: 'https://platform.openai.com/api-keys',
                note: 'Use GPT-4 for best quality. Set hard spending limits!',
                pricing: '$0.01-0.03 per call',
                icon: 'fa-brain',
                color: 'text-emerald-400'
              },
              {
                service: 'Twilio',
                prodKey: 'Live Credentials (from console)',
                prodUrl: 'https://console.twilio.com',
                note: 'Real phone number, real calls, real charges',
                pricing: '~$1/month + $0.01/min',
                icon: 'fa-phone',
                color: 'text-red-400'
              },
              {
                service: 'ElevenLabs',
                prodKey: 'Starter/Creator plan key',
                prodUrl: 'https://elevenlabs.io/app/subscription',
                note: 'Paid plan for commercial use',
                pricing: '$5-99/month',
                icon: 'fa-microphone',
                color: 'text-purple-400'
              },
              {
                service: 'Deepgram',
                prodKey: 'Paid plan API key',
                prodUrl: 'https://console.deepgram.com/',
                note: 'Pay-as-you-go for production',
                pricing: '$0.0043/min',
                icon: 'fa-ear-listen',
                color: 'text-blue-400'
              },
            ].map((item, idx) => (
              <div key={idx} className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <i className={`fa-solid ${item.icon} ${item.color}`}></i>
                    <h5 className="text-sm font-medium text-white">{item.service}</h5>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">{item.pricing}</span>
                </div>
                <div className="space-y-1 text-xs">
                  <p className="text-gray-400">
                    <span className="text-gray-500">Key format:</span>{' '}
                    <code className="text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded">{item.prodKey}</code>
                  </p>
                  <p className="text-gray-400">
                    <span className="text-gray-500">Get from:</span>{' '}
                    <a href={item.prodUrl} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300">
                      {item.prodUrl} <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                    </a>
                  </p>
                  <p className="text-gray-400">
                    <span className="text-gray-500">Note:</span> {item.note}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
            <h4 className="text-sm font-semibold text-white mb-2">
              <i className="fa-solid fa-file-code text-emerald-400 mr-2"></i>
              Example .env.production
            </h4>
            <pre className="text-xs text-gray-300 bg-gray-950 p-3 rounded-lg overflow-x-auto font-mono">
{`APP_ENV=production
APP_DEBUG=false

# OpenAI (production model)
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4-turbo  # Best quality

# Twilio LIVE credentials (real calls)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_live_auth_token
TWILIO_PHONE_NUMBER=+1234567890  # Real number

# ElevenLabs (paid plan)
ELEVENLABS_API_KEY=your_paid_plan_key

# Deepgram (paid plan)
DEEPGRAM_API_KEY=your_paid_plan_key`}
            </pre>
          </div>
        </div>
      )}

      {/* Best Practices Tab */}
      {activeTab === 'best' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                title: 'Never Commit Keys to Git',
                icon: 'fa-ban',
                color: 'text-red-400',
                items: [
                  'Add .env to .gitignore',
                  'Use environment variables',
                  'Never hardcode keys in source',
                  'Use secret managers in production'
                ]
              },
              {
                title: 'Use Different Keys Per Env',
                icon: 'fa-layer-group',
                color: 'text-blue-400',
                items: [
                  'Separate dev/staging/prod keys',
                  'Rotate keys regularly',
                  'Revoke leaked keys immediately',
                  'Use key prefixes (dev_, prod_)'
                ]
              },
              {
                title: 'Set Usage Limits',
                icon: 'fa-gauge-high',
                color: 'text-amber-400',
                items: [
                  'Set spending limits in dashboards',
                  'Monitor usage daily',
                  'Set up alerts for spikes',
                  'Use cheaper models in dev'
                ]
              },
              {
                title: 'Secure Production Keys',
                icon: 'fa-shield-halved',
                color: 'text-emerald-400',
                items: [
                  'Use AWS Secrets Manager / Vault',
                  'Restrict IP access when possible',
                  'Enable 2FA on provider accounts',
                  'Audit key usage regularly'
                ]
              },
            ].map((section, idx) => (
              <div key={idx} className="p-4 rounded-lg bg-gray-800/30 border border-gray-700/50">
                <div className="flex items-center gap-2 mb-3">
                  <i className={`fa-solid ${section.icon} ${section.color}`}></i>
                  <h4 className="text-sm font-semibold text-white">{section.title}</h4>
                </div>
                <ul className="space-y-1.5">
                  {section.items.map((item, i) => (
                    <li key={i} className="text-xs text-gray-300 flex items-start gap-2">
                      <i className="fa-solid fa-circle-check text-gray-500 mt-0.5 text-xs"></i>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
            <h4 className="text-sm font-semibold text-white mb-3">
              <i className="fa-solid fa-route text-violet-400 mr-2"></i>
              Recommended Workflow
            </h4>
            <div className="space-y-3">
              {[
                { step: 1, title: 'Development', desc: 'Use free tiers & test credentials locally', color: 'from-blue-500 to-cyan-500' },
                { step: 2, title: 'Staging', desc: 'Use separate staging keys with limited access', color: 'from-amber-500 to-orange-500' },
                { step: 3, title: 'Production', desc: 'Use live keys with proper security & monitoring', color: 'from-emerald-500 to-teal-500' },
              ].map((item) => (
                <div key={item.step} className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${item.color} flex items-center justify-center flex-shrink-0`}>
                    <span className="text-xs font-bold text-white">{item.step}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">{item.title}</p>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
            <h4 className="text-sm font-semibold text-red-300 mb-2 flex items-center gap-2">
              <i className="fa-solid fa-triangle-exclamation"></i>
              Common Mistakes to Avoid
            </h4>
            <ul className="space-y-1.5 text-xs text-gray-300">
              <li className="flex items-start gap-2">
                <i className="fa-solid fa-xmark text-red-400 mt-0.5"></i>
                <span>❌ Using production keys in development</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fa-solid fa-xmark text-red-400 mt-0.5"></i>
                <span>❌ Committing .env files to GitHub</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fa-solid fa-xmark text-red-400 mt-0.5"></i>
                <span>❌ Sharing keys in Slack/Email/Chat</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fa-solid fa-xmark text-red-400 mt-0.5"></i>
                <span>❌ Hardcoding keys in source files</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fa-solid fa-xmark text-red-400 mt-0.5"></i>
                <span>❌ Not setting spending limits</span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
