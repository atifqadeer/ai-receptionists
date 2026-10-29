import { useState } from 'react';

interface AutomationRule {
  id: number;
  name: string;
  trigger: string;
  action: string;
  enabled: boolean;
  priority: number;
}

export default function Automation() {
  const [rules, setRules] = useState<AutomationRule[]>([
    { id: 1, name: 'After Hours Routing', trigger: 'Call outside business hours', action: 'Play recorded message + offer callback', enabled: true, priority: 1 },
    { id: 2, name: 'Appointment Booking', trigger: 'Intent: Appointment', action: 'Collect date/time → Confirm → Send SMS', enabled: true, priority: 2 },
    { id: 3, name: 'Emergency Escalation', trigger: 'Keywords: emergency, urgent, help', action: 'Immediately transfer to on-call staff', enabled: true, priority: 0 },
    { id: 4, name: 'VIP Caller Detection', trigger: 'Caller ID matches VIP list', action: 'Skip queue → Transfer to manager', enabled: false, priority: 1 },
    { id: 5, name: 'Survey Collection', trigger: 'Call resolved successfully', action: 'Ask for satisfaction rating 1-5', enabled: true, priority: 5 },
    { id: 6, name: 'Voicemail Fallback', trigger: 'No agent available after 30s', action: 'Offer voicemail + email notification', enabled: true, priority: 4 },
  ]);

  const [workflows, setWorkflows] = useState([
    { id: 1, name: 'New Customer Onboarding', steps: 5, status: 'active', calls: 234 },
    { id: 2, name: 'Appointment Reminder', steps: 3, status: 'active', calls: 567 },
    { id: 3, name: 'Payment Collection', steps: 4, status: 'paused', calls: 89 },
    { id: 4, name: 'Feedback Survey', steps: 2, status: 'active', calls: 1023 },
  ]);

  const [showNewRule, setShowNewRule] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', trigger: '', action: '' });

  const toggleRule = (id: number) => {
    setRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const deleteRule = (id: number) => {
    setRules(rules.filter(r => r.id !== id));
  };

  const addRule = () => {
    if (newRule.name && newRule.trigger && newRule.action) {
      setRules([...rules, { id: Date.now(), ...newRule, enabled: true, priority: rules.length + 1 }]);
      setNewRule({ name: '', trigger: '', action: '' });
      setShowNewRule(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Automation Rules */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-diagram-project text-violet-400"></i>
              Call Routing Rules
            </h3>
            <p className="text-sm text-gray-400 mt-1">Define how incoming calls are handled automatically</p>
          </div>
          <button
            onClick={() => setShowNewRule(!showNewRule)}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-all flex items-center gap-2"
          >
            <i className="fa-solid fa-plus text-xs"></i>
            New Rule
          </button>
        </div>

        {/* New Rule Form */}
        {showNewRule && (
          <div className="mb-5 p-4 rounded-lg border border-violet-500/30 bg-violet-500/5 space-y-3">
            <input
              type="text"
              placeholder="Rule name..."
              value={newRule.name}
              onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:border-violet-500 outline-none"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Trigger Condition</label>
                <select
                  value={newRule.trigger}
                  onChange={(e) => setNewRule({ ...newRule, trigger: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:border-violet-500 outline-none"
                >
                  <option value="">Select trigger...</option>
                  <option>Call outside business hours</option>
                  <option>Intent: Appointment</option>
                  <option>Intent: Technical Support</option>
                  <option>Keywords: emergency, urgent</option>
                  <option>Caller ID matches list</option>
                  <option>Call duration exceeds limit</option>
                  <option>No agent available</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Action</label>
                <select
                  value={newRule.action}
                  onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:border-violet-500 outline-none"
                >
                  <option value="">Select action...</option>
                  <option>Transfer to agent</option>
                  <option>Play recorded message</option>
                  <option>Collect information</option>
                  <option>Send notification</option>
                  <option>Create ticket</option>
                  <option>Schedule callback</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={addRule} className="px-4 py-1.5 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700">
                Create Rule
              </button>
              <button onClick={() => setShowNewRule(false)} className="px-4 py-1.5 rounded-lg border border-gray-700 text-gray-300 text-sm hover:bg-gray-800">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Rules List */}
        <div className="space-y-3">
          {rules.sort((a, b) => a.priority - b.priority).map((rule) => (
            <div key={rule.id} className={`p-4 rounded-lg border transition-all ${rule.enabled ? 'bg-gray-800/50 border-gray-700/50' : 'bg-gray-800/20 border-gray-800 opacity-60'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-gray-500 bg-gray-800 px-2 py-0.5 rounded">P{rule.priority}</span>
                  <div>
                    <p className="text-sm font-medium text-white">{rule.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded">
                        <i className="fa-solid fa-bolt mr-1"></i>{rule.trigger}
                      </span>
                      <i className="fa-solid fa-arrow-right text-gray-600 text-xs"></i>
                      <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                        <i className="fa-solid fa-play mr-1"></i>{rule.action}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleRule(rule.id)}
                    className={`w-11 h-6 rounded-full transition-all ${rule.enabled ? 'bg-violet-600' : 'bg-gray-700'}`}
                  >
                    <div className={`w-4.5 h-4.5 rounded-full bg-white transition-transform ${rule.enabled ? 'translate-x-5.5' : 'translate-x-0.5'}`} style={{ width: '18px', height: '18px', transform: rule.enabled ? 'translateX(22px)' : 'translateX(2px)' }}></div>
                  </button>
                  <button onClick={() => deleteRule(rule.id)} className="text-gray-500 hover:text-red-400 transition-all">
                    <i className="fa-solid fa-trash text-sm"></i>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Workflows */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-layer-group text-violet-400"></i>
              Automated Workflows
            </h3>
            <p className="text-sm text-gray-400 mt-1">Multi-step processes for complex call scenarios</p>
          </div>
          <button className="px-4 py-2 rounded-lg border border-gray-700 text-gray-300 text-sm hover:bg-gray-800 transition-all flex items-center gap-2">
            <i className="fa-solid fa-plus text-xs"></i>
            New Workflow
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map((wf) => (
            <div key={wf.id} className="p-4 rounded-lg border border-gray-700/50 bg-gray-800/30 hover:border-gray-600 transition-all">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-white">{wf.name}</h4>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  wf.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {wf.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span><i className="fa-solid fa-list-ol mr-1"></i>{wf.steps} steps</span>
                <span><i className="fa-solid fa-phone mr-1"></i>{wf.calls} calls</span>
              </div>
              <div className="mt-3 flex gap-2">
                <button className="flex-1 py-1.5 rounded-md bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:bg-gray-700 transition-all">
                  <i className="fa-solid fa-edit mr-1"></i>Edit
                </button>
                <button
                  onClick={() => setWorkflows(workflows.map(w => w.id === wf.id ? { ...w, status: w.status === 'active' ? 'paused' : 'active' } : w))}
                  className={`flex-1 py-1.5 rounded-md text-xs transition-all ${
                    wf.status === 'active'
                      ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
                      : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                  }`}
                >
                  <i className={`fa-solid ${wf.status === 'active' ? 'fa-pause' : 'fa-play'} mr-1`}></i>
                  {wf.status === 'active' ? 'Pause' : 'Resume'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Integrations */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
          <i className="fa-solid fa-plug text-violet-400"></i>
          Connected Services
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { name: 'Google Calendar', icon: 'fa-calendar', status: 'connected', color: 'text-blue-400' },
            { name: 'Twilio SMS', icon: 'fa-message', status: 'connected', color: 'text-red-400' },
            { name: 'Slack Notifications', icon: 'fa-hashtag', status: 'connected', color: 'text-purple-400' },
            { name: 'Salesforce CRM', icon: 'fa-cloud', status: 'disconnected', color: 'text-gray-400' },
            { name: 'Zendesk Tickets', icon: 'fa-ticket', status: 'connected', color: 'text-emerald-400' },
            { name: 'Stripe Payments', icon: 'fa-credit-card', status: 'disconnected', color: 'text-gray-400' },
          ].map((service, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/30 border border-gray-700/50">
              <div className="flex items-center gap-3">
                <i className={`fa-solid ${service.icon} ${service.color}`}></i>
                <span className="text-sm text-white">{service.name}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                service.status === 'connected' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700 text-gray-400'
              }`}>
                {service.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
