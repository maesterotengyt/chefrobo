import { useState, useEffect, useRef, useCallback } from "react";

// ─── Brand ────────────────────────────────────────────────────────────────────
const DARK = {
  bg:"#0E0F0D", bgAlt:"#141510", surface:"#1A1C17", surfaceAlt:"#202318",
  border:"#2C2F24", borderLt:"#363A2A",
  accent:"#C8F04A", accentDim:"rgba(200,240,74,0.12)", accentGlow:"rgba(200,240,74,0.07)",
  amber:"#F5A623", amberGlow:"rgba(245,166,35,0.10)",
  red:"#E8544A",   redGlow:"rgba(232,84,74,0.10)",
  blue:"#5B8DEF",  blueGlow:"rgba(91,141,239,0.10)",
  txt:"#F2F0E8", txtSub:"#9A9880", txtMuted:"#4A4A38", shadow:"rgba(0,0,0,0.6)",
};
const LIGHT = {
  bg:"#F5F4EE", bgAlt:"#ECEAE0", surface:"#FFFFFF", surfaceAlt:"#F0EFE7",
  border:"#D8D6C8", borderLt:"#C8C6B4",
  accent:"#5C8200", accentDim:"rgba(92,130,0,0.10)", accentGlow:"rgba(92,130,0,0.05)",
  amber:"#B57B00", amberGlow:"rgba(181,123,0,0.08)",
  red:"#C0392B",   redGlow:"rgba(192,57,43,0.08)",
  blue:"#2B5FBF",  blueGlow:"rgba(43,95,191,0.08)",
  txt:"#1A1C12", txtSub:"#5A5840", txtMuted:"#9A9880", shadow:"rgba(0,0,0,0.12)",
};
const FS = "'Inter','Helvetica Neue',system-ui,sans-serif";
const FM = "'JetBrains Mono','Courier New',monospace";

// ─── High-priority demo scenarios ─────────────────────────────────────────────
const HIGH_SCENARIOS = [
  {
    id: "hs1",
    label: "Safety Hazard",
    customerMsg: "The robot arm is moving erratically and almost hit one of our workers. We've stopped the line.",
    brief: {
      issue: "Erratic arm movement — potential safety incident, line stopped",
      urgency: "IMMEDIATE",
      lookAt: [
        "Check servo controller for fault codes on arm joints 2 & 3",
        "Review last motion log for encoder signal loss",
        "Verify E-stop was triggered and arm is fully powered down before approaching",
      ],
      note: "Do NOT restart until a physical inspection is complete. Safety incident protocol may apply.",
    },
  },
  {
    id: "hs2",
    label: "Full Line Down",
    customerMsg: "Everything stopped. The whole production line is down and we have a big order due today.",
    brief: {
      issue: "Full production line stoppage — high business impact",
      urgency: "IMMEDIATE",
      lookAt: [
        "Check ChefOS system status for fleet-wide fault codes",
        "Verify network/connectivity between robot and control system",
        "Inspect conveyor integration — likely sync fault between belt and robot cycle",
      ],
      note: "Customer has time-sensitive order. Prioritize rapid diagnosis over full root cause.",
    },
  },
];

// ─── API ──────────────────────────────────────────────────────────────────────
async function callClaude(messages, system) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:1000, system, messages }),
  });
  const d = await r.json();
  return d.content?.find(b => b.type === "text")?.text ?? "…";
}

let _n = 1000;
const newTicket = () => `TKT-${++_n}`;

function statusMeta(s, T) {
  if (s === "diagnosing") return { label:T("DIAGNOSING","DIAGNÓSTICO"),    color:"blue"  };
  if (s === "proposed")   return { label:T("ACTION READY","ACCIÓN LISTA"), color:"amber" };
  if (s === "escalated")  return { label:T("ESCALATED","ESCALADO"),         color:"red"   };
  if (s === "critical")   return { label:T("CRITICAL","CRÍTICO"),           color:"red"   };
  if (s === "resolved")   return { label:T("RESOLVED","RESUELTO"),          color:"accent"};
  return                         { label:T("CLOSED","CERRADO"),             color:"txtMuted"};
}

