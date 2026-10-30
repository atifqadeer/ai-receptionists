# 🔑 API Keys: Development vs Production

Complete guide to understanding and managing your API keys for the AI Receptionist system.

---

## 📊 Quick Reference

| Service | Development Key | Production Key | Free Tier |
|---------|----------------|----------------|-----------|
| **OpenAI** | Same key (monitor usage) | Same key (set limits) | ❌ No free tier |
| **Twilio** | Test credentials | Live credentials | ✅ Free trial |
| **ElevenLabs** | Free tier key | Paid plan key | ✅ 10k chars/month |
| **Deepgram** | Free credit key | Paid plan key | ✅ $200 credit |

---

## 🧪 DEVELOPMENT KEYS (For Local Testing)

### What are Development Keys?
- Used for **testing and debugging** on your local machine
- Often **free or limited** (no real charges)
- Can be **shared with team** (but not in git!)
- Used with **localhost** and local testing

### When to Use Dev Keys
✅ Building and testing features  
✅ Debugging issues  
✅ Learning the system  
✅ Demo purposes  
✅ Local development  

### Development Keys by Service

#### 🤖 OpenAI (Required)
```bash
# .env.development
OPENAI_API_KEY=sk-proj-your-key-here
OPENAI_MODEL=gpt-3.5-turbo  # Cheaper for dev
```
- **Get from:** https://platform.openai.com/api-keys
- **Note:** Same key format, but use cheaper model (GPT-3.5) in dev
- **Cost:** ~$0.001-0.002 per call (very cheap)
- **Tip:** Set usage limits in OpenAI dashboard!

