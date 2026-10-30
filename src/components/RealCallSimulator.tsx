import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface CallMessage {
  id: number;
  sender: 'agent' | 'caller' | 'system';
  text: string;
  timestamp: string;
  intent?: string;
}

const VOICE_PROFILES: Record<string, { rate: number; pitch: number; gender: 'male' | 'female' }> = {
  skylar: { rate: 1.0, pitch: 1.15, gender: 'female' },
  daniel: { rate: 0.95, pitch: 0.85, gender: 'male' },
  gemma: { rate: 0.95, pitch: 1.2, gender: 'female' },
  parker: { rate: 1.05, pitch: 0.95, gender: 'male' },
  archie: { rate: 1.05, pitch: 1.1, gender: 'male' },
  jacqueline: { rate: 0.98, pitch: 1.05, gender: 'female' },
};

export default function RealCallSimulator() {
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [callStatus, setCallStatus] = useState<'idle' | 'dialing' | 'active' | 'ended'>('idle');
  const [callDuration, setCallDuration] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callMode, setCallMode] = useState<'browser' | 'twilio'>('browser');
  const [voiceLevel, setVoiceLevel] = useState(0);
  
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  
  // Use refs to track state for callbacks (fixes stale closure issue)
  const isSpeakingRef = useRef(false);
  const callStatusRef = useRef<'idle' | 'dialing' | 'active' | 'ended'>('idle');
  const shouldListenRef = useRef(false);

  const [identity] = useLocalStorage('agent-identity', {
    agentName: 'Aria',
    companyName: 'TechCorp Solutions',
    voice: 'skylar',
    speakingRate: 1.0,
    pitch: 1.0,
  });

  const [behavior] = useLocalStorage('agent-behavior', {
    greeting: 'Hello! Thank you for calling. I\'m your AI assistant. How can I help you today?',
    farewell: 'Thank you for calling! Have a wonderful day.',
  });

  const [knowledge] = useLocalStorage('agent-knowledge', {
    businessHours: 'Monday to Friday, 9:00 AM to 6:00 PM EST',
    phone: '+1 (555) 123-4567',
    email: 'support@techcorp.com',
    services: 'Web Development, Mobile Apps, Cloud Solutions',
    faqs: [] as Array<{ q: string; a: string }>,
  });

  // Keep refs in sync with state
  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    callStatusRef.current = callStatus;
  }, [callStatus]);

  const speechRecognitionSupported = typeof window !== 'undefined' && 
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  const speechSynthesisSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (callStatus === 'active') {
      durationIntervalRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    }
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [callStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }
      window.speechSynthesis.cancel();
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Detect intent
  const detectIntent = useCallback((text: string): string => {
    const lower = text.toLowerCase();
    
    if (knowledge.faqs && knowledge.faqs.length > 0) {
      for (const faq of knowledge.faqs) {
        const faqLower = faq.q.toLowerCase();
        const words = faqLower.split(/\s+/).filter(w => w.length > 3);
        const matchCount = words.filter(w => lower.includes(w)).length;
        if (matchCount >= Math.min(2, words.length)) {
          return `FAQ:${faq.q}`;
        }
      }
    }
    
    if (lower.includes('appointment') || lower.includes('book') || lower.includes('schedule') || lower.includes('meeting')) return 'Appointment Booking';
    if (lower.includes('hours') || lower.includes('open') || lower.includes('close') || lower.includes('when')) return 'Business Hours';
    if (lower.includes('support') || lower.includes('technical') || lower.includes('bug') || lower.includes('error') || lower.includes('problem')) return 'Technical Support';
    if (lower.includes('manager') || lower.includes('speak') || lower.includes('human') || lower.includes('person') || lower.includes('transfer')) return 'Transfer Request';
    if (lower.includes('service') || lower.includes('offer') || lower.includes('provide')) return 'General Inquiry';
    if (lower.includes('complaint') || lower.includes('unhappy') || lower.includes('angry')) return 'Complaint';
    if (lower.includes('price') || lower.includes('cost') || lower.includes('how much')) return 'Pricing';
    if (lower.includes('address') || lower.includes('location') || lower.includes('where')) return 'Location';
    if (lower.includes('email') || lower.includes('contact') || lower.includes('phone')) return 'Contact Info';
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) return 'Greeting';
    if (lower.includes('thank') || lower.includes('bye') || lower.includes('goodbye')) return 'Closing';
    
    return 'General Inquiry';
  }, [knowledge.faqs]);

  // Generate response
  const generateResponse = useCallback((text: string, intent: string): string => {
    if (intent.startsWith('FAQ:')) {
      const question = intent.substring(4);
      const faq = knowledge.faqs?.find(f => f.q === question);
      if (faq) return faq.a;
    }
    
    const responses: Record<string, string[]> = {
      'Appointment Booking': [
        `I'd be happy to help you book an appointment! We're available ${knowledge.businessHours}. What date and time works best for you?`,
        `Great! I can schedule that for you. Our hours are ${knowledge.businessHours}. When would you like to come in?`,
      ],
      'Business Hours': [
        `Our business hours are ${knowledge.businessHours}. Is there anything else I can help you with?`,
        `We're open ${knowledge.businessHours}. Would you like to schedule a visit?`,
      ],
      'Technical Support': [
        `I understand you're having technical difficulties. Could you describe the problem in more detail?`,
        `I'm sorry to hear you're having issues. Let me help you troubleshoot. What's happening?`,
      ],
      'Transfer Request': [
        `I'd be happy to connect you with a specialist. Would you like me to transfer you now?`,
        `Of course! Let me get you connected with the right person.`,
      ],
      'General Inquiry': [
        `We offer ${knowledge.services}. You can reach us at ${knowledge.email} or ${knowledge.phone}. What else can I help with?`,
        `Our services include ${knowledge.services}. For more info, email us at ${knowledge.email}.`,
      ],
      'Complaint': [
        `I'm sorry to hear that. Could you tell me more about what happened so I can help?`,
        `I apologize for the inconvenience. Let me make sure this gets addressed properly.`,
      ],
      'Pricing': [
        `Our pricing varies based on your needs. We offer ${knowledge.services}. Want me to connect you with sales?`,
      ],
      'Location': [
        `For our exact address, please contact us at ${knowledge.phone} or ${knowledge.email}.`,
      ],
      'Contact Info': [
        `You can reach us at ${knowledge.phone} or ${knowledge.email}. We're available ${knowledge.businessHours}.`,
      ],
      'Greeting': [
        `Hello! How can I assist you today?`,
        `Hi there! What can I help you with?`,
      ],
      'Closing': [
        `Thank you for calling! Have a wonderful day.`,
        `You're welcome! Goodbye!`,
      ],
    };
    
    const intentResponses = responses[intent] || responses['General Inquiry'];
    return intentResponses[Math.floor(Math.random() * intentResponses.length)];
  }, [knowledge]);

  // Handle caller speech
  const handleCallerSpeech = useCallback(async (text: string) => {
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    setMessages(prev => [...prev, {
      id: Date.now(),
      sender: 'caller',
      text: text,
      timestamp: now,
    }]);
    
    setTranscript('');
    
    const intent = detectIntent(text);
    const response = generateResponse(text, intent);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    setMessages(prev => [...prev, {
      id: Date.now() + 1,
      sender: 'agent',
      text: response,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      intent: intent,
    }]);
    
    await speakText(response);
  }, [detectIntent, generateResponse]);

  // Find browser voice
  const findBrowserVoice = (): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    const profile = VOICE_PROFILES[identity.voice] || VOICE_PROFILES.skylar;
    
    const keywords = profile.gender === 'female' 
      ? ['female', 'woman', 'zira', 'samantha', 'victoria', 'karen']
      : ['male', 'man', 'david', 'daniel', 'alex', 'fred', 'tom'];
    
    for (const keyword of keywords) {
      const match = voices.find(v => v.name.toLowerCase().includes(keyword.toLowerCase()));
      if (match) return match;
    }
    
    return voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
  };

  // Speak text
  const speakText = (text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!speechSynthesisSupported) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = findBrowserVoice();
      if (voice) utterance.voice = voice;
      
      const profile = VOICE_PROFILES[identity.voice] || VOICE_PROFILES.skylar;
      utterance.rate = profile.rate * identity.speakingRate;
      utterance.pitch = profile.pitch * identity.pitch;
      
      utterance.onstart = () => {
        setIsSpeaking(true);
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (e) {}
        }
      };
      
      utterance.onend = () => {
        setIsSpeaking(false);
        // Restart listening after agent finishes
        if (callStatusRef.current === 'active' && shouldListenRef.current) {
          setTimeout(() => {
            if (recognitionRef.current && shouldListenRef.current) {
              try {
                recognitionRef.current.start();
              } catch (e) {}
            }
          }, 300);
        }
        resolve();
      };
      
      utterance.onerror = () => {
        setIsSpeaking(false);
        if (callStatusRef.current === 'active' && shouldListenRef.current) {
          setTimeout(() => {
            if (recognitionRef.current && shouldListenRef.current) {
              try {
                recognitionRef.current.start();
              } catch (e) {}
            }
          }, 300);
        }
        resolve();
      };
      
      window.speechSynthesis.speak(utterance);
    });
  };

  // Initialize speech recognition
  const initRecognition = () => {
    if (!speechRecognitionSupported) {
      setError('Speech recognition not supported. Please use Chrome or Edge.');
      return null;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += t;
        } else {
          interim += t;
        }
      }
      
      setInterimTranscript(interim);
      
      // Barge-in: stop agent if user speaks
      if (final && isSpeakingRef.current) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      }
      
      if (final) {
        setTranscript(final);
        handleCallerSpeech(final);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Please allow microphone access.');
        setIsListening(false);
      } else if (event.error === 'no-speech') {
        // Auto-restart on no-speech
        if (callStatusRef.current === 'active' && shouldListenRef.current && !isSpeakingRef.current) {
          setTimeout(() => {
            try {
              recognition.start();
            } catch (e) {}
          }, 100);
        }
      } else if (event.error !== 'aborted') {
        setError(`Speech error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      // Auto-restart if call is active and should be listening
      if (callStatusRef.current === 'active' && shouldListenRef.current && !isSpeakingRef.current) {
        setTimeout(() => {
          try {
            recognition.start();
          } catch (e) {}
        }, 100);
      } else {
        setIsListening(false);
      }
      setInterimTranscript('');
    };

    return recognition;
  };

  // Initialize microphone
  const initMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);
      
      const updateVoiceLevel = () => {
        if (analyserRef.current) {
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setVoiceLevel(Math.min(100, (avg / 128) * 100));
        }
        animationFrameRef.current = requestAnimationFrame(updateVoiceLevel);
      };
      updateVoiceLevel();
    } catch (err) {
      console.error('Microphone error:', err);
      setError('Could not access microphone. Please check permissions.');
    }
  };

  const stopMicrophone = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setVoiceLevel(0);
  };

  // Start call
  const startCall = async () => {
    setError(null);
    setCallStatus('dialing');
    setCallDuration(0);
    setMessages([]);
    shouldListenRef.current = false;
    
    await initMicrophone();
    
    // Initialize recognition
    if (!recognitionRef.current) {
      recognitionRef.current = initRecognition();
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setCallStatus('active');
    
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setMessages([{
      id: 1,
      sender: 'system',
      text: `Call connected with ${identity.agentName} at ${identity.companyName}`,
      timestamp: now,
    }]);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    await speakText(behavior.greeting);
    
    setMessages(prev => [...prev, {
      id: 2,
      sender: 'agent',
      text: behavior.greeting,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }]);
    
    // Start listening after greeting
    shouldListenRef.current = true;
    setTimeout(() => {
      if (recognitionRef.current && callStatusRef.current === 'active') {
        try {
          recognitionRef.current.start();
        } catch (e) {
          console.log('Recognition already started');
        }
      }
    }, 500);
  };

  // End call
  const endCall = async () => {
    shouldListenRef.current = false;
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    
    window.speechSynthesis.cancel();
    stopMicrophone();
    
    if (callStatus === 'active') {
      await speakText(behavior.farewell);
      
      setMessages(prev => [...prev, {
        id: Date.now(),
        sender: 'agent',
        text: behavior.farewell,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }]);
    }
    
    setCallStatus('ended');
    setIsListening(false);
    
    setMessages(prev => [...prev, {
      id: Date.now() + 1,
      sender: 'system',
      text: `Call ended - Duration: ${formatDuration(callDuration)}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }]);
  };

  // New call
  const newCall = () => {
    setCallStatus('idle');
    setCallDuration(0);
    setMessages([]);
    setTranscript('');
    setInterimTranscript('');
    setError(null);
    setIsListening(false);
    setIsSpeaking(false);
    shouldListenRef.current = false;
  };

  // Idle state
  if (callStatus === 'idle') {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-br from-violet-600/10 to-indigo-600/10 rounded-xl border border-violet-500/30 p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <i className="fa-solid fa-phone-volume text-white text-2xl"></i>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Make a Voice Call</h2>
              <p className="text-sm text-gray-300">
                Speak to {identity.agentName} using your microphone. The AI will listen automatically and respond with voice.
              </p>
            </div>
          </div>
        </div>

        {(!speechRecognitionSupported || !speechSynthesisSupported) && (
          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <p className="text-sm text-amber-300 flex items-start gap-2">
              <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
              <span>
                {!speechRecognitionSupported && !speechSynthesisSupported 
                  ? 'Your browser does not support speech features. Please use Chrome or Edge.'
                  : !speechRecognitionSupported 
                  ? 'Speech recognition not supported. Please use Chrome or Edge.'
                  : 'Speech synthesis not supported. Please use Chrome or Edge.'}
              </span>
            </p>
          </div>
        )}

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Call Configuration</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500">Agent</p>
              <p className="text-white font-medium">{identity.agentName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Voice</p>
              <p className="text-white font-medium capitalize">{identity.voice}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Company</p>
              <p className="text-white font-medium">{identity.companyName}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Mode</p>
              <p className="text-white font-medium">Browser Call</p>
            </div>
          </div>
        </div>

        <button
          onClick={startCall}
          disabled={!speechRecognitionSupported || !speechSynthesisSupported}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold text-lg hover:from-emerald-600 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg"
        >
          <i className="fa-solid fa-phone text-xl"></i>
          Start Call with {identity.agentName}
        </button>

        <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
          <p className="text-sm text-blue-300 flex items-start gap-2">
            <i className="fa-solid fa-circle-info mt-0.5"></i>
            <span>
              <strong>How it works:</strong> After the call starts, just speak naturally. The AI will listen automatically, 
              process your speech, and respond with voice. You can interrupt the AI anytime by speaking (barge-in).
            </span>
          </p>
        </div>
      </div>
    );
  }

  // Dialing state
  if (callStatus === 'dialing') {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4 animate-pulse">
          <i className="fa-solid fa-phone text-white text-3xl"></i>
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Connecting...</h3>
        <p className="text-sm text-gray-400">Preparing microphone and AI agent...</p>
      </div>
    );
  }

  // Active/Ended call
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-180px)]">
      <div className="lg:col-span-2 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              callStatus === 'active' ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
            }`}></div>
            <div>
              <p className="text-sm font-medium text-white">
                {callStatus === 'active' ? 'Call in Progress' : 'Call Ended'}
              </p>
              <p className="text-xs text-gray-400">
                Duration: {formatDuration(callDuration)} • {identity.agentName}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {callStatus === 'active' && (
              <button
                onClick={endCall}
                className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm hover:bg-red-500/20 transition-all flex items-center gap-2"
              >
                <i className="fa-solid fa-phone-slash"></i>
                End Call
              </button>
            )}
            {callStatus === 'ended' && (
              <button
                onClick={newCall}
                className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm hover:bg-emerald-500/20 transition-all flex items-center gap-2"
              >
                <i className="fa-solid fa-phone"></i>
                New Call
              </button>
            )}
          </div>
        </div>

        {/* Voice Status */}
        {callStatus === 'active' && (
          <div className="p-4 border-b border-gray-800 bg-gradient-to-r from-violet-600/5 to-indigo-600/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  isSpeaking ? 'bg-violet-400 animate-pulse' : 
                  isListening ? 'bg-emerald-400 animate-pulse' : 
                  'bg-gray-500'
                }`}></div>
                <span className="text-xs text-gray-400">
                  {isSpeaking ? `${identity.agentName} speaking...` : 
                   isListening ? 'Listening...' : 
                   'Automatic voice detection active'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <i className="fa-solid fa-microphone"></i>
                <span>Auto-listening</span>
              </div>
            </div>
            
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-100 ${
                  isSpeaking ? 'bg-gradient-to-r from-violet-500 to-purple-500' :
                  isListening ? 'bg-gradient-to-r from-emerald-500 to-teal-500' :
                  'bg-gradient-to-r from-gray-600 to-gray-700'
                }`}
                style={{ width: `${voiceLevel}%` }}
              ></div>
            </div>
            
            {(interimTranscript || transcript) && (
              <div className="mt-2 p-2 rounded bg-gray-800/50">
                <p className="text-xs text-gray-400 mb-1">
                  <i className="fa-solid fa-microphone mr-1"></i>
                  Live Transcript:
                </p>
                <p className="text-sm text-white">
                  {transcript}
                  <span className="text-gray-500 italic">{interimTranscript}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] max-h-[500px]">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.sender === 'system' ? 'justify-center' : msg.sender === 'caller' ? 'justify-end' : 'justify-start'}`}>
              {msg.sender === 'system' ? (
                <div className="px-4 py-1.5 rounded-full bg-gray-800 text-xs text-gray-400">
                  <i className="fa-solid fa-circle-info mr-1"></i>
                  {msg.text}
                </div>
              ) : (
                <div className={`max-w-[80%] ${msg.sender === 'caller' ? 'order-1' : ''}`}>
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
                      <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400">
                        {msg.intent}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
          {isSpeaking && (
            <div className="flex justify-start">
              <div className="px-4 py-3 rounded-2xl bg-gray-800 border border-gray-700 rounded-bl-md">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Status Bar */}
        {callStatus === 'active' && (
          <div className="p-4 border-t border-gray-800">
            <div className={`w-full py-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-3 ${
              isSpeaking
                ? 'bg-violet-600/20 border border-violet-500/30 text-violet-300'
                : isListening
                ? 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-300'
                : 'bg-gray-800/50 border border-gray-700/50 text-gray-400'
            }`}>
              {isSpeaking ? (
                <>
                  <div className="flex gap-1">
                    <div className="w-1 h-4 bg-violet-400 rounded animate-pulse" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-1 h-4 bg-violet-400 rounded animate-pulse" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-1 h-4 bg-violet-400 rounded animate-pulse" style={{ animationDelay: '300ms' }}></div>
                  </div>
                  <span className="text-lg">{identity.agentName} is speaking...</span>
                </>
              ) : isListening ? (
                <>
                  <i className="fa-solid fa-microphone text-xl animate-pulse"></i>
                  <span className="text-lg">🎤 Listening... Just speak naturally</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-circle text-xl"></i>
                  <span className="text-lg">Ready - Start speaking anytime</span>
                </>
              )}
            </div>
            <p className="text-xs text-gray-500 text-center mt-2">
              {isSpeaking 
                ? '💡 You can interrupt by speaking - the agent will stop automatically'
                : isListening
                ? '💡 The AI will respond when you finish speaking'
                : '💡 Automatic voice detection is active - no buttons needed'}
            </p>
          </div>
        )}
      </div>

      {/* Side Panel */}
      <div className="space-y-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <i className="fa-solid fa-circle-info text-violet-400"></i>
            Call Information
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Agent</span>
              <span className="text-white">{identity.agentName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Voice</span>
              <span className="text-white capitalize">{identity.voice}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Duration</span>
              <span className="text-white">{formatDuration(callDuration)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Messages</span>
              <span className="text-white">{messages.filter(m => m.sender !== 'system').length}</span>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <i className="fa-solid fa-brain text-violet-400"></i>
            Detected Intents
          </h3>
          <div className="space-y-2">
            {messages.filter(m => m.intent).length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-3">No intents detected yet</p>
            ) : (
              messages.filter(m => m.intent).map((m, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-gray-800/50">
                  <span className="text-xs text-gray-300">{m.intent}</span>
                  <span className="text-xs text-gray-500">{m.timestamp}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <p className="text-sm text-red-300 flex items-start gap-2">
              <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
              <span>{error}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
