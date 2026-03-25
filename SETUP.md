# Jarvis WhatsApp Setup

## Step 1 — Create your .env file

Copy `.env.example` to `.env` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...        ← from your Agent Command Centre
TWILIO_ACCOUNT_SID=ACxxxx...        ← from twilio.com/console
TWILIO_AUTH_TOKEN=xxxx...           ← from twilio.com/console
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886   ← sandbox number (stays the same)
```

## Step 2 — Set up Twilio (free, takes 5 min)

1. Go to twilio.com → sign up free
2. In Console → Messaging → Try it out → Send a WhatsApp message
3. You'll see the sandbox number (+1 415 523 8886)
4. Follow the on-screen instructions to join the sandbox from YOUR phone
   (you WhatsApp the sandbox number with a code like "join silver-fox")

## Step 3 — Run the server

```
cd C:\Users\peter\jarvis_whatsapp
node server.js
```

## Step 4 — Expose it with ngrok (free)

In a second terminal:
```
ngrok http 3000
```

Copy the https URL it gives you, e.g. https://abc123.ngrok-free.app

## Step 5 — Set the webhook in Twilio

1. In Twilio Console → Messaging → Settings → WhatsApp Sandbox Settings
2. Set "When a message comes in" to:
   https://abc123.ngrok-free.app/whatsapp
3. Save

## You're live!

Open WhatsApp on your phone and message the Twilio sandbox number.

---

## How to use it

| Prefix | Agent |
|--------|-------|
| `1: <message>` or `j1: <message>` | Jarvis 1 — Research & Strategy |
| `2: <message>` or `j2: <message>` | Jarvis 2 — Documents & Creation |
| `3: <message>` or `j3: <message>` | Jarvis 3 — Comms & Automation |
| `pa: <message>` or `4: <message>` | Jarvis PA — Personal Assistant |
| No prefix | Uses your current active agent |

**Commands:**
- `help` — show this guide
- `status` — see which agent is active
- `clear` — reset the conversation

**Voice notes:** Just send a voice note — it transcribes automatically and passes to your active agent.

---

## Want a permanent URL? (no ngrok)

Deploy free to Railway: railway.app → New Project → Deploy from GitHub
Or Render: render.com → New Web Service
