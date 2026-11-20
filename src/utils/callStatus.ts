// Call statuses and outcomes, labelled the same way on every call list
// (Job Calls, Inbound Calls, the dial pad). The decision statuses come from
// what the person said on the call (python-backend app/services/call_intents.py).

export const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  dialing: 'Dialling',
  ringing: 'Ringing',
  in_progress: 'Live',
  completed: 'Completed',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
  cancelled: 'Cancelled',
  dnc: 'DNC',
  not_interested: 'Not interested',
  wrong_number: 'Wrong number',
  callback: 'Call back',
  voicemail: 'Voicemail',
  hung_up: 'Hung up',
  dropped: 'Dropped on request',
};

export const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-gray-700/60 text-gray-300',
  dialing: 'bg-blue-500/15 text-blue-300',
  ringing: 'bg-amber-500/15 text-amber-300',
  in_progress: 'bg-violet-500/20 text-violet-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  no_answer: 'bg-amber-500/15 text-amber-300',
  busy: 'bg-amber-500/15 text-amber-300',
  failed: 'bg-red-500/15 text-red-300',
  cancelled: 'bg-gray-700/60 text-gray-400',
  dnc: 'bg-red-600/25 text-red-200 border border-red-500/40 font-semibold',
  not_interested: 'bg-slate-600/40 text-slate-200',
  wrong_number: 'bg-orange-500/15 text-orange-300',
  callback: 'bg-sky-500/15 text-sky-300',
  voicemail: 'bg-indigo-500/15 text-indigo-300',
  hung_up: 'bg-rose-500/15 text-rose-300',
  dropped: 'bg-zinc-600/40 text-zinc-200',
};

// Text colour only (compact lists such as the dial pad's recent calls).
export const STATUS_TEXT: Record<string, string> = {
  dialing: 'text-amber-300', ringing: 'text-amber-300', in_progress: 'text-emerald-300',
  completed: 'text-gray-400', no_answer: 'text-orange-300', cancelled: 'text-gray-400', failed: 'text-red-300',
  dnc: 'text-red-300 font-semibold', not_interested: 'text-slate-300', wrong_number: 'text-orange-300',
  callback: 'text-sky-300', voicemail: 'text-indigo-300', hung_up: 'text-rose-300', dropped: 'text-zinc-300',
};

export const OUTCOME_LABEL: Record<string, string> = {
  interested: 'Interested',
  not_interested: 'Not interested',
  do_not_call: 'Do not call',
  callback: 'Call back',
  wrong_number: 'Wrong number',
  voicemail: 'Voicemail',
  undecided: 'Undecided',
  abusive: 'Abusive',
  end_call: 'Asked to end call',
  no_response: 'No response',
  unknown: 'Unknown',
};

export const OUTCOME_STYLE: Record<string, string> = {
  interested: 'bg-emerald-500/15 text-emerald-300',
  not_interested: 'bg-slate-600/40 text-slate-200',
  do_not_call: 'bg-red-500/15 text-red-300',
  callback: 'bg-sky-500/15 text-sky-300',
  wrong_number: 'bg-orange-500/15 text-orange-300',
  voicemail: 'bg-indigo-500/15 text-indigo-300',
  undecided: 'bg-amber-500/15 text-amber-300',
  abusive: 'bg-red-500/15 text-red-300',
  end_call: 'bg-zinc-600/40 text-zinc-200',
  no_response: 'bg-gray-700/60 text-gray-400',
  unknown: 'bg-gray-700/60 text-gray-400',
};

// Calls that ended with a conversation (for "Completed" filters and counts).
export const ENDED_TALKING = ['completed', 'dnc', 'not_interested', 'wrong_number', 'callback', 'voicemail', 'hung_up', 'dropped'];

export const statusLabel = (s: string) => STATUS_LABEL[s] || s.replace(/_/g, ' ');
export const outcomeLabel = (s: string) => OUTCOME_LABEL[s] || s.replace(/_/g, ' ');
