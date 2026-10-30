# 📞 Make a Call - Voice Calling Guide

## 🎉 New Feature: Real Voice Calls!

You can now make **real voice calls** to the AI agent using your microphone! The AI will listen to you, understand your speech, and respond with voice using the configured voice profile.

---

## 🚀 How to Make a Call

### Step 1: Navigate to "Make a Call"
- Click **"Make a Call"** in the left sidebar (phone icon)
- Or go directly to the voice call interface

### Step 2: Choose Call Mode
You have two options:

#### 🌐 **Browser Call** (Recommended)
- Uses your computer's microphone and speakers
- Works immediately, no API keys needed
- Uses browser's built-in Web Speech API
- Best for testing and development

#### 📱 **Phone Call (Twilio)**
- Calls a real phone number via Twilio
- Requires Twilio account and API setup
- Best for production use
- Configure in Settings → Telephony

### Step 3: Start the Call
1. Click **"Start Call"** button
2. Allow microphone access when prompted
3. Wait for the AI agent to greet you
4. Click **"Hold to Speak"** to talk

### Step 4: Talk to the AI
- Click the microphone button to start listening
- Speak clearly into your microphone
- The AI will process your speech and respond
- You'll see a live transcript of what you said
- The AI's response will be spoken aloud

### Step 5: End the Call
- Click **"End Call"** to hang up
- The AI will say goodbye
- You'll see a call summary

---

## 🎤 How It Works

### Voice Input (Speech-to-Text)
1. Your browser captures audio from your microphone
2. Web Speech API converts your speech to text in real-time
3. The text is sent to the AI agent for processing
4. You see a live transcript of what you said

### AI Processing
1. The AI analyzes your speech text
2. Detects your intent (appointment, inquiry, support, etc.)
3. Generates an appropriate response
4. Response appears in the chat transcript

### Voice Output (Text-to-Speech)
1. The AI's response text is converted to speech
2. Uses your configured voice profile (Skylar, Daniel, etc.)
3. Applies your rate and pitch settings
4. Plays through your speakers

---

## 🎙️ Voice Profiles

The AI uses the voice you configured in **Agent Setup**:

| Voice | Characteristics |
|-------|----------------|
| **Skylar** | Warm, friendly, American female |
| **Daniel** | Deep, authoritative, British male |
| **Gemma** | Soft, gentle, Irish female |
| **Parker** | Clear, confident, American male |
| **Archie** | Young, upbeat, British male |
| **Jacqueline** | Elegant, sophisticated, American female |

To change the voice:
1. Go to **Agent Setup** → **Identity & Voice**
2. Select a different voice
3. Start a new call to hear the change

---

## 🎯 Features

### Real-Time Features
- ✅ **Live voice level visualization** - See your voice amplitude
- ✅ **Live transcript** - See what you're saying in real-time
- ✅ **Intent detection** - See what the AI understood
- ✅ **Call duration timer** - Track call length
- ✅ **Message history** - Full conversation log

### Call Controls
- ✅ **Hold to Speak** - Click to talk, release to listen
- ✅ **Interrupt Agent** - Stop the AI mid-sentence
- ✅ **Transfer to Human** - Simulate transfer
- ✅ **Put on Hold** - Pause the conversation
- ✅ **End Call** - Hang up with farewell

### Smart Features
- ✅ **Barge-in support** - Interrupt the AI while speaking
- ✅ **Silence detection** - Auto-stops listening after silence
- ✅ **Error handling** - Clear messages for microphone issues
- ✅ **Voice matching** - Uses your configured voice profile

---

## 🔧 Browser Requirements

### Supported Browsers
- ✅ **Chrome** (Recommended) - Full support
- ✅ **Edge** - Full support
- ✅ **Safari** - Good support
- ⚠️ **Firefox** - Limited support

### Required Permissions
- 🎤 **Microphone access** - Required for voice input
- 🔊 **Audio output** - Required for voice output

### How to Allow Microphone
1. Click the microphone icon in the address bar
2. Select "Allow" when prompted
3. Refresh the page if needed

---

## 📱 Using Twilio for Real Phone Calls

### Setup Steps

