require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ── AGENT DEFINITIONS ──────────────────────────────────────────────────────
const AGENTS = {
  1: {
    name: 'Jarvis 1',
    role: 'Research & Strategy',
    system: `You are Jarvis 1, the Research & Strategy specialist for Peter at Insight Property Wealth (IPW). IPW is a premium property wealth advisory firm. Your role is to provide sharp, direct, and highly actionable intelligence.

When researching competitors, always cover:
- Company overview and background
- Service offerings and key products
- Pricing structure and fee models
- Strengths and competitive advantages
- Weaknesses and vulnerabilities
- Strategic opportunities for IPW to exploit

Your tone is sharp, professional, and direct. No fluff. Lead with insights. Format clearly with headers and bullet points where appropriate. Always think like a strategic advisor, not just a researcher.

IMPORTANT: You are responding via WhatsApp. Keep responses concise and well-formatted for mobile. Use plain text, avoid markdown that won't render. Use short paragraphs and line breaks.`
  },
  2: {
    name: 'Jarvis 2',
    role: 'Documents & Creation',
    system: `You are Jarvis 2, the Documents & Creation specialist for Peter at Insight Property Wealth (IPW). IPW is a premium property wealth advisory firm.

Your role is to build professional, polished documents that reflect the IPW brand:
- Brand colours: Teal (#1C393D) and Gold (#F3CA4D)
- Primary font: Montserrat (headings), Oxygen (body)
- Tone: Premium, authoritative, client-focused

You produce proposals, pitch decks, reports, briefs, marketing copy, SOPs, templates, and presentation scripts. When producing documents, use clear structure. Always reflect the premium nature of the IPW brand. Ask for any missing information needed to make the document excellent.

IMPORTANT: You are responding via WhatsApp. Keep responses concise and well-formatted for mobile. Use plain text. For long documents, offer to email them or produce them in stages.`
  },
  3: {
    name: 'Jarvis 3',
    role: 'Comms & Automation',
    system: `You are Jarvis 3, the Comms & Automation specialist for Peter at Insight Property Wealth (IPW). IPW is a premium property wealth advisory firm.

Your role is to handle all communications and automation workflows:
- Professional email drafting for any client or prospect scenario
- CRM nurture sequences and lead follow-up cadences
- Meeting request and scheduling scripts
- Automation workflow planning (Zapier, Make, etc.)
- SMS and short-form outreach copy

Your tone is professional, warm, and efficient. Communications should feel personal and high-quality, not templated or generic. Always make IPW look premium in every touchpoint. When drafting sequences, number each step clearly and include timing guidance.

IMPORTANT: You are responding via WhatsApp. Keep responses concise and well-formatted for mobile. Use plain text.`
  },
  4: {
    name: 'Jarvis PA',
    role: 'Personal Assistant',
    system: `You are Jarvis PA, Peter's personal assistant at Insight Property Wealth (IPW). IPW is a premium property investment advisory firm with 30+ years experience, 20+ staff, and 1,250+ clients across Australia.

Your job is to help Peter manage his day-to-day — emails, files, scheduling, follow-ups, and anything that keeps his working day running smoothly.

EMAIL MANAGEMENT:
- When Peter asks you to read or check his emails, summarise clearly: who emailed, what they need, and what action is required
- When drafting replies, match IPW's tone: professional, warm, and authoritative
- Always ask Peter to review before sending
- Flag anything urgent or time-sensitive

GOOGLE DRIVE:
- When Peter asks you to save something, confirm: what to name it, which folder it should go in, and what format
- Help Peter stay organised with clear folder structures for client files, reports, proposals, and templates

DAY-TO-DAY:
- Help Peter plan his day and prioritise tasks
- Track open follow-ups and remind him what needs attention
- Draft meeting agendas, action item lists, and status updates
- Keep everything concise — Peter is busy and values clarity over long responses

Always be proactive: if you see something that needs attention, flag it. You are Peter's right hand.

IMPORTANT: You are responding via WhatsApp. Be concise and mobile-friendly. Use plain text.`
  }
};