// ═════════════════════════════════════════════════════════════════════════════
// ROOT
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [dark, setDark]                 = useState(true);
  const [lang, setLang]                 = useState("en");
  const [msgs, setMsgs]                 = useState([]);
  const [opEvents, setOpEvents]         = useState([]);
  const [status, setStatus]             = useState(null);
  const [ticketId]                      = useState(newTicket);
  const [fix, setFix]                   = useState(null);
  const [history, setHistory]           = useState([]);
  const [thinking, setThinking]         = useState(false);
  const [started, setStarted]           = useState(false);
  const [qCount, setQCount]             = useState(0);
  // Live ticket brief — updates as conversation builds
  const [ticketBrief, setTicketBrief]   = useState(null);

  const C   = dark ? DARK : LIGHT;
  const isEs = lang === "es";
  const T   = (en, es) => isEs ? es : en;
  const ts  = () => new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });

  const pushOp  = useCallback(ev => setOpEvents(p => [ev, ...p]), []);
  const addMsg  = useCallback((role, text) => setMsgs(p => [...p, { role, text, ts: ts() }]), []);

  // ── Generate / update operator brief using AI ──────────────────────────────
  const updateBrief = useCallback(async (convHistory) => {
    const briefPrompt = `You are an AI assistant for Chef Robotics operations engineers.
Based on the conversation so far, produce a concise JSON operator brief. Respond with ONLY valid JSON, no other text.
{
  "summary": "1-2 sentence plain-English summary of what the customer is experiencing",
  "likelyIssue": "your best hypothesis on what the root cause is (1 sentence)",
  "startingPoints": ["first thing engineer should check", "second thing", "third thing"],
  "customerContext": "any useful context about the customer's situation (shift, urgency, knowledge level)"
}`;
    try {
      const raw = await callClaude(
        [{ role:"user", content: `Conversation so far:\n${convHistory.map(m => `${m.role}: ${m.content}`).join("\n")}\n\nGenerate operator brief.` }],
        briefPrompt
      );
      const clean = raw.replace(/```json|```/g, "").trim();
      const data  = JSON.parse(clean);
      setTicketBrief(data);
    } catch { /* silently fail — brief not critical */ }
  }, []);

  // ── Customer sends a message ───────────────────────────────────────────────
  const handleSend = useCallback(async (text) => {
    if (thinking) return;
    addMsg("user", text);
    setThinking(true);

    const newHist = [...history, { role:"user", content:text }];

    if (!started) {
      setStarted(true);
      setStatus("diagnosing");
      pushOp({ type:"new_ticket", id:ticketId, summary:text, ts:ts() });
      // Generate initial brief immediately
      updateBrief(newHist);
    }

    const sysPrompt = `You are ChefOS Support, the AI triage assistant for Chef Robotics — deploying food portioning robots in commercial kitchens and food manufacturing facilities.

The customer is a kitchen or production floor worker. They are NOT a technician. They just want the robot running. Be warm, calm, and efficient.

LANGUAGE: Respond in ${isEs ? "Spanish" : "English"}.

STRICT LIMIT: Ask AT MOST 5 questions total. Each question must extract maximum diagnostic value. Diagnose as soon as you're confident — don't wait for all 5.

APPROACH:
- First message: warmly acknowledge, then ask the single most useful clarifying question based on exactly what they said.
- Each follow-up: build on their previous answer specifically.
- If they say they don't know → move on, never press.
- Reassure briefly between questions so they feel progress ("Got it, that helps.").
- Never make them feel interrogated. They just want it fixed.

WHEN READY TO DIAGNOSE output only:
DIAGNOSIS_READY
\`\`\`json
{"issue":"root problem one-liner","confidence":"high|medium|low","suggestedFix":"plain-language fix","fixPreview":"1. Step\\n2. Step\\n3. Step","priority":"low|mid|high"}
\`\`\`

WHEN ESCALATING (5 questions hit, unclear, or serious issue) output only:
ESCALATE
\`\`\`json
{"reason":"why escalating","summary":"what customer told you"}
\`\`\`

Never mention JSON, escalation, or internal processes to the customer.`;

    const reply = await callClaude(newHist, sysPrompt);

    if (reply.includes("DIAGNOSIS_READY")) {
      try {
        const data = JSON.parse(reply.match(/```json\s*([\s\S]*?)```/)?.[1]);
        addMsg("assistant", T(
          "Thanks — I've identified the issue and have a recommended fix ready. Our operations engineer is reviewing it now and will follow up shortly.",
          "Gracias. He identificado el problema y tengo una solución lista. Nuestro ingeniero la está revisando ahora."
        ));
        setFix(data);
        setStatus("proposed");
        pushOp({ type:"proposed_fix", id:ticketId, ts:ts(), ...data });
        // Final brief update
        updateBrief([...newHist, { role:"assistant", content:"[Diagnosis ready]" }]);
      } catch {
        addMsg("assistant", T("Let me get our engineer to take a closer look.", "Voy a pedir a nuestro ingeniero que lo revise."));
        setStatus("escalated");
        pushOp({ type:"escalated", id:ticketId, reason:"Parse error", ts:ts() });
      }
    } else if (reply.includes("ESCALATE")) {
      try {
        const data = JSON.parse(reply.match(/```json\s*([\s\S]*?)```/)?.[1]);
        addMsg("assistant", T(
          "Thanks for walking me through this. I'm flagging our operations engineer now — they'll be with you shortly.",
          "Gracias. Estoy notificando a nuestro ingeniero de operaciones ahora mismo."
        ));
        setStatus("escalated");
        pushOp({ type:"escalated", id:ticketId, reason:data.reason, summary:data.summary, ts:ts() });
        updateBrief([...newHist, { role:"assistant", content:"[Escalated]" }]);
      } catch {
        addMsg("assistant", T("I'm escalating this to our team now.", "Estoy escalando esto a nuestro equipo."));
        setStatus("escalated");
        pushOp({ type:"escalated", id:ticketId, reason:"Unclear issue", ts:ts() });
      }
    } else {
      addMsg("assistant", reply);
      const updatedHist = [...newHist, { role:"assistant", content:reply }];
      setHistory(updatedHist);
      setQCount(q => q + 1);
      // Update brief after each exchange
      if (newHist.length >= 2) updateBrief(updatedHist);
    }
    setThinking(false);
  }, [thinking, history, started, ticketId, isEs, addMsg, pushOp, T, updateBrief]);

  // ── High-priority scenario trigger ────────────────────────────────────────
  const triggerHighPriority = useCallback((scenario) => {
    if (started) return;
    setStarted(true);
    setStatus("critical");
    addMsg("user", scenario.customerMsg);
    addMsg("assistant", T(
      "I understand this is urgent — I'm flagging our operations engineer immediately as a high-priority alert. Please ensure the area around the robot is clear and safe. Someone will be with you right away.",
      "Entiendo que es urgente. Estoy notificando a nuestro ingeniero de operaciones como alerta de alta prioridad. Por favor asegúrese de que el área alrededor del robot esté despejada. Alguien estará con usted de inmediato."
    ));
    setTicketBrief({
      summary: scenario.brief.issue,
      likelyIssue: scenario.brief.note,
      startingPoints: scenario.brief.lookAt,
      customerContext: `Urgency: ${scenario.brief.urgency}`,
    });
    pushOp({ type:"critical", id:ticketId, scenario, ts:ts() });
  }, [started, addMsg, pushOp, ticketId, T]);

  const handleApprove = useCallback(() => {
    setStatus("resolved");
    addMsg("assistant", T(
      `Good news — our engineer approved the fix. Here's what's being applied:\n\n${fix?.fixPreview}`,
      `Buenas noticias — nuestro ingeniero aprobó la solución:\n\n${fix?.fixPreview}`
    ));
    pushOp({ type:"approved", id:ticketId, ts:ts() });
    setFix(null);
  }, [fix, ticketId, T, addMsg, pushOp]);

  const handleDeny = useCallback((reason) => {
    setStatus("escalated");
    addMsg("assistant", T(
      "Our engineer is taking a closer look. We'll follow up with a tailored solution shortly.",
      "Nuestro ingeniero está revisando esto en detalle. Le contactaremos con una solución personalizada."
    ));
    pushOp({ type:"denied", id:ticketId, reason, ts:ts() });
    setFix(null);
  }, [ticketId, T, addMsg, pushOp]);

  const handleReset = () => {
    setMsgs([]); setOpEvents([]); setStatus(null); setFix(null);
    setHistory([]); setThinking(false); setStarted(false);
    setQCount(0); setTicketBrief(null);
  };

  return (
    <div style={{ height:"100vh", overflow:"hidden", display:"flex", flexDirection:"column", background:C.bg, color:C.txt, fontFamily:FS, transition:"background 0.3s,color 0.3s" }}>
      <TopBar C={C} dark={dark} setDark={setDark} lang={lang} setLang={setLang} ticketId={ticketId} status={status} T={T} onReset={handleReset} />

      {/* Demo mode banner */}
      <div style={{ background:C.amberGlow, borderBottom:`1px solid ${C.amber}44`, padding:"6px 24px", display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <span style={{ fontSize:11, color:C.amber, fontFamily:FM, letterSpacing:1 }}>⚠ DEMO MODE</span>
        <span style={{ fontSize:11, color:C.txtMuted }}>
          {T("Not connected to live systems · AI-simulated triage · For demonstration purposes only","No conectado a sistemas reales · Triaje simulado por IA · Solo para fines de demostración")}
        </span>
        {!started && (
          <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
            <span style={{ fontSize:11, color:C.txtMuted }}>{T("Try a high-priority scenario:","Probar escenario de alta prioridad:")}</span>
            {HIGH_SCENARIOS.map(s => (
              <button key={s.id} onClick={() => triggerHighPriority(s)} style={{ background:C.redGlow, border:`1px solid ${C.red}55`, color:C.red, padding:"4px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontFamily:FS, fontWeight:600 }}>
                🚨 {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex:1, display:"flex", overflow:"hidden", minHeight:0 }}>
        <CustomerPanel C={C} T={T} dark={dark} msgs={msgs} thinking={thinking} onSend={handleSend} status={status} ticketId={ticketId} started={started} qCount={qCount} />
        <Divider C={C} />
        <OperatorPanel C={C} T={T} events={opEvents} fix={fix} status={status} ticketId={ticketId} brief={ticketBrief} onApprove={handleApprove} onDeny={handleDeny} />
      </div>
    </div>
  );
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────
function TopBar({ C, dark, setDark, lang, setLang, ticketId, status, T, onReset }) {
  const sm = status ? statusMeta(status, T) : null;
  const sc = sm ? (C[sm.color] || C.accent) : null;
  return (
    <div style={{ height:54, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px", borderBottom:`1px solid ${C.border}`, background:C.surface, flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <img src="https://cdn.prod.website-files.com/64b77d8a4c7f046a3e2e5feb/64b781c8ea0ad169a1da65ee_Chef%20Brand%20Image.svg"
          alt="Chef Robotics" style={{ height:20, filter:dark?"brightness(0) invert(1)":"none" }}
          onError={e => e.target.style.display="none"} />
        <div style={{ width:1, height:18, background:C.border }} />
        <span style={{ fontSize:11, color:C.txtMuted, fontFamily:FM, letterSpacing:0.8 }}>ChefOS Operations · AI Triage Demo</span>
      </div>
      {status && (
        <div style={{ display:"flex", alignItems:"center", gap:8, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:20, padding:"4px 14px" }}>
          <span style={{ fontSize:11, color:C.txtMuted, fontFamily:FM }}>{ticketId}</span>
          <Dot color={sc} pulse={status === "critical"} />
          <span style={{ fontSize:11, fontFamily:FM, color:sc, letterSpacing:0.5 }}>{sm.label}</span>
        </div>
      )}
      <div style={{ display:"flex", gap:6 }}>
        {[
          { label: lang==="en"?"ES":"EN", action:() => setLang(l => l==="en"?"es":"en") },
          { label: dark?"☀ Light":"☾ Dark", action:() => setDark(d => !d) },
          { label:"↺ Reset", action:onReset },
        ].map((b,i) => (
          <button key={i} onClick={b.action} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, color:C.txtSub, padding:"5px 13px", borderRadius:7, cursor:"pointer", fontSize:12, fontFamily:FS }}>{b.label}</button>
        ))}
      </div>
    </div>
  );
}

function Divider({ C }) {
  return (
    <div style={{ width:1, background:C.border, flexShrink:0, position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ position:"absolute", width:26, height:26, borderRadius:"50%", background:C.surface, border:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:C.txtMuted, zIndex:2 }}>⇆</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOMER PANEL
// ═════════════════════════════════════════════════════════════════════════════
function CustomerPanel({ C, T, dark, msgs, thinking, onSend, status, ticketId, started, qCount }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef();
  const disabled = thinking || status === "resolved" || status === "closed" || status === "critical";

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, thinking]);

  const send = () => {
    const t = input.trim();
    if (!t || disabled) return;
    onSend(t);
    setInput("");
  };

  const STARTERS = [
    T("The robot arm stopped moving","El brazo del robot se detuvo"),
    T("The robot isn't working at all","El robot no funciona en absoluto"),
    T("There's an error showing on screen","Hay un error en la pantalla"),
  ];

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minWidth:0 }}>
      <PanelHeader C={C} color={C.blue} role={T("CUSTOMER","CLIENTE")} title={T("Support Portal","Portal de Soporte")} sub={T("Report your issue","Informe su problema")} ticketId={started ? ticketId : null} />

      {/* Progress bar */}
      {started && status === "diagnosing" && (
        <div style={{ padding:"8px 20px", borderBottom:`1px solid ${C.border}`, background:C.surfaceAlt, display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ flex:1, height:3, background:C.border, borderRadius:2, overflow:"hidden" }}>
            <div style={{ height:"100%", borderRadius:2, width:`${Math.min((qCount/5)*100, 95)}%`, background:`linear-gradient(90deg,${C.blue},${C.accent})`, transition:"width 0.5s ease" }} />
          </div>
          <span style={{ fontSize:10, color:C.txtMuted, fontFamily:FM, flexShrink:0 }}>{T("Diagnosing…","Diagnosticando…")}</span>
        </div>
      )}

      {/* Critical banner */}
      {status === "critical" && (
        <div style={{ background:C.redGlow, borderBottom:`1px solid ${C.red}44`, padding:"10px 20px", display:"flex", gap:10, alignItems:"center" }}>
          <span style={{ fontSize:14 }}>🚨</span>
          <span style={{ fontSize:13, color:C.red, fontWeight:600 }}>{T("High-priority alert sent to operator","Alerta de alta prioridad enviada al operador")}</span>
        </div>
      )}

      {/* Empty state */}
      {msgs.length === 0 && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 32px", textAlign:"center" }}>
          <div style={{ width:52, height:52, borderRadius:"50%", background:C.accentDim, border:`1px solid ${C.accent}33`, display:"flex", alignItems:"center", justifyContent:"center", marginBottom:18, fontSize:22 }}>🤖</div>
          <p style={{ fontSize:16, fontWeight:600, color:C.txt, margin:"0 0 8px" }}>{T("How can we help?","¿Cómo podemos ayudar?")}</p>
          <p style={{ fontSize:13, color:C.txtSub, maxWidth:300, lineHeight:1.7, margin:"0 0 24px" }}>{T("Describe the issue with your Chef robot in your own words.","Describa el problema con su robot Chef con sus propias palabras.")}</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8, width:"100%", maxWidth:340 }}>
            {STARTERS.map((s,i) => (
              <button key={i} onClick={() => onSend(s)} style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, color:C.txtSub, borderRadius:10, padding:"12px 16px", cursor:"pointer", fontSize:13, fontFamily:FS, textAlign:"left" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor=C.accent; e.currentTarget.style.color=C.txt; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.txtSub; }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 20px", display:"flex", flexDirection:"column", gap:12 }}>
        {msgs.map((m,i) => (
          <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start", alignItems:"flex-end", gap:8 }}>
            {m.role === "assistant" && <AiAvatar C={C} />}
            <div style={{ maxWidth:"80%", background:m.role==="user"?C.accent:C.surface, color:m.role==="user"?(dark?"#0E0F0D":"#fff"):C.txtSub, border:m.role==="user"?"none":`1px solid ${C.border}`, borderRadius:m.role==="user"?"16px 16px 4px 16px":"4px 16px 16px 16px", padding:"11px 15px", fontSize:13, lineHeight:1.65 }}>
              <RichText text={m.text} />
              <div style={{ fontSize:10, color:m.role==="user"?(dark?"#3a4a0a":"rgba(255,255,255,0.55)"):C.txtMuted, marginTop:5 }}>{m.ts}</div>
            </div>
          </div>
        ))}
        {thinking && (
          <div style={{ display:"flex", alignItems:"flex-end", gap:8 }}>
            <AiAvatar C={C} />
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:"4px 16px 16px 16px", padding:"11px 16px" }}>
              <ThinkDots C={C} />
            </div>
          </div>
        )}
        {status === "resolved" && <div style={{ textAlign:"center", padding:10, fontSize:12, color:C.accent, fontFamily:FM }}>✓ {T("Ticket resolved","Ticket resuelto")}</div>}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding:"12px 16px", borderTop:`1px solid ${C.border}`, background:C.surface, display:"flex", gap:8 }}>
        <textarea value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} }}
          placeholder={disabled ? T("Processing…","Procesando…") : T("Describe your issue…","Describa el problema…")}
          disabled={disabled} rows={2}
          style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 14px", color:C.txt, fontSize:13, fontFamily:FS, outline:"none", resize:"none", lineHeight:1.5, opacity:disabled?0.4:1 }} />
        <button onClick={send} disabled={disabled}
          style={{ background:C.accent, color:dark?"#0E0F0D":"#fff", border:"none", borderRadius:10, padding:"0 20px", cursor:disabled?"not-allowed":"pointer", fontSize:13, fontWeight:700, fontFamily:FS, opacity:disabled?0.4:1 }}>
          {T("Send","Enviar")}
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// OPERATOR PANEL
// ═════════════════════════════════════════════════════════════════════════════
function OperatorPanel({ C, T, events, fix, status, ticketId, brief, onApprove, onDeny }) {
  const [denyReason, setDenyReason] = useState("");
  const [showDeny, setShowDeny]     = useState(false);
  const bottomRef = useRef();
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [events, fix, brief]);

  const EVENT_META = {
    new_ticket:   { icon:"📥", label:T("New ticket opened","Ticket abierto"),         color:"blue"  },
    proposed_fix: { icon:"⚡", label:T("Diagnosis ready","Diagnóstico listo"),          color:"amber" },
    escalated:    { icon:"🚨", label:T("Escalated to operator","Escalado al operador"), color:"red"   },
    critical:     { icon:"🔴", label:T("CRITICAL ALERT","ALERTA CRÍTICA"),              color:"red"   },
    approved:     { icon:"✅", label:T("Fix approved","Solución aprobada"),             color:"accent"},
    denied:       { icon:"✗",  label:T("Fix denied","Solución rechazada"),              color:"red"  },
  };

  const isEmpty = events.length === 0 && !fix && !brief;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden", minWidth:0 }}>
      <PanelHeader C={C} color={C.accent} role={T("OPERATOR","OPERADOR")} title={T("Operations Dashboard","Panel de Operaciones")} sub={T("Engineer view","Vista del ingeniero")} ticketId={events.length>0 ? ticketId : null} />

      {isEmpty && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:40, textAlign:"center" }}>
          <div style={{ fontSize:32, opacity:0.15, marginBottom:16 }}>🖥</div>
          <p style={{ fontSize:14, fontWeight:600, color:C.txtSub, margin:"0 0 8px" }}>{T("Monitoring active","Monitoreo activo")}</p>
          <p style={{ fontSize:12, color:C.txtMuted, maxWidth:280, lineHeight:1.7 }}>{T("Customer tickets, AI briefs, and suggested actions will appear here.","Los tickets, resúmenes y acciones sugeridas aparecerán aquí.")}</p>
        </div>
      )}

      <div style={{ flex:1, overflowY:"auto", padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>

        {/* ── Live ticket brief — most important, always on top ── */}
        {brief && <TicketBrief C={C} T={T} brief={brief} status={status} />}

        {/* ── Proposed fix card ── */}
        {fix && (
          <FixCard C={C} T={T} fix={fix} showDeny={showDeny} denyReason={denyReason}
            setDenyReason={setDenyReason} setShowDeny={setShowDeny}
            onApprove={onApprove} onDeny={onDeny} dark={C===DARK} />
        )}

        {/* ── Event log ── */}
        {[...events].map((ev,i) => {
          const m = EVENT_META[ev.type] || {};
          const color = C[m.color] || C.txtMuted;
          return (
            <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderLeft:`3px solid ${color}`, borderRadius:10, padding:"11px 14px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom: (ev.summary||ev.reason||ev.issue) ? 6 : 0 }}>
                <span style={{ fontSize:13 }}>{m.icon}</span>
                <span style={{ fontSize:12, fontWeight:600, color, flex:1 }}>{m.label}</span>
                <span style={{ fontSize:10, color:C.txtMuted, fontFamily:FM }}>{ev.ts}</span>
              </div>
              {ev.summary && <p style={{ fontSize:12, color:C.txtMuted, margin:0, lineHeight:1.5 }}>"{ev.summary}"</p>}
              {ev.reason  && !ev.summary && <p style={{ fontSize:12, color:C.txtMuted, margin:0 }}>{T("Reason:","Razón:")} {ev.reason}</p>}
              {ev.issue   && <p style={{ fontSize:12, color:C.txtMuted, margin:0 }}>{T("Issue:","Problema:")} {ev.issue}</p>}
              {ev.type === "critical" && ev.scenario && (
                <p style={{ fontSize:12, color:C.red, margin:"4px 0 0", fontWeight:500 }}>{ev.scenario.brief.note}</p>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Status footer */}
      {status && (() => {
        const sm = statusMeta(status, T);
        const sc = C[sm.color] || C.accent;
        return (
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 16px", borderTop:`1px solid ${C.border}`, background:C.surfaceAlt }}>
            <Dot color={sc} pulse={status==="critical"} />
            <span style={{ fontSize:11, fontFamily:FM, color:sc, letterSpacing:0.5 }}>{sm.label}</span>
            {status === "resolved" && <span style={{ fontSize:11, color:C.txtMuted, marginLeft:4 }}>· {T("Customer notified","Cliente notificado")}</span>}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Ticket Brief Card ────────────────────────────────────────────────────────
function TicketBrief({ C, T, brief, status }) {
  const isCritical = status === "critical";
  const borderColor = isCritical ? C.red : C.blue;
  const glowColor   = isCritical ? C.redGlow : C.blueGlow;

  return (
    <div style={{ background:C.surface, border:`1px solid ${borderColor}55`, borderLeft:`3px solid ${borderColor}`, borderRadius:12, overflow:"hidden", boxShadow:`0 0 20px ${glowColor}` }}>
      {/* Header */}
      <div style={{ background:isCritical ? C.redGlow : C.blueGlow, padding:"9px 14px", borderBottom:`1px solid ${borderColor}33`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:11, fontFamily:FM, fontWeight:700, color:borderColor, letterSpacing:1 }}>
          {isCritical ? `🔴 ${T("CRITICAL TICKET BRIEF","RESUMEN CRÍTICO")}` : `📋 ${T("LIVE TICKET BRIEF","RESUMEN EN VIVO")}`}
        </span>
        <span style={{ fontSize:10, color:C.txtMuted }}>{T("Updates as conversation builds","Se actualiza con la conversación")}</span>
      </div>

      <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
        {/* Summary */}
        <div>
          <p style={{ fontSize:9, fontFamily:FM, color:C.txtMuted, letterSpacing:1.5, margin:"0 0 4px" }}>{T("SITUATION","SITUACIÓN")}</p>
          <p style={{ fontSize:13, color:C.txt, margin:0, lineHeight:1.5 }}>{brief.summary}</p>
        </div>

        {/* Likely issue */}
        {brief.likelyIssue && (
          <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px" }}>
            <p style={{ fontSize:9, fontFamily:FM, color:C.txtMuted, letterSpacing:1.5, margin:"0 0 4px" }}>{T("AI HYPOTHESIS","HIPÓTESIS IA")}</p>
            <p style={{ fontSize:13, color:C.txtSub, margin:0, lineHeight:1.5 }}>{brief.likelyIssue}</p>
          </div>
        )}

        {/* Starting points */}
        {brief.startingPoints?.length > 0 && (
          <div>
            <p style={{ fontSize:9, fontFamily:FM, color:C.txtMuted, letterSpacing:1.5, margin:"0 0 8px" }}>{T("WHERE TO START","POR DÓNDE EMPEZAR")}</p>
            {brief.startingPoints.map((pt, i) => (
              <div key={i} style={{ display:"flex", gap:10, marginBottom:6, alignItems:"flex-start" }}>
                <div style={{ width:20, height:20, borderRadius:"50%", background:C.accentDim, border:`1px solid ${C.accent}33`, color:C.accent, fontSize:10, fontFamily:FM, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>{i+1}</div>
                <span style={{ fontSize:12, color:C.txtSub, lineHeight:1.55 }}>{pt}</span>
              </div>
            ))}
          </div>
        )}

        {/* Customer context */}
        {brief.customerContext && (
          <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
            <p style={{ fontSize:9, fontFamily:FM, color:C.txtMuted, letterSpacing:1.5, margin:"0 0 3px" }}>{T("CONTEXT","CONTEXTO")}</p>
            <p style={{ fontSize:11, color:C.txtMuted, margin:0, lineHeight:1.5 }}>{brief.customerContext}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fix Card ─────────────────────────────────────────────────────────────────
function FixCard({ C, T, fix, showDeny, denyReason, setDenyReason, setShowDeny, onApprove, onDeny, dark }) {
  const confColor = fix.confidence==="high" ? C.accent : fix.confidence==="medium" ? C.amber : C.red;
  const steps = fix.fixPreview?.split("\n").filter(Boolean) ?? [];
  return (
    <div style={{ background:C.surface, borderRadius:12, border:`1px solid ${C.amber}66`, boxShadow:`0 0 24px ${C.amberGlow}`, overflow:"hidden" }}>
      <div style={{ background:C.amberGlow, padding:"9px 14px", borderBottom:`1px solid ${C.amber}33`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:11, fontFamily:FM, fontWeight:700, color:C.amber, letterSpacing:1 }}>⚡ {T("SUGGESTED ACTION","ACCIÓN SUGERIDA")}</span>
        <span style={{ fontSize:10, color:C.txtMuted }}>{T("Awaiting your approval","Esperando su aprobación")}</span>
      </div>
      <div style={{ padding:"13px 14px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
          <p style={{ fontSize:13, color:C.txt, margin:0, lineHeight:1.5, flex:1, paddingRight:10 }}>{fix.issue}</p>
          <span style={{ fontSize:10, fontFamily:FM, fontWeight:700, color:confColor, background:C.surfaceAlt, border:`1px solid ${confColor}44`, borderRadius:6, padding:"3px 8px", flexShrink:0 }}>{(fix.confidence??"—").toUpperCase()}</span>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", marginBottom:8 }}>
          <p style={{ fontSize:9, fontFamily:FM, color:C.txtMuted, letterSpacing:1.5, margin:"0 0 4px" }}>{T("PROPOSED FIX","SOLUCIÓN PROPUESTA")}</p>
          <p style={{ fontSize:13, color:C.txtSub, margin:0, lineHeight:1.55 }}>{fix.suggestedFix}</p>
        </div>
        <div style={{ background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", marginBottom:12 }}>
          <p style={{ fontSize:9, fontFamily:FM, color:C.txtMuted, letterSpacing:1.5, margin:"0 0 8px" }}>{T("STEP PREVIEW","PASOS")}</p>
          {steps.map((s,i) => (
            <div key={i} style={{ display:"flex", gap:8, marginBottom:5 }}>
              <span style={{ color:C.amber, fontFamily:FM, fontSize:12, flexShrink:0 }}>›</span>
              <span style={{ fontSize:12, color:C.txtSub, lineHeight:1.5 }}>{s.replace(/^\d+\.\s*/,"")}</span>
            </div>
          ))}
        </div>
        {!showDeny ? (
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={onApprove} style={{ flex:1, background:C.accent, color:dark?"#0E0F0D":"#fff", border:"none", borderRadius:9, padding:"11px 0", cursor:"pointer", fontSize:13, fontWeight:700, fontFamily:FS }}>✓ {T("Approve & Execute","Aprobar y Ejecutar")}</button>
            <button onClick={() => setShowDeny(true)} style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.red}55`, color:C.red, borderRadius:9, padding:"11px 0", cursor:"pointer", fontSize:13, fontFamily:FS }}>✗ {T("Deny","Rechazar")}</button>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <input value={denyReason} onChange={e => setDenyReason(e.target.value)}
              placeholder={T("Reason (optional)…","Razón (opcional)…")}
              style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:"9px 12px", color:C.txt, fontSize:13, fontFamily:FS, outline:"none" }} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => { onDeny(denyReason); setShowDeny(false); }} style={{ flex:1, background:C.redGlow, border:`1px solid ${C.red}55`, color:C.red, borderRadius:8, padding:"9px 0", cursor:"pointer", fontSize:12, fontFamily:FS, fontWeight:600 }}>{T("Confirm Deny","Confirmar Rechazo")}</button>
              <button onClick={() => setShowDeny(false)} style={{ flex:1, background:C.surfaceAlt, border:`1px solid ${C.border}`, color:C.txtSub, borderRadius:8, padding:"9px 0", cursor:"pointer", fontSize:12, fontFamily:FS }}>{T("Cancel","Cancelar")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────────────────────────────
function PanelHeader({ C, color, role, title, sub, ticketId }) {
  return (
    <div style={{ padding:"13px 20px", borderBottom:`1px solid ${C.border}`, background:C.surface, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <span style={{ fontSize:10, fontFamily:FM, fontWeight:700, letterSpacing:1.5, color, background:`${color}15`, border:`1px solid ${color}44`, borderRadius:6, padding:"4px 10px" }}>{role}</span>
        <div>
          <p style={{ margin:0, fontSize:13, fontWeight:600, color:C.txt }}>{title}</p>
          <p style={{ margin:0, fontSize:11, color:C.txtMuted }}>{sub}</p>
        </div>
      </div>
      {ticketId && <span style={{ fontSize:10, fontFamily:FM, color:C.txtMuted, background:C.surfaceAlt, border:`1px solid ${C.border}`, borderRadius:6, padding:"3px 9px" }}>{ticketId}</span>}
    </div>
  );
}

function AiAvatar({ C }) {
  return <div style={{ width:26, height:26, borderRadius:"50%", flexShrink:0, background:C.accentDim, border:`1px solid ${C.accent}33`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, marginBottom:2 }}>🤖</div>;
}

function Dot({ color, pulse }) {
  return <span style={{ width:7, height:7, borderRadius:"50%", background:color, boxShadow:pulse?`0 0 0 3px ${color}44`:undefined, display:"inline-block", transition:"box-shadow 0.5s" }} />;
}

function ThinkDots({ C }) {
  const [n, setN] = useState(1);
  useEffect(() => { const t = setInterval(() => setN(x => x%3+1), 420); return () => clearInterval(t); }, []);
  return <span style={{ color:C.accent, fontFamily:FM, letterSpacing:4, fontSize:13 }}>{"●".repeat(n)}</span>;
}

function RichText({ text }) {
  return <>{text.split("\n").map((line,i,a) => (<span key={i}>{line.split(/\*\*(.*?)\*\*/g).map((p,j) => j%2===1?<strong key={j}>{p}</strong>:p)}{i<a.length-1&&<br/>}</span>))}</>;
}
