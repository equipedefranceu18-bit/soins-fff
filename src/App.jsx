import { useState, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://khueuwkglmtvoqctyaor.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtodWV1d2tnbG10dm9xY3R5YW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTYzNDQsImV4cCI6MjA5MzAzMjM0NH0.To75-XcGQtig_Q4M5YqFqqN8yMAzJGsqXhlZQzU5Ckg";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── DATA ──────────────────────────────────────────────────────────────────────
const PRACTITIONERS = [
  { id: "k1", name: "Guillaume", role: "kiné",  color: "#4fc3f7", initials: "GU" },
  { id: "k2", name: "Denis",     role: "kiné",  color: "#ef5350", initials: "DE" },
  { id: "k3", name: "Alexandre", role: "kiné",  color: "#ffd54f", initials: "AL" },
  { id: "k4", name: "Clément",   role: "kiné",  color: "#81c784", initials: "CL" },
  { id: "o1", name: "Jean-Yves", role: "ostéo", color: "#ce93d8", initials: "JY" },
];

const PLAYERS = [
  "A. Dupont","B. Girard","C. Petit","D. Leroy","E. Moreau",
  "F. Simon","G. Michel","H. Lefebvre","I. Lefevre","J. Garcia",
  "K. David","L. Bertrand","M. Roux","N. Vincent","O. Fournier",
  "P. Morel","Q. Girard","R. Andre","S. Lecomte","T. Dupuis",
  "U. Mercier","V. Blanc","W. Guerin","X. Boyer","Y. Gauthier",
];

const STAFF_PASSWORD = "staff2024";
const BOOKING_ADVANCE_HOURS = 20;
const CASCADE_AFTER_HOUR = 21; // slots from this hour onward require previous to be booked first

// ─── TIME SLOTS ───────────────────────────────────────────────────────────────
// Base slots are 1h. Split slots ({ [slotKey]: true }) add the :30 half.
function generateBaseSlots() {
  const slots = [];
  for (let h = 9; h <= 23; h++) slots.push(`${String(h).padStart(2,"0")}:00`);
  return slots; // 09:00 … 23:00, each representing a 1h block
}
const BASE_SLOTS = generateBaseSlots();

// Given the base slots + which ones are split, return the full ordered list
function buildTimeSlots(splitSlots) {
  const all = [];
  for (const time of BASE_SLOTS) {
    all.push(time);
    if (splitSlots[time]) {
      const [h] = time.split(":").map(Number);
      all.push(`${String(h).padStart(2,"0")}:30`);
    }
  }
  return all;
}

// ─── WEEK / DATE HELPERS ──────────────────────────────────────────────────────
// Always starts from TODAY (offset in days from today, going 7 days)
function get7Days(dayOffset = 0) {
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + dayOffset + i);
    return d;
  });
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function fmtDate(d) { return d.toISOString().split("T")[0]; }

