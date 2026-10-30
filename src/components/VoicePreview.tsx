import { useState, useEffect, useRef } from 'react';

interface VoiceOption {
  id: string;
  label: string;
  description: string;
  gender: 'female' | 'male';
  elevenlabsId: string;
  // Browser TTS tuning for differentiation
  rate: number;
  pitch: number;
  sampleText: string;
  accent: string;
  tags: string[];
}

const VOICE_OPTIONS: VoiceOption[] = [
  {
    id: 'skylar',
    label: 'Skylar',
    description: 'Warm, expressive American female voice. Friendly and approachable.',
    gender: 'female',
    elevenlabsId: 'EXAVITQu4vr4xnSDxMaL',
    rate: 1.0,
    pitch: 1.15,
    sampleText: "Hello! I'm Skylar, your AI receptionist. It's wonderful to hear from you! How may I brighten your day?",
    accent: 'American',
    tags: ['Warm', 'Friendly', 'Expressive']
  },
  {
    id: 'daniel',
    label: 'Daniel',
    description: 'Deep, authoritative British male voice. Professional and trustworthy.',
    gender: 'male',
    elevenlabsId: 'onwK4e9ZLuTAKqWW03F9',
    rate: 0.95,
    pitch: 0.85,
    sampleText: "Good day. I'm Daniel, your AI receptionist. How may I be of assistance to you today?",
    accent: 'British',
    tags: ['Deep', 'Authoritative', 'Professional']
  },
  {
    id: 'gemma',
    label: 'Gemma',
    description: 'Soft, gentle Irish female voice. Calm and reassuring.',
    gender: 'female',
    elevenlabsId: 'pFZP5JQG7iQjIQuC4Bku',
    rate: 0.95,
    pitch: 1.2,
    sampleText: "Hi there! I'm Gemma. Thank you so much for calling. How can I help you today?",
    accent: 'Irish',
    tags: ['Soft', 'Gentle', 'Calm']
  },
  {
    id: 'parker',
    label: 'Parker',
    description: 'Clear, confident American male voice. Modern and energetic.',
    gender: 'male',
    elevenlabsId: 'OXyPsHkaYpLrZFlUdLVd',
    rate: 1.05,
    pitch: 0.95,
    sampleText: "Hey there! Parker here, your AI receptionist. What can I do for you today?",
    accent: 'American',
    tags: ['Clear', 'Confident', 'Energetic']
  },
  {
    id: 'archie',
    label: 'Archie',
    description: 'Young, upbeat British male voice. Cheerful and engaging.',
    gender: 'male',
    elevenlabsId: 'XrC1iQiEwGHWoAojsVZF',
    rate: 1.05,
    pitch: 1.1,
    sampleText: "Hello! Archie here, ready to help! What can I do for you today, mate?",
    accent: 'British',
    tags: ['Young', 'Upbeat', 'Cheerful']
  },
  {
    id: 'jacqueline',
    label: 'Jacqueline',
    description: 'Elegant, sophisticated American female voice. Polished and refined.',
    gender: 'female',
    elevenlabsId: 'sGyzj8KtG3bOQ9aQoHGJ',
    rate: 0.98,
    pitch: 1.05,
    sampleText: "Welcome. I'm Jacqueline, your AI receptionist. How may I assist you on this fine day?",
    accent: 'American',
    tags: ['Elegant', 'Sophisticated', 'Polished']
  },
];

// Color themes for each voice
const VOICE_COLORS: Record<string, { bg: string; border: string; text: string; gradient: string }> = {
  skylar: { bg: 'from-rose-500 to-pink-600', border: 'border-rose-500', text: 'text-rose-400', gradient: 'from-rose-500/20 to-pink-500/20' },
  daniel: { bg: 'from-blue-600 to-indigo-700', border: 'border-blue-500', text: 'text-blue-400', gradient: 'from-blue-500/20 to-indigo-500/20' },
  gemma: { bg: 'from-emerald-500 to-teal-600', border: 'border-emerald-500', text: 'text-emerald-400', gradient: 'from-emerald-500/20 to-teal-500/20' },
  parker: { bg: 'from-amber-500 to-orange-600', border: 'border-amber-500', text: 'text-amber-400', gradient: 'from-amber-500/20 to-orange-500/20' },
  archie: { bg: 'from-violet-500 to-purple-600', border: 'border-violet-500', text: 'text-violet-400', gradient: 'from-violet-500/20 to-purple-500/20' },
  jacqueline: { bg: 'from-fuchsia-500 to-pink-600', border: 'border-fuchsia-500', text: 'text-fuchsia-400', gradient: 'from-fuchsia-500/20 to-pink-500/20' },
};