// ── SESSION STORE (in-memory, persists while server runs) ──────────────────
// sessions[phoneNumber] = { agentId: 1-4, history: [{role, content}] }
const sessions = {};

function getSession(from) {
  if (!sessions[from]) {
    sessions[from] = { agentId: 4, history: [] }; // default to Jarvis PA
  }
  return sessions[from];
}

// ── ROUTING: detect agent switch from message prefix ──────────────────────
// "1 <msg>" or "j1 <msg>" → Jarvis 1, etc.
// "switch 1" / "use jarvis 1" → switch agent, no message
function parseMessage(text) {
  const t = text.trim();
  const lower = t.toLowerCase();

  const patterns = [
    { regex: /^(?:j1|1)[:\s]+(.+)/si, agentId: 1 },
    { regex: /^(?:j2|2)[:\s]+(.+)/si, agentId: 2 },
    { regex: /^(?:j3|3)[:\s]+(.+)/si, agentId: 3 },
    { regex: /^(?:jpa|pa|4)[:\s]+(.+)/si, agentId: 4 },
  ];

  for (const p of patterns) {
    const m = t.match(p.regex);
    if (m) return { agentId: p.agentId, message: m[1].trim(), switchOnly: false };
  }

  // Switch-only commands (no message body)
  if (/^(?:use\s+)?jarvis\s+1|^switch\s+(?:to\s+)?(?:j1|1)$/i.test(lower)) return { agentId: 1, message: null, switchOnly: true };
  if (/^(?:use\s+)?jarvis\s+2|^switch\s+(?:to\s+)?(?:j2|2)$/i.test(lower)) return { agentId: 2, message: null, switchOnly: true };
  if (/^(?:use\s+)?jarvis\s+3|^switch\s+(?:to\s+)?(?:j3|3)$/i.test(lower)) return { agentId: 3, message: null, switchOnly: true };
  if (/^(?:use\s+)?jarvis\s+(?:pa|4)|^switch\s+(?:to\s+)?(?:pa|4)$/i.test(lower)) return { agentId: 4, message: null, switchOnly: true };

  return { agentId: null, message: t, switchOnly: false };
}

// ── TRANSCRIBE VOICE via OpenAI Whisper ───────────────────────────────────
async function transcribeAudio(mediaUrl) {
  try {
    // Download audio from Twilio (requires auth)
    const audioResp = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      }
    });

    if (process.env.OPENAI_API_KEY) {
      // Use Whisper for best quality
      const form = new FormData();
      form.append('file', Buffer.from(audioResp.data), { filename: 'audio.ogg', contentType: 'audio/ogg' });
      form.append('model', 'whisper-1');

      const whisperResp = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        }
      });
      return whisperResp.data.text;
    } else {
      return null; // No transcription available
    }
  } catch (err) {
    console.error('Transcription error:', err.message);
    return null;
  }
}

// ── ASK CLAUDE ─────────────────────────────────────────────────────────────
async function askClaude(agentId, history, userMessage) {
  const agent = AGENTS[agentId];

  // Keep last 20 messages to avoid token overflow
  const trimmedHistory = history.slice(-20);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: agent.system,
    messages: [
      ...trimmedHistory,
      { role: 'user', content: userMessage }
    ]
  });

  return response.content[0].text;
}

