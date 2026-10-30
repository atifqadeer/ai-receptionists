import { useState, useRef, useEffect } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface CallMessage {
  id: number;
  sender: 'agent' | 'caller' | 'system';
  text: string;
  timestamp: string;
  intent?: string;
}

// Voice profiles matching the ones in VoicePreview
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
  const synthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load saved configurations
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

  // Check browser support
  const speechRecognitionSupported = typeof window !== 'undefined' && 
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  const speechSynthesisSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Call duration timer
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

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Initialize speech recognition with continuous listening
  const initRecognition = () => {
    if (!speechRecognitionSupported) {
      setError('Speech recognition not supported in this browser. Please use Chrome or Edge.');
      return null;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    // Enable continuous listening for automatic voice detection
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
      
      // Barge-in: If user starts speaking while agent is speaking, stop the agent
      if (final && isSpeaking) {
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
        // No speech detected, restart listening automatically
        if (callStatus === 'active' && !isSpeaking) {
          try {
            recognition.start();
          } catch (e) {
            // Already started
          }
        }
      } else if (event.error !== 'aborted') {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      // Automatically restart listening if call is still active and agent is not speaking
      if (callStatus === 'active' && !isSpeaking) {
        try {
          recognition.start();
        } catch (e) {
          // Already started
        }
      } else {
        setIsListening(false);
      }
      setInterimTranscript('');
    };

    return recognition;
  };

  // Initialize microphone for voice level visualization
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

  // Find browser voice matching the agent voice
  const findBrowserVoice = (): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    const profile = VOICE_PROFILES[identity.voice] || VOICE_PROFILES.skylar;
    
    const keywords = profile.gender === 'female' 
      ? ['female', 'woman', 'zira', 'samantha', 'victoria', 'karen', 'allison', 'fiona']
      : ['male', 'man', 'david', 'daniel', 'alex', 'fred', 'tom', 'mark'];
    
    for (const keyword of keywords) {
      const match = voices.find(v => v.name.toLowerCase().includes(keyword.toLowerCase()));
      if (match) return match;
    }
    
    return voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
  };

  // Speak text using the agent's voice
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
        // Pause recognition while agent is speaking
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (e) {
            // Ignore errors
          }
        }
      };
      
      utterance.onend = () => {
        setIsSpeaking(false);
        // Restart listening after agent finishes speaking
        if (callStatus === 'active' && recognitionRef.current) {
          setTimeout(() => {
            try {
              recognitionRef.current.start();
            } catch (e) {
              // Already started
            }
          }, 300);
        }
        resolve();
      };
      
      utterance.onerror = () => {
        setIsSpeaking(false);
        // Restart listening even on error
        if (callStatus === 'active' && recognitionRef.current) {
          setTimeout(() => {
            try {
              recognitionRef.current.start();
            } catch (e) {
              // Already started
            }
          }, 300);
        }
        resolve();
      };
      
      synthRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    });
  };

  // Detect intent from caller's speech
  const detectIntent = (text: string): string => {
    const lower = text.toLowerCase();
    
    // Check FAQs first for direct matches
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
    
    // Intent detection
    if (lower.includes('appointment') || lower.includes('book') || lower.includes('schedule') || lower.includes('meeting')) return 'Appointment Booking';
    if (lower.includes('hours') || lower.includes('open') || lower.includes('close') || lower.includes('when')) return 'Business Hours';
    if (lower.includes('support') || lower.includes('technical') || lower.includes('bug') || lower.includes('error') || lower.includes('problem') || lower.includes('issue') || lower.includes('broken') || lower.includes('not working')) return 'Technical Support';
    if (lower.includes('manager') || lower.includes('speak') || lower.includes('human') || lower.includes('person') || lower.includes('agent') || lower.includes('representative') || lower.includes('transfer')) return 'Transfer Request';
    if (lower.includes('service') || lower.includes('offer') || lower.includes('provide') || lower.includes('do you')) return 'General Inquiry';
    if (lower.includes('complaint') || lower.includes('unhappy') || lower.includes('angry') || lower.includes('frustrated') || lower.includes('dissatisfied')) return 'Complaint';
    if (lower.includes('price') || lower.includes('cost') || lower.includes('how much') || lower.includes('pricing') || lower.includes('charge') || lower.includes('fee') || lower.includes('rate')) return 'Pricing';
    if (lower.includes('address') || lower.includes('location') || lower.includes('where') || lower.includes('find you') || lower.includes('office')) return 'Location';
    if (lower.includes('email') || lower.includes('contact') || lower.includes('reach') || lower.includes('phone') || lower.includes('call')) return 'Contact Info';
    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey') || lower.includes('good morning') || lower.includes('good afternoon')) return 'Greeting';
    if (lower.includes('thank') || lower.includes('thanks') || lower.includes('bye') || lower.includes('goodbye')) return 'Closing';
    
    return 'General Inquiry';
  };

  // Generate AI response based on intent - uses knowledge base data
  const generateResponse = (text: string, intent: string): string => {
    // Handle FAQ matches
    if (intent.startsWith('FAQ:')) {
      const question = intent.substring(4);
      const faq = knowledge.faqs?.find(f => f.q === question);
      if (faq) {
        return faq.a;
      }
    }
    
    // Dynamic responses using knowledge base
    const responses: Record<string, string[]> = {
      'Appointment Booking': [
        `I'd be happy to help you book an appointment! We're available ${knowledge.businessHours}. What date and time works best for you?`,
        `Great! I can schedule that for you. Our available hours are ${knowledge.businessHours}. When would you like to come in?`,
        `Absolutely! We can set up an appointment. We're open ${knowledge.businessHours}. What day and time would you prefer?`,
      ],
      'Business Hours': [
        `Our business hours are ${knowledge.businessHours}. Is there anything else I can help you with?`,
        `We're open ${knowledge.businessHours}. Would you like to schedule a visit or do you have other questions?`,
        `You can reach us ${knowledge.businessHours}. Is there something specific I can assist you with today?`,
      ],
      'Technical Support': [
        `I understand you're experiencing technical difficulties. Could you describe the problem in more detail? If it's urgent, I can transfer you to our technical team right away.`,
        `I'm sorry to hear you're having technical issues. Let me help you troubleshoot. Can you tell me exactly what's happening?`,
        `I'd be happy to help with the technical problem. Could you walk me through what you're experiencing? We can also connect you with a specialist if needed.`,
      ],
      'Transfer Request': [
        `I'd be happy to connect you with a specialist. Let me check their availability. Would you like me to transfer you now, or would you prefer to schedule a specific time?`,
        `Of course! I can transfer you to the right person. Are you available now, or would you prefer to schedule a callback?`,
        `Absolutely! Let me get you connected with someone who can help. Would you like to be transferred now?`,
      ],
      'General Inquiry': [
        `Thank you for your question! We offer ${knowledge.services}. You can reach us at ${knowledge.email} or call us at ${knowledge.phone}. Is there anything specific you'd like to know?`,
        `Great question! Our services include ${knowledge.services}. For more information, you can email us at ${knowledge.email}. What else can I help you with?`,
        `I'd be happy to help! We provide ${knowledge.services}. Feel free to contact us at ${knowledge.email} for more details. What else would you like to know?`,
      ],
      'Complaint': [
        `I'm sincerely sorry to hear you're having this experience. Your feedback is important to us. Could you tell me more about what happened so I can make sure it gets addressed properly?`,
        `I apologize for the inconvenience. We take all concerns seriously. Could you share more details about the issue? I want to make sure we resolve this for you.`,
        `I'm sorry you're frustrated. We want to make this right. Can you tell me what went wrong so I can escalate this to the right team?`,
      ],
      'Pricing': [
        `Our pricing varies based on your specific needs. We offer ${knowledge.services}. Would you like me to connect you with our sales team for a detailed quote? You can reach them at ${knowledge.email}.`,
        `We have different pricing tiers depending on the services you need. We provide ${knowledge.services}. For a personalized quote, I can connect you with our sales team. Would you like that?`,
        `Pricing depends on your requirements. Our services include ${knowledge.services}. For accurate pricing, our sales team can provide a custom quote. Would you like me to arrange that?`,
      ],
      'Location': [
        `You can find us at our main office. For the exact address and directions, please contact us at ${knowledge.email} or call ${knowledge.phone}. Would you like me to transfer you to someone who can provide detailed location information?`,
        `Our office is conveniently located. For specific address details and parking information, please reach out to us at ${knowledge.phone} or ${knowledge.email}.`,
      ],
      'Contact Info': [
        `You can reach us in several ways: Phone: ${knowledge.phone}, Email: ${knowledge.email}. We're available ${knowledge.businessHours}. How would you prefer to be contacted?`,
        `Our contact information is: Phone: ${knowledge.phone}, Email: ${knowledge.email}. We're here to help ${knowledge.businessHours}. Is there anything else I can assist you with?`,
        `Feel free to contact us at ${knowledge.phone} or email us at ${knowledge.email}. Our team is available ${knowledge.businessHours}. What else can I help you with today?`,
      ],
      'Greeting': [
        `Hello! It's great to speak with you. How can I assist you today?`,
        `Hi there! Welcome. What can I help you with today?`,
        `Hello! I'm here to help. What brings you in today?`,
      ],
      'Closing': [
        `Thank you for calling! Have a wonderful day. Don't hesitate to reach out if you need anything else.`,
        `You're welcome! It was my pleasure assisting you. Have a great day!`,
        `Thank you! We appreciate your call. Feel free to contact us anytime. Goodbye!`,
      ],
    };
    
    const intentResponses = responses[intent] || responses['General Inquiry'];
    // Pick a random response to add variety
    return intentResponses[Math.floor(Math.random() * intentResponses.length)];
  };

  // Handle caller's speech
  const handleCallerSpeech = async (text: string) => {
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    // Add caller message
    setMessages(prev => [...prev, {
      id: Date.now(),
      sender: 'caller',
      text: text,
      timestamp: now,
    }]);
    
    setTranscript('');
    
    // Detect intent and generate response
    const intent = detectIntent(text);
    const response = generateResponse(text, intent);
    
    // Small delay to feel natural
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Add agent response
    setMessages(prev => [...prev, {
      id: Date.now() + 1,
      sender: 'agent',
      text: response,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      intent: intent,
    }]);
    
    // Speak the response
    await speakText(response);
  };

  // Start listening for caller speech
  const startListening = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
    
    if (!recognitionRef.current) {
      recognitionRef.current = initRecognition();
    }
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error('Failed to start recognition:', err);
      }
    }
  };

  // Stop listening
  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.error('Failed to stop recognition:', err);
      }
    }
    setIsListening(false);
  };

  // Start a call
  const startCall = async () => {
    setError(null);
    setCallStatus('dialing');
    setCallDuration(0);
    setMessages([]);
    
    // Initialize microphone for voice level
    await initMicrophone();
    
    // Initialize speech recognition
    if (!recognitionRef.current) {
      recognitionRef.current = initRecognition();
    }
    
    // Simulate dialing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setCallStatus('active');
    
    // Add system message
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setMessages([{
      id: 1,
      sender: 'system',
      text: `Call connected with ${identity.agentName} at ${identity.companyName}`,
      timestamp: now,
    }]);
    
    // Agent greeting
    await new Promise(resolve => setTimeout(resolve, 500));
    await speakText(behavior.greeting);
    
    setMessages(prev => [...prev, {
      id: 2,
      sender: 'agent',
      text: behavior.greeting,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    }]);
    
    // Automatically start listening after greeting
    setTimeout(() => {
      if (recognitionRef.current && callStatus === 'active') {
        try {
          recognitionRef.current.start();
        } catch (e) {
          // Already started
        }
      }
    }, 500);
  };

  // End call
  const endCall = async () => {
    stopListening();
    window.speechSynthesis.cancel();
    stopMicrophone();
    
    if (callStatus === 'active') {
      // Speak farewell
      await speakText(behavior.farewell);
      
      setMessages(prev => [...prev, {
        id: Date.now(),
        sender: 'agent',
        text: behavior.farewell,
        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      }]);
    }
    
    setCallStatus('ended');
    
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
  };

  return (
    <div className="space-y-6">
      {/* Call Setup Card */}
      {callStatus === 'idle' && (
        <div className="bg-gradient-to-br from-violet-600/10 to-indigo-600/10 rounded-xl border border-violet-500/30 p-6">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <i className="fa-solid fa-phone-volume text-white text-2xl"></i>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Make a Voice Call</h2>
              <p className="text-sm text-gray-300">
                Speak to {identity.agentName} using your microphone. Your voice will be converted to text, 
                processed by the AI, and responses will be spoken back to you.
              </p>
            </div>
          </div>

          {/* Browser Support Warning */}
          {(!speechRecognitionSupported || !speechSynthesisSupported) && (
            <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <p className="text-sm text-amber-300 flex items-start gap-2">
                <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
                <span>
                  {!speechRecognitionSupported && !speechSynthesisSupported 
                    ? 'Your browser does not support speech recognition or synthesis. Please use Chrome, Edge, or Safari.'
                    : !speechRecognitionSupported 
                    ? 'Your browser does not support speech recognition. Please use Chrome or Edge.'
                    : 'Your browser does not support speech synthesis. Please use Chrome, Edge, or Safari.'}
                </span>
              </p>
            </div>
          )}

          {/* Call Mode Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">Call Mode</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={() => setCallMode('browser')}
                className={`p-4 rounded-lg border text-left transition-all ${
                  callMode === 'browser' 
                    ? 'border-violet-500 bg-violet-500/10' 
                    : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <i className="fa-solid fa-globe text-violet-400"></i>
                  <p className="text-sm font-semibold text-white">Browser Call</p>
                  {callMode === 'browser' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">Recommended</span>
                  )}
                </div>
                <p className="text-xs text-gray-400">Use your microphone and speakers. Works immediately, no API keys needed.</p>
              </button>
              <button
                onClick={() => setCallMode('twilio')}
                className={`p-4 rounded-lg border text-left transition-all ${
                  callMode === 'twilio' 
                    ? 'border-violet-500 bg-violet-500/10' 
                    : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <i className="fa-solid fa-phone text-violet-400"></i>
                  <p className="text-sm font-semibold text-white">Phone Call (Twilio)</p>
                  {callMode === 'twilio' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">Selected</span>
                  )}
                </div>
                <p className="text-xs text-gray-400">Call a real phone number. Requires Twilio API setup in Settings.</p>
              </button>
            </div>
          </div>

          {/* Phone Number Input (for Twilio mode) */}
          {callMode === 'twilio' && (
            <div className="mb-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Phone Number</label>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Your Name (Optional)</label>
                <input
                  type="text"
                  value={callerName}
                  onChange={(e) => setCallerName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 outline-none"
                />
              </div>
              <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
                <p className="text-xs text-blue-300 flex items-start gap-2">
                  <i className="fa-solid fa-circle-info mt-0.5"></i>
                  <span>
                    To use real phone calls, configure Twilio in Settings → Telephony. 
                    You'll need a Twilio account, phone number, and API credentials.
                  </span>
                </p>
              </div>
            </div>
          )}

          {/* Agent Info */}
          <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50 mb-4">
            <p className="text-xs text-gray-400 mb-2">Call Configuration</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
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
                <p className="text-xs text-gray-500">Language</p>
                <p className="text-white font-medium">English</p>
              </div>
            </div>
          </div>

          {/* Start Call Button */}
          <button
            onClick={startCall}
            disabled={!speechRecognitionSupported || !speechSynthesisSupported}
            className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold text-lg hover:from-emerald-600 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-lg"
          >
            <i className="fa-solid fa-phone text-xl"></i>
            Start Call
          </button>
        </div>
      )}

      {/* Dialing State */}
      {callStatus === 'dialing' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <i className="fa-solid fa-phone text-white text-3xl"></i>
          </div>
          <h3 className="text-xl font-bold text-white mb-2">
            {callMode === 'twilio' ? `Calling ${phoneNumber}...` : 'Connecting...'}
          </h3>
          <p className="text-sm text-gray-400">
            {callMode === 'twilio' ? 'Establishing connection via Twilio...' : 'Preparing microphone and AI agent...'}
          </p>
        </div>
      )}

      {/* Active Call */}
      {(callStatus === 'active' || callStatus === 'ended') && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Call Interface */}
          <div className="lg:col-span-2 bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden">
            {/* Call Header */}
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
                    Duration: {formatDuration(callDuration)} • {identity.agentName} ({identity.voice})
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

            {/* Voice Visualization */}
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
                    <span>Auto-listening enabled</span>
                  </div>
                </div>
                
                {/* Voice Level Bar */}
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
                
                {/* Live Transcript */}
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

            {/* Automatic Voice Detection Status */}
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
            {/* Call Info */}
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
                  <span className="text-gray-400">Mode</span>
                  <span className="text-white">{callMode === 'browser' ? 'Browser' : 'Twilio'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Messages</span>
                  <span className="text-white">{messages.filter(m => m.sender !== 'system').length}</span>
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

            {/* Quick Actions */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <i className="fa-solid fa-bolt text-violet-400"></i>
                Quick Actions
              </h3>
              <div className="space-y-2">
                <button
                  onClick={() => {
                    if (callStatus === 'active') {
                      speakText("Let me transfer you to a specialist.");
                    }
                  }}
                  disabled={callStatus !== 'active'}
                  className="w-full py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <i className="fa-solid fa-arrow-right-arrow-left"></i>
                  Transfer to Human
                </button>
                <button
                  onClick={() => {
                    if (callStatus === 'active' && isSpeaking) {
                      window.speechSynthesis.cancel();
                      setIsSpeaking(false);
                    }
                  }}
                  disabled={callStatus !== 'active' || !isSpeaking}
                  className="w-full py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <i className="fa-solid fa-stop"></i>
                  Interrupt Agent
                </button>
                <button
                  onClick={() => {
                    if (callStatus === 'active') {
                      const text = "Could you please hold for a moment while I look into that?";
                      speakText(text);
                      setMessages(prev => [...prev, {
                        id: Date.now(),
                        sender: 'agent',
                        text: text,
                        timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                      }]);
                    }
                  }}
                  disabled={callStatus !== 'active'}
                  className="w-full py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <i className="fa-solid fa-pause"></i>
                  Put on Hold
                </button>
              </div>
            </div>

            {/* Error Display */}
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
      )}
    </div>
  );
}
