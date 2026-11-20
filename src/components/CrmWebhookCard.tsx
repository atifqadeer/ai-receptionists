import { useEffect, useState } from 'react';
import { outboundApi, telephonyApi } from '../utils/outboundApi';

// Settings > Calling > Webhooks: the webhook your recruitment CRM
// POSTs applicants to. Each one is queued as a job call (Job Calls page).

// Same fields as the CSV template columns.
const SAMPLE_PAYLOAD = {
  applicant_name: 'Sarah Jones', phone: '07700 900123', email: 'sarah@example.com',
  job_title: 'Registered Nurse (RGN)', office: 'Oakwood Care Home', branch: 'Manchester',
  salary: '£38,000 per year', benefits: '28 days holiday, pension, paid training',
  qualifications: 'Active NMC registration and PIN', experience: 'At least 2 years in elderly care',
  job_type: 'Full-time, permanent', working_hours: 'Day shifts, 37.5 hours a week',
  job_description: 'Caring for 30 elderly residents in a nursing home',
};

export default function CrmWebhookCard() {
  const [token, setToken] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    telephonyApi.get()
      .then((s) => { setToken(s.webhook_token); setPublicUrl(s.public_url || ''); setError(''); })
      .catch((e) => setError(e.message));
  }, []);

  const flash = (t: string) => { setNotice(t); setTimeout(() => setNotice(''), 2500); };
  const copy = (text: string, what: string) => { navigator.clipboard?.writeText(text).catch(() => {}); flash(`${what} copied.`); };

  const newToken = async () => {
    if (!window.confirm('Create a new token? Your CRM must be updated with the new one, or its applicants will be refused.')) return;
    try {
      const r = await telephonyApi.newToken();
      setToken(r.webhook_token);
      flash('New webhook token created. Update it in your CRM.');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const webhookUrl = publicUrl ? `${publicUrl.replace(/\/+$/, '')}/api/outbound/webhook` : outboundApi.webhookUrl;
  const btn = 'px-3 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800';

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <i className="fa-solid fa-link text-violet-400"></i>CRM Webhook (receive applicants)
        </h3>
        <p className="text-sm text-gray-400 mt-1">
          Set your recruitment CRM to POST each applicant and their matching job (JSON) to this URL.
          Every applicant received is queued as a job call on the Job Calls page.
        </p>
      </div>
      {error && <p className="text-sm text-amber-300"><i className="fa-solid fa-triangle-exclamation mr-1.5"></i>{error}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Webhook URL</label>
          <div className="flex gap-2">
            <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 break-all">{webhookUrl}</code>
            <button onClick={() => copy(webhookUrl, 'Webhook URL')} className={btn} title="Copy"><i className="fa-regular fa-copy"></i></button>
          </div>
          {!publicUrl && <p className="text-xs text-amber-300 mt-1">This is a local address. A cloud CRM needs the public URL (VoIP settings › Public URL).</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Token (send as header <code>X-Webhook-Token</code>, or <code>?token=</code>)</label>
          <div className="flex gap-2">
            <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 break-all">
              {token ? (showToken ? token : '•'.repeat(24)) : '…'}
            </code>
            <button onClick={() => setShowToken(!showToken)} className={btn} title={showToken ? 'Hide' : 'Show'}><i className={`fa-regular ${showToken ? 'fa-eye-slash' : 'fa-eye'}`}></i></button>
            <button onClick={() => copy(token, 'Token')} disabled={!token} className={btn} title="Copy"><i className="fa-regular fa-copy"></i></button>
            <button onClick={newToken} className={btn} title="New token"><i className="fa-solid fa-rotate"></i></button>
          </div>
        </div>
      </div>
      {notice && <p className="text-xs text-emerald-300"><i className="fa-solid fa-circle-check mr-1.5"></i>{notice}</p>}
      <details className="text-sm">
        <summary className="cursor-pointer text-violet-300">Example payload</summary>
        <pre className="mt-2 bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-300 overflow-x-auto">{JSON.stringify(SAMPLE_PAYLOAD, null, 2)}</pre>
        <p className="text-xs text-gray-500 mt-1">The same fields as the CSV template. A list of applicants also works, and common CRM names such as mobile, full_name, position, pay_rate and requirements are recognised.</p>
      </details>
    </div>
  );
}