function fmtDisplay(d) {
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

function fmtLong(dateStr) {
  return new Date(dateStr+"T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function isWeekend(d) { const day = d.getDay(); return day === 0 || day === 6; }
function isPast(dateStr) { return dateStr < todayStr(); }

// ─── KEY HELPERS ──────────────────────────────────────────────────────────────
function slotKey(practId, date, time) { return `${practId}|${date}|${time}`; }
function recurKey(practId, dow, time) { return `${practId}|dow${dow}|${time}`; }
function dowOf(dateStr) { return (new Date(dateStr+"T12:00:00").getDay() + 6) % 7; } // 0=Mon…6=Sun

// Slot bookable only in the 20h window before it
function isWithinBookingWindow(date, time) {
  const slotDate = new Date(`${date}T${time}:00`);
  const hoursUntil = (slotDate - new Date()) / 3600000;
  return hoursUntil >= 0 && hoursUntil <= BOOKING_ADVANCE_HOURS;
}

const DAY_NAMES = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];

// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [view, setView] = useState("home");

  // Supabase state — synced from DB
  const [open,       setOpen]       = useState({});
  const [recurring,  setRecurring]  = useState({});
  const [closed,     setClosed]     = useState({});
  const [bookings,   setBookings]   = useState({});
  const [splitSlots, setSplitSlots] = useState({});
  const [dbReady,    setDbReady]    = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [o,c,r,s,b] = await Promise.all([
        supabase.from("open_slots").select("*"),
        supabase.from("closed_slots").select("*"),
        supabase.from("recurring_slots").select("*"),
        supabase.from("split_slots").select("*"),
        supabase.from("bookings").select("*"),
      ]);
      const om={}; (o.data||[]).forEach(x=>{om[`${x.pract_id}|${x.date}|${x.time}`]=true;});
      const cm={}; (c.data||[]).forEach(x=>{cm[`${x.pract_id}|${x.date}|${x.time}`]=true;});
      const rm={}; (r.data||[]).forEach(x=>{rm[`${x.pract_id}|dow${x.dow}|${x.time}`]=true;});
      const sm={}; (s.data||[]).forEach(x=>{sm[`${x.pract_id}|${x.date}|${x.base_time}`]=true;});
      const bm={}; (b.data||[]).forEach(x=>{bm[`${x.pract_id}|${x.date}|${x.time}`]={player:x.player,locked:x.locked,note:x.note||"",duration:x.duration||60};});
      setOpen(om); setClosed(cm); setRecurring(rm); setSplitSlots(sm); setBookings(bm);
      setDbReady(true);
    } catch(e) { console.warn("Supabase:",e.message); setDbReady(true); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const ch = supabase.channel("sync")
      .on("postgres_changes",{event:"*",schema:"public",table:"open_slots"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"closed_slots"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"recurring_slots"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"split_slots"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"bookings"},loadAll)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [loadAll]);

  // Navigation: dayOffset from today (steps of 7)
  const [dayOffset,  setDayOffset]  = useState(0);
  const days = get7Days(dayOffset);

  // Player state
  const [playerName,    setPlayerName]    = useState("");
  const [playerMode,    setPlayerMode]    = useState("byPract");
  const [selectedPract, setSelectedPract] = useState(null);
  const [selectedDate,  setSelectedDate]  = useState(null);
  const [selectedTime,  setSelectedTime]  = useState(null);
  const [bookingRole,   setBookingRole]   = useState("kiné");
  const [confirmation,  setConfirmation]  = useState(null);

  // Staff state
  const [staffPwd,        setStaffPwd]        = useState("");
  const [staffAuth,       setStaffAuth]       = useState(false);
  const [staffPract,      setStaffPract]      = useState(PRACTITIONERS[0].id);
  const [staffTarget,     setStaffTarget]     = useState(null);
  const [staffPlayerName, setStaffPlayerName] = useState("");

  // History view (staff)
  const [historyView, setHistoryView] = useState(false);

  const kines  = PRACTITIONERS.filter(p => p.role === "kiné");
  const osteos = PRACTITIONERS.filter(p => p.role === "ostéo");

  if (!dbReady) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,background:"#f0f4ff"}}>
      <FFFShield size={70}/>
      <div style={{color:"#002395",fontWeight:700,fontSize:16}}>Chargement…</div>
    </div>
  );

  // ── split slot helpers ────────────────────────────────────────────────────────
  function splitKey(practId, date, baseTime) { return `${practId}|${date}|${baseTime}`; }

  function isSplit(practId, date, baseTime) {
    return !!splitSlots[splitKey(practId, date, baseTime)];
  }

  async function toggleSplit(practId, date, baseTime) {
    const k = splitKey(practId, date, baseTime);
    if (splitSlots[k]) {
      await supabase.from("split_slots").delete().match({pract_id:practId, date, base_time:baseTime});
    } else {
      await supabase.from("split_slots").upsert({pract_id:practId, date, base_time:baseTime});
    }
    await loadAll();
  }

  // Build the time slots for a given pract+date context
  function getSlotsForContext(practId, date) {
    const splits = {};
    for (const base of BASE_SLOTS) {
      if (splitSlots[splitKey(practId, date, base)]) splits[base] = true;
    }
    return buildTimeSlots(splits);
  }

  // Is a given time a :30 half-slot (added by splitting)?
  function isHalfSlot(time) { return time.endsWith(":30"); }

  // ── slot queries ──────────────────────────────────────────────────────────────
  function isSlotOpen(practId, date, time) {
    const sk = slotKey(practId, date, time);
    const rk = recurKey(practId, dowOf(date), time);
    if (closed[sk]) return false;
    return !!(open[sk] || recurring[rk]);
  }
  function isRecurring(practId, date, time) {
    return !!recurring[recurKey(practId, dowOf(date), time)];
  }
  function getBooking(practId, date, time) {
    return bookings[slotKey(practId, date, time)] || null;
  }
  function isAvailable(practId, date, time) {
    if (!isSlotOpen(practId, date, time)) return false;
    if (getBooking(practId, date, time)) return false;
    if (!isWithinBookingWindow(date, time)) return false;

    // Cascade rule: after CASCADE_AFTER_HOUR, a slot is only bookable
    // if every earlier open slot from CASCADE_AFTER_HOUR onward (that day) is already booked
    const [h] = time.split(":").map(Number);
    if (h >= CASCADE_AFTER_HOUR) {
      const slotsForDay = getSlotsForContext(practId, date);
      for (const t of slotsForDay) {
        const [th] = t.split(":").map(Number);
        if (th < CASCADE_AFTER_HOUR) continue; // before threshold, ignore
        if (t === time) break;                  // reached current slot, stop
        // If there's an earlier open slot that day after threshold that is NOT booked → block
        if (isSlotOpen(practId, date, t) && !getBooking(practId, date, t)) return false;
      }
    }

    return true;
  }

  // ── staff slot actions ────────────────────────────────────────────────────────
  async function toggleOpen(practId, date, time) {
    const sk = slotKey(practId, date, time);
    const rk = recurKey(practId, dowOf(date), time);
    if (isSlotOpen(practId, date, time)) {
      if (recurring[rk] && !open[sk]) {
        await supabase.from("closed_slots").upsert({pract_id:practId, date, time});
      } else {
        await supabase.from("open_slots").delete().match({pract_id:practId, date, time});
        await supabase.from("closed_slots").delete().match({pract_id:practId, date, time});
      }
    } else {
      await supabase.from("closed_slots").delete().match({pract_id:practId, date, time});
      await supabase.from("open_slots").upsert({pract_id:practId, date, time});
    }
    await loadAll();
  }

  async function toggleRecurring(practId, date, time) {
    const dow = dowOf(date);
    const rk = recurKey(practId, dow, time);
    const sk = slotKey(practId, date, time);
    if (recurring[rk]) {
      await supabase.from("recurring_slots").delete().match({pract_id:practId, dow, time});
    } else {
      await supabase.from("recurring_slots").upsert({pract_id:practId, dow, time});
      await supabase.from("closed_slots").delete().match({pract_id:practId, date, time});
    }
    await loadAll();
  }

  async function staffBookSlot(practId, date, time, player) {
    const is30 = time.endsWith(":30") || isSplit(practId, date, time);
    await supabase.from("open_slots").upsert({pract_id:practId, date, time});
    await supabase.from("closed_slots").delete().match({pract_id:practId, date, time});
    await supabase.from("bookings").upsert({pract_id:practId, date, time, player, locked:true, note:"", duration:is30?30:60});
    await loadAll();
  }

  function unbook(practId, date, time) {
    // Keep past bookings in history — only allow delete for future/today
    const date_ = slotKey(practId, date, time).split("|")[1];
    if (isPast(date_)) return; // archived, can't delete
    setBookings(b => { const n={...b}; delete n[slotKey(practId,date,time)]; return n; });
  }

  async function addNote(practId, date, time, note) {
    await supabase.from("bookings").update({note}).match({pract_id:practId, date, time});
    await loadAll();
  }

  async function moveBooking(fromPractId, date, time, toPractId) {
    const bk = getBooking(fromPractId, date, time);
    if (!bk) return;
    await supabase.from("bookings").delete().match({pract_id:fromPractId, date, time});
    await supabase.from("open_slots").upsert({pract_id:toPractId, date, time});
    await supabase.from("closed_slots").delete().match({pract_id:toPractId, date, time});
    await supabase.from("bookings").upsert({pract_id:toPractId, date, time, player:bk.player, locked:bk.locked, note:bk.note, duration:bk.duration});
    await loadAll();
  }

  // ── player booking ────────────────────────────────────────────────────────────
  async function confirmBooking() {
    if (!playerName.trim() || !selectedPract || !selectedDate || !selectedTime) return;
    const is30 = selectedTime.endsWith(":30") || isSplit(selectedPract, selectedDate, selectedTime);
    await supabase.from("bookings").upsert({pract_id:selectedPract, date:selectedDate, time:selectedTime, player:playerName.trim(), locked:false, note:"", duration:is30?30:60});
    await loadAll();
    const p = PRACTITIONERS.find(x => x.id === selectedPract);
    setConfirmation({ pract: p, date: selectedDate, time: selectedTime, player: playerName, duration: is30 ? 30 : 60 });
    setSelectedPract(null); setSelectedDate(null); setSelectedTime(null);
  }

  function cancelMyBooking(practId, date, time) {
    const b = getBooking(practId, date, time);
    if (b && !b.locked && b.player === playerName && !isPast(date)) unbook(practId, date, time);
  }

  function myBookings() {
    if (!playerName) return [];
    return Object.entries(bookings)
      .filter(([,v]) => v.player === playerName)
      .map(([k,v]) => { const [pId,date,time] = k.split("|"); return { pId,date,time,locked:v.locked }; })
      .sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
  }

  // ── all past bookings (staff history) ────────────────────────────────────────
  function getPastBookings() {
    const today = todayStr();
    return Object.entries(bookings)
      .filter(([k]) => { const date = k.split("|")[1]; return date < today; })
      .map(([k,v]) => { const [pId,date,time] = k.split("|"); return { pId,date,time,...v }; })
      .sort((a,b) => (b.date+b.time).localeCompare(a.date+a.time)); // most recent first
  }

  // ─── render ───────────────────────────────────────────────────────────────────
  return (
    <div style={css.root}>
      <style>{globalStyles}</style>
      {view === "home" && <Home setView={setView} />}
      {view === "player" && (
        <PlayerView
          loadAll={loadAll}
          playerName={playerName} setPlayerName={setPlayerName}
          playerMode={playerMode} setPlayerMode={setPlayerMode}
          bookingRole={bookingRole} setBookingRole={setBookingRole}
          days={days} dayOffset={dayOffset} setDayOffset={setDayOffset}
          kines={kines} osteos={osteos}
          selectedPract={selectedPract} setSelectedPract={setSelectedPract}
          selectedDate={selectedDate} setSelectedDate={setSelectedDate}
          selectedTime={selectedTime} setSelectedTime={setSelectedTime}
          isAvailable={isAvailable} getBooking={getBooking}
          isSlotOpen={isSlotOpen} getSlotsForContext={getSlotsForContext} isSplit={isSplit}
          confirmBooking={confirmBooking}
          confirmation={confirmation} setConfirmation={setConfirmation}
          myBookings={myBookings} cancelMyBooking={cancelMyBooking}
          setView={setView}
        />
      )}
      {view === "staffAuth" && (
        <StaffAuth staffPwd={staffPwd} setStaffPwd={setStaffPwd}
          onAuth={() => { if (staffPwd === STAFF_PASSWORD) { setStaffAuth(true); setView("staff"); } }}
          setView={setView} />
      )}
      {view === "staff" && staffAuth && (
        <StaffView
          practitioners={PRACTITIONERS} days={days}
          dayOffset={dayOffset} setDayOffset={setDayOffset}
          staffPract={staffPract} setStaffPract={setStaffPract}
          getBooking={getBooking} isSlotOpen={isSlotOpen} isRecurring={isRecurring}
          toggleOpen={toggleOpen} toggleRecurring={toggleRecurring}
          unbook={unbook} staffBookSlot={staffBookSlot} addNote={addNote} moveBooking={moveBooking}
          staffTarget={staffTarget} setStaffTarget={setStaffTarget}
          staffPlayerName={staffPlayerName} setStaffPlayerName={setStaffPlayerName}
          getSlotsForContext={getSlotsForContext} isSplit={isSplit} toggleSplit={toggleSplit}
          BASE_SLOTS={BASE_SLOTS} isHalfSlot={isHalfSlot}
          getPastBookings={getPastBookings}
          PLAYERS={PLAYERS} setView={setView}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── FFF Logo SVG (style officiel : hexagone + coq + 2 étoiles + FFF) ─────────
function FFFShield({ size = 90 }) {
  const w = size, h = size * 1.15;
  return (
    <svg width={w} height={h} viewBox="0 0 200 230" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Hexagone principal bleu marine */}
      <path d="M100 4 L192 52 L192 178 L100 226 L8 178 L8 52 Z"
        fill="#002395"/>
      {/* Bordure or */}
      <path d="M100 4 L192 52 L192 178 L100 226 L8 178 L8 52 Z"
        fill="none" stroke="#c8a84b" strokeWidth="4"/>
      {/* Bande tricolore verticale au centre */}
      <clipPath id="hex-clip">
        <path d="M100 4 L192 52 L192 178 L100 226 L8 178 L8 52 Z"/>
      </clipPath>
      <g clipPath="url(#hex-clip)">
        <rect x="8" y="4" width="61" height="224" fill="#002395"/>
        <rect x="69" y="4" width="62" height="224" fill="white" opacity="0.12"/>
        <rect x="131" y="4" width="61" height="224" fill="#ED2939" opacity="0.25"/>
      </g>

      {/* 2 étoiles */}
      <text x="72" y="38" textAnchor="middle" fill="#c8a84b" fontSize="18" fontWeight="900">★</text>
      <text x="128" y="38" textAnchor="middle" fill="#c8a84b" fontSize="18" fontWeight="900">★</text>

      {/* Coq gaulois stylisé */}
      {/* Crête */}
      <path d="M115 55 C112 48 108 44 105 46 C102 42 97 41 95 45 C91 42 87 45 88 50 C84 48 82 53 85 56 C88 54 91 55 93 58" fill="#c8a84b"/>
      {/* Tête */}
      <ellipse cx="100" cy="63" rx="13" ry="11" fill="#c8a84b"/>
      {/* Bec */}
      <path d="M87 63 L80 61 L81 66 L87 65 Z" fill="#ED2939"/>
      {/* Oeil */}
      <circle cx="94" cy="60" r="2" fill="#002395"/>
      <circle cx="94" cy="60" r="1" fill="white"/>
      {/* Barbillons */}
      <path d="M87 67 C84 67 82 70 84 72 C86 74 89 72 88 69 Z" fill="#ED2939"/>
      {/* Corps */}
      <path d="M100 72 C90 73 82 80 80 92 C78 104 80 118 84 128 C88 138 95 143 100 144 C105 143 112 138 116 128 C120 118 122 104 120 92 C118 80 110 73 100 72 Z"
        fill="#c8a84b"/>
      {/* Aile gauche */}
      <path d="M84 90 C74 95 68 108 70 122 C76 115 82 105 84 92 Z" fill="#b8922a"/>
      {/* Aile droite */}
      <path d="M116 90 C126 95 132 108 130 122 C124 115 118 105 116 92 Z" fill="#b8922a"/>
      {/* Patte gauche */}
      <path d="M92 143 L88 160 L84 165 M88 160 L84 162 M88 160 L90 164" stroke="#c8a84b" strokeWidth="3" strokeLinecap="round"/>
      {/* Patte droite */}
      <path d="M108 143 L112 160 L116 165 M112 160 L116 162 M112 160 L110 164" stroke="#c8a84b" strokeWidth="3" strokeLinecap="round"/>
      {/* Queue */}
      <path d="M116 95 C124 88 132 82 138 78 C134 86 128 94 122 100 Z" fill="#c8a84b"/>
      <path d="M116 100 C126 95 136 92 142 90 C136 98 128 104 120 108 Z" fill="#b8922a"/>

      {/* FFF text */}
      <text x="100" y="200" textAnchor="middle" fill="white"
        fontSize="22" fontWeight="900" fontFamily="'Arial Black', Arial, sans-serif" letterSpacing="4">
        FFF
      </text>
      {/* Ligne déco sous FFF */}
      <line x1="60" y1="207" x2="140" y2="207" stroke="#c8a84b" strokeWidth="1.5" opacity="0.6"/>
    </svg>
  );
}

function Home({ setView }) {
  return (
    <div style={css.homeWrap}>
      {/* Background gradient bleu marine */}
      <div style={{
        position:"fixed", inset:0, zIndex:0,
        background:"linear-gradient(160deg, #001a5e 0%, #002395 45%, #001a5e 100%)",
      }} />
      {/* Subtle pattern */}
      <div style={{
        position:"fixed", inset:0, zIndex:0, opacity:0.04,
        backgroundImage:"repeating-linear-gradient(45deg, #fff 0, #fff 1px, transparent 0, transparent 50%)",
        backgroundSize:"20px 20px",
      }} />

      <div style={{...css.homeCard, zIndex:1, position:"relative",
        background:"rgba(0,10,40,0.85)",
        border:"1px solid rgba(200,168,75,0.4)",
        backdropFilter:"blur(20px)",
        boxShadow:"0 0 60px rgba(0,35,149,0.5), 0 0 0 1px rgba(200,168,75,0.2)",
      }}>
        {/* Shield */}
        <div style={{display:"flex",justifyContent:"center",marginBottom:8}}>
          <FFFShield size={90} />
        </div>

        {/* Title */}
        <h1 style={{...css.homeTitle,
          fontSize:13, letterSpacing:4, textTransform:"uppercase",
          color:"#c8a84b", fontWeight:700, margin:"0 0 4px",
        }}>
          Équipe de France
        </h1>
        <h2 style={{...css.homeTitle,
          fontSize:22, letterSpacing:1,
          color:"#ffffff", fontWeight:800, margin:"0 0 4px",
        }}>
          Soins & Récupération
        </h2>
        <p style={{...css.homeSub, color:"rgba(255,255,255,0.5)", marginBottom:32, fontSize:13}}>
          Réservation des créneaux médicaux
        </p>

        {/* Tricolor divider */}
        <div style={{display:"flex", height:3, borderRadius:2, overflow:"hidden", marginBottom:28}}>
          <div style={{flex:1, background:"#002395"}} />
          <div style={{flex:1, background:"#ffffff"}} />
          <div style={{flex:1, background:"#ED2939"}} />
        </div>

        <div style={css.homeBtns}>
          <button style={{
            ...css.btn,
            background:"linear-gradient(135deg, #002395 0%, #0035cc 100%)",
            color:"#fff",
            border:"1px solid rgba(200,168,75,0.3)",
            boxShadow:"0 4px 20px rgba(0,35,149,0.4)",
          }} onClick={() => setView("player")}>
            <span style={{fontSize:20}}>⚽</span>
            <span>Je suis un joueur</span>
          </button>
          <button style={{
            ...css.btn,
            background:"linear-gradient(135deg, #7b1011 0%, #ED2939 100%)",
            color:"#fff",
            border:"1px solid rgba(200,168,75,0.3)",
            boxShadow:"0 4px 20px rgba(237,41,57,0.3)",
          }} onClick={() => setView("staffAuth")}>
            <span style={{fontSize:20}}>🩺</span>
            <span>Staff médical</span>
          </button>
        </div>

        <p style={{fontSize:10,color:"rgba(255,255,255,0.2)",marginTop:20,letterSpacing:1}}>
          FÉDÉRATION FRANÇAISE DE FOOTBALL
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
function PlayerView({
  loadAll,
  playerName, setPlayerName, playerMode, setPlayerMode,
  bookingRole, setBookingRole, days, dayOffset, setDayOffset,
  kines, osteos, selectedPract, setSelectedPract,
  selectedDate, setSelectedDate, selectedTime, setSelectedTime,
  isAvailable, getBooking, isSlotOpen, getSlotsForContext, isSplit, confirmBooking,
  confirmation, setConfirmation, myBookings, cancelMyBooking, setView
}) {
  const practitioners = bookingRole === "kiné" ? kines : osteos;
  const [showMy, setShowMy] = useState(false);
  // Single-day view: track the currently displayed day
  const [activeDay, setActiveDay] = useState(todayStr());
  const mb = myBookings();
  const future = mb.filter(b => b.date >= todayStr());
  const past_mb = mb.filter(b => b.date < todayStr());

  // Keep activeDay in sync when week changes
  const allDays = days;
  const activeDayObj = allDays.find(d => fmtDate(d) === activeDay) || allDays[0];
  const activeIdx = allDays.findIndex(d => fmtDate(d) === activeDay);

  function goDay(delta) {
    loadAll(); // Recharger les données depuis Supabase
    const newIdx = activeIdx + delta;
    if (newIdx < 0) {
      setDayOffset(o => Math.max(0, o - 7));
      setActiveDay(fmtDate(days[6]));
    } else if (newIdx >= 7) {
      setDayOffset(o => o + 7);
      setActiveDay(fmtDate(days[0]));
    } else {
      setActiveDay(fmtDate(allDays[newIdx]));
    }
    setSelectedDate(null); setSelectedTime(null); setSelectedPract(null);
  }

  function handlePractSelect(id) {
    setSelectedPract(id === selectedPract ? null : id);
    setSelectedDate(null); setSelectedTime(null);
  }
  function handleSlotClick(pId, date, time) {
    if (!isAvailable(pId, date, time)) return;
    if (playerMode === "byPract") {
      if (selectedPract !== pId) return;
      if (selectedDate===date && selectedTime===time) { setSelectedDate(null); setSelectedTime(null); }
      else { setSelectedDate(date); setSelectedTime(time); }
    } else {
      if (selectedDate===date && selectedTime===time && selectedPract===pId) {
        setSelectedDate(null); setSelectedTime(null); setSelectedPract(null);
      } else { setSelectedDate(date); setSelectedTime(time); setSelectedPract(pId); }
    }
  }

  const canConfirm = playerName.trim() && selectedPract && selectedDate && selectedTime;
  const singleDay = activeDayObj ? [activeDayObj] : [];

  if (confirmation) {
    const is30 = confirmation.duration === 30;
    return (
      <div style={css.confirmWrap}>
        <div style={css.confirmCard}>
          <div style={{fontSize:56}}>✅</div>
          <h2 style={css.confirmTitle}>Réservation confirmée !</h2>
          {is30 && (
            <div style={{background:`${T.gold}22`,border:`1px solid ${T.goldBright}`,borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:T.gold,fontWeight:600}}>
              ⏱ Attention : ce créneau est de <strong>30 minutes</strong> seulement
            </div>
          )}
          <div style={css.confirmDetail}>
            <div style={css.confirmRow}><span>Joueur</span><strong>{confirmation.player}</strong></div>
            <div style={css.confirmRow}><span>Praticien</span><strong>{confirmation.pract.name}</strong></div>
            <div style={css.confirmRow}><span>Date</span><strong>{fmtLong(confirmation.date)}</strong></div>
            <div style={css.confirmRow}>
              <span>Heure</span>
              <strong>{confirmation.time} <span style={{fontSize:11,fontWeight:400,color:T.textDim}}>({is30?"30 min":"1 heure"})</span></strong>
            </div>
          </div>
          <button style={{...css.btn,...css.btnPlayer,marginTop:24}} onClick={() => setConfirmation(null)}>
            Faire une autre réservation
          </button>
          <button style={css.btnLink} onClick={() => setView("home")}>← Accueil</button>
        </div>
      </div>
    );
  }

  return (
    <div style={css.pageWrap}>
      <div style={css.pageHeader}>
        <button style={css.backBtn} onClick={() => setView("home")}>←</button>
        <h2 style={css.pageTitle}>Réserver un soin</h2>
        <button style={{...css.badgePill,background:future.length>0?"rgba(255,255,255,0.25)":"rgba(255,255,255,0.12)"}}
          onClick={() => setShowMy(!showMy)}>
          📋 {future.length} RDV
        </button>
      </div>

      {showMy && (
        <div style={css.myBookingsPanel}>
          {future.length > 0 && <>
            <h3 style={css.myBookingsTitle}>Mes prochains RDV</h3>
            {future.map(b => <BookingRow key={`${b.pId}${b.date}${b.time}`} b={b} onCancel={cancelMyBooking} past={false} />)}
          </>}
          {past_mb.length > 0 && <>
            <h3 style={{...css.myBookingsTitle,color:T.textDim,marginTop:16}}>Historique</h3>
            {past_mb.slice(0,10).map(b => <BookingRow key={`${b.pId}${b.date}${b.time}`} b={b} onCancel={cancelMyBooking} past={true} />)}
          </>}
          {future.length===0 && past_mb.length===0 && <p style={{color:T.textDim,fontSize:13,margin:0}}>Aucune réservation.</p>}
        </div>
      )}

      <div style={css.section}>
        <label style={css.label}>Votre nom</label>
        <select style={css.select} value={playerName} onChange={e=>setPlayerName(e.target.value)}>
          <option value="">-- Sélectionner --</option>
          {PLAYERS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Role tabs */}
      <div style={css.tabs}>
        {["kiné","ostéo"].map(r => (
          <button key={r} style={{...css.tab,...(bookingRole===r?css.tabActive:{})}}
            onClick={()=>{ setBookingRole(r); setSelectedPract(null); setSelectedDate(null); setSelectedTime(null); }}>
            {r==="kiné"?"💆 Kinésithérapie":"🦴 Ostéopathie"}
          </button>
        ))}
      </div>

      {/* Mode tabs */}
      <div style={css.modeTabs}>
        <button style={{...css.modeTab,...(playerMode==="byPract"?css.modeTabActive:{})}}
          onClick={()=>{ setPlayerMode("byPract"); setSelectedPract(null); setSelectedDate(null); setSelectedTime(null); }}>
          Choisir un praticien
        </button>
        <button style={{...css.modeTab,...(playerMode==="bySlot"?css.modeTabActive:{})}}
          onClick={()=>{ setPlayerMode("bySlot"); setSelectedPract(null); setSelectedDate(null); setSelectedTime(null); }}>
          Choisir un créneau
        </button>
      </div>

      <div style={css.noticeBar}>
        🕐 Les créneaux ne sont réservables que dans les 20h qui précèdent le soin
      </div>

      {/* ── Single-day navigator ── */}
      <div style={css.playerDayNav}>
        <button style={css.playerDayBtn} onClick={() => goDay(-1)} disabled={activeIdx===0 && dayOffset===0}>
          ‹
        </button>

        {/* 7 day pills */}
        <div style={{display:"flex", gap:6, overflowX:"auto", flex:1, justifyContent:"center"}}>
          {allDays.map(d => {
            const date    = fmtDate(d);
            const isToday = date === todayStr();
            const isSel   = date === activeDay;
            const isPastD = isPast(date);
            return (
              <button key={date} onClick={() => { setActiveDay(date); setSelectedDate(null); setSelectedTime(null); setSelectedPract(null); }}
                style={{
                  flexShrink:0, minWidth:46,
                  background: isSel ? T.navy : isToday ? `${T.navy}18` : T.surface,
                  border: isSel ? `2px solid ${T.navy}` : `1px solid ${T.border}`,
                  borderRadius:10, cursor:"pointer", padding:"6px 4px", textAlign:"center",
                  opacity: isPastD ? 0.4 : 1,
                  boxShadow: isSel ? `0 2px 12px ${T.navy}33` : "none",
                  transition:"all 0.15s",
                }}>
                <div style={{fontSize:10, fontWeight:700, textTransform:"capitalize",
                  color: isSel?"#fff" : isToday ? T.navy : T.textDim}}>
                  {d.toLocaleDateString("fr-FR",{weekday:"short"})}
                </div>
                <div style={{fontSize:16, fontWeight:800,
                  color: isSel?"#fff" : isToday ? T.navy : T.text}}>
                  {d.getDate()}
                </div>
                {isToday && !isSel && <div style={{width:4,height:4,borderRadius:"50%",background:T.navy,margin:"2px auto 0"}} />}
              </button>
            );
          })}
        </div>

        <button style={css.playerDayBtn} onClick={() => goDay(1)}>›</button>
      </div>

      {/* Active day label */}
      <div style={{padding:"0 20px 8px", textAlign:"center"}}>
        <span style={{fontSize:15, fontWeight:700, color:T.navy, textTransform:"capitalize"}}>
          {activeDayObj?.toLocaleDateString("fr-FR",{weekday:"long", day:"numeric", month:"long"})}
        </span>
      </div>

      {playerMode === "byPract" ? (
        <ByPractGrid
          practitioners={practitioners} days={singleDay}
          selectedPract={selectedPract} onPractSelect={handlePractSelect}
          selectedDate={selectedDate} selectedTime={selectedTime}
          isAvailable={isAvailable} getBooking={getBooking}
          isSlotOpen={isSlotOpen} getSlotsForContext={getSlotsForContext} isSplit={isSplit}
          onSlotClick={handleSlotClick}
        />
      ) : (
        <BySlotGrid
          practitioners={practitioners} days={singleDay}
          selectedPract={selectedPract} selectedDate={selectedDate} selectedTime={selectedTime}
          isAvailable={isAvailable} isSlotOpen={isSlotOpen} getSlotsForContext={getSlotsForContext} isSplit={isSplit}
          onSlotClick={handleSlotClick}
        />
      )}

      {canConfirm && (
        <div style={css.confirmBar}>
          <div style={{fontSize:13}}>
            <div style={{opacity:0.9,color:"#fff"}}>
              <strong>{PRACTITIONERS.find(x=>x.id===selectedPract)?.name}</strong>
              {" · "}{fmtLong(selectedDate)} · {selectedTime}
            </div>
            {(selectedTime?.endsWith(":30") || isSplit(selectedPract, selectedDate, selectedTime)) && (
              <div style={{fontSize:11,color:T.goldBright,fontWeight:700,marginTop:2}}>
                ⏱ Créneau de 30 minutes
              </div>
            )}
          </div>
          <button style={{...css.btn,...css.btnConfirm}} onClick={confirmBooking}>Confirmer ✓</button>
        </div>
      )}
    </div>
  );
}

function BookingRow({ b, onCancel, past }) {
  const p = PRACTITIONERS.find(x => x.id === b.pId);
  return (
    <div style={{...css.myBookingRow, opacity: past ? 0.6 : 1}}>
      <div style={{...css.practDot,background:p.color}} />
      <div style={{flex:1}}>
        <strong>{p.name}</strong>
        <div style={{fontSize:12,opacity:0.7}}>
          {fmtLong(b.date)} à {b.time}
          {past && <span style={{marginLeft:6,fontSize:10,color:"#8b949e"}}>• passé</span>}
        </div>
      </div>
      {!past && !b.locked && (
        <button style={css.cancelBtn} onClick={()=>onCancel(b.pId,b.date,b.time)}>Annuler</button>
      )}
      {(past || b.locked) && <span style={{fontSize:12,opacity:0.4}}>{past?"✓":"🔒"}</span>}
    </div>
  );
}

// ─── Player grids ──────────────────────────────────────────────────────────────
function ByPractGrid({ practitioners, days, selectedPract, onPractSelect, selectedDate, selectedTime,
  isAvailable, getBooking, isSlotOpen, getSlotsForContext, isSplit, onSlotClick }) {

  // Build union of all time slots across days for selected pract
  const timeSlots = selectedPract
    ? [...new Set(days.flatMap(d => getSlotsForContext(selectedPract, fmtDate(d))))].sort()
    : BASE_SLOTS;

  return (
    <div style={css.gridSection}>
      <div style={css.practList}>
        {practitioners.map(p => (
          <button key={p.id}
            style={{...css.practBtn,...(selectedPract===p.id?{background:p.color+"33",borderColor:p.color}:{})}}
            onClick={()=>onPractSelect(p.id)}>
            <div style={{...css.practAvatar,background:p.color}}>{p.initials}</div>
            <span>{p.name}</span>
          </button>
        ))}
      </div>

      {selectedPract ? (
        <div style={css.calendarWrap}>
          <div style={{...css.calGrid,gridTemplateColumns:`56px repeat(${days.length},1fr)`}}>
            <div style={{...css.timeColHead, minWidth:0}} />
            {days.map(d => {
              const isToday = fmtDate(d) === todayStr();
              return (
                <div key={fmtDate(d)} style={{...css.dayHead,...(isWeekend(d)?css.dayHeadWE:{}),...(isToday?css.dayHeadToday:{})}}>
                  <span style={css.dayName}>{fmtDisplay(d)}</span>
                  {isToday && <div style={css.todayDot} />}
                </div>
              );
            })}
            {timeSlots.map(time => {
              const isHalf = time.endsWith(":30");

              // For a :00 slot, check if it's split on ANY visible day for this pract
              // If split, it represents only 30min, so use the half height
              const isEffectivelyHalf = isHalf ||
                (!isHalf && days.some(d => isSplit(selectedPract, fmtDate(d), time)));

              return (
                <>
                  <div key={`t-${time}`} style={{
                    ...css.timeCell,
                    ...(isEffectivelyHalf ? css.timeCellHalf : {}),
                    // If it's a :00 that is split, show it distinctly
                    ...(isEffectivelyHalf && !isHalf ? { color:"#fd79a8", fontSize:10 } : {})
                  }}>{time}{isEffectivelyHalf && !isHalf ? " ✂" : ""}</div>
                  {days.map(d => {
                    const date     = fmtDate(d);
                    const slots    = getSlotsForContext(selectedPract, date);
                    if (!slots.includes(time)) {
                      return <div key={`${date}-${time}`} style={{...css.slotCell, height: isEffectivelyHalf ? 34 : 52, background:isWeekend(d)?"#0f1117":"#0d1117",opacity:0.3}} />;
                    }
                    const avail    = isAvailable(selectedPract, date, time);
                    const slotOpen = isSlotOpen(selectedPract, date, time);
                    const booking  = getBooking(selectedPract, date, time);
                    const past     = isPast(date);
                    const sel      = selectedDate===date && selectedTime===time;
                    const color    = PRACTITIONERS.find(x=>x.id===selectedPract)?.color;
                    const we       = isWeekend(d);
                    // Per-cell: is this specific date/pract split?
                    const cellIsHalf = isHalf || isSplit(selectedPract, date, time);
                    return (
                      <PlayerSlotCell key={`${date}-${time}`}
                        avail={avail} slotOpen={slotOpen} booking={booking}
                        past={past} selected={sel} color={color} weekend={we} halfSlot={cellIsHalf}
                        onClick={()=>onSlotClick(selectedPract,date,time)}
                      />
                    );
                  })}
                </>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={css.emptyHint}>← Sélectionnez un praticien pour voir ses disponibilités</div>
      )}

      {selectedPract && (
        <div style={css.practLegend}>
          <LegendItem color="#162320" border={`2px solid ${PRACTITIONERS.find(x=>x.id===selectedPract)?.color}66`} label="Disponible" />
          <LegendItem color="#1f3a2a" label="Réservé" />
          <LegendItem color="#0d1117" label="Fermé" dim />
          <LegendItem color="#1a1a2e" label="Passé" dim />
        </div>
      )}
    </div>
  );
}

function BySlotGrid({ practitioners, days, selectedPract, selectedDate, selectedTime,
  isAvailable, isSlotOpen, getSlotsForContext, isSplit, onSlotClick }) {

  const H = 28; // base unit. 1h = 2*H, 30min = 1*H

  const baseTimes = [...new Set(days.flatMap(d =>
    practitioners.flatMap(p => getSlotsForContext(p.id, fmtDate(d)).filter(t => !t.endsWith(":30")))
  ))].sort();

  // For a single day (days has 1 element in player view), we know the exact date
  const date = days.length === 1 ? fmtDate(days[0]) : null;

  function PractBtn({ p, d, time, h }) {
    if (!isAvailable(p.id, d, time)) return null;
    const sel  = selectedPract===p.id && selectedDate===d && selectedTime===time;
    const is30 = time.endsWith(":30") || isSplit(p.id, d, time);
    return (
      <button style={{
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        height: h - 8, minWidth:44, padding:"0 8px",
        background: sel ? p.color : p.color+"20",
        border:`2px solid ${p.color}`,
        borderRadius:10, cursor:"pointer", gap:1,
        boxShadow: sel ? `0 2px 8px ${p.color}44` : "none",
        flexShrink:0,
      }}
        onClick={() => onSlotClick(p.id, d, time)}
        title={`${p.name} — ${is30 && h <= H ? "30 min" : "1 heure"}`}>
        <span style={{fontSize:13, fontWeight:800, color:sel?"#fff":p.color}}>{p.initials}</span>
        {is30 && h <= H && <span style={{fontSize:8, color:sel?"rgba(255,255,255,0.8)":p.color+"aa", fontWeight:700}}>30'</span>}
        {!is30 && <span style={{fontSize:8, color:sel?"rgba(255,255,255,0.7)":p.color+"88"}}>1h</span>}
      </button>
    );
  }

  // Single-day view: render as a simple vertical list, one slot per row.
  // For split slots, render TWO consecutive rows — each H tall.
  // No table, no rowSpan — just divs stacked vertically.
  if (days.length === 1) {
    const d = fmtDate(days[0]);
    const past = isPast(d);

    return (
      <div style={css.gridSection}>
        <div style={{...css.calendarWrap, overflow:"hidden"}}>
          {/* Header */}
          <div style={{
            display:"flex", height:48,
            background:T.surface3, borderBottom:`2px solid ${T.border}`,
          }}>
            <div style={{width:70, flexShrink:0, borderRight:`1px solid ${T.border}`}} />
            <div style={{
              flex:1,
              background: isWeekend(days[0]) ? "#f5f0f8" : d===todayStr() ? T.navy+"18" : T.surface3,
              borderBottom: d===todayStr() ? `3px solid ${T.navy}` : "none",
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            }}>
              <div style={{fontSize:13, fontWeight:700, color:T.textMid, textTransform:"capitalize"}}>{fmtDisplay(days[0])}</div>
              {d===todayStr() && <div style={{width:6,height:6,borderRadius:"50%",background:T.navy,marginTop:2}} />}
            </div>
          </div>

          {/* Rows */}
          {baseTimes.map(baseTime => {
            const halfTime = `${baseTime.split(":")[0].padStart(2,"0")}:30`;
            const splitHere = practitioners.some(p => isSplit(p.id, d, baseTime));

            if (!splitHere) {
              // Simple 1h row
              const avail = practitioners.filter(p => isAvailable(p.id, d, baseTime));
              return (
                <div key={baseTime} style={{
                  display:"flex", height:H*2,
                  borderBottom:`1px solid ${T.border2}`,
                }}>
                  <div style={{
                    width:70, flexShrink:0, borderRight:`1px solid ${T.border}`,
                    display:"flex", flexDirection:"column", alignItems:"flex-end", justifyContent:"center",
                    padding:"0 8px", background:T.surface2,
                  }}>
                    <span style={{fontSize:12, fontWeight:700, color:T.textMid}}>{baseTime}</span>
                    <span style={{fontSize:9, color:T.textDim}}>1h</span>
                  </div>
                  <div style={{
                    flex:1, display:"flex", alignItems:"center", justifyContent:"center",
                    gap:8, flexWrap:"wrap", padding:4,
                    background: past ? "#eef0f5" : T.surface,
                    opacity: past ? 0.5 : 1,
                  }}>
                    {!past && avail.map(p => <PractBtn key={p.id} p={p} d={d} time={baseTime} h={H*2} />)}
                    {!past && avail.length===0 && <span style={{fontSize:12,opacity:0.2,color:T.textDim}}>—</span>}
                  </div>
                </div>
              );
            }

            // Split: two rows of H each, but 1h practs span the full H*2 height
            const splitPracts   = practitioners.filter(p =>  isSplit(p.id, d, baseTime));
            const unsplitPracts = practitioners.filter(p => !isSplit(p.id, d, baseTime));

            const avail1h  = unsplitPracts.filter(p => isAvailable(p.id, d, baseTime));
            const avail00  = splitPracts.filter(p => isAvailable(p.id, d, baseTime));
            const avail30  = splitPracts.filter(p => isAvailable(p.id, d, halfTime));

            return (
              <div key={baseTime} style={{position:"relative"}}>
                {/* Full-height container for 1h buttons (positioned absolutely) */}
                {!past && avail1h.length > 0 && (
                  <div style={{
                    position:"absolute", left:70, top:0,
                    height:H*2, display:"flex", alignItems:"center",
                    gap:6, padding:"0 8px", zIndex:2, pointerEvents:"none",
                  }}>
                    {avail1h.map(p => (
                      <div key={p.id} style={{pointerEvents:"auto"}}>
                        <PractBtn p={p} d={d} time={baseTime} h={H*2} />
                      </div>
                    ))}
                  </div>
                )}

                {/* :00 row — only split practs, plus invisible spacer for 1h practs */}
                <div style={{display:"flex", height:H, borderBottom:`1px dashed ${T.border2}`}}>
                  <div style={{
                    width:70, flexShrink:0, borderRight:`1px solid ${T.border}`,
                    display:"flex", flexDirection:"column", alignItems:"flex-end", justifyContent:"center",
                    padding:"0 8px", background:T.surface2,
                  }}>
                    <span style={{fontSize:11, fontWeight:700, color:T.textMid}}>{baseTime}</span>
                    <span style={{fontSize:8, color:"#e05090"}}>30'</span>
                  </div>
                  <div style={{
                    flex:1, display:"flex", alignItems:"center", justifyContent:"flex-end",
                    gap:6, padding:"2px 8px",
                    background:T.surface, opacity: past ? 0.5 : 1,
                  }}>
                    {!past && avail00.map(p => <PractBtn key={p.id} p={p} d={d} time={baseTime} h={H} />)}
                    {!past && avail00.length===0 && avail1h.length===0 && <span style={{fontSize:10,opacity:0.2}}>—</span>}
                  </div>
                </div>

                {/* :30 row — only split practs */}
                <div style={{display:"flex", height:H, borderBottom:`1px solid ${T.border2}`}}>
                  <div style={{
                    width:70, flexShrink:0, borderRight:`1px solid ${T.border}`,
                    display:"flex", flexDirection:"column", alignItems:"flex-end", justifyContent:"center",
                    padding:"0 8px", background:T.surface2,
                  }}>
                    <span style={{fontSize:10, color:"#e05090"}}>{halfTime}</span>
                    <span style={{fontSize:8, color:"#e05090"}}>30'</span>
                  </div>
                  <div style={{
                    flex:1, display:"flex", alignItems:"center", justifyContent:"flex-end",
                    gap:6, padding:"2px 8px",
                    background:T.surface, opacity: past ? 0.5 : 1,
                  }}>
                    {!past && avail30.map(p => <PractBtn key={p.id} p={p} d={d} time={halfTime} h={H} />)}
                    {!past && avail30.length===0 && avail1h.length===0 && <span style={{fontSize:10,opacity:0.2}}>—</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={css.practLegend}>
          {practitioners.map(p => (
            <div key={p.id} style={css.legendItem}>
              <div style={{...css.practDot,background:p.color}} />{p.name}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Multi-day fallback (not used in player view but kept for safety)
  return (
    <div style={css.gridSection}>
      <div style={css.emptyHint}>Vue multi-jours non disponible en mode joueur.</div>
    </div>
  );
}

function PlayerSlotCell({ avail, slotOpen, booking, past, selected, color, weekend, halfSlot, onClick }) {
  const weBg = weekend ? "#0f1117" : "#0d1117";
  const h = halfSlot ? 28 : 56;

  if (past) {
    if (booking) {
      return (
        <div style={{...css.slotCell,height:h,background:"#1a2a1a",cursor:"default",borderLeft:"2px solid #2a4a2a",flexDirection:"column",gap:1}}>
          <span style={{fontSize:9,color:"#5a8a5a"}}>✓</span>
          {halfSlot && <span style={{fontSize:8,color:"#3a6a3a"}}>30'</span>}
        </div>
      );
    }
    return <div style={{...css.slotCell,height:h,background:weBg,opacity:0.08,cursor:"default"}} />;
  }

  if (!slotOpen && !booking) {
    return <div style={{...css.slotCell,height:h,background:weBg,opacity:0.08,cursor:"default"}} />;
  }
  if (booking) {
    return (
      <div style={{...css.slotCell,height:h,background:"#1f3a2a",cursor:"default",flexDirection:"column",gap:1}} title="Déjà réservé">
        <span style={{fontSize:10,color:"#7ee787"}}>●</span>
        {halfSlot && <span style={{fontSize:8,color:"#7ee787aa"}}>30'</span>}
      </div>
    );
  }
  if (!avail) {
    return (
      <div style={{...css.slotCell,height:h,background:weBg,opacity:0.35,cursor:"default"}}
        title="Pas encore dans la fenêtre de 20h">
        <span style={{fontSize:9}}>🕐</span>
      </div>
    );
  }
  // Available — half slots show clear 30min badge
  return (
    <div style={{
      ...css.slotCell, height:h,
      flexDirection:"column", gap:1,
      background: selected ? color+"33" : halfSlot ? "#1a1f28" : "#162320",
      borderLeft: `2px solid ${selected ? color : color+"88"}`,
      ...(halfSlot ? { borderTop: `1px dashed ${color}44` } : {}),
      cursor:"pointer",
    }} onClick={onClick} title={halfSlot ? "Créneau 30 minutes" : "Créneau 1 heure"}>
      <span style={{fontSize:9,color,fontWeight:800}}>✓</span>
      {halfSlot && (
        <span style={{
          fontSize:8, fontWeight:800, color:"#fff",
          background:color, borderRadius:3, padding:"1px 4px", lineHeight:1.3,
        }}>30'</span>
      )}
    </div>
  );
}

function LegendItem({ color, border, label, dim }) {
  return (
    <div style={css.legendItem}>
      <div style={{width:12,height:12,borderRadius:3,background:color,border:border||"none",opacity:dim?0.4:1}} />
      {label}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
function DayNav({ days, dayOffset, setDayOffset }) {
  const start = days[0], end = days[6];
  return (
    <div style={css.weekNav}>
      <button style={css.weekBtn} onClick={()=>setDayOffset(o=>Math.max(0,o-7))} disabled={dayOffset===0}
        title={dayOffset===0?"Aujourd'hui est déjà à gauche":""}>
        ‹
      </button>
      <span style={css.weekLabel}>
        {start.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})} –{" "}
        {end.toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"})}
      </span>
      <button style={css.weekBtn} onClick={()=>setDayOffset(o=>o+7)}>›</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
function StaffAuth({ staffPwd, setStaffPwd, onAuth, setView }) {
  return (
    <div style={css.homeWrap}>
      <div style={{...css.homeCard,maxWidth:380}}>
        <div style={{fontSize:48}}>🔐</div>
        <h2 style={{...css.homeTitle,fontSize:24}}>Accès Staff Médical</h2>
        <input type="password" style={css.input} placeholder="Mot de passe"
          value={staffPwd} onChange={e=>setStaffPwd(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&onAuth()} />
        <button style={{...css.btn,...css.btnStaff,width:"100%",marginTop:8}} onClick={onAuth}>Connexion</button>
        <button style={css.btnLink} onClick={()=>setView("home")}>← Retour</button>
        <p style={{fontSize:11,opacity:0.4,marginTop:16}}>Mot de passe démo : staff2024</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
function StaffView({ practitioners, days, dayOffset, setDayOffset, staffPract, setStaffPract,
  getBooking, isSlotOpen, isRecurring, toggleOpen, toggleRecurring,
  unbook, staffBookSlot, addNote, moveBooking, staffTarget, setStaffTarget,
  staffPlayerName, setStaffPlayerName,
  getSlotsForContext, isSplit, toggleSplit, BASE_SLOTS, isHalfSlot,
  getPastBookings, PLAYERS, setView }) {

  const [dvSubMode, setDvSubMode] = useState("slots");
  const [staffViewDay, setStaffViewDay] = useState(todayStr());
  const [noteModal,    setNoteModal]    = useState(null);
  const [moveModal,    setMoveModal]    = useState(null); // { practId, date, time, booking }
  const [histFilter,   setHistFilter]   = useState("");

  const kines4 = practitioners.filter(p => p.role === "kiné");
  const dvDate = staffViewDay || todayStr();

  const pastBookings = getPastBookings();
  const filteredHistory = histFilter ? pastBookings.filter(b => b.pId === histFilter) : pastBookings;
  const byMonth = {};
  for (const b of filteredHistory) {
    const month = b.date.slice(0,7);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(b);
  }

  const subModes = [
    { key:"slots",     label:"📅 Ouvrir/Fermer", color:"#00d4aa", hint:"Cliquez pour ouvrir ou fermer un créneau (ponctuel)." },
    { key:"recurring", label:"↺ Récurrence",     color:"#ffd166", hint:"Cliquez pour activer/désactiver la répétition hebdomadaire." },
    { key:"split",     label:"✂️ Diviser 2×30'", color:"#fd79a8", hint:"Cliquez sur un créneau 1h pour le couper en deux créneaux de 30 min." },
    { key:"addPlayer", label:"➕ Assigner",       color:"#a29bfe", hint:"Cliquez sur un créneau libre pour y assigner un joueur." },
    { key:"history",   label:"🗂 Historique",     color:"#8b949e", hint:"Consultez tous les soins passés." },
  ];
  const currentMode = subModes.find(m => m.key === dvSubMode);

  return (
    <div style={css.pageWrap}>
      <div style={css.pageHeader}>
        <button style={css.backBtn} onClick={()=>setView("home")}>←</button>
        <h2 style={css.pageTitle}>Gestion — Vue du jour</h2>
        <div style={css.staffBadge}>Staff ✓</div>
      </div>

      {/* Note modal */}
      {noteModal && (
        <NoteModal
          note={noteModal.booking.note || ""}
          player={noteModal.booking.player}
          date={noteModal.date} time={noteModal.time}
          pract={PRACTITIONERS.find(x=>x.id===noteModal.practId)}
          onSave={(note) => { addNote(noteModal.practId, noteModal.date, noteModal.time, note); setNoteModal(null); }}
          onClose={() => setNoteModal(null)}
        />
      )}

      {/* Move/action modal */}
      {moveModal && (
        <BookingActionModal
          modal={moveModal}
          kines={kines4}
          pract={PRACTITIONERS.find(x=>x.id===moveModal.practId)}
          onNote={() => { setNoteModal({...moveModal}); setMoveModal(null); }}
          onMove={(toPractId) => {
            moveBooking(moveModal.practId, moveModal.date, moveModal.time, toPractId);
            setMoveModal(null);
          }}
          onDelete={() => { unbook(moveModal.practId, moveModal.date, moveModal.time); setMoveModal(null); }}
          onClose={() => setMoveModal(null)}
        />
      )}

      {/* Day selector */}
      <div style={css.daySelectorRow}>
        <button style={css.weekBtn} onClick={()=>setDayOffset(o=>Math.max(0,o-7))} disabled={dayOffset===0}>‹</button>
        {days.map(d => {
          const date = fmtDate(d);
          const isToday = date === todayStr();
          const isSel = date === dvDate;
          return (
            <button key={date} style={{
              ...css.daySelectBtn,
              ...(isSel ? {background:"#58a6ff22",border:"1px solid #58a6ff",color:"#58a6ff"} : {}),
              ...(isToday && !isSel ? {color:"#00d4aa"} : {}),
              ...(isWeekend(d) ? {background:"#0f1117"} : {}),
            }} onClick={()=>setStaffViewDay(date)}>
              <div style={{fontSize:11,fontWeight:600,textTransform:"capitalize"}}>{d.toLocaleDateString("fr-FR",{weekday:"short"})}</div>
              <div style={{fontSize:15,fontWeight:800}}>{d.getDate()}</div>
              {isToday && <div style={{width:4,height:4,borderRadius:"50%",background:"#00d4aa",margin:"2px auto 0"}} />}
            </button>
          );
        })}
        <button style={css.weekBtn} onClick={()=>setDayOffset(o=>o+7)}>›</button>
      </div>

      {/* Sub-mode buttons */}
      <div style={css.staffActions}>
        {subModes.map(({key,label,color}) => (
          <button key={key} style={{
            ...css.staffActBtn,
            ...(dvSubMode===key ? {background:color+"22",border:`1px solid ${color}`,color} : {})
          }} onClick={()=>{ setDvSubMode(key); setStaffTarget(null); }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{padding:"0 20px 8px",fontSize:12,color:"#8b949e"}}>{currentMode?.hint}</div>

      {/* ── HISTORY MODE ── */}
      {dvSubMode === "history" && (
        <div style={{padding:"0 0 40px"}}>
          <div style={{padding:"0 20px 12px"}}>
            <label style={css.label}>Filtrer par praticien</label>
            <select style={css.select} value={histFilter} onChange={e=>setHistFilter(e.target.value)}>
              <option value="">Tous les praticiens</option>
              {practitioners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {Object.keys(byMonth).length === 0 && (
            <div style={css.emptyHint}>Aucun soin passé enregistré.</div>
          )}
          {Object.entries(byMonth).map(([month, entries]) => {
            const monthLabel = new Date(`${month}-15`).toLocaleDateString("fr-FR",{month:"long",year:"numeric"});
            return (
              <div key={month} style={{padding:"0 20px 16px"}}>
                <div style={css.histMonthHeader}>{monthLabel} — {entries.length} soin{entries.length>1?"s":""}</div>
                {entries.map((b,i) => {
                  const p = PRACTITIONERS.find(x=>x.id===b.pId);
                  return (
                    <div key={i} style={css.histRow}>
                      <div style={{...css.practDot,background:p.color,flexShrink:0}} />
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <strong>{b.player}</strong>
                          {b.locked && <span style={{fontSize:10,opacity:0.4}}>🔒 staff</span>}
                        </div>
                        <div style={{fontSize:12,color:"#8b949e"}}>
                          {fmtLong(b.date)} · {b.time} · <span style={{color:p.color}}>{p.name}</span>
                        </div>
                        {b.note && (
                          <div style={{fontSize:12,color:"#c9d1d9",marginTop:4,padding:"4px 8px",background:"#21262d",borderRadius:6,borderLeft:`2px solid ${p.color}55`}}>
                            💬 {b.note}
                          </div>
                        )}
                      </div>
                      <button style={{...css.staffActBtn,fontSize:11,padding:"4px 8px",flexShrink:0}}
                        onClick={()=>setNoteModal({practId:b.pId,date:b.date,time:b.time,booking:b})}>
                        {b.note?"✏️":"💬"}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ── CALENDAR MODES ── */}
      {dvSubMode !== "history" && (
        <>
          {/* Assign player panel */}
          {dvSubMode==="addPlayer" && staffTarget && (
            <div style={css.addPlayerPanel}>
              <div style={{fontWeight:600,marginBottom:8,fontSize:14}}>
                Assigner · <span style={{color: kines4.find(k=>k.id===staffTarget.practId)?.color}}>
                  {kines4.find(k=>k.id===staffTarget.practId)?.name}
                </span> · {staffTarget.time}
              </div>
              <select style={css.select} value={staffPlayerName} onChange={e=>setStaffPlayerName(e.target.value)}>
                <option value="">-- Choisir un joueur --</option>
                {PLAYERS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div style={{display:"flex",gap:8,marginTop:8}}>
                <button style={{...css.btn,...css.btnConfirm}}
                  onClick={()=>{
                    if(staffTarget && staffPlayerName){
                      staffBookSlot(staffTarget.practId, staffTarget.date, staffTarget.time, staffPlayerName);
                      setStaffTarget(null); setStaffPlayerName("");
                    }
                  }} disabled={!staffPlayerName}>
                  Confirmer 🔒
                </button>
                <button style={{...css.btn,background:"#21262d",color:"#8b949e",fontSize:14,padding:"10px 16px"}}
                  onClick={()=>{ setStaffTarget(null); setStaffPlayerName(""); }}>
                  Annuler
                </button>
              </div>
            </div>
          )}

          <MultiKineDay
            kines={kines4}
            date={dvDate}
            subMode={dvSubMode}
            staffTarget={staffTarget}
            getBooking={getBooking} isSlotOpen={isSlotOpen} isRecurring={isRecurring}
            getSlotsForContext={getSlotsForContext} isSplit={isSplit}
            onCellClick={(practId, date, time) => {
              const booking = getBooking(practId, date, time);
              if (booking) {
                // Always open the booking action modal (note + move)
                setMoveModal({ practId, date, time, booking });
                return;
              }
              if (dvSubMode === "addPlayer") {
                setStaffTarget({ practId, date, time });
              } else if (dvSubMode === "recurring") {
                toggleRecurring(practId, date, time);
              } else if (dvSubMode === "split") {
                if (!time.endsWith(":30")) toggleSplit(practId, date, time);
              } else {
                toggleOpen(practId, date, time);
              }
            }}
            unbook={unbook}
          />

          <div style={css.staffLegend}>
            <span style={{...css.legendBadge}}>↺ Récurrent (couleur du kiné)</span>
            <span style={{...css.legendBadge}}>✓ Ouvert 1h</span>
            <span style={{...css.legendBadge,borderLeft:"2px solid #fd79a8"}}>✓ 30'</span>
            <span style={css.legendBadge}>■ Réservé → clic = commenter</span>
            <span style={css.legendBadge}>🔒 Assigné staff</span>
            <span style={{...css.legendBadge,color:"#ffd166"}}>⚡ ≥21h cascade</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Multi-Kiné Day View ──────────────────────────────────────────────────────
// Each kiné column is an independent flex column.
// The time axis shows base 1h slots. Split kinés show 2×30' within their H1 space.
// Other kinés keep H1 — no forced split bleeding across columns.
function MultiKineDay({ kines, date, subMode, staffTarget, getBooking, isSlotOpen, isRecurring,
  getSlotsForContext, isSplit, onCellClick, unbook }) {

  const isPastDay = isPast(date);
  // KEY: H1 = 2 × H30  →  a split column (2×H30) = exactly the height of an unsplit column (H1)
  // This guarantees perfect row alignment across all columns.
  const H30 = 28, H1 = 56, HEADER = 48;

  // All base (non-:30) slots that appear in at least one kiné for this date
  const baseTimes = [...new Set(kines.flatMap(k =>
    getSlotsForContext(k.id, date).filter(t => !t.endsWith(":30"))
  ))].sort();

  // For each base time, build the row description:
  // - If a kiné has this slot split, it shows [baseTime, baseTime:30] each H30
  // - Otherwise it shows [baseTime] at H1
  // The time-axis always shows H1 for each base slot (representing 1h block)

  function renderCell(k, time) {
    const isHalf    = time.endsWith(":30");
    const splitThis = isSplit(k.id, date, time.endsWith(":30") ? time.replace(":30",":00") : time);
    const cellIs30  = isHalf || splitThis;
    const cellH     = cellIs30 ? H30 : H1;
    const kSlots    = getSlotsForContext(k.id, date);
    const inSlots   = kSlots.includes(time);

    const commonStyle = {
      height: cellH, flexShrink: 0,
      borderBottom: `1px solid ${T.border2}`,
      borderRight: `1px solid ${T.border}`,
      overflow: "hidden",
      transition: "background 0.1s",
    };

    if (!inSlots) {
      return (
        <div key={`${k.id}-${time}`} style={{
          ...commonStyle,
          background: "#f5f5fa",
          opacity: 0.5,
        }} />
      );
    }

    const booking  = getBooking(k.id, date, time);
    const slotOpen = isSlotOpen(k.id, date, time);
    const rec      = isRecurring(k.id, date, time);
    const isTarget = staffTarget?.practId===k.id && staffTarget?.date===date && staffTarget?.time===time;

    let bg = T.surface, bl = "3px solid transparent", indicator = null;

    if (booking) {
      bg = k.color+"18"; bl = `3px solid ${k.color}`;
      indicator = (
        <div style={{width:"100%", overflow:"hidden", padding:"0 6px"}}>
          <div style={{display:"flex", alignItems:"center", gap:3}}>
            <span style={{fontSize:11, fontWeight:700, color:k.color, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1}}>
              {booking.player}
            </span>
            {cellIs30 && <span style={{fontSize:8, background:k.color, color:"#fff", borderRadius:3, padding:"0 3px", flexShrink:0}}>30'</span>}
            {booking.locked && <span style={{fontSize:9, opacity:0.5, flexShrink:0}}>🔒</span>}
            {!isPastDay && <button style={css.deleteBtn} onClick={e=>{e.stopPropagation();unbook(k.id,date,time);}}>✕</button>}
          </div>
          {booking.note && (
            <div style={{fontSize:9, color:T.textDim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:1}}>
              💬 {booking.note}
            </div>
          )}
        </div>
      );
    } else if (slotOpen) {
      bg = rec ? k.color+"14" : k.color+"0c";
      bl = rec ? `3px solid ${k.color}88` : `3px solid ${k.color}55`;
      const splitHint = subMode === "split" && !cellIs30;
      indicator = (
        <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:1}}>
          <span style={{fontSize:13, color:k.color, fontWeight:800, opacity:0.7}}>
            {rec ? "↺" : splitHint ? "✂" : "✓"}
          </span>
          <span style={{fontSize:8, color:k.color+"99", fontWeight:600}}>{cellIs30 ? "30'" : "1h"}</span>
        </div>
      );
    } else {
      const hint = subMode==="recurring" ? "↺" : subMode==="split"&&!isHalf ? "✂" : "+";
      indicator = <span style={{fontSize:12, color:T.textDim, opacity:0.3}}>{hint}</span>;
    }

    if (isTarget) { bg="#fffbe8"; bl=`3px solid ${T.goldBright}`; }

    return (
      <div key={`${k.id}-${time}`} style={{
        ...commonStyle,
        background: bg, borderLeft: bl,
        display:"flex", alignItems:"center", justifyContent:"center",
        cursor: (subMode==="split" && isHalf) ? "default" : "pointer",
        opacity: (subMode==="split" && isHalf) ? 0.5 : 1,
      }}
        onClick={() => { if(subMode==="split"&&isHalf) return; onCellClick(k.id,date,time); }}
        title={booking ? `${booking.player} — options` : slotOpen ? `Ouvert ${cellIs30?"30'":"1h"}` : "Fermé"}>
        {indicator}
      </div>
    );
  }

  return (
    <div style={{...css.calendarWrap, margin:"0 20px", overflowX:"auto"}}>
      <div style={{display:"flex", minWidth:500}}>

        {/* Fixed time axis — one H1 row per base slot */}
        <div style={{width:64, flexShrink:0, display:"flex", flexDirection:"column"}}>
          <div style={{height:HEADER, background:T.surface3, borderBottom:`2px solid ${T.border}`, borderRight:`1px solid ${T.border}`}} />
          {baseTimes.map(time => (
            <div key={`axis-${time}`} style={{
              height: H1, flexShrink:0,
              background: T.surface2,
              borderBottom:`1px solid ${T.border2}`,
              borderRight:`1px solid ${T.border}`,
              display:"flex", alignItems:"center", justifyContent:"flex-end", padding:"0 8px",
            }}>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:11, fontWeight:600, color:T.textMid}}>{time}</div>
                <div style={{fontSize:9, color:T.textDim}}>1h</div>
              </div>
            </div>
          ))}
        </div>

        {/* One independent flex column per kiné */}
        {kines.map(k => (
          <div key={k.id} style={{flex:1, minWidth:90, display:"flex", flexDirection:"column"}}>
            {/* Header */}
            <div style={{
              height: HEADER, flexShrink:0,
              background: k.color+"18",
              borderBottom:`3px solid ${k.color}`,
              borderRight:`1px solid ${T.border}`,
              display:"flex", alignItems:"center", justifyContent:"center", gap:6, padding:"0 6px",
            }}>
              <div style={{...css.practAvatar, background:k.color, width:30, height:30, fontSize:11, flexShrink:0}}>{k.initials}</div>
              <span style={{fontSize:13, fontWeight:700, color:k.color, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{k.name}</span>
            </div>

            {/* Per base slot: render 1 or 2 cells */}
            {baseTimes.map(baseTime => {
              const splitForThis = isSplit(k.id, date, baseTime);
              if (splitForThis) {
                const halfTime = `${baseTime.split(":")[0].padStart(2,"0")}:30`;
                return (
                  <div key={`${k.id}-${baseTime}-split`} style={{display:"flex", flexDirection:"column"}}>
                    {renderCell(k, baseTime)}
                    {renderCell(k, halfTime)}
                  </div>
                );
              }
              return renderCell(k, baseTime);
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingActionModal({ modal, kines, pract, onNote, onMove, onDelete, onClose }) {
  const { booking, date, time } = modal;
  const otherKines = kines.filter(k => k.id !== modal.practId);
  const isPastDay  = isPast(date);

  return (
    <div style={css.modalOverlay} onClick={onClose}>
      <div style={css.modalCard} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{...css.practAvatar,background:pract.color,width:32,height:32,fontSize:12,flexShrink:0}}>{pract.initials}</div>
          <div>
            <div style={{fontWeight:800,fontSize:16}}>{booking.player}</div>
            <div style={{fontSize:12,color:"#8b949e"}}>{fmtLong(date)} · {time} · <span style={{color:pract.color}}>{pract.name}</span></div>
            {booking.note && <div style={{fontSize:11,color:"#8b949e",marginTop:2}}>💬 {booking.note}</div>}
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {/* Comment */}
          <button style={{...css.modalActionBtn, borderColor:"#30363d", color:"#e6edf3"}} onClick={onNote}>
            <span style={{fontSize:18}}>{booking.note?"✏️":"💬"}</span>
            <div style={{textAlign:"left"}}>
              <div style={{fontWeight:700}}>{booking.note ? "Modifier le commentaire" : "Ajouter un commentaire"}</div>
              {booking.note && <div style={{fontSize:11,opacity:0.6,marginTop:1}}>{booking.note}</div>}
            </div>
          </button>

          {/* Move to another kine */}
          {!isPastDay && otherKines.length > 0 && (
            <div>
              <div style={{fontSize:11,color:"#8b949e",padding:"4px 0 6px",textTransform:"uppercase",letterSpacing:1}}>
                Déplacer vers
              </div>
              {otherKines.map(k => (
                <button key={k.id} style={{
                  ...css.modalActionBtn,
                  borderColor: k.color+"55",
                  color: k.color,
                  background: k.color+"11",
                  marginBottom:6,
                }} onClick={()=>onMove(k.id)}>
                  <div style={{...css.practAvatar,background:k.color,width:28,height:28,fontSize:11,flexShrink:0}}>{k.initials}</div>
                  <div style={{textAlign:"left"}}>
                    <div style={{fontWeight:700}}>{k.name}</div>
                    <div style={{fontSize:11,opacity:0.6}}>même créneau · {time}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Delete */}
          {!isPastDay && (
            <button style={{...css.modalActionBtn, borderColor:"#f8514944", color:"#f85149", background:"#f8514911"}} onClick={onDelete}>
              <span style={{fontSize:18}}>🗑</span>
              <div style={{textAlign:"left"}}>
                <div style={{fontWeight:700}}>Supprimer la réservation</div>
                <div style={{fontSize:11,opacity:0.6}}>Libère le créneau</div>
              </div>
            </button>
          )}

          <button style={{...css.modalActionBtn, borderColor:"#30363d", color:"#8b949e"}} onClick={onClose}>
            <span style={{fontSize:18}}>✕</span>
            <div style={{fontWeight:700,textAlign:"left"}}>Fermer</div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Note Modal ───────────────────────────────────────────────────────────────
function NoteModal({ note, player, date, time, pract, onSave, onClose }) {
  const [text, setText] = useState(note);
  return (
    <div style={css.modalOverlay} onClick={onClose}>
      <div style={css.modalCard} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{...css.practAvatar,background:pract.color,width:32,height:32,fontSize:12,flexShrink:0}}>{pract.initials}</div>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>{player}</div>
            <div style={{fontSize:12,color:"#8b949e"}}>{fmtLong(date)} · {time} · {pract.name}</div>
          </div>
        </div>

        <label style={{...css.label,marginBottom:8}}>💬 Commentaire sur le soin</label>
        <textarea
          style={{
            width:"100%", background:"#0d1117", border:"1px solid #30363d",
            borderRadius:10, padding:"12px", color:"#e6edf3", fontSize:14,
            resize:"vertical", minHeight:100, fontFamily:"inherit", boxSizing:"border-box",
            outline:"none",
          }}
          placeholder="Ex: Massage quadriceps G, électrostimulation, bilan de la cheville..."
          value={text}
          onChange={e=>setText(e.target.value)}
          autoFocus
        />

        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button style={{...css.btn,...css.btnConfirm,flex:1}} onClick={()=>onSave(text.trim())}>
            Enregistrer ✓
          </button>
          {text && (
            <button style={{...css.btn,background:"#2a1a1a",border:"1px solid #f85149",color:"#f85149",fontSize:13,padding:"10px 14px"}}
              onClick={()=>{ setText(""); onSave(""); }}>
              Effacer
            </button>
          )}
          <button style={{...css.btn,background:"#21262d",color:"#8b949e",fontSize:13,padding:"10px 14px"}}
            onClick={onClose}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── THEME CONSTANTS (Light) ──────────────────────────────────────────────────
// France: Navy #002395 · White · Red #ED2939 · Gold #c8a84b  — Light mode
const T = {
  navy:    "#002395",
  navyDk:  "#001a6e",
  navyLt:  "#1a4fd6",
  red:     "#ED2939",
  redDk:   "#b01020",
  white:   "#ffffff",
  gold:    "#9a6e00",
  goldBright: "#c8a84b",
  goldDim: "rgba(154,110,0,0.25)",
  bg:      "#f0f4ff",        // very light blue-white
  surface: "#ffffff",        // pure white cards
  surface2:"#e8edf8",        // slightly blue-tinted hover
  surface3:"#dde4f5",        // deeper tint for headers
  border:  "rgba(0,35,149,0.15)",
  border2: "rgba(0,35,149,0.10)",
  text:    "#0a1440",        // very dark navy text
  textDim: "#4a5a8a",        // muted navy
  textMid: "#1a2e6e",
  slotFree:"#e8f4ff",        // light blue for available slots
  slotBooked:"#e8f5e9",      // light green for booked
};

// ─── STYLES ───────────────────────────────────────────────────────────────────
const css = {
  root: { minHeight:"100vh", background:T.bg, color:T.text, fontFamily:"'Outfit','Segoe UI',sans-serif" },
  homeWrap: { minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24 },
  homeCard: { background:T.surface, border:`1px solid ${T.border}`, borderRadius:20, padding:"48px 40px", textAlign:"center", maxWidth:440, width:"100%", boxShadow:"0 8px 40px rgba(0,35,149,0.12)" },
  homeBadge: { fontSize:56, marginBottom:16 },
  homeTitle: { fontSize:28, fontWeight:800, margin:"0 0 8px", letterSpacing:-0.5, color:T.text },
  homeSub: { color:T.textDim, margin:"0 0 32px", fontSize:15 },
  homeBtns: { display:"flex", flexDirection:"column", gap:12 },

  btn: { border:"none", borderRadius:12, padding:"14px 24px", fontSize:16, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10, transition:"all 0.2s" },
  btnPlayer: { background:`linear-gradient(135deg,${T.navy},${T.navyLt})`, color:"#fff", border:`1px solid ${T.navyDk}` },
  btnStaff:  { background:`linear-gradient(135deg,${T.redDk},${T.red})`, color:"#fff", border:`1px solid ${T.redDk}` },
  btnConfirm:{ background:`linear-gradient(135deg,${T.navy},${T.navyLt})`, color:"#fff", fontSize:14, padding:"10px 20px" },
  btnLink: { background:"none", border:"none", color:T.textDim, cursor:"pointer", marginTop:16, fontSize:14 },

  pageWrap: { maxWidth:1400, margin:"0 auto", padding:"0 0 120px" },
  pageHeader: { display:"flex", alignItems:"center", gap:12, padding:"12px 20px", background:`linear-gradient(90deg,${T.navyDk},${T.navy})`, borderBottom:`1px solid ${T.border}`, position:"sticky", top:0, zIndex:10, boxShadow:`0 2px 12px rgba(0,35,149,0.2)` },
  backBtn: { background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.3)", borderRadius:8, color:"#fff", cursor:"pointer", padding:"6px 12px", fontSize:18 },
  pageTitle: { flex:1, margin:0, fontSize:17, fontWeight:800, color:"#fff", letterSpacing:0.5 },
  badgePill: { padding:"5px 12px", borderRadius:20, border:"1px solid rgba(255,255,255,0.3)", fontSize:13, cursor:"pointer", color:"#fff", background:"rgba(255,255,255,0.15)" },
  staffBadge: { padding:"4px 12px", borderRadius:20, background:"rgba(237,41,57,0.2)", border:"1px solid rgba(237,41,57,0.5)", fontSize:12, color:"#ff8a8a" },

  noticeBar: { margin:"4px 20px 4px", padding:"8px 14px", background:`${T.navy}11`, border:`1px solid ${T.border}`, borderRadius:8, fontSize:12, color:T.navy, fontWeight:600 },

  section: { padding:"16px 20px" },
  label: { display:"block", fontSize:11, color:T.navy, textTransform:"uppercase", letterSpacing:1.5, marginBottom:8, fontWeight:700 },
  select: { width:"100%", background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 14px", color:T.text, fontSize:15, cursor:"pointer" },
  input: { width:"100%", background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:"12px 14px", color:T.text, fontSize:15, boxSizing:"border-box" },

  tabs: { display:"flex", padding:"0 20px", borderBottom:`2px solid ${T.border}` },
  tab: { flex:1, background:"none", border:"none", borderBottom:"3px solid transparent", padding:"12px", color:T.textDim, cursor:"pointer", fontSize:14, fontWeight:600, transition:"all 0.2s" },
  tabActive: { color:T.navy, borderBottomColor:T.navy },
  modeTabs: { display:"flex", gap:8, padding:"12px 20px" },
  modeTab: { flex:1, background:T.surface2, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px", color:T.textDim, cursor:"pointer", fontSize:13, fontWeight:600 },
  modeTabActive: { background:T.navy, border:`1px solid ${T.navy}`, color:"#fff" },

  weekNav: { display:"flex", alignItems:"center", justifyContent:"center", gap:20, padding:"12px 20px" },
  weekBtn: { background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, color:T.navy, cursor:"pointer", padding:"6px 14px", fontSize:18, boxShadow:"0 1px 4px rgba(0,35,149,0.1)" },
  weekLabel: { fontSize:14, fontWeight:600, color:T.textMid, minWidth:220, textAlign:"center" },

  gridSection: { padding:"0 12px" },
  practList: { display:"flex", gap:10, overflowX:"auto", paddingBottom:12, marginBottom:8 },
  practBtn: { display:"flex", alignItems:"center", gap:10, background:T.surface, border:`2px solid ${T.border}`, borderRadius:12, padding:"8px 16px", cursor:"pointer", color:T.text, fontSize:14, fontWeight:600, whiteSpace:"nowrap", transition:"all 0.2s" },
  practAvatar: { width:36, height:36, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, color:"#fff" },
  practDot: { width:10, height:10, borderRadius:"50%", flexShrink:0 },

  calendarWrap: { overflowX:"auto", borderRadius:12, border:`1px solid ${T.border}`, margin:"0 12px", boxShadow:"0 2px 12px rgba(0,35,149,0.08)" },
  calGrid: { display:"grid", minWidth:300 },
  timeColHead: { background:T.surface3, borderBottom:`1px solid ${T.border}`, borderRight:`1px solid ${T.border}`, height:56 },
  dayHead: { background:T.surface3, borderBottom:`2px solid ${T.border}`, borderRight:`1px solid ${T.border}`, padding:"8px 6px", textAlign:"center", position:"relative" },
  dayHeadWE: { background:"#f5e8ec" },
  dayHeadToday: { background:`${T.navy}18`, borderBottom:`3px solid ${T.navy}` },
  todayDot: { width:6, height:6, borderRadius:"50%", background:T.navy, margin:"2px auto 0" },
  dayName: { fontSize:12, fontWeight:700, color:T.textMid, textTransform:"capitalize" },
  timeCell: { background:T.surface2, borderBottom:`1px solid ${T.border2}`, borderRight:`1px solid ${T.border}`, padding:"4px 8px", fontSize:11, color:T.textDim, display:"flex", alignItems:"center", justifyContent:"flex-end", height:56 },
  timeCellHalf: { height:28, fontSize:10, color:"#e05090", background:"#fce8f3" },
  slotCell: { height:56, borderBottom:`1px solid ${T.border2}`, borderRight:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, transition:"background 0.1s", overflow:"hidden", padding:"0 6px", background:T.surface },

  bySlotCell: { height:56, borderBottom:`1px solid ${T.border2}`, borderRight:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", gap:4, padding:"4px", flexWrap:"wrap", background:T.surface },
  miniPractBtn: { width:22, height:22, borderRadius:6, fontSize:9, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"#fff", transition:"all 0.15s" },

  practLegend: { display:"flex", gap:12, flexWrap:"wrap", padding:"10px 0", marginTop:6 },
  legendItem: { display:"flex", alignItems:"center", gap:6, fontSize:12, color:T.textDim },

  confirmBar: { position:"fixed", bottom:0, left:0, right:0, background:`linear-gradient(90deg,${T.navyDk},${T.navy})`, borderTop:`3px solid ${T.goldBright}`, padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, zIndex:20 },
  confirmWrap: { minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24 },
  confirmCard: { background:T.surface, border:`1px solid ${T.border}`, borderRadius:20, padding:"40px 32px", textAlign:"center", maxWidth:440, width:"100%", boxShadow:"0 8px 40px rgba(0,35,149,0.15)" },
  confirmTitle: { fontSize:24, fontWeight:800, margin:"16px 0 24px", color:T.navy },
  confirmDetail: { background:T.surface2, borderRadius:12, padding:20, textAlign:"left", display:"flex", flexDirection:"column", gap:12 },
  confirmRow: { display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:14, color:T.textDim },

  myBookingsPanel: { margin:"0 20px 8px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:16, boxShadow:"0 2px 8px rgba(0,35,149,0.08)" },
  myBookingsTitle: { margin:"0 0 10px", color:T.navy, fontSize:13, textTransform:"uppercase", letterSpacing:1, fontWeight:700 },
  myBookingRow: { display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderBottom:`1px solid ${T.border2}`, fontSize:14 },
  cancelBtn: { background:"none", border:`1px solid ${T.red}`, borderRadius:6, color:T.red, cursor:"pointer", padding:"4px 10px", fontSize:12 },
  emptyHint: { padding:"40px 20px", textAlign:"center", color:T.textDim, fontSize:14 },

  practTabs: { display:"flex", gap:8, overflowX:"auto", padding:"16px 20px" },
  practTabBtn: { display:"flex", alignItems:"center", gap:8, background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:"10px 14px", cursor:"pointer", color:T.textDim, fontSize:13, whiteSpace:"nowrap", transition:"all 0.2s", boxShadow:"0 1px 4px rgba(0,35,149,0.08)" },

  staffActions: { display:"flex", gap:6, padding:"0 20px 8px", flexWrap:"wrap" },
  staffActBtn: { background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, color:T.textMid, cursor:"pointer", padding:"7px 12px", fontSize:12, fontWeight:600, transition:"all 0.15s", boxShadow:"0 1px 3px rgba(0,35,149,0.08)" },
  staffActBtnHistory: { background:T.surface, border:`1px solid ${T.border}`, color:T.textDim, borderRadius:8, padding:"6px 12px", fontSize:13 },

  addPlayerPanel: { margin:"0 20px 12px", background:"#fffbe8", border:`1px solid ${T.goldBright}88`, borderRadius:12, padding:16 },

  staffCell: { height:56, borderBottom:`1px solid ${T.border2}`, borderRight:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, transition:"background 0.1s", overflow:"hidden", padding:"0 6px", background:T.surface },
  staffBookingContent: { display:"flex", alignItems:"center", gap:3, width:"100%" },
  deleteBtn: { background:"none", border:"none", color:T.red, cursor:"pointer", fontSize:11, padding:"2px", marginLeft:"auto", flexShrink:0 },

  staffLegend: { display:"flex", gap:8, flexWrap:"wrap", padding:"10px 20px", fontSize:11, color:T.textDim },
  legendBadge: { background:T.surface2, padding:"3px 8px", borderRadius:6, border:`1px solid ${T.border}`, color:T.textMid },

  histMonthHeader: { fontSize:13, fontWeight:700, color:T.navy, textTransform:"capitalize", padding:"10px 0 6px", borderBottom:`2px solid ${T.border}`, marginBottom:6 },
  histRow: { display:"flex", alignItems:"flex-start", gap:10, padding:"10px 0", borderBottom:`1px solid ${T.border2}`, fontSize:14 },

  daySelectorRow: { display:"flex", alignItems:"center", gap:6, padding:"12px 20px", overflowX:"auto" },
  daySelectBtn: { flex:"0 0 auto", minWidth:52, background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, color:T.textMid, cursor:"pointer", padding:"8px 10px", textAlign:"center", transition:"all 0.15s", boxShadow:"0 1px 3px rgba(0,35,149,0.08)" },

  playerDayNav: { display:"flex", alignItems:"center", gap:8, padding:"12px 16px" },
  playerDayBtn: { background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, color:T.navy, cursor:"pointer", padding:"8px 14px", fontSize:20, fontWeight:700, flexShrink:0, boxShadow:"0 1px 4px rgba(0,35,149,0.1)" },

  modalOverlay: { position:"fixed", inset:0, background:"rgba(0,10,50,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:50, padding:20 },
  modalCard: { background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, padding:24, width:"100%", maxWidth:440, boxShadow:"0 20px 60px rgba(0,35,149,0.2)" },
  modalActionBtn: { display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:10, cursor:"pointer", border:`1px solid ${T.border}`, background:T.surface2, fontSize:14, fontWeight:600, width:"100%", marginBottom:0, color:T.text },
};

const globalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; background: #f0f4ff; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: #e8edf8; }
  ::-webkit-scrollbar-thumb { background: rgba(0,35,149,0.25); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0,35,149,0.45); }
  select option { background: #ffffff; color: #0a1440; }
  button:hover { opacity: 0.88; }
  button:disabled { opacity: 0.35 !important; cursor: default !important; }
`;
