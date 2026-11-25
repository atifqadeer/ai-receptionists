import { FormEvent, useEffect, useState } from 'react';
import { authApi, saveSession, AuthUser } from '../utils/auth';

// The login page. The very first time (no account yet) it creates the
// administrator account instead; after that it only signs in.

export default function LoginPage({ onSignedIn }: { onSignedIn: (u: AuthUser) => void }) {
  const [setup, setSetup] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = () => {
    setStatusError('');
    authApi.status().then((s) => setSetup(s.setup_needed)).catch((e) => setStatusError(e.message));
  };
  useEffect(check, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (setup && password !== confirm) { setError("The passwords don't match."); return; }
    setBusy(true);
    try {
      const s = setup
        ? await authApi.setup(name.trim(), email.trim(), password, remember)
        : await authApi.login(email.trim(), password, remember);
      saveSession(s, remember);
      onSignedIn(s.user);
    } catch (err: any) {
      setError(err.message);
      setPassword('');
      setConfirm('');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full bg-gray-800/80 border border-gray-700 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 outline-none transition';
  const icon = 'fa-solid absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-gray-500';

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* soft background glow */}
      <div className="absolute -top-40 -left-40 w-[28rem] h-[28rem] rounded-full bg-violet-600/20 blur-3xl pointer-events-none"></div>
      <div className="absolute -bottom-40 -right-40 w-[28rem] h-[28rem] rounded-full bg-indigo-600/20 blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md relative">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-900/40">
            <i className="fa-solid fa-robot text-white text-2xl"></i>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">AI Receptionist</h1>
          <p className="text-sm text-gray-400">Automation Hub</p>
        </div>

        <div className="bg-gray-900/90 backdrop-blur border border-gray-800 rounded-2xl p-7 shadow-2xl">
          {setup === null && !statusError && (
            <p className="text-sm text-gray-400 text-center py-8"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</p>
          )}
          {statusError && (
            <div className="text-center py-6 space-y-3">
              <i className="fa-solid fa-plug-circle-xmark text-3xl text-amber-400"></i>
              <p className="text-sm text-amber-300">{statusError}</p>
              <button onClick={check} className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700">Try again</button>
            </div>
          )}

          {setup !== null && !statusError && (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div>
                <h2 className="text-lg font-semibold text-white">{setup ? 'Create your admin account' : 'Welcome back'}</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  {setup ? 'No account exists yet. This first account manages the dashboard.' : 'Sign in to your dashboard'}
                </p>
              </div>

              {error && (
                <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2.5">
                  <i className="fa-solid fa-circle-exclamation mt-0.5"></i><span>{error}</span>
                </div>
              )}

              {setup && (
                <label className="block">
                  <span className="text-xs font-medium text-gray-300">Your name</span>
                  <div className="relative mt-1.5">
                    <i className={`${icon} fa-user`}></i>
                    <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Jane Smith" className={field} />
                  </div>
                </label>
              )}

              <label className="block">
                <span className="text-xs font-medium text-gray-300">Email</span>
                <div className="relative mt-1.5">
                  <i className={`${icon} fa-envelope`}></i>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
                    autoComplete={setup ? 'email' : 'username'} placeholder="you@company.com" className={field} />
                </div>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-gray-300">Password</span>
                <div className="relative mt-1.5">
                  <i className={`${icon} fa-lock`}></i>
                  <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required
                    autoComplete={setup ? 'new-password' : 'current-password'} placeholder={setup ? 'At least 8 characters, letters and numbers' : '••••••••'}
                    className={`${field} pr-10`} />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md text-gray-500 hover:text-gray-200">
                    <i className={`fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
                  </button>
                </div>
              </label>

              {setup && (
                <label className="block">
                  <span className="text-xs font-medium text-gray-300">Confirm password</span>
                  <div className="relative mt-1.5">
                    <i className={`${icon} fa-lock`}></i>
                    <input type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} required
                      autoComplete="new-password" placeholder="Type it again" className={field} />
                  </div>
                </label>
              )}

              <label className="flex items-center gap-2 text-sm text-gray-400 select-none cursor-pointer">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-violet-600" />
                Keep me signed in for 30 days
              </label>

              <button type="submit" disabled={busy || !email.trim() || !password}
                className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 transition shadow-lg shadow-violet-900/30">
                {busy ? <><i className="fa-solid fa-spinner fa-spin mr-2"></i>{setup ? 'Creating account…' : 'Signing in…'}</>
                  : setup ? 'Create account and sign in' : 'Sign in'}
              </button>
            </form>
          )}
        </div>
        <p className="text-center text-xs text-gray-600 mt-6">
          <i className="fa-solid fa-shield-halved mr-1"></i>Your dashboard is private: only signed-in users can use it.
        </p>
      </div>
    </div>
  );
}
