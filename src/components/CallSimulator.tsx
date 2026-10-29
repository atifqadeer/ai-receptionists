import { useState, useRef, useEffect } from 'react';

interface Message {
  id: number;
  sender: 'agent' | 'caller' | 'system';
  text: string;
  timestamp: string;
  intent?: string;
}

export default function CallSimulator() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, sender: 'system', text: 'Call started - AI Receptionist Aria is now active', timestamp: '10:30:00 AM' },
    { id: 2, sender: 'agent', text: "Hello! Thank you for calling TechCorp Solutions. I'm Aria, your AI assistant. How can I help you today?", timestamp: '10:30:02 AM' },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [callStatus, setCallStatus] = useState<'active' | 'ended' | 'idle'>('active');
  const [callDuration, setCallDuration] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const quickPrompts = [
    "I'd like to book an appointment",
    "What are your business hours?",
    "I need technical support",
    "Can I speak to a manager?",
    "What services do you offer?",
    "I have a complaint",
  ];

  const agentResponses: Record<string, { text: string; intent: string }> = {
    'appointment': {
      text: "I'd be happy to help you book an appointment! We have availability this week. Could you please tell me your preferred date and time? We're open Monday through Friday, 9 AM to 6 PM.",
      intent: 'Appointment Booking'
    },
    'hours': {
      text: "Our business hours are Monday through Friday, 9:00 AM to 6:00 PM Eastern Standard Time. We're closed on weekends and major holidays. Is there anything else I can help you with?",
      intent: 'Business Hours Inquiry'
    },
    'support': {
      text: "I understand you need technical support. I can help with some common issues right away. Could you describe the problem you're experiencing? If it's urgent, I can also transfer you to our technical team.",
      intent: 'Technical Support'
    },
    'manager': {
      text: "I'd be happy to connect you with a manager. Let me check their availability... Our manager is currently available. Would you like me to transfer you now, or would you prefer to schedule a specific time?",
      intent: 'Transfer Request'
    },
    'services': {
      text: "We offer a range of services including Web Development, Mobile Application Development, Cloud Solutions, and AI Integration. Each service is tailored to your specific needs. Would you like more details about any particular service?",
      intent: 'General Inquiry'
    },
    'complaint': {
      text: "I'm sorry to hear you'd like to file a complaint. I take this seriously and want to make sure it's addressed properly. Could you please tell me more about the issue? I'll make sure it gets the attention it deserves.",
      intent: 'Complaint'
    },
    'default': {
      text: "Thank you for that information. Let me see how I can best assist you with that. Is there anything specific you'd like me to help with regarding this matter?",
      intent: 'General Inquiry'
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (callStatus === 'active') {
      const interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [callStatus]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getResponse = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes('appointment') || lower.includes('book') || lower.includes('schedule')) return agentResponses['appointment'];
    if (lower.includes('hours') || lower.includes('open') || lower.includes('time')) return agentResponses['hours'];
    if (lower.includes('support') || lower.includes('technical') || lower.includes('bug') || lower.includes('error')) return agentResponses['support'];
    if (lower.includes('manager') || lower.includes('speak') || lower.includes('human') || lower.includes('person')) return agentResponses['manager'];
    if (lower.includes('service') || lower.includes('offer') || lower.includes('what do you')) return agentResponses['services'];
    if (lower.includes('complaint') || lower.includes('unhappy') || lower.includes('problem')) return agentResponses['complaint'];
    return agentResponses['default'];
  };

  const sendMessage = (text: string) => {
    if (!text.trim() || callStatus !== 'active') return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    setMessages(prev => [...prev, {
      id: Date.now(),
      sender: 'caller',
      text: text.trim(),
      timestamp: timeStr
    }]);
    setInput('');
    setIsTyping(true);

    setTimeout(() => {
      const response = getResponse(text);
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        sender: 'agent',
        text: response.text,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        intent: response.intent
      }]);
      setIsTyping(false);
    }, 1200 + Math.random() * 800);
  };

  const endCall = () => {
    setCallStatus('ended');
    setMessages(prev => [...prev, {
      id: Date.now(),
      sender: 'system',
      text: `Call ended - Duration: ${formatDuration(callDuration)} - Summary generated`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }]);
  };

  const newCall = () => {
    setCallStatus('active');
    setCallDuration(0);
    setMessages([
      { id: 1, sender: 'system', text: 'New call started - AI Receptionist Aria is now active', timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
      { id: 2, sender: 'agent', text: "Hello! Thank you for calling TechCorp Solutions. I'm Aria, your AI assistant. How can I help you today?", timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) },
    ]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
      {/* Chat Area */}
      <div className="lg:col-span-2 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
        {/* Call Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${callStatus === 'active' ? 'bg-emerald-400 animate-pulse' : callStatus === 'ended' ? 'bg-red-400' : 'bg-gray-500'}`}></div>
            <div>
              <p className="text-sm font-medium text-white">
                {callStatus === 'active' ? 'Call in Progress' : callStatus === 'ended' ? 'Call Ended' : 'Ready'}
              </p>
              <p className="text-xs text-gray-400">Duration: {formatDuration(callDuration)}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {callStatus === 'active' && (
              <button onClick={endCall} className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm hover:bg-red-500/20 transition-all">
                <i className="fa-solid fa-phone-slash mr-1"></i>End Call
              </button>
            )}
            {callStatus === 'ended' && (
              <button onClick={newCall} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm hover:bg-emerald-500/20 transition-all">
                <i className="fa-solid fa-phone mr-1"></i>New Call
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.sender === 'system' ? 'justify-center' : msg.sender === 'caller' ? 'justify-end' : 'justify-start'}`}>
              {msg.sender === 'system' ? (
                <div className="px-4 py-1.5 rounded-full bg-gray-800 text-xs text-gray-400">
                  <i className="fa-solid fa-circle-info mr-1"></i>{msg.text}
                </div>
              ) : (
                <div className={`max-w-[75%] ${msg.sender === 'caller' ? 'order-1' : ''}`}>
                  <div className={`px-4 py-3 rounded-2xl ${
                    msg.sender === 'agent'
                      ? 'bg-gray-800 border border-gray-700 rounded-bl-md'
                      : 'bg-violet-600 rounded-br-md'
                  }`}>
                    <p className="text-sm text-white">{msg.text}</p>
                  </div>
                  <div className={`flex items-center gap-2 mt-1 ${msg.sender === 'caller' ? 'justify-end' : ''}`}>
                    <span className="text-xs text-gray-500">{msg.timestamp}</span>
                    {msg.intent && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">{msg.intent}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="px-4 py-3 rounded-2xl bg-gray-800 border border-gray-700 rounded-bl-md">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
              placeholder={callStatus === 'active' ? 'Type your message as the caller...' : 'Call has ended. Start a new call to continue.'}
              disabled={callStatus !== 'active'}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || callStatus !== 'active'}
              className="px-4 py-2.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-paper-plane"></i>
            </button>
          </div>
          {/* Quick Prompts */}
          <div className="flex flex-wrap gap-2 mt-3">
            {quickPrompts.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(prompt)}
                disabled={callStatus !== 'active'}
                className="px-3 py-1 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:bg-gray-700 hover:border-gray-600 transition-all disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Side Panel */}
      <div className="space-y-4">
        {/* Agent Status */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <i className="fa-solid fa-robot text-violet-400"></i>
            Agent Status
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">State</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                isTyping ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
              }`}>
                {isTyping ? 'Processing' : 'Listening'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Confidence</span>
              <span className="text-xs text-emerald-400">96.2%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Latency</span>
              <span className="text-xs text-white">1.2s</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Tokens Used</span>
              <span className="text-xs text-white">{messages.filter(m => m.sender === 'agent').length * 45}</span>
            </div>
          </div>
        </div>

        {/* Detected Intents */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <i className="fa-solid fa-brain text-violet-400"></i>
            Detected Intents
          </h3>
          <div className="space-y-2">
            {messages
              .filter(m => m.intent)
              .map((m, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-gray-800/50">
                  <span className="text-xs text-gray-300">{m.intent}</span>
                  <span className="text-xs text-gray-500">{m.timestamp}</span>
                </div>
              ))}
            {messages.filter(m => m.intent).length === 0 && (
              <p className="text-xs text-gray-500 text-center py-3">No intents detected yet</p>
            )}
          </div>
        </div>

        {/* Call Controls */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <i className="fa-solid fa-sliders text-violet-400"></i>
            Live Controls
          </h3>
          <div className="space-y-3">
            <button className="w-full py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 transition-all flex items-center justify-center gap-2">
              <i className="fa-solid fa-pause"></i>Pause Agent
            </button>
            <button className="w-full py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-400 hover:bg-amber-500/20 transition-all flex items-center justify-center gap-2">
              <i className="fa-solid fa-arrow-right-arrow-left"></i>Transfer to Human
            </button>
            <button className="w-full py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 transition-all flex items-center justify-center gap-2">
              <i className="fa-solid fa-volume-xmark"></i>Mute Caller
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
