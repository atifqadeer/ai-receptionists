import { useState, useEffect, useRef } from 'react';

interface VoiceOption {
  id: string;
  label: string;
  description: string;
  gender: 'female' | 'male' | 'neutral';
  browserVoiceMatch: string[]; // Keywords to match browser voices
}

const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'female-1', label: 'Aria (Professional)', description: 'Clear, professional female voice', gender: 'female', browserVoiceMatch: ['female', 'woman', 'zira', 'samantha', 'google us english'] },
  { id: 'female-2', label: 'Luna (Friendly)', description: 'Warm, friendly female voice', gender: 'female', browserVoiceMatch: ['female', 'woman', 'allison', 'karen', 'google uk english female'] },
  { id: 'male-1', label: 'James (Professional)', description: 'Deep, authoritative male voice', gender: 'male', browserVoiceMatch: ['male', 'man', 'david', 'daniel', 'google uk english male'] },
  { id: 'male-2', label: 'Marcus (Warm)', description: 'Friendly, approachable male voice', gender: 'male', browserVoiceMatch: ['male', 'man', 'mark', 'alex', 'google us english'] },
  { id: 'neutral', label: 'Sage (Modern)', description: 'Neutral, modern voice', gender: 'neutral', browserVoiceMatch: ['neutral', 'google'] },
];

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
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Load available browser voices
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

  // Find best matching browser voice for a given option
  const findBrowserVoice = (option: VoiceOption): SpeechSynthesisVoice | null => {
    if (browserVoices.length === 0) return null;

    // Try to match by keywords
    for (const keyword of option.browserVoiceMatch) {
      const match = browserVoices.find(v => 
        v.name.toLowerCase().includes(keyword.toLowerCase())
      );
      if (match) return match;
    }

    // Fallback: match by gender
    const genderKeywords = {
      female: ['female', 'woman', 'zira', 'samantha', 'allison', 'karen', 'victoria', 'fiona'],
      male: ['male', 'man', 'david', 'daniel', 'mark', 'alex', 'fred', 'tom'],
      neutral: ['google', 'neutral', 'default']
    };

    for (const keyword of genderKeywords[option.gender]) {
      const match = browserVoices.find(v => 
        v.name.toLowerCase().includes(keyword.toLowerCase())
      );
      if (match) return match;
    }

    // Last resort: return first English voice
    return browserVoices.find(v => v.lang.startsWith('en')) || browserVoices[0];
  };

  const speak = (text: string, voiceId: string) => {
    if (!audioSupported) return;

    // Stop any current speech
    window.speechSynthesis.cancel();
    
    const option = VOICE_OPTIONS.find(v => v.id === voiceId);
    if (!option) return;

    const browserVoice = findBrowserVoice(option);
    const utterance = new SpeechSynthesisUtterance(text);
    
    if (browserVoice) {
      utterance.voice = browserVoice;
    }
    
    utterance.rate = speakingRate;
    utterance.pitch = pitch;
    utterance.volume = 1;
    
    utterance.onstart = () => {
      setIsSpeaking(true);
      setCurrentPreview(voiceId);
    };
    
    utterance.onend = () => {
      setIsSpeaking(false);
      setCurrentPreview(null);
    };
    
    utterance.onerror = () => {
      setIsSpeaking(false);
      setCurrentPreview(null);
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const stop = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setCurrentPreview(null);
  };

  const previewVoice = (voiceId: string) => {
    if (currentPreview === voiceId && isSpeaking) {
      stop();
    } else {
      const option = VOICE_OPTIONS.find(v => v.id === voiceId);
      const sampleText = option?.gender === 'male'
        ? "Hello! I'm your AI receptionist. Thank you for calling. How may I assist you today?"
        : "Hello! I'm your AI receptionist. Thank you for calling. How may I assist you today?";
      speak(sampleText, voiceId);
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

      {/* Voice Cards */}
      <div className="space-y-2">
        {VOICE_OPTIONS.map((option) => {
          const isSelected = selectedVoice === option.id;
          const isPlaying = currentPreview === option.id && isSpeaking;
          const browserVoice = findBrowserVoice(option);

          return (
            <div
              key={option.id}
              className={`p-3 rounded-lg border transition-all ${
                isSelected
                  ? 'border-violet-500 bg-violet-500/10'
                  : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  {/* Voice Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    option.gender === 'female' 
                      ? 'bg-gradient-to-br from-pink-500 to-rose-600' 
                      : option.gender === 'male'
                      ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                      : 'bg-gradient-to-br from-emerald-500 to-teal-600'
                  }`}>
                    <i className={`fa-solid ${
                      option.gender === 'female' ? 'fa-person-dress' : 
                      option.gender === 'male' ? 'fa-person' : 'fa-user'
                    } text-white text-sm`}></i>
                  </div>

                  {/* Voice Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-white">{option.label}</p>
                      {isSelected && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">Selected</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{option.description}</p>
                    {browserVoice && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        <i className="fa-solid fa-microphone mr-1"></i>
                        {browserVoice.name} ({browserVoice.lang})
                      </p>
                    )}
                  </div>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-2">
                  {/* Play/Stop Button */}
                  <button
                    onClick={() => previewVoice(option.id)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                      isPlaying
                        ? 'bg-red-500 hover:bg-red-600'
                        : 'bg-violet-600 hover:bg-violet-700'
                    }`}
                    title={isPlaying ? 'Stop' : 'Preview voice'}
                  >
                    {isPlaying ? (
                      <>
                        <div className="flex gap-0.5">
                          <div className="w-0.5 h-3 bg-white rounded animate-pulse"></div>
                          <div className="w-0.5 h-3 bg-white rounded animate-pulse" style={{ animationDelay: '0.1s' }}></div>
                          <div className="w-0.5 h-3 bg-white rounded animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                        </div>
                      </>
                    ) : (
                      <i className="fa-solid fa-play text-white text-xs ml-0.5"></i>
                    )}
                  </button>

                  {/* Select Button */}
                  <button
                    onClick={() => onSelectVoice(option.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-violet-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {isSelected ? '✓ Active' : 'Select'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom Text Preview */}
      <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
        <label className="block text-xs font-medium text-gray-300 mb-2">
          <i className="fa-solid fa-keyboard mr-1"></i>
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
                speak(input.value, selectedVoice);
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
            Voice preview uses your browser's built-in speech synthesis. For production use with premium voices, 
            connect ElevenLabs API in Settings. Available voices depend on your browser and OS.
          </span>
        </p>
      </div>
    </div>
  );
}