1. **Get Twilio Account**
   - Sign up at [twilio.com](https://www.twilio.com)
   - Get a phone number
   - Get Account SID and Auth Token

2. **Configure in Settings**
   - Go to **Settings** → **Telephony**
   - Select **Twilio** as provider
   - Enter Account SID, Auth Token, Phone Number
   - Save configuration

3. **Make a Call**
   - Go to **Make a Call**
   - Select **Phone Call (Twilio)** mode
   - Enter the phone number to call
   - Click **Start Call**

### How Twilio Calls Work
1. Twilio initiates a call to the phone number
2. When answered, audio is streamed to the AI
3. Deepgram converts speech to text
4. AI generates response
5. ElevenLabs/Cartesia converts text to speech
6. Audio is streamed back to the caller

---

## 🎮 Call Scenarios to Try

### Scenario 1: Book an Appointment
```
You: "I'd like to book an appointment"
AI: "I'd be happy to help you book an appointment! We're available Monday through Friday, 9 AM to 6 PM. What date and time works best for you?"
You: "How about tomorrow at 2 PM?"
AI: "Tomorrow at 2 PM works perfectly. Can I get your name and contact information?"
```

### Scenario 2: Ask About Hours
```
You: "What are your business hours?"
AI: "Our business hours are Monday to Friday, 9:00 AM to 6:00 PM EST. Is there anything else I can help you with?"
```

### Scenario 3: Technical Support
```
You: "I need technical support"
AI: "I understand you need technical support. Could you describe the problem you're experiencing? If it's urgent, I can transfer you to our technical team."
You: "My website is down"
AI: "I'm sorry to hear that. Let me transfer you to our technical team right away."
```

### Scenario 4: General Inquiry
```
You: "What services do you offer?"
AI: "We offer web development, mobile apps, cloud solutions, and AI integration. Would you like more details about any specific service?"
```

---

## 🐛 Troubleshooting

### "Microphone access denied"
**Solution:**
1. Click the microphone icon in the address bar
2. Select "Allow"
3. Refresh the page
4. Try again

### "No sound from AI"
**Solution:**
1. Check your computer's volume
2. Check browser audio permissions
3. Try a different browser (Chrome recommended)
4. Check that the voice is configured in Agent Setup

### "Speech not recognized"
**Solution:**
1. Speak clearly and at normal volume
2. Reduce background noise
3. Move closer to the microphone
4. Try a different browser
5. Check microphone settings in your OS

### "Browser not supported"
**Solution:**
- Use Chrome or Edge for best compatibility
- Firefox has limited Web Speech API support
- Safari works but may have limitations

### "Twilio call not working"
**Solution:**
1. Verify Twilio credentials in Settings
2. Check that phone number is valid (E.164 format: +1234567890)
3. Verify Twilio account has credits
4. Check Twilio console for errors

---

## 📊 Call Analytics

After each call, you can view:
- **Call duration** - How long the call lasted
- **Message count** - Number of exchanges
- **Detected intents** - What the AI understood
- **Conversation log** - Full transcript

View in **Analytics** page for historical data.

---

## 🔒 Privacy & Security

### Browser Calls
- ✅ Audio processed locally in your browser
- ✅ Speech-to-text uses browser's built-in API
- ✅ No audio sent to external servers (except for AI processing)
- ✅ You control when microphone is active

### Twilio Calls
- ⚠️ Audio sent to Twilio servers
- ⚠️ Speech processed by Deepgram
- ⚠️ Voice generated by ElevenLabs/Cartesia
- ✅ All providers have privacy policies
- ✅ You control call initiation

---

## 💡 Tips for Best Experience

### For Voice Input
1. **Use a good microphone** - Headset or external mic works best
2. **Speak clearly** - Enunciate words
3. **Reduce background noise** - Quiet environment helps
4. **Normal pace** - Don't rush or speak too slowly
5. **Wait for prompt** - Let the AI finish before speaking

### For Voice Output
1. **Check volume** - Make sure speakers are on
2. **Choose right voice** - Pick a voice you like in Agent Setup
3. **Adjust rate/pitch** - Fine-tune in Agent Setup
4. **Use headphones** - Better audio quality

### For Best AI Responses
1. **Be specific** - "Book appointment for tomorrow at 2 PM" vs "Book something"
2. **Use natural language** - Speak like you would to a human
3. **One request at a time** - Don't combine multiple requests
4. **Wait for response** - Let the AI finish before asking more

---

## 🎯 Comparison: Browser vs Twilio

| Feature | Browser Call | Twilio Call |
|---------|--------------|-------------|
| **Setup** | None | Requires Twilio account |
| **Cost** | Free | Pay per minute |
| **Quality** | Good | Excellent |
| **Latency** | Low | Very low |
| **Phone Number** | Not needed | Required |
| **Real Phone** | No | Yes |
| **Best For** | Testing, demo | Production |

---

## 🚀 Advanced Features

### Custom Intents
Add more intents in the AI agent configuration to handle specific scenarios.

### Voice Cloning
With ElevenLabs, you can clone voices for a personalized experience.

### Multi-Language
Configure different languages in Agent Setup for international calls.

### Call Recording
Enable call recording in Settings to save conversations.

### Call Transfer
Set up transfer rules in Automation to route calls to humans.

---

## 📚 Related Documentation

- **Agent Setup** - Configure voice and personality
- **Settings → Telephony** - Configure Twilio
- **Settings → Integrations** - Configure voice providers
- **Analytics** - View call history

---

## 🎉 You're Ready to Call!

**Quick Start:**
1. Click **"Make a Call"** in sidebar
2. Click **"Start Call"**
3. Allow microphone access
4. Click **"Hold to Speak"** and talk!
5. Listen to the AI's response
6. Click **"End Call"** when done

**That's it!** You're now making real voice calls to your AI receptionist! 🎊