#### 📞 Twilio (Optional - Phone Calls)
```bash
# .env.development
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_test_auth_token
TWILIO_PHONE_NUMBER=+15005550006  # Twilio test number
```
- **Get from:** https://console.twilio.com → "Test Credentials"
- **Note:** Use TEST credentials (not live) - no real calls, no charges
- **Cost:** FREE (test mode)
- **Test number:** +15005550006 (Twilio's magic test number)

#### 🎙️ ElevenLabs (Optional - Premium Voices)
```bash
# .env.development
ELEVENLABS_API_KEY=your_free_tier_key
```
- **Get from:** https://elevenlabs.io/ → Sign up (free)
- **Note:** Free tier gives 10,000 characters/month
- **Cost:** FREE (10k chars/month)
- **Tip:** Enough for ~100 test calls

#### 👂 Deepgram (Optional - Speech Recognition)
```bash
# .env.development
DEEPGRAM_API_KEY=your_free_credit_key
```
- **Get from:** https://console.deepgram.com/ → Sign up
- **Note:** $200 free credit when you sign up
- **Cost:** FREE ($200 credit)
- **Tip:** Enough for ~50,000 minutes of audio

---

## 🚀 PRODUCTION KEYS (For Live Use)

### What are Production Keys?
- Used for **live system** with real customers
- **Real charges apply** (pay-as-you-go)
- **Keep SECRET** - never share or commit to git
- Used with **real domain** and live server

### When to Use Prod Keys
✅ Live customer-facing system  
✅ Real phone calls  
✅ Production deployment  
✅ Commercial use  

### Production Keys by Service

#### 🤖 OpenAI (Required)
```bash
# .env.production
OPENAI_API_KEY=sk-proj-your-live-key
OPENAI_MODEL=gpt-4-turbo  # Best quality
```
- **Get from:** https://platform.openai.com/api-keys
- **Note:** Use GPT-4 for best quality
- **Cost:** ~$0.01-0.03 per call
- **IMPORTANT:** Set hard spending limits!

#### 📞 Twilio (For Real Phone Calls)
```bash
# .env.production
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_live_auth_token
TWILIO_PHONE_NUMBER=+1234567890  # Your real number
```
- **Get from:** https://console.twilio.com → "Live Credentials"
- **Note:** Real phone number, real calls, real charges
- **Cost:** ~$1/month for number + $0.01/minute
- **IMPORTANT:** Only use live credentials in production!

#### 🎙️ ElevenLabs (Premium Voices)
```bash
# .env.production
ELEVENLABS_API_KEY=your_paid_plan_key
```
- **Get from:** https://elevenlabs.io/app/subscription
- **Note:** Paid plan required for commercial use
- **Cost:** $5-99/month depending on usage
- **Tip:** Starter plan ($5/month) is enough for most businesses

#### 👂 Deepgram (Speech Recognition)
```bash
# .env.production
DEEPGRAM_API_KEY=your_paid_plan_key
```
- **Get from:** https://console.deepgram.com/
- **Note:** Pay-as-you-go for production
- **Cost:** $0.0043/minute of audio
- **Tip:** Very affordable for production use

---

## 📋 Complete .env Examples

### Development Environment (.env.development)
```bash
# App Settings
APP_ENV=development
APP_DEBUG=true
APP_HOST=localhost
APP_PORT=8000

# Database (SQLite for dev)
DATABASE_URL=sqlite:///./ai_receptionist_dev.db

# OpenAI (use cheaper model)
OPENAI_API_KEY=sk-proj-your-dev-key
OPENAI_MODEL=gpt-3.5-turbo
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_TOKENS=500

# Twilio TEST credentials (no real calls)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_test_auth_token
TWILIO_PHONE_NUMBER=+15005550006

# ElevenLabs (free tier)
ELEVENLABS_API_KEY=your_free_tier_key

# Deepgram (free credit)
DEEPGRAM_API_KEY=your_free_credit_key
```

### Production Environment (.env.production)
```bash
# App Settings
APP_ENV=production
APP_DEBUG=false
APP_HOST=0.0.0.0
APP_PORT=8000

# Database (PostgreSQL for production)
DATABASE_URL=postgresql://user:password@localhost:5432/ai_receptionist

# OpenAI (best quality model)
OPENAI_API_KEY=sk-proj-your-live-key
OPENAI_MODEL=gpt-4-turbo
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_TOKENS=500

# Twilio LIVE credentials (real calls)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_live_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# ElevenLabs (paid plan)
ELEVENLABS_API_KEY=your_paid_plan_key

# Deepgram (paid plan)
DEEPGRAM_API_KEY=your_paid_plan_key
```

---

## 🛡️ Best Practices

### ✅ DO
- ✅ Use **separate keys** for dev/staging/prod
- ✅ Set **spending limits** in provider dashboards
- ✅ Add `.env` to `.gitignore`
- ✅ Use **environment variables** (never hardcode)
- ✅ **Rotate keys** regularly (every 90 days)
- ✅ **Monitor usage** daily
- ✅ Use **cheaper models** in development
- ✅ **Test with test credentials** before going live

### ❌ DON'T
- ❌ Use production keys in development
- ❌ Commit `.env` files to Git
- ❌ Share keys in Slack/Email/Chat
- ❌ Hardcode keys in source files
- ❌ Forget to set spending limits
- ❌ Use test credentials in production
- ❌ Ignore usage alerts
- ❌ Share your live Twilio credentials

---

## 💰 Cost Comparison

### Development (Monthly)
| Service | Cost | Notes |
|---------|------|-------|
| OpenAI | $5-10 | Using GPT-3.5, light usage |
| Twilio | $0 | Test credentials |
| ElevenLabs | $0 | Free tier (10k chars) |
| Deepgram | $0 | Free credit |
| **Total** | **$5-10** | Very affordable |

### Production (Monthly)
| Service | Cost | Notes |
|---------|------|-------|
| OpenAI | $30-100 | Using GPT-4, moderate usage |
| Twilio | $15-50 | Real phone number + calls |
| ElevenLabs | $5-22 | Starter/Creator plan |
| Deepgram | $10-30 | Pay-as-you-go |
| **Total** | **$60-200** | Depends on call volume |

---

## 🔄 Migration: Dev → Production

### Step 1: Test in Development
```bash
# Use test credentials
TWILIO_PHONE_NUMBER=+15005550006  # Test number
OPENAI_MODEL=gpt-3.5-turbo        # Cheaper model
```

### Step 2: Switch to Production Keys
```bash
# Update .env with live credentials
TWILIO_PHONE_NUMBER=+1234567890   # Real number
OPENAI_MODEL=gpt-4-turbo          # Best quality
```

### Step 3: Set Spending Limits
- OpenAI: https://platform.openai.com/account/limits
- Twilio: https://console.twilio.com/us1/settings/billing
- ElevenLabs: https://elevenlabs.io/app/subscription
- Deepgram: https://console.deepgram.com/account/billing

### Step 4: Monitor Usage
Check dashboards daily for the first week:
- OpenAI: https://platform.openai.com/usage
- Twilio: https://console.twilio.com/us1/monitor/logs
- ElevenLabs: https://elevenlabs.io/app/usage
- Deepgram: https://console.deepgram.com/account/usage

---

## 🆘 Troubleshooting

### "Invalid API Key" Error
**Problem:** Key is wrong or expired  
**Solution:** 
1. Check key in provider dashboard
2. Regenerate key if needed
3. Update .env file
4. Restart server

### "Usage Limit Exceeded" Error
**Problem:** You've hit your spending limit  
**Solution:**
1. Go to provider dashboard
2. Increase limit or add payment method
3. Monitor usage to prevent future issues

### "Test Credentials Not Working in Production"
**Problem:** Using test keys in live environment  
**Solution:**
1. Get LIVE credentials from provider
2. Update .env with live keys
3. Restart server

### "Charges Are Too High"
**Problem:** Unexpected costs  
**Solution:**
1. Check usage in provider dashboard
2. Set hard spending limits
3. Switch to cheaper models (GPT-3.5 instead of GPT-4)
4. Review call logs for unusual patterns

---

## 📞 Support Links

| Service | Dashboard | Support | Docs |
|---------|-----------|---------|------|
| **OpenAI** | [platform.openai.com](https://platform.openai.com) | [help.openai.com](https://help.openai.com) | [platform.openai.com/docs](https://platform.openai.com/docs) |
| **Twilio** | [console.twilio.com](https://console.twilio.com) | [twilio.com/help](https://www.twilio.com/help) | [twilio.com/docs](https://www.twilio.com/docs) |
| **ElevenLabs** | [elevenlabs.io](https://elevenlabs.io) | [docs.elevenlabs.com](https://docs.elevenlabs.com) | [elevenlabs.io/docs](https://elevenlabs.io/docs) |
| **Deepgram** | [console.deepgram.com](https://console.deepgram.com) | [deepgram.com/support](https://deepgram.com/support) | [developers.deepgram.com](https://developers.deepgram.com) |

---

## 🎯 Quick Start Checklist

### For Development
- [ ] Get OpenAI API key (required)
- [ ] Get Twilio TEST credentials (optional)
- [ ] Get ElevenLabs free tier key (optional)
- [ ] Get Deepgram free credit key (optional)
- [ ] Create `.env.development` file
- [ ] Set spending limits in dashboards
- [ ] Test with `python test_setup.py`

### For Production
- [ ] Get OpenAI live API key (required)
- [ ] Get Twilio LIVE credentials (for phone calls)
- [ ] Get ElevenLabs paid plan key (for premium voices)
- [ ] Get Deepgram paid plan key (for STT)
- [ ] Create `.env.production` file
- [ ] Set HARD spending limits
- [ ] Set up usage monitoring/alerts
- [ ] Test thoroughly before going live
- [ ] Deploy to production server

---

## 💡 Pro Tips

1. **Start with OpenAI only** - You don't need all services to start
2. **Use GPT-3.5 in dev** - 10x cheaper than GPT-4
3. **Test with browser voices** - No ElevenLabs needed for testing
4. **Set alerts at 50% of budget** - Catch issues early
5. **Review logs weekly** - Spot unusual patterns
6. **Keep dev and prod separate** - Never mix them
7. **Use environment-specific databases** - Separate dev/prod data
8. **Document your keys** - Keep a secure record of which keys are where

---

## 📚 Related Documentation

- [QUICKSTART.md](./QUICKSTART.md) - Get started in 5 minutes
- [README.md](./README.md) - Full project documentation
- [API Keys Guide](./src/components/ApiKeysGuide.tsx) - Interactive UI guide

---

**Remember:** Development keys are for testing (cheap/free), Production keys are for live use (real charges). Always keep them separate! 🔐