export default function VoicePreview({ 
  selectedVoice, 
  speakingRate, 
  pitch, 
  onSelectVoice 
}: { 
  selectedVoice: string; 
  speakingRate: number; 
  pitch: number;
  onSelectVoice: (voiceId: string) => void;
}) {
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentPreview, setCurrentPreview] = useState<string | null>(null);
  const [audioSupported, setAudioSupported] = useState(true);
  const [waveformActive, setWaveformActive] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      setAudioSupported(false);
      return;
    }

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        setBrowserVoices(voices);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Find best browser voice based on gender
  const findBrowserVoice = (gender: 'male' | 'female'): SpeechSynthesisVoice | null => {
    if (browserVoices.length === 0) return null;

    const femaleKeywords = ['female', 'woman', 'zira', 'samantha', 'victoria', 'karen', 'allison', 'fiona', 'moira', 'tessa'];
    const maleKeywords = ['male', 'man', 'david', 'daniel', 'alex', 'fred', 'tom', 'mark', 'jorge', 'diego'];

    const keywords = gender === 'female' ? femaleKeywords : maleKeywords;
    
    for (const keyword of keywords) {
      const match = browserVoices.find(v => 
        v.name.toLowerCase().includes(keyword.toLowerCase())
      );
      if (match) return match;
    }

    return browserVoices.find(v => v.lang.startsWith('en')) || browserVoices[0];
  };

  const speak = (voiceId: string) => {
    if (!audioSupported) return;

    window.speechSynthesis.cancel();
    
    const option = VOICE_OPTIONS.find(v => v.id === voiceId);
    if (!option) return;

    const browserVoice = findBrowserVoice(option.gender);
    const utterance = new SpeechSynthesisUtterance(option.sampleText);
    
    if (browserVoice) {
      utterance.voice = browserVoice;
    }
    
    // Apply voice-specific tuning combined with user settings
    utterance.rate = option.rate * speakingRate;
    utterance.pitch = option.pitch * pitch;
    utterance.volume = 1;
    
    utterance.onstart = () => {
      setIsSpeaking(true);
      setCurrentPreview(voiceId);
      setWaveformActive(true);
    };
    
    utterance.onend = () => {
      setIsSpeaking(false);
      setCurrentPreview(null);
      setWaveformActive(false);
    };
    
    utterance.onerror = () => {
      setIsSpeaking(false);
      setCurrentPreview(null);
      setWaveformActive(false);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const stop = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setCurrentPreview(null);
    setWaveformActive(false);
  };

  const previewVoice = (voiceId: string) => {
    if (currentPreview === voiceId && isSpeaking) {
      stop();
    } else {
      speak(voiceId);
    }
  };

  if (!audioSupported) {
    return (
      <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
        <p className="text-sm text-amber-300 flex items-center gap-2">
          <i className="fa-solid fa-exclamation-triangle"></i>
          Voice preview is not supported in this browser. Try Chrome, Edge, or Safari.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white flex items-center gap-2">
          <i className="fa-solid fa-headphones text-violet-400"></i>
          Voice Preview
          <span className="text-xs font-normal text-gray-400">({VOICE_OPTIONS.length} voices available)</span>
        </h4>
        {isSpeaking && (
          <button
            onClick={stop}
            className="px-3 py-1 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs hover:bg-red-500/20 transition-all flex items-center gap-1"
          >
            <i className="fa-solid fa-stop"></i>
            Stop
          </button>
        )}
      </div>

      {/* Voice Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {VOICE_OPTIONS.map((option) => {
          const isSelected = selectedVoice === option.id;
          const isPlaying = currentPreview === option.id && isSpeaking;
          const colors = VOICE_COLORS[option.id];

          return (
            <div
              key={option.id}
              className={`relative p-4 rounded-xl border transition-all overflow-hidden ${
                isSelected
                  ? `${colors.border} bg-gradient-to-br ${colors.gradient}`
                  : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
              }`}
            >
              {/* Playing indicator */}
              {isPlaying && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-500 via-pink-500 to-violet-500 animate-pulse"></div>
              )}

              <div className="flex items-start gap-3">
                {/* Voice Avatar */}
                <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${colors.bg} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                  <span className="text-lg font-bold text-white">
                    {option.label.charAt(0)}
                  </span>
                </div>

                {/* Voice Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-white">{option.label}</p>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-300">
                      {option.accent}
                    </span>
                    {isSelected && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${colors.text} bg-black/20`}>
                        <i className="fa-solid fa-check mr-1"></i>Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">{option.description}</p>
                  
                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {option.tags.map((tag, idx) => (
                      <span 
                        key={idx}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors.text} bg-black/20`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-700/50">
                {/* Play Button */}
                <button
                  onClick={() => previewVoice(option.id)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${
                    isPlaying
                      ? `bg-gradient-to-r ${colors.bg} text-white shadow-lg`
                      : `bg-gray-700/50 text-gray-200 hover:bg-gray-700`
                  }`}
                >
                  {isPlaying ? (
                    <>
                      <div className="flex gap-0.5 items-center">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div 
                            key={i}
                            className="w-0.5 bg-white rounded-full animate-pulse"
                            style={{ 
                              height: `${8 + Math.random() * 8}px`,
                              animationDelay: `${i * 0.1}s`,
                              animationDuration: '0.6s'
                            }}
                          ></div>
                        ))}
                      </div>
                      <span>Playing...</span>
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-play text-xs"></i>
                      <span>Preview</span>
                    </>
                  )}
                </button>

                {/* Select Button */}
                <button
                  onClick={() => onSelectVoice(option.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    isSelected
                      ? `bg-gradient-to-r ${colors.bg} text-white`
                      : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {isSelected ? '✓' : 'Use'}
                </button>
              </div>

              {/* ElevenLabs ID */}
              <div className="mt-2 pt-2 border-t border-gray-700/30">
                <p className="text-[10px] text-gray-500 font-mono truncate">
                  <i className="fa-solid fa-fingerprint mr-1"></i>
                  ID: {option.elevenlabsId}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom Text Preview */}
      <div className="p-4 rounded-xl bg-gray-800/50 border border-gray-700/50">
        <label className="block text-xs font-medium text-gray-300 mb-2">
          <i className="fa-solid fa-keyboard mr-1 text-violet-400"></i>
          Custom Preview Text
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            id="customVoiceText"
            defaultValue="Hello! Thank you for calling. I'm your AI assistant. How can I help you today?"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none"
            placeholder="Type text to preview..."
          />
          <button
            onClick={() => {
              const input = document.getElementById('customVoiceText') as HTMLInputElement;
              if (input?.value) {
                window.speechSynthesis.cancel();
                const option = VOICE_OPTIONS.find(v => v.id === selectedVoice);
                const browserVoice = option ? findBrowserVoice(option.gender) : null;
                const utterance = new SpeechSynthesisUtterance(input.value);
                if (browserVoice) utterance.voice = browserVoice;
                if (option) {
                  utterance.rate = option.rate * speakingRate;
                  utterance.pitch = option.pitch * pitch;
                }
                utterance.onstart = () => { setIsSpeaking(true); setCurrentPreview(selectedVoice); };
                utterance.onend = () => { setIsSpeaking(false); setCurrentPreview(null); };
                window.speechSynthesis.speak(utterance);
              }
            }}
            disabled={isSpeaking}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            <i className="fa-solid fa-play"></i>
            Play
          </button>
        </div>
      </div>

      {/* Current Settings Display */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-gray-800/30 border border-gray-700/50">
          <p className="text-xs text-gray-400 mb-1">Speaking Rate</p>
          <p className="text-lg font-bold text-white">{speakingRate}x</p>
          <div className="w-full h-1 bg-gray-700 rounded-full mt-2 overflow-hidden">
            <div 
              className="h-full bg-violet-500 rounded-full transition-all"
              style={{ width: `${(speakingRate / 2) * 100}%` }}
            ></div>
          </div>
        </div>
        <div className="p-3 rounded-lg bg-gray-800/30 border border-gray-700/50">
          <p className="text-xs text-gray-400 mb-1">Pitch</p>
          <p className="text-lg font-bold text-white">{pitch}x</p>
          <div className="w-full h-1 bg-gray-700 rounded-full mt-2 overflow-hidden">
            <div 
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${(pitch / 2) * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Info Note */}
      <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <p className="text-xs text-blue-300 flex items-start gap-2">
          <i className="fa-solid fa-circle-info mt-0.5"></i>
          <span>
            <strong>Browser Preview:</strong> Uses your browser's speech synthesis with voice-specific pitch/rate tuning to approximate each voice. 
            For production with authentic voice quality, connect <strong>ElevenLabs API</strong> in Settings → Integrations.
          </span>
        </p>
      </div>
    </div>
  );
}
