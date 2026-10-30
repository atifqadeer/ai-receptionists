# Telephony Providers Guide

This guide explains all the telephony providers available in the AI Receptionist system.

## Overview

The system supports **12 telephony providers**, giving you flexibility to choose based on your needs, budget, and geographic coverage.

---

## Cloud Providers (Managed Services)

### 1. **Twilio** ⭐ Most Popular
- **Best for**: General purpose, global coverage, excellent documentation
- **Pricing**: $0.0085/min (US), varies by country
- **Features**:
  - 180+ countries coverage
  - Voice, SMS, Video APIs
  - Excellent documentation and SDKs
  - Pay-as-you-go pricing
  - Strong community support
- **Credentials needed**:
  - Account SID
  - Auth Token
- **Setup**: [Twilio Console](https://console.twilio.com)

---

### 2. **Telnyx** 💰 Cost-Effective
- **Best for**: High-volume calls, cost savings (50% cheaper than Twilio)
- **Pricing**: $0.004/min (US)
- **Features**:
  - Direct carrier connections (lower latency)
  - Mission Control portal
  - Competitive pricing
  - Good for US/Canada focus
- **Credentials needed**:
  - API Key
  - Connection ID (for voice)
  - Messaging Profile ID (optional, for SMS)
- **Setup**: [Telnyx Mission Control](https://portal.telnyx.com)

---

### 3. **Vonage** (formerly Nexmo) 🏢 Enterprise
- **Best for**: Enterprise features, business messaging
- **Pricing**: $0.01/min
- **Features**:
  - Enterprise-grade reliability
  - Number Insights API
  - Verify API for 2FA
  - Strong business focus
- **Credentials needed**:
  - API Key
  - API Secret
  - Application ID
  - Private Key (RSA)
- **Setup**: [Vonage Dashboard](https://dashboard.nexmo.com)

---

### 4. **Plivo** 🚀 Developer-Friendly
- **Best for**: Startups, mid-size businesses
- **Pricing**: $0.007/min
- **Features**:
  - Simple, clean API
  - Powerpack for SMS
  - PHLO visual workflow builder
  - Good documentation
- **Credentials needed**:
  - Auth ID
  - Auth Token
- **Setup**: [Plivo Console](https://console.plivo.com)

---

### 5. **Bandwidth** 📡 Direct Carrier
- **Best for**: High-volume US/Canada, lowest latency
- **Pricing**: $0.004/min
- **Features**:
  - Own network infrastructure
  - Lowest latency
  - Enterprise SLA
  - Direct carrier (no middleman)
- **Credentials needed**:
  - Account ID
  - API Token
  - API Secret
- **Setup**: [Bandwidth Developer Portal](https://dev.bandwidth.com)

---

### 6. **SignalWire** 📶 FreeSWITCH-Based
- **Best for**: FreeSWITCH compatibility, low latency
- **Pricing**: $0.005/min
- **Features**:
  - Built by FreeSWITCH creators
  - Compatible with existing FreeSWITCH setups
  - Modern API layer
  - Competitive pricing
- **Credentials needed**:
  - Project ID
  - API Token
  - Space URL
- **Setup**: [SignalWire Dashboard](https://mysignalwire.com)

---

### 7. **Amazon Connect** ☁️ AWS Service
- **Best for**: AWS ecosystem integration, contact centers
- **Pricing**: $0.008/min + $0.004/min for phone numbers
- **Features**:
  - Full AWS integration
  - Visual contact flows
  - Pay per use (no minimum)
  - Omnichannel support
  - Lambda function integration
- **Credentials needed**:
  - AWS Access Key ID
  - AWS Secret Access Key
  - AWS Region
  - Connect Instance ID
  - Contact Flow ID (optional)
- **Setup**: [AWS Console](https://console.aws.amazon.com/connect)

---

### 8. **MessageBird** 💬 Multi-Channel
- **Best for**: Multi-channel communications (voice + messaging)
- **Pricing**: $0.009/min
- **Features**:
  - Multi-channel platform
  - Flow builder
  - Global reach
  - Strong messaging features
- **Credentials needed**:
  - Access Key
  - Signing Key (optional, for webhook verification)
- **Setup**: [MessageBird Dashboard](https://dashboard.messagebird.com)

---

### 9. **Sinch** 🌍 Global CPaaS
- **Best for**: European presence, global coverage
- **Pricing**: $0.008/min
- **Features**:
  - Global coverage
  - Enterprise grade
  - Strong in EU markets
  - Comprehensive CPaaS
- **Credentials needed**:
  - Key ID
  - Key Secret
  - Service Plan ID
- **Setup**: [Sinch Dashboard](https://dashboard.sinch.com)

---

### 10. **DialogFlow CX** 🤖 Google Cloud
- **Best for**: Advanced NLU + telephony, Google Cloud users
- **Pricing**: $0.01/min + NLU costs
- **Features**:
  - Google Cloud integration
  - Advanced Natural Language Understanding
  - Visual conversation builder
  - Combines AI with telephony
- **Credentials needed**:
  - Project ID
  - Service Account JSON
- **Setup**: [DialogFlow Console](https://dialogflow.cloud.google.com)

---

## Self-Hosted Solutions

### 11. **Asterisk** 🔧 Open Source PBX
- **Best for**: Full control, no per-minute fees, technical teams
- **Pricing**: Free (open source) + infrastructure costs
- **Features**:
  - Open source
  - Complete control
  - No per-minute fees
  - Highly customizable
- **Credentials needed**:
  - SIP Server
  - SIP Port (default: 5060)
  - SIP Username
  - SIP Password
  - Transport Protocol (UDP/TCP/TLS/WS/WSS)
- **Requirements**:
  - Linux server
  - Technical expertise
  - SIP trunk from carrier
- **Setup**: [Asterisk Documentation](https://www.asterisk.org/get-started/)

---

### 12. **FreeSWITCH** 🌐 Enterprise Open Source
- **Best for**: Scalable, enterprise-grade, highly flexible
- **Pricing**: Free (open source) + infrastructure costs
- **Features**:
  - Open source
  - Highly scalable
  - Enterprise proven
  - Advanced routing
- **Credentials needed**:
  - SIP Server
  - SIP Port (default: 5060)
  - SIP Username
  - SIP Password
  - Transport Protocol (UDP/TCP/TLS/WS/WSS)
- **Requirements**:
  - Linux server
  - Technical expertise
  - SIP trunk from carrier
- **Setup**: [FreeSWITCH Documentation](https://freeswitch.org/confluence/display/FREESWITCH/Getting+Started)

---

## Comparison Table

| Provider | Cost/min | Coverage | Latency | Ease of Use | Best For |
|----------|----------|----------|---------|-------------|----------|
| **Twilio** | $0.0085 | 180+ countries | Medium | ⭐⭐⭐⭐⭐ | General purpose |
| **Telnyx** | $0.004 | 100+ countries | Low | ⭐⭐⭐⭐ | Cost savings |
| **Vonage** | $0.01 | 180+ countries | Medium | ⭐⭐⭐⭐ | Enterprise |
| **Plivo** | $0.007 | 150+ countries | Medium | ⭐⭐⭐⭐⭐ | Startups |
| **Bandwidth** | $0.004 | US/Canada | Lowest | ⭐⭐⭐ | High volume US |
| **SignalWire** | $0.005 | 100+ countries | Low | ⭐⭐⭐⭐ | FreeSWITCH users |
| **Amazon Connect** | $0.008 | Global | Medium | ⭐⭐⭐⭐ | AWS ecosystem |
| **MessageBird** | $0.009 | 180+ countries | Medium | ⭐⭐⭐⭐ | Multi-channel |
| **Sinch** | $0.008 | Global | Medium | ⭐⭐⭐ | European focus |
| **DialogFlow CX** | $0.01+ | Global | Medium | ⭐⭐⭐ | Advanced NLU |
| **Asterisk** | Free* | Depends | Lowest | ⭐⭐ | Full control |
| **FreeSWITCH** | Free* | Depends | Lowest | ⭐⭐ | Enterprise scale |

*Self-hosted solutions have infrastructure costs but no per-minute fees

---

## How to Choose

### Choose **Twilio** if:
- You want the most popular, well-documented solution
- You need global coverage
- You're okay with standard pricing
- You want excellent community support

### Choose **Telnyx** if:
- Cost is a major factor
- You're making high-volume calls
- You want lower latency
- You're focused on US/Canada

### Choose **Bandwidth** if:
- You need the absolute lowest latency
- You're making very high volume US/Canada calls
- You want direct carrier connection
- You need enterprise SLA

### Choose **Amazon Connect** if:
- You're already using AWS
- You need advanced contact center features
- You want visual contact flows
- You need Lambda integration

### Choose **Asterisk/FreeSWITCH** if:
- You want complete control
- You have technical expertise
- You want to avoid per-minute fees
- You have existing PBX infrastructure

---

## Setup Instructions

### For Cloud Providers:

1. **Create an account** with your chosen provider
2. **Get credentials** from their dashboard/console
3. **In AI Receptionist**:
   - Go to Settings → Telephony
   - Select your provider from the grid
   - Enter the required credentials
   - Set your phone number
   - Configure webhook URL
   - Click "Save Configuration"
   - Click "Test Connection" to verify

### For Self-Hosted:

1. **Set up your PBX** (Asterisk/FreeSWITCH) on a Linux server
2. **Configure SIP settings** (server, port, credentials)
3. **Get a SIP trunk** from a carrier
4. **In AI Receptionist**:
   - Go to Settings → Telephony
   - Select Asterisk or FreeSWITCH
   - Enter SIP server details
   - Configure transport protocol
   - Set webhook URL
   - Click "Save Configuration"

---

## Webhook Configuration

All providers send call events to your webhook URL. The webhook receives:

```json
{
  "event": "call.started|call.ended|call.transferred",
  "call_id": "unique-call-id",
  "from": "+1234567890",
  "to": "+0987654321",
  "timestamp": "2024-01-15T10:30:00Z",
  "duration": 120,
  "status": "completed"
}
```

**Requirements**:
- Must be publicly accessible (HTTPS recommended)
- Must respond with 200 OK within 5 seconds
- Should handle retries (providers retry failed webhooks)

---

## Testing Your Setup

After configuring your provider:

1. **Test Connection**: Click the "Test Connection" button
2. **Make a Test Call**: Call your configured phone number
3. **Check Logs**: View call logs in the Analytics section
4. **Verify Webhooks**: Check that call events are received

---

## Troubleshooting

### "Invalid credentials"
- Double-check your API keys/tokens
- Ensure you're using the correct environment (test vs live)
- Regenerate credentials if needed

### "Webhook not receiving events"
- Verify webhook URL is publicly accessible
- Check firewall settings
- Ensure HTTPS is configured correctly
- Check provider dashboard for webhook status

### "Call not connecting"
- Verify phone number format (E.164: +1234567890)
- Check that phone number is assigned to your account
- Verify SIP settings for self-hosted solutions
- Check provider status page for outages

### "High latency"
- Consider switching to a direct carrier (Bandwidth, Telnyx)
- Check your server location relative to provider
- For self-hosted, optimize network configuration

---

## Cost Optimization Tips

1. **Use Telnyx or Bandwidth** for high-volume US/Canada calls (50% savings)
2. **Negotiate enterprise pricing** if making >10,000 minutes/month
3. **Use self-hosted** for very high volume to eliminate per-minute fees
4. **Monitor usage** in provider dashboard to catch unexpected costs
5. **Set up alerts** for unusual usage patterns

---

## Support Links

| Provider | Documentation | Support | Status Page |
|----------|---------------|---------|-------------|
| Twilio | [docs.twilio.com](https://www.twilio.com/docs) | [support.twilio.com](https://support.twilio.com) | [status.twilio.com](https://status.twilio.com) |
| Telnyx | [developers.telnyx.com](https://developers.telnyx.com) | [support.telnyx.com](https://support.telnyx.com) | [status.telnyx.com](https://status.telnyx.com) |
| Vonage | [developer.vonage.com](https://developer.vonage.com) | [help.nexmo.com](https://help.nexmo.com) | [status.vonage.com](https://status.vonage.com) |
| Plivo | [plivo.com/docs](https://www.plivo.com/docs/) | [support.plivo.com](https://support.plivo.com) | [status.plivo.com](https://status.plivo.com) |
| Bandwidth | [dev.bandwidth.com](https://dev.bandwidth.com) | [support.bandwidth.com](https://support.bandwidth.com) | [status.bandwidth.com](https://status.bandwidth.com) |
| SignalWire | [docs.signalwire.com](https://docs.signalwire.com) | [support.signalwire.com](https://support.signalwire.com) | [status.signalwire.com](https://status.signalwire.com) |
| Amazon Connect | [docs.aws.amazon.com/connect](https://docs.aws.amazon.com/connect/) | [AWS Support](https://aws.amazon.com/premiumsupport/) | [health.aws.amazon.com](https://health.aws.amazon.com) |
| MessageBird | [developers.messagebird.com](https://developers.messagebird.com) | [support.messagebird.com](https://support.messagebird.com) | [status.messagebird.com](https://status.messagebird.com) |
| Sinch | [developers.sinch.com](https://developers.sinch.com) | [support.sinch.com](https://support.sinch.com) | [status.sinch.com](https://status.sinch.com) |
| DialogFlow | [cloud.google.com/dialogflow](https://cloud.google.com/dialogflow/docs) | [Google Cloud Support](https://cloud.google.com/support) | [status.cloud.google.com](https://status.cloud.google.com) |
| Asterisk | [asterisk.org](https://www.asterisk.org/documentation/) | [Community Forums](https://community.asterisk.org) | N/A |
| FreeSWITCH | [freeswitch.org](https://freeswitch.org/confluence/) | [Community Support](https://signalwire.com/community) | N/A |

---

## Next Steps

1. **Choose your provider** based on your needs
2. **Create an account** and get credentials
3. **Configure in Settings** → Telephony
4. **Test with a call** to verify everything works
5. **Monitor usage** and optimize costs

For more help, check the [main documentation](./README.md) or contact support.