// ── SEND WHATSAPP MESSAGE ──────────────────────────────────────────────────
async function sendWhatsApp(to, body) {
  // Split long messages (WhatsApp limit ~4096 chars, but keep it readable)
  const MAX = 1500;
  if (body.length <= MAX) {
    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to,
      body
    });
  } else {
    // Split at paragraph boundaries
    const chunks = [];
    let current = '';
    for (const para of body.split('\n\n')) {
      if ((current + '\n\n' + para).length > MAX && current) {
        chunks.push(current.trim());
        current = para;
      } else {
        current = current ? current + '\n\n' + para : para;
      }
    }
    if (current) chunks.push(current.trim());

    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n` : '';
      await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to,
        body: prefix + chunks[i]
      });
      // Small delay between messages
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
    }
  }
}

// ── HELP MESSAGE ──────────────────────────────────────────────────────────
const HELP = `*IPW Jarvis Agents* 🤖

You have 4 agents available:

*1* or *j1:* Jarvis 1 — Research & Strategy
*2* or *j2:* Jarvis 2 — Documents & Creation
*3* or *j3:* Jarvis 3 — Comms & Automation
*pa* or *4:* Jarvis PA — Personal Assistant (default)

To use a specific agent, prefix your message:
  _1: analyse competitor XYZ_
  _j3: draft a follow-up email for John_
  _pa: what's on my plate today_

Or just message — you'll stay with your current agent until you switch.

Type *status* to see which agent is active.
Type *clear* to reset the conversation.`;

// ── WEBHOOK HANDLER ────────────────────────────────────────────────────────
app.post('/whatsapp', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately

  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const numMedia = parseInt(req.body.NumMedia || '0', 10);
  const mediaContentType = req.body.MediaContentType0 || '';
  const mediaUrl = req.body.MediaUrl0 || '';
  const twilioTranscription = req.body.TranscriptionText || '';

  if (!from) return;

  const session = getSession(from);
  const agent = AGENTS[session.agentId];

  try {
    // ── COMMANDS ──
    const lowerBody = body.toLowerCase();

    if (lowerBody === 'help' || lowerBody === 'hi' || lowerBody === 'hello') {
      await sendWhatsApp(from, HELP);
      return;
    }

    if (lowerBody === 'status') {
      await sendWhatsApp(from, `Active agent: *${agent.name}* — ${agent.role}\nConversation: ${session.history.length / 2} message(s)`);
      return;
    }

    if (lowerBody === 'clear') {
      session.history = [];
      await sendWhatsApp(from, `Conversation cleared. Still on *${agent.name}*.`);
      return;
    }

    // ── VOICE / AUDIO MESSAGE ──
    if (numMedia > 0 && mediaContentType.startsWith('audio/')) {
      let transcribed = twilioTranscription;

      if (!transcribed) {
        await sendWhatsApp(from, `🎤 Transcribing your voice note...`);
        transcribed = await transcribeAudio(mediaUrl);
      }

      if (!transcribed) {
        await sendWhatsApp(from, `Sorry, I couldn't transcribe that voice note. Please type your message instead.`);
        return;
      }

      const userMessage = `[Voice note transcription]: ${transcribed}`;
      await sendWhatsApp(from, `📝 Heard: "${transcribed}"\n\n⏳ Thinking...`);

      const reply = await askClaude(session.agentId, session.history, transcribed);
      session.history.push({ role: 'user', content: transcribed });
      session.history.push({ role: 'assistant', content: reply });

      await sendWhatsApp(from, `*${agent.name}:*\n${reply}`);
      return;
    }

    // ── TEXT MESSAGE ──
    if (!body) return;

    const parsed = parseMessage(body);

    // Switching agent
    if (parsed.agentId && parsed.agentId !== session.agentId) {
      session.agentId = parsed.agentId;
      session.history = []; // fresh history per agent
      const newAgent = AGENTS[session.agentId];

      if (parsed.switchOnly || !parsed.message) {
        await sendWhatsApp(from, `Switched to *${newAgent.name}* — ${newAgent.role} ✅`);
        return;
      }
    }

    const messageToSend = parsed.message || body;

    // Get reply from Claude
    const reply = await askClaude(session.agentId, session.history, messageToSend);

    // Save to history
    session.history.push({ role: 'user', content: messageToSend });
    session.history.push({ role: 'assistant', content: reply });

    const currentAgent = AGENTS[session.agentId];
    await sendWhatsApp(from, `*${currentAgent.name}:*\n${reply}`);

  } catch (err) {
    console.error('Error:', err.message);
    await sendWhatsApp(from, `Something went wrong. Please try again.`).catch(() => {});
  }
});

// Health check
app.get('/', (req, res) => res.send('Jarvis WhatsApp server is running.'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🤖 Jarvis WhatsApp server running on port ${PORT}`);
  console.log(`   Webhook URL: http://localhost:${PORT}/whatsapp`);
  console.log(`   (Use ngrok to expose this publicly)\n`);
});
