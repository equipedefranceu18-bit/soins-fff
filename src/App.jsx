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
const STRAP_COLOR = "#ff7043"; // Orange unique straps
const STRAP_ID = "strap";    // pract_id virtuel en Supabase
const BOOKING_ADVANCE_HOURS = 24;
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

// Slot bookable only in the 24h window before it
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
  const [strapSlots, setStrapSlots] = useState({}); // { "date|time": true }
  const [scheduleBlocks, setScheduleBlocks] = useState([]); // [{id, date, time_start, time_end, label, color}]
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
      const om={}; (o.data||[]).forEach(x=>{om[`${x.pract_id}|${x.date}|${x.time}`]=x.duration||30;});
      const cm={}; (c.data||[]).forEach(x=>{cm[`${x.pract_id}|${x.date}|${x.time}`]=true;});
      const rm={}; (r.data||[]).forEach(x=>{rm[`${x.pract_id}|dow${x.dow}|${x.time}`]=true;});
      const sm={}; (s.data||[]).forEach(x=>{sm[`${x.pract_id}|${x.date}|${x.base_time}`]=true;});
      const bm={}; const stm={};
      (b.data||[]).forEach(x => {
        if (x.pract_id && x.pract_id.startsWith(STRAP_ID+"_")) {
          stm[`${x.pract_id}|${x.date}|${x.time}`] = { player: x.player || "", locked: x.locked };
        } else {
          bm[`${x.pract_id}|${x.date}|${x.time}`] = {player:x.player,locked:x.locked,note:x.note||"",duration:x.duration||60,cancelled:x.cancelled||false};
        }
      });
      const sb = await supabase.from("schedule_blocks").select("*");
      setOpen(om); setClosed(cm); setRecurring(rm); setSplitSlots(sm); setBookings(bm); setStrapSlots(stm);
      setScheduleBlocks(sb.data||[]);
      setDbReady(true);
    } catch(e) { console.warn("Supabase:",e.message); setDbReady(true); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Actualisation automatique toutes les 30 secondes
  useEffect(() => {
    const interval = setInterval(() => { loadAll(); }, 30000);
    return () => clearInterval(interval);
  }, [loadAll]);

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
    if (splitSlots[splitKey(practId, date, baseTime)]) return true;
    // Also consider split if the :30 half-slot is directly open or booked
    const half = `${baseTime.split(":")[0].padStart(2,"0")}:30`;
    return isSlotOpen(practId, date, half) || !!bookings[slotKey(practId, date, half)];
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


  // ── Schedule blocks actions ────────────────────────────────────────────────
  async function addScheduleBlock(date, time_start, time_end, label, color="#6c757d") {
    await supabase.from("schedule_blocks").insert({ date, time_start, time_end, label, color });
    await loadAll();
  }
  async function deleteScheduleBlock(id) {
    await supabase.from("schedule_blocks").delete().eq("id", id);
    await loadAll();
  }

  // ── Strap actions ─────────────────────────────────────────────────────────
  // Strap par kiné : pract_id = "strap_k1", "strap_k2", etc.
  function strapPractId(kineId) { return STRAP_ID + "_" + kineId; }

  async function toggleStrap(kineId, date, time) {
    const practId = strapPractId(kineId);
    const key = `${practId}|${date}|${time}`;
    const s = strapSlots[key];
    if (s) {
      await supabase.from("bookings").delete().match({ pract_id: practId, date, time });
    } else {
      await supabase.from("bookings").upsert({ pract_id: practId, date, time, player: "", locked: false, note: "", duration: 30 }, {onConflict:"pract_id,date,time"});
    }
    await loadAll();
  }

  async function bookStrap(kineId, date, time, player) {
    const practId = strapPractId(kineId);
    const key = `${practId}|${date}|${time}`;
    const s = strapSlots[key];
    if (!s) return;
    if (s.player && s.player !== "") return;
    await supabase.from("bookings")
      .update({ player, locked: false })
      .eq("pract_id", practId).eq("date", date).eq("time", time);
    await loadAll();
  }

  function isStrapAvailable(kineId, date, time) {
    const key = `${strapPractId(kineId)}|${date}|${time}`;
    const s = strapSlots[key];
    if (!s || (s.player && s.player !== "")) return false;
    return isWithinBookingWindow(date, time);
  }

  function getAvailableStraps(date, time) {
    // Retourne la liste des kineIds qui ont un strap disponible (ouvert et non réservé)
    return kines.filter(k => {
      const key = `${strapPractId(k.id)}|${date}|${time}`;
      const s = strapSlots[key];
      return s && !s.player && isWithinBookingWindow(date, time);
    });
  }

  function getOpenStraps(date, time) {
    // Tous les straps ouverts (réservés ou non) pour ce créneau
    return kines.filter(k => {
      const key = `${strapPractId(k.id)}|${date}|${time}`;
      return !!strapSlots[key];
    });
  }

  // Build the time slots for a given pract+date context
  function getSlotsForContext(practId, date) {
    const result = [];
    for (const base of BASE_SLOTS) {
      const half = `${base.split(":")[0].padStart(2,"0")}:30`;
      const hasSplit = splitSlots[splitKey(practId, date, base)];
      const baseOpen = isSlotOpen(practId, date, base) || !!getBooking(practId, date, base);
      const halfOpen = isSlotOpen(practId, date, half) || !!getBooking(practId, date, half);
      
      if (baseOpen) result.push(base);
      if (hasSplit || halfOpen) result.push(half);
    }
    return result;
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
  function getSlotDuration(practId, date, time) {
    const sk = slotKey(practId, date, time);
    return open[sk] || 30; // duration stockée dans open (30 ou 60)
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
  async function toggleOpen(practId, date, time, duration=30) {
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
      await supabase.from("open_slots").upsert({pract_id:practId, date, time, duration});
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
    await supabase.from("bookings").upsert({pract_id:practId, date, time, player, locked:true, note:"", duration:is30?30:60}, {onConflict:"pract_id,date,time"});
    await loadAll();
  }

  async function unbook(practId, date, time) {
    const date_ = slotKey(practId, date, time).split("|")[1];
    if (isPast(date_)) return;
    await supabase.from("bookings").delete().match({pract_id:practId, date, time});
    await loadAll();
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
    await supabase.from("bookings").upsert({pract_id:toPractId, date, time, player:bk.player, locked:bk.locked, note:bk.note, duration:bk.duration}, {onConflict:"pract_id,date,time"});
    await loadAll();
  }

  // ── player booking ────────────────────────────────────────────────────────────
  async function confirmBooking() {
    if (!playerName.trim() || !selectedPract || !selectedDate || !selectedTime) return;
    if (selectedPract && selectedPract.startsWith(STRAP_ID + '_')) {
      const kineId = selectedPract.replace(STRAP_ID + '_', '');
      await bookStrap(kineId, selectedDate, selectedTime, playerName.trim());
      setConfirmation({ pract: { name:"Strap", color:STRAP_COLOR, initials:"🩹" }, date:selectedDate, time:selectedTime, player:playerName, duration:30 });
      setSelectedPract(null); setSelectedDate(null); setSelectedTime(null);
      return;
    }
    const slotDur = getSlotDuration(selectedPract, selectedDate, selectedTime);
    const is30 = slotDur === 30 || selectedTime.endsWith(":30") || isSplit(selectedPract, selectedDate, selectedTime);
    await supabase.from("bookings").upsert({pract_id:selectedPract, date:selectedDate, time:selectedTime, player:playerName.trim(), locked:false, note:"", duration:is30?30:60}, {onConflict:"pract_id,date,time"});
    await loadAll();
    const p = PRACTITIONERS.find(x => x.id === selectedPract);
    if (!p) return; // sécurité
    setConfirmation({ pract: p, date: selectedDate, time: selectedTime, player: playerName, duration: is30 ? 30 : 60 });
    setSelectedPract(null); setSelectedDate(null); setSelectedTime(null);
  }

  async function cancelMyBooking(practId, date, time) {
    if (practId?.startsWith("strap_")) {
      await supabase.from("bookings").update({ player:"", locked:false }).eq("pract_id",practId).eq("date",date).eq("time",time);
      await loadAll();
      return;
    }
    const b = getBooking(practId, date, time);
    if (b && !b.locked && b.player === playerName && !isPast(date)) {
      // Marquer comme annulé (garde la trace) plutôt que supprimer
      // Garder la trace (cancelled=true) mais libérer le créneau (player=null)
      const bk = getBooking(practId, date, time);
      const cancelledPlayer = bk?.player || playerName;
      await supabase.from("bookings").update({ cancelled: true, player: "", note: (bk?.note||"") + (bk?.note ? " | " : "") + "Annulé par: "+cancelledPlayer }).eq("pract_id",practId).eq("date",date).eq("time",time);
      await loadAll();
    }
  }

  function myBookings() {
    if (!playerName) return [];
    const regular = Object.entries(bookings)
      .filter(([,v]) => v.player === playerName && !v.cancelled)
      .map(([k,v]) => { const [pId,date,time] = k.split("|"); return { pId,date,time,locked:v.locked }; });
    const straps = Object.entries(strapSlots)
      .filter(([,v]) => v.player === playerName)
      .map(([k,v]) => { const [pId,date,time] = k.split("|"); return { pId,date,time,locked:false }; });
    return [...regular, ...straps].sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
  }

  // ── all past bookings (staff history) ────────────────────────────────────────
  function getPastBookings() {
    const today = todayStr();
    return Object.entries(bookings)
      .filter(([k,v]) => {
        const date = k.split("|")[1];
        return date < today || v.cancelled; // inclure les annulations futures
      })
      .filter(([,v]) => v.player || v.cancelled) // exclure les lignes vides non annulées
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
          confirmBooking={confirmBooking} bookings={bookings} getSlotDuration={getSlotDuration}
          confirmation={confirmation} setConfirmation={setConfirmation}
          myBookings={myBookings} cancelMyBooking={cancelMyBooking}
          strapSlots={strapSlots} bookStrap={bookStrap} isStrapAvailable={isStrapAvailable}
          scheduleBlocks={scheduleBlocks}
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
          loadAll={loadAll}
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
          getSlotDuration={getSlotDuration}
          bookings={bookings}
          strapSlots={strapSlots} toggleStrap={toggleStrap}
          scheduleBlocks={scheduleBlocks} addScheduleBlock={addScheduleBlock} deleteScheduleBlock={deleteScheduleBlock}
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
  isAvailable, getBooking, isSlotOpen, getSlotsForContext, isSplit, confirmBooking, bookings, getSlotDuration,
  confirmation, setConfirmation, myBookings, cancelMyBooking,
  strapSlots, bookStrap, isStrapAvailable,
  scheduleBlocks, setView
}) {
  // Tous les praticiens ensemble — kinés + ostéo dans la même vue
  const practitioners = [...kines, ...osteos];
  const [showMy, setShowMy] = useState(false);
  const [activeDay, setActiveDay] = useState(todayStr());
  const mb = myBookings();
  const future = mb.filter(b => b.date >= todayStr());
  const past_mb = mb.filter(b => b.date < todayStr());

  // Keep activeDay in sync when week changes
  const allDays = days;
  const activeDayObj = allDays.find(d => fmtDate(d) === activeDay) || allDays[0];
  const activeIdx = allDays.findIndex(d => fmtDate(d) === activeDay);

  function goDay(delta) {
    loadAll();
    const newIdx = activeIdx + delta;
    if (newIdx < 0) {
      setDayOffset(o => o - 7);
      setActiveDay(fmtDate(days[6]));
    } else if (newIdx >= 7) {
      setDayOffset(o => o + 7);
      setActiveDay(fmtDate(days[0]));
    } else {
      setActiveDay(fmtDate(allDays[newIdx]));
    }
    setSelectedDate(null); setSelectedTime(null); setSelectedPract(null);
  }

  const [doubleBookingAlert, setDoubleBookingAlert] = useState(null); // { date, existingPract }

  function handlePractSelect(id) {
    setSelectedPract(id === selectedPract ? null : id);
    setSelectedDate(null); setSelectedTime(null);
  }
  function handleSlotClick(pId, date, time) {
    if (!playerName.trim()) return;

    // Strap booking
    if (pId && pId.startsWith(STRAP_ID + '_')) {
      const kineId = pId.replace(STRAP_ID + '_', '');
      if (!isStrapAvailable(kineId, date, time)) return;
      if (selectedPract === pId && selectedDate === date && selectedTime === time) {
        setSelectedPract(null); setSelectedDate(null); setSelectedTime(null);
      } else {
        setSelectedPract(pId); setSelectedDate(date); setSelectedTime(time);
      }
      return;
    }

    if (!isAvailable(pId, date, time)) return;

    // Vérifier si le joueur a déjà un RDV ce jour-là
    const existing = mb.find(b => b.date === date);
    if (existing && !(existing.date === selectedDate && existing.pId === selectedPract)) {
      const existPract = PRACTITIONERS.find(x => x.id === existing.pId);
      setDoubleBookingAlert({ date, existingPract: existPract, existingTime: existing.time });
      return;
    }

    if (selectedDate===date && selectedTime===time && selectedPract===pId) {
      setSelectedDate(null); setSelectedTime(null); setSelectedPract(null);
    } else {
      setSelectedDate(date); setSelectedTime(time); setSelectedPract(pId);
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
      {/* Modal double réservation */}
      {doubleBookingAlert && (
        <div style={css.modalOverlay} onClick={() => setDoubleBookingAlert(null)}>
          <div style={{...css.modalCard, textAlign:"center", maxWidth:380}} onClick={e => e.stopPropagation()}>
            <div style={{fontSize:40, marginBottom:8}}>⚠️</div>
            <h3 style={{margin:"0 0 8px", fontSize:17, color:T.navy, fontWeight:800}}>
              Un seul RDV par jour
            </h3>
            <p style={{margin:"0 0 16px", fontSize:14, color:T.textDim, lineHeight:1.5}}>
              Tu as déjà un rendez-vous ce jour-là à <strong>{doubleBookingAlert.existingTime}</strong> avec{" "}
              <strong style={{color: doubleBookingAlert.existingPract?.color}}>
                {doubleBookingAlert.existingPract?.name}
              </strong>.
            </p>
            <p style={{margin:"0 0 20px", fontSize:13, color:T.textMid, background:T.surface2, borderRadius:10, padding:"10px 14px", lineHeight:1.6}}>
              Pour un deuxième soin, contacte directement ton kiné référent ou le staff médical.
            </p>
            <button style={{...css.btn, ...css.btnPlayer, width:"100%"}}
              onClick={() => setDoubleBookingAlert(null)}>
              Compris ✓
            </button>
          </div>
        </div>
      )}

      <div style={css.pageHeader}>
        <button style={css.backBtn} onClick={() => setView("home")}>←</button>
        <h2 style={css.pageTitle}>Réserver un soin</h2>
        <button style={css.backBtn} onClick={() => loadAll()} title="Actualiser">🔄</button>
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

      {/* Mode tabs supprimés — vue créneaux uniquement */}

      <div style={css.noticeBar}>
        🕐 Les créneaux ne sont réservables que dans les 24h qui précèdent le soin
      </div>

      {/* ── Single-day navigator ── */}
      <div style={css.playerDayNav}>
        <button style={css.playerDayBtn} onClick={() => goDay(-1)}>
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

      <BySlotGrid
          practitioners={practitioners} kines={kines} days={singleDay}
          selectedPract={selectedPract} selectedDate={selectedDate} selectedTime={selectedTime}
          isAvailable={isAvailable} isSlotOpen={isSlotOpen} getSlotsForContext={getSlotsForContext} isSplit={isSplit}
          onSlotClick={handleSlotClick} bookings={bookings} playerName={playerName} getBooking={getBooking}
          getSlotDuration={getSlotDuration}
          strapSlots={strapSlots} bookStrap={bookStrap} isStrapAvailable={isStrapAvailable}
          scheduleBlocks={scheduleBlocks}
        />

      {canConfirm && (
        <div style={css.confirmBar}>
          <div style={{fontSize:13}}>
            <div style={{opacity:0.9,color:"#fff"}}>
              <strong>{selectedPract?.startsWith(STRAP_ID+"_") ? "🩹 Strap" : PRACTITIONERS.find(x=>x.id===selectedPract)?.name}</strong>
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
  const p = PRACTITIONERS.find(x => x.id === b.pId) ||
    (b.pId?.startsWith("strap_") ? { id:b.pId, name:"Strap", color:STRAP_COLOR, initials:"🩹", role:"strap" } : null);
  if (!p) return null;
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

function BySlotGrid({ practitioners, kines, days, selectedPract, selectedDate, selectedTime,
  isAvailable, isSlotOpen, getSlotsForContext, isSplit, onSlotClick, bookings, playerName, getBooking, getSlotDuration,
  strapSlots, bookStrap, isStrapAvailable, scheduleBlocks }) {

  const ROW = 28; // hauteur d'une unité de 30 minutes en px
  const d = days.length === 1 ? fmtDate(days[0]) : null;
  if (!d) return null;
  const past = isPast(d);
  const osteos = practitioners.filter(p => p.role === "ostéo");
  const SEP = `2px solid ${T.navy}33`;

  // Tous les times ouverts, triés
  // + ajouter les time+30 pour chaque slot 1h (pour que le span=2 fonctionne même sans voisin)
  // Straps par kiné : "strap_k1|date|time" etc.
  const strapTimesForDay = strapSlots ? [...new Set(Object.keys(strapSlots)
    .filter(k => { const parts = k.split("|"); return parts[1] === d; })
    .map(k => k.split("|")[2]))] : [];
  // Toutes les plages 30' de 09:00 à 21:30 + straps
  const allHalfHours = [];
  for (let h = 9; h <= 21; h++) {
    allHalfHours.push(`${String(h).padStart(2,"0")}:00`);
    allHalfHours.push(`${String(h).padStart(2,"0")}:30`);
  }
  allHalfHours.push("22:00");
  const baseTimes = [...new Set([...allHalfHours, ...strapTimesForDay])].sort();

  if (baseTimes.length === 0) {
    return (
      <div style={css.gridSection}>
        <div style={css.emptyHint}>Aucun créneau disponible ce jour.</div>
      </div>
    );
  }

  function playerHasBookingAt(time) {
    if (!playerName) return false;
    return Object.entries(bookings).some(([k,v]) =>
      v.player === playerName && k.split("|")[1] === d && k.split("|")[2] === time
    );
  }

  // Convertir un time "HH:MM" en index de ligne (unités de 30 min depuis le premier slot)
  function timeToRow(time) {
    return baseTimes.indexOf(time);
  }

  // Nombre de lignes qu'occupe un slot selon sa durée
  // span=2 seulement si duration=60 ET la ligne baseTimes[idx+1] est bien exactement time+30min
  function slotRowSpan(practId, time) {
    const dur = getSlotDuration(practId, d, time);
    if (dur !== 60) return 1;
    const [h, m] = time.split(":").map(Number);
    let nh = h, nm = m + 30;
    if (nm >= 60) { nh++; nm = 0; }
    const next30 = `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`;
    const idx = timeToRow(time);
    if (idx >= 0 && baseTimes[idx + 1] === next30) return 2;
    return 1;
  }

  // Bandeaux planning pour ce jour
  const dayBlocks = (scheduleBlocks||[]).filter(b => b.date === d)
    .sort((a,b) => a.time_start.localeCompare(b.time_start));

  // Vérifie si un time est couvert par un bandeau
  function getBlockForTime(time) {
    return dayBlocks.find(b => time >= b.time_start.slice(0,5) && time < b.time_end.slice(0,5));
  }



  // Bouton individuel — positionné en grid row
  function Btn({ p, time }) {
    const _bk = getBooking(p.id, d, time);
    const booked = !!_bk && !!_bk.player && !_bk.cancelled;
    const open   = isSlotOpen(p.id, d, time);
    // Strap pour ce kiné spécifique
    const strapKey = `${STRAP_ID}_${p.id}|${d}|${time}`;
    const hasStrap = !!(strapSlots && strapSlots[strapKey]);

    // Si strap actif ET slot pas réservé par un joueur kiné → afficher bouton orange Strap
    if (hasStrap && !booked && !open) {
      const s = strapSlots[strapKey];
      const strapBooked = !!(s && s.player);
      const strapAvail = isStrapAvailable(p.id, d, time);
      const strapPId = STRAP_ID + "_" + p.id;
      const sel = selectedPract === strapPId && selectedDate === d && selectedTime === time;
      const rowIdx = timeToRow(time);
      if (rowIdx < 0) return null;
      return (
        <div key={`${p.id}-strap-${time}`} style={{
          gridRow: `${rowIdx + 1} / span 1`,
          display:"flex", alignItems:"center", justifyContent:"center", padding:"2px",
        }}>
          <button style={{
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
            height:ROW-6, width:"100%", minWidth:42, padding:"0 4px",
            background: strapBooked ? "#ebebeb" : sel ? STRAP_COLOR : STRAP_COLOR+"25",
            border:`2px solid ${strapBooked ? "#ccc" : STRAP_COLOR}`,
            borderRadius:10, cursor: strapBooked||!strapAvail ? "not-allowed" : "pointer",
            transition:"all 0.15s",
          }}
            onClick={() => strapAvail && !strapBooked && onSlotClick(STRAP_ID + '_' + p.id, d, time)}
            title={strapBooked ? "Strap complet" : !strapAvail ? "Pas encore réservable" : "Strap — 30 min"}>
            <span style={{fontSize:9,fontWeight:800,color:strapBooked?"#bbb":sel?"#fff":STRAP_COLOR}}>🩹 Strap</span>
            <span style={{fontSize:7,color:strapBooked?"#ccc":sel?"rgba(255,255,255,0.85)":STRAP_COLOR+"99",fontWeight:600}}>30'</span>
          </button>
        </div>
      );
    }

    if (!booked && !open) return null;

    const avail   = isAvailable(p.id, d, time);
    const sel     = selectedPract===p.id && selectedDate===d && selectedTime===time;
    const blocked = !booked && playerHasBookingAt(time);
    const span    = slotRowSpan(p.id, time);
    const label   = span === 2 ? "1h" : "30'";
    const rowIdx  = timeToRow(time);
    const h       = span * ROW - 6;

    let bg, border, textColor, cursor;
    if (booked)               { bg="#ebebeb"; border="#ccc";    textColor="#bbb"; cursor="not-allowed"; }
    else if (blocked||!avail) { bg="#f5f5f5"; border="#ddd";    textColor="#ccc"; cursor="not-allowed"; }
    else if (sel)             { bg=p.color;   border=p.color;   textColor="#fff"; cursor="pointer"; }
    else                      { bg=p.color+"25"; border=p.color; textColor=p.color; cursor="pointer"; }

    return (
      <div key={`${p.id}-${time}`} style={{
        gridRow: `${rowIdx + 1} / span ${span}`,
        display:"flex", alignItems:"center", justifyContent:"center",
        padding:"2px 2px", position:"relative",
      }}>
        <button style={{
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          height:h, width:"100%", minWidth:42, padding:"0 4px",
          background:bg, border:`2px solid ${border}`, borderRadius:10,
          cursor, gap:1, boxShadow:sel?`0 2px 10px ${p.color}55`:"none",
          transition:"all 0.15s",
        }}
          onClick={()=>(avail&&!blocked&&!booked)&&onSlotClick(p.id,d,time)}
          title={booked?"Réservé":blocked?"Déjà un RDV à cette heure":`${p.name} — ${label==="1h"?"1 heure":"30 min"}`}>
          <span style={{fontSize:13,fontWeight:800,color:textColor}}>{p.initials}</span>
          <span style={{fontSize:8,color:sel?"rgba(255,255,255,0.85)":booked?"#ccc":p.color+"99",fontWeight:700}}>
            {label}
          </span>
        </button>

      </div>
    );
  }

  const nRows = baseTimes.length;
  // gridTemplateRows: une ligne par time dans baseTimes
  const gridRows = baseTimes.map(() => `${ROW}px`).join(" ");

  // Axe temps : même CSS grid que les colonnes pour alignement parfait
  const timeAxis = (
    <div style={{
      width:64, flexShrink:0,
      display:"grid",
      gridTemplateRows: gridRows,
      borderRight:`1px solid ${T.border}`,
    }}>
      {baseTimes.map((time, i) => {
        const isHour = time.endsWith(":00");
        const block = getBlockForTime(time);
        return (
          <div key={time} style={{
            gridRow: i+1,
            background: block ? block.color+"25" : isHour ? T.surface2 : T.surface3,
            borderBottom: isHour ? `2px solid ${block ? block.color+"44" : T.border}` : `1px solid ${T.border2}`,
            borderLeft: block ? `3px solid ${block.color}` : "none",
            display:"flex", flexDirection:"column", alignItems:"flex-end", justifyContent:"center",
            padding:"0 4px", overflow:"hidden",
          }}>
            <div style={{fontSize: isHour?11:9, fontWeight:isHour?700:400, color: block ? block.color : isHour?T.textMid:T.textDim, lineHeight:1.2}}>
              {time}
            </div>

          </div>
        );
      })}
    </div>
  );

  // Colonne kiné : CSS grid avec positionnement par row
  function KineColumn({ p }) {
    const slots = getSlotsForContext(p.id, d).filter(t => baseTimes.includes(t));
    // Filtrer les slots qui sont couverts par un slot 1h précédent
    // On ne couvre que le time exactement 30 min après (pas juste le suivant dans baseTimes)
    const covered = new Set();
    for (const time of slots) {
      const span = slotRowSpan(p.id, time);
      if (span === 2) {
        const [h, m] = time.split(":").map(Number);
        let nh = h, nm = m + 30;
        if (nm >= 60) { nh++; nm = 0; }
        const next30 = `${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`;
        covered.add(next30);
      }
    }
    const visibleSlots = slots.filter(t => !covered.has(t));
    // Straps pour CE kiné spécifiquement
    const myStrapTimes = strapSlots ? Object.keys(strapSlots)
      .filter(k => { const parts = k.split("|"); return parts[0] === STRAP_ID+"_"+p.id && parts[1] === d; })
      .map(k => k.split("|")[2]) : [];
    const allVisibleTimes = [...new Set([...visibleSlots, ...myStrapTimes])].sort();

    return (
      <div style={{
        display:"grid",
        gridTemplateRows: gridRows,
        flex:1, minWidth:52,
        borderRight:`1px solid ${T.border}`,
      }}>
        {/* Lignes de fond (séparateurs) */}
        {baseTimes.map((time, i) => {
          const block = getBlockForTime(time);
          return (
            <div key={`bg-${time}`} style={{
              gridRow: i+1,
              gridColumn: 1,
              borderBottom: time.endsWith(":00") ? `2px solid ${block ? block.color+"33" : T.border}` : `1px solid ${T.border2}`,
              background: time.endsWith(":00") ? T.surface : T.surface3+"88",
              opacity: past ? 0.45 : 1,
              position:"relative",
            }}>
            </div>
          );
        })}
        {/* Boutons de slots (kinés + straps) */}
        {allVisibleTimes.map(time => (
          <Btn key={time} p={p} time={time} />
        ))}
      </div>
    );
  }

  function OsteoColumn({ p }) {
    const slots = getSlotsForContext(p.id, d).filter(t => baseTimes.includes(t));
    const covered = new Set();
    for (const time of slots) {
      const span = slotRowSpan(p.id, time);
      if (span === 2) {
        const [h, m] = time.split(":").map(Number);
        let nh = h, nm = m + 30;
        if (nm >= 60) { nh++; nm = 0; }
        covered.add(`${String(nh).padStart(2,"0")}:${String(nm).padStart(2,"0")}`);
      }
    }
    const visibleSlots = slots.filter(t => !covered.has(t));
    return (
      <div style={{
        display:"grid",
        gridTemplateRows: gridRows,
        flex:1, minWidth:52,
        borderRight:`1px solid ${T.border}`,
        background:"#faf5ff",
      }}>
        {baseTimes.map((time, i) => (
          <div key={`bg-${time}`} style={{
            gridRow: i+1,
            gridColumn: 1,
            borderBottom: time.endsWith(":00") ? `2px solid ${T.border}` : `1px solid ${T.border2}`,
            background: time.endsWith(":00") ? "#faf5ff" : "#f5eeff88",
            opacity: past ? 0.45 : 1,
          }} />
        ))}
        {visibleSlots.map(time => (
          <Btn key={time} p={p} time={time} />
        ))}
      </div>
    );
  }

  const header = (
    <div style={{display:"flex", height:48, background:T.surface3, borderBottom:`2px solid ${T.border}`}}>
      <div style={{width:64, flexShrink:0, borderRight:`1px solid ${T.border}`}} />
      <div style={{flex:4, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        borderRight:SEP, background:d===todayStr()?T.navy+"14":T.surface3}}>
        <span style={{fontSize:12, fontWeight:700, color:T.textMid}}>💆 Kinésithérapie</span>
        <span style={{fontSize:10, color:T.textDim}}>{kines.map(k=>k.name).join(" · ")}</span>
      </div>
      <div style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"#f5eeff"}}>
        <span style={{fontSize:12, fontWeight:700, color:"#9c27b0"}}>🦴 Ostéo</span>
        <span style={{fontSize:10, color:T.textDim}}>Jean-Yves</span>
      </div>
    </div>
  );

  return (
    <div style={css.gridSection}>
      <div style={{...css.calendarWrap, overflow:"hidden"}}>
        {header}
        <div style={{display:"flex", position:"relative"}}>
          {timeAxis}
          <div style={{flex:4, display:"flex", borderRight:SEP}}>
            {kines.map(p => <KineColumn key={p.id} p={p} />)}
          </div>
          <div style={{flex:1, display:"flex"}}>
            {osteos.map(p => <OsteoColumn key={p.id} p={p} />)}
          </div>
          {/* Bandeaux planning overlay */}
          <div style={{position:"absolute", top:0, bottom:0, left:64, right:0, pointerEvents:"none", zIndex:2}}>
            {dayBlocks.map(block => {
              const startIdx = baseTimes.indexOf(block.time_start.slice(0,5));
              const endIdx = baseTimes.indexOf(block.time_end.slice(0,5));
              if (startIdx < 0) return null;
              const ROW_H = ROW;
              const top = startIdx * ROW_H;
              const height = endIdx >= 0 ? (endIdx - startIdx) * ROW_H : ROW_H;
              return (
                <div key={block.id} style={{
                  position:"absolute", left:0, right:0,
                  top, height,
                  background: block.color+"33",
                  borderTop: `3px solid ${block.color}`,
                  borderBottom: `2px solid ${block.color}55`,
                  display:"flex", alignItems:"center", paddingLeft:12,
                  pointerEvents:"none",
                }}>
                  <span style={{
                    fontSize:12, fontWeight:800, color:block.color,
                    background: block.color+"22", borderRadius:6,
                    padding:"3px 10px", border:`1px solid ${block.color}55`,
                    boxShadow:`0 1px 4px ${block.color}33`,
                  }}>{block.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={css.practLegend}>
        {practitioners.map(p=>(
          <div key={p.id} style={css.legendItem}>
            <div style={{...css.practDot,background:p.color}}/>{p.name}
            {p.role==="ostéo"&&<span style={{fontSize:10,color:T.textDim,marginLeft:2}}>(ostéo)</span>}
          </div>
        ))}
        <div style={css.legendItem}>
          <div style={{...css.practDot, background:STRAP_COLOR}}/>Strap (30')
        </div>
      </div>
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
        title="Pas encore dans la fenêtre de 24h">
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
      <button style={css.weekBtn} onClick={()=>setDayOffset(o=>o-7)}>
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

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
function StaffView({ loadAll, practitioners, days, dayOffset, setDayOffset, staffPract, setStaffPract,
  getBooking, isSlotOpen, isRecurring, toggleOpen, toggleRecurring,
  unbook, staffBookSlot, addNote, moveBooking, staffTarget, setStaffTarget,
  staffPlayerName, setStaffPlayerName,
  getSlotsForContext, isSplit, toggleSplit, BASE_SLOTS, isHalfSlot,
  getPastBookings, getSlotDuration, bookings, strapSlots, toggleStrap,
  scheduleBlocks, addScheduleBlock, deleteScheduleBlock, PLAYERS, setView }) {

  const [dvSubMode, setDvSubMode] = useState("slots");
  const [showStats, setShowStats] = useState(false);
  const [staffViewDay, setStaffViewDay] = useState(todayStr());
  const [noteModal,    setNoteModal]    = useState(null);
  const [moveModal,    setMoveModal]    = useState(null); // { practId, date, time, booking }
  const [histFilter,   setHistFilter]   = useState("");

  const kines4 = practitioners; // tous les praticiens : 4 kinés + ostéo
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
    { key:"straps",    label:"🩹 Straps",          color:"#ff7043", hint:"Cliquez sur un créneau pour ouvrir/fermer un strap de 30 min. Couleur orange unique." },
    { key:"history",   label:"🗂 Historique",     color:"#8b949e", hint:"Consultez tous les soins passés." },
  ];
  const currentMode = subModes.find(m => m.key === dvSubMode);

  return (
    <div style={css.pageWrap}>
      <div style={css.pageHeader}>
        <button style={css.backBtn} onClick={()=>setView("home")}>←</button>
        <h2 style={css.pageTitle}>Gestion — Vue du jour</h2>
        <button style={css.backBtn} onClick={()=>loadAll()} title="Actualiser">🔄</button>
        <div style={css.staffBadge}>Staff ✓</div>
      </div>

      {/* Stats modal */}
      {showStats && (
        <StatsModal onClose={()=>setShowStats(false)} bookings={bookings} practitioners={practitioners} />
      )}

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
        <button style={css.weekBtn} onClick={()=>setDayOffset(o=>o-7)}>‹</button>
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
        <button style={{
          background: dvSubMode==="planning" ? "#20c997" : "#e0fff5",
          border:"3px solid #20c997", color: dvSubMode==="planning" ? "#fff" : "#157a6e",
          fontWeight:800, fontSize:13, padding:"8px 14px", borderRadius:10,
          cursor:"pointer", whiteSpace:"nowrap",
        }}
          onClick={()=>{ setDvSubMode(dvSubMode==="planning"?"slots":"planning"); setStaffTarget(null); }}>
          🏃 Planning
        </button>
        <button style={{...css.staffActBtn, background:"#f0f4ff", border:`1px solid ${T.navy}44`, color:T.navy}}
          onClick={()=>setShowStats(true)}>
          📊 Stats
        </button>
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
                  const p = PRACTITIONERS.find(x=>x.id===b.pId) ||
                    (b.pId?.startsWith("strap_") ? {id:b.pId,name:"Strap",color:STRAP_COLOR,initials:"🩹"} : null);
                  if (!p) return null;
                  return (
                    <div key={i} style={{...css.histRow, opacity: b.cancelled ? 0.6 : 1, background: b.cancelled ? "#fff5f5" : "transparent"}}>
                      <div style={{...css.practDot,background:b.cancelled?"#ccc":p.color,flexShrink:0}} />
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <strong style={{textDecoration:b.cancelled?"line-through":"none"}}>{b.player}</strong>
                          {b.cancelled && <span style={{fontSize:10,color:"#e53935",fontWeight:700}}>❌ Annulé</span>}
                          {b.locked && !b.cancelled && <span style={{fontSize:10,opacity:0.4}}>🔒 staff</span>}
                        </div>
                        <div style={{fontSize:12,color:"#8b949e"}}>
                          {fmtLong(b.date)} · {b.time} · <span style={{color:p.color}}>{p.name}</span>
                        </div>
                        {b.note && (
                          <div style={{fontSize:12,color:"#c9d1d9",marginTop:4,padding:"4px 8px",background:"#21262d",borderRadius:6,borderLeft:`2px solid ${p.color}55`}}>
                            💬 {noteToDisplay(b.note)}
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

      {/* ── PLANNING MODE ── */}
      {dvSubMode === "planning" && (
        <PlanningEditor
          date={dvDate}
          scheduleBlocks={scheduleBlocks}
          addScheduleBlock={addScheduleBlock}
          deleteScheduleBlock={deleteScheduleBlock}
        />
      )}

      {/* ── CALENDAR MODES ── */}
      {dvSubMode !== "history" && dvSubMode !== "planning" && (
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
            getSlotDuration={getSlotDuration}
            toggleOpen={toggleOpen}
            strapSlots={strapSlots}
            toggleStrap={toggleStrap}
            scheduleBlocks={scheduleBlocks}
            onCellClick={(practId, date, time, duration) => {
              if (dvSubMode === "straps") {
                const p = practitioners.find(x => x.id === practId);
                if (p && p.role === "kiné") toggleStrap(practId, date, time);
                return;
              }
              const booking = getBooking(practId, date, time);
              if (booking) {
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
                toggleOpen(practId, date, time, duration||30);
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
            <span style={{...css.legendBadge,color:STRAP_COLOR,border:`1px solid ${STRAP_COLOR}44`}}>🩹 Strap (30')</span>
            <span style={{...css.legendBadge,color:STRAP_COLOR,border:`1px solid ${STRAP_COLOR}44`}}>🩹 Strap (30')</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Planning Editor (staff) ─────────────────────────────────────────────────
const BLOCK_PRESETS = [
  { label: "🏃 Entraînement", color: "#2d6a4f" },
  { label: "🍽 Repas",         color: "#e07b00" },
  { label: "🛌 Récupération",  color: "#5b4fcf" },
  { label: "🚌 Déplacement",   color: "#1565c0" },
  { label: "📋 Réunion",       color: "#b00020" },
];

function PlanningEditor({ date, scheduleBlocks, addScheduleBlock, deleteScheduleBlock }) {
  const [label, setLabel]       = useState(BLOCK_PRESETS[0].label);
  const [color, setColor]       = useState(BLOCK_PRESETS[0].color);
  const [customLabel, setCustomLabel] = useState("");
  const [timeStart, setTimeStart] = useState("09:00");
  const [timeEnd,   setTimeEnd]   = useState("10:00");
  const [useCustom, setUseCustom] = useState(false);

  const dayBlocks = scheduleBlocks
    .filter(b => b.date === date)
    .sort((a,b) => a.time_start.localeCompare(b.time_start));

  const finalLabel = useCustom ? customLabel : label;
  const finalColor = useCustom ? "#6c757d" : color;

  function handlePreset(preset) {
    setLabel(preset.label);
    setColor(preset.color);
    setUseCustom(false);
  }

  return (
    <div style={{padding:"0 20px 24px"}}>
      <div style={{background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:16, marginBottom:16, boxShadow:"0 2px 8px rgba(0,35,149,0.06)"}}>
        <div style={{...css.label, marginBottom:10}}>Ajouter un bandeau</div>

        {/* Presets */}
        <div style={{display:"flex", flexWrap:"wrap", gap:8, marginBottom:12}}>
          {BLOCK_PRESETS.map(p => (
            <button key={p.label} onClick={()=>handlePreset(p)} style={{
              padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
              background: (!useCustom && label===p.label) ? p.color : p.color+"22",
              border: `2px solid ${p.color}`,
              color: (!useCustom && label===p.label) ? "#fff" : p.color,
              transition:"all 0.15s",
            }}>{p.label}</button>
          ))}
          <button onClick={()=>setUseCustom(true)} style={{
            padding:"6px 12px", borderRadius:20, fontSize:12, fontWeight:600, cursor:"pointer",
            background: useCustom ? T.navy : T.surface2,
            border: `2px solid ${T.navy}`,
            color: useCustom ? "#fff" : T.navy,
          }}>✏️ Autre</button>
        </div>

        {useCustom && (
          <input style={{...css.input, marginBottom:10}} placeholder="Ex: 🎯 Tactique..."
            value={customLabel} onChange={e=>setCustomLabel(e.target.value)} />
        )}

        <div style={{display:"flex", gap:10, alignItems:"flex-end", flexWrap:"wrap"}}>
          <div style={{flex:1, minWidth:100}}>
            <div style={{...css.label, marginBottom:4}}>De</div>
            <input type="time" style={css.input} value={timeStart} onChange={e=>setTimeStart(e.target.value)} />
          </div>
          <div style={{flex:1, minWidth:100}}>
            <div style={{...css.label, marginBottom:4}}>À</div>
            <input type="time" style={css.input} value={timeEnd} onChange={e=>setTimeEnd(e.target.value)} />
          </div>
          <button style={{...css.btn, ...css.btnConfirm, height:44, flexShrink:0}}
            onClick={()=>{
              if (!finalLabel.trim() || timeStart >= timeEnd) return;
              addScheduleBlock(date, timeStart, timeEnd, finalLabel.trim(), finalColor);
            }}>
            + Ajouter
          </button>
        </div>
      </div>

      {/* Liste des bandeaux du jour */}
      {dayBlocks.length === 0 ? (
        <div style={css.emptyHint}>Aucun bandeau ce jour.</div>
      ) : (
        <div style={{display:"flex", flexDirection:"column", gap:8}}>
          {dayBlocks.map(b => (
            <div key={b.id} style={{
              display:"flex", alignItems:"center", gap:10,
              background:b.color+"18", border:`2px solid ${b.color}55`,
              borderLeft:`4px solid ${b.color}`, borderRadius:10, padding:"10px 14px",
            }}>
              <span style={{fontSize:14, fontWeight:800, color:b.color, flex:1}}>{b.label}</span>
              <span style={{fontSize:12, color:T.textDim}}>{b.time_start.slice(0,5)} – {b.time_end.slice(0,5)}</span>
              <button style={{...css.deleteBtn, fontSize:14}} onClick={()=>deleteScheduleBlock(b.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Multi-Kiné Day View ──────────────────────────────────────────────────────
// Each kiné column is an independent flex column.
// The time axis shows base 1h slots. Split kinés show 2×30' within their H1 space.
// Other kinés keep H1 — no forced split bleeding across columns.
function MultiKineDay({ kines, date, subMode, staffTarget, getBooking, isSlotOpen, isRecurring,
  getSlotsForContext, isSplit, onCellClick, unbook, toggleOpen, getSlotDuration, strapSlots, toggleStrap, scheduleBlocks }) {

  const isPastDay = isPast(date);
  const H30 = 28, HEADER = 48;

  // Vrai si ce créneau est dans le passé (jour passé OU aujourd'hui mais heure dépassée)
  function isSlotPast(time) {
    if (isPastDay) return true;
    if (date > todayStr()) return false;
    // Même jour — comparer l'heure
    const [h, m] = time.split(":").map(Number);
    const now = new Date();
    return h < now.getHours() || (h === now.getHours() && m <= now.getMinutes());
  }
  const [durationPicker, setDurationPicker] = useState(null); // {practId, time}
  const [defaultDuration, setDefaultDuration] = useState(60); // 30 ou 60

  // Générer tous les créneaux de 30 minutes de 9h00 à 23h30
  const allTimes = [];
  for (let h = 9; h <= 23; h++) {
    allTimes.push(`${String(h).padStart(2,"0")}:00`);
    if (h < 23) allTimes.push(`${String(h).padStart(2,"0")}:30`);
  }
  // Ajouter 23:30 si besoin
  allTimes.push("23:30");

  // Filtrer pour n'afficher que les créneaux où au moins un kiné a quelque chose
  // OU afficher tous si aucun créneau ouvert (grille vide)
  const hasAny = kines.some(k => getSlotsForContext(k.id, date).length > 0);
  const displayTimes = allTimes; // toujours afficher tous les créneaux

  function getSlotStatus(k, time) {
    const booking  = getBooking(k.id, date, time);
    const slotOpen = isSlotOpen(k.id, date, time);
    const rec      = isRecurring(k.id, date, time);
    return { booking, slotOpen, rec };
  }

  function handleCellClick(practId, time) {
    if (isPastDay) return;
    const { slotOpen, booking } = getSlotStatus(kines.find(k=>k.id===practId), time);
    if (booking) {
      onCellClick(practId, date, time);
    } else if (slotOpen) {
      onCellClick(practId, date, time);
    } else {
      // Ouvrir directement avec la durée sélectionnée via les onglets
      openWithDuration(defaultDuration, practId, time);
    }
  }

  async function openWithDuration(duration, practId, time) {
    // Un seul appel en base — duration=60 ou 30 stockée dans open_slots
    onCellClick(practId, date, time, duration);
  }

  // Toujours H30 — alignement parfait garanti entre toutes les colonnes
  // Un slot duration=60 colore les deux lignes H30 correspondantes (time et time+30)
  function buildKineRows(k) {
    return displayTimes.map(time => ({ time, h: H30 }));
  }

  // Retourne le time du slot 1h qui "couvre" cette ligne (la 2e moitié d'un bloc 1h)
  function getCoveringSlot(k, time) {
    // Trouver le créneau précédent dans displayTimes
    const idx = displayTimes.indexOf(time);
    if (idx <= 0) return null;
    const prevTime = displayTimes[idx - 1];
    const prevOpen = isSlotOpen(k.id, date, prevTime);
    const prevBooking = getBooking(k.id, date, prevTime);
    const prevDur = getSlotDuration(k.id, date, prevTime);
    if ((prevOpen || prevBooking) && prevDur === 60) return prevTime;
    return null;
  }

  // La grille staff : axe temps fixe H30, mais chaque colonne kiné
  // peut avoir des cellules fusionnées H30*2
  // Pour l'axe temps, on affiche toujours H30 par créneau
  function renderCell(k, time, h) {
    const { booking, slotOpen, rec } = getSlotStatus(k, time);
    const isTarget = staffTarget?.practId===k.id && staffTarget?.date===date && staffTarget?.time===time;
    const isHour = time.endsWith(":00");

    // Vérifier si cette ligne :30 est couverte par un slot 1h sur la ligne :00 précédente
    const coveringTime = getCoveringSlot(k, time);
    if (coveringTime) {
      // Cette cellule est la 2e moitié d'un slot 1h — afficher le même fond, sans indicateur
      const covBooking = getBooking(k.id, date, coveringTime);
      const covOpen = isSlotOpen(k.id, date, coveringTime);
      const covRec = isRecurring(k.id, date, coveringTime);
      const covPast = isSlotPast(coveringTime);
      let bg = T.surface3+"88";
      let bl = "3px solid transparent";
      if (covPast && !covBooking) { bg = "#f0f0f0"; }
      else if (covBooking) { bg = k.color+"44"; bl = `3px solid ${k.color}`; }
      else if (covOpen) {
        bg = covRec ? k.color+"14" : k.color+"0c";
        bl = covRec ? `3px solid ${k.color}88` : `3px solid ${k.color}55`;
      }
      return (
        <div key={`${k.id}-${time}`} style={{
          height: h, flexShrink: 0,
          borderBottom: `1px solid ${T.border2}`,
          borderRight: `1px solid ${T.border}`,
          background: bg, borderLeft: bl,
          overflow: "hidden",
          opacity: covPast && !covBooking ? 0.45 : 1,
        }} />
      );
    }

    const commonStyle = {
      height: h, flexShrink: 0,
      borderBottom: isHour ? `2px solid ${T.border}` : `1px solid ${T.border2}`,
      borderRight: `1px solid ${T.border}`,
      overflow: "hidden",
      transition: "background 0.1s",
    };

    const slotPast = isSlotPast(time);
    // Bandeau planning
    const staffBlock = (scheduleBlocks||[]).find(b => b.date === date && time >= b.time_start.slice(0,5) && time < b.time_end.slice(0,5));

    // Strap : chaque kiné a sa propre place strap (pas JY)
    const isKine = k.role === "kiné";
    // Clé strap par kiné : "kineId|date|time"
    const strapKey = `${STRAP_ID}_${k.id}|${date}|${time}`;
    const hasStrap = isKine && strapSlots && strapSlots[strapKey];

    if (hasStrap) {
      const strapData = strapSlots[strapKey];
      const strapPlayer = strapData?.player || "";
      const isBooked = !!strapPlayer;
      return (
        <div key={`${k.id}-${time}`} style={{
          height: h, flexShrink: 0,
          borderBottom: isHour ? `2px solid ${STRAP_COLOR}55` : `1px solid ${STRAP_COLOR}33`,
          borderRight: `1px solid ${T.border}`,
          borderLeft: `3px solid ${STRAP_COLOR}`,
          background: isBooked ? STRAP_COLOR+"44" : STRAP_COLOR+"22",
          display:"flex", alignItems:"center", justifyContent:"center",
          cursor: !isPastDay && subMode === "straps" ? "pointer" : "default",
          opacity: slotPast ? 0.45 : 1,
          overflow:"hidden",
        }}
          onClick={() => !isPastDay && subMode === "straps" && !isBooked && onCellClick(k.id, date, time)}>
          {isBooked ? (
            <div style={{width:"100%", padding:"0 4px", overflow:"hidden"}}>
              <div style={{display:"flex", alignItems:"center", gap:2}}>
                <span style={{fontSize:9}}>🩹</span>
                <span style={{fontSize:10, fontWeight:800, color:STRAP_COLOR,
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  filter:"brightness(0.65)", flex:1}}>
                  {strapPlayer}
                </span>
                {!isPastDay && (
                  <button style={css.deleteBtn} onClick={e=>{e.stopPropagation();toggleStrap(k.id,date,time);}}>✕</button>
                )}
              </div>
              <div style={{fontSize:7, color:STRAP_COLOR, fontWeight:600}}>Strap 30'</div>
            </div>
          ) : (
            <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:1}}>
              <span style={{fontSize:11}}>🩹</span>
              <span style={{fontSize:7, fontWeight:800, color:STRAP_COLOR}}>30'</span>
            </div>
          )}
        </div>
      );
    }

    let bg = isHour ? T.surface : T.surface3+"88";
    let bl = "3px solid transparent";
    let indicator = null;


    // Créneau passé sans réservation → grisé non cliquable
    if (slotPast && !booking) {
      return (
        <div key={`${k.id}-${time}`} style={{
          ...commonStyle,
          background: "#f0f0f0",
          borderLeft: "3px solid transparent",
          cursor: "default",
          opacity: 0.45,
          display:"flex", alignItems:"center", justifyContent:"center",
        }} />
      );
    }

    if (booking && booking.cancelled && !booking.player) {
      // Annulé et libéré — traiter comme slot ouvert
      bg = isHour ? T.surface : T.surface3+"88"; bl = "3px solid transparent";
    } else if (booking && booking.cancelled) {
      bg = "#f5f5f5"; bl = "3px solid #ccc";
      indicator = (
        <div style={{width:"100%", padding:"0 4px", overflow:"hidden"}}>
          <div style={{fontSize:10, fontWeight:700, color:"#999", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
            ❌ {booking.player}
          </div>
          <div style={{fontSize:8, color:"#bbb"}}>Annulé</div>
        </div>
      );
      // Show unbook button for staff
    } else if (booking) {
      bg = k.color+"66"; bl = `3px solid ${k.color}`;
      indicator = (
        <div style={{width:"100%", overflow:"hidden", padding:"0 4px"}}>
          <div style={{display:"flex", alignItems:"center", gap:2}}>
            <span style={{fontSize:10, fontWeight:800, color:k.color, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1,
              textShadow:"0 0 0 transparent", filter:"brightness(0.6)"}}>
              {booking.player}
            </span>
            {booking.locked && <span style={{fontSize:8, opacity:0.7, flexShrink:0}}>🔒</span>}
            {!isPastDay && <button style={css.deleteBtn} onClick={e=>{e.stopPropagation();unbook(k.id,date,time);}}>✕</button>}
          </div>
          {booking.note && (
            <div style={{fontSize:8, color:T.textDim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
              💬 {noteToDisplay(booking.note)}
            </div>
          )}
        </div>
      );
    } else if (slotOpen) {
      bg = rec ? k.color+"14" : k.color+"0c";
      bl = rec ? `3px solid ${k.color}88` : `3px solid ${k.color}55`;
      const dur = getSlotDuration(k.id, date, time);
      indicator = (
        <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:0}}>
          <span style={{fontSize:12, color:k.color, fontWeight:800, opacity:0.7}}>
            {rec ? "↺" : "✓"}
          </span>
          <span style={{fontSize:7, color:k.color+"99", fontWeight:600}}>{dur===60?"1h":"30'"}</span>
        </div>
      );
    } else {
      indicator = <span style={{fontSize:10, color:T.textDim, opacity:0.2}}>+</span>;
    }

    if (isTarget) { bg="#fffbe8"; bl=`3px solid ${T.goldBright}`; }

    return (
      <div key={`${k.id}-${time}`} style={{
        ...commonStyle,
        background: bg, borderLeft: bl,
        display:"flex", alignItems:"center", justifyContent:"center",
        cursor: isPastDay ? "default" : "pointer",
      }}
        onClick={() => !isPastDay && handleCellClick(k.id, time)}
        title={booking ? `${booking.player}` : slotOpen ? `Ouvert ${getSlotDuration(k.id,date,time)===60?"1h":"30'"}` : "Fermé — cliquer pour ouvrir"}>
        {indicator}

      </div>
    );
  }

  return (
    <div style={{...css.calendarWrap, margin:"0 20px", overflowX:"auto"}}>
      {/* Onglets durée */}
      <div style={{display:"flex", gap:8, padding:"10px 0 8px", justifyContent:"center"}}>
        <button style={{
          padding:"6px 20px", borderRadius:20, border:`2px solid ${T.navy}`,
          background: defaultDuration===60 ? T.navy : "transparent",
          color: defaultDuration===60 ? "#fff" : T.navy,
          fontWeight:700, fontSize:13, cursor:"pointer",
        }} onClick={()=>setDefaultDuration(60)}>
          ⏱ 1 heure
        </button>
        <button style={{
          padding:"6px 20px", borderRadius:20, border:`2px solid #e05090`,
          background: defaultDuration===30 ? "#e05090" : "transparent",
          color: defaultDuration===30 ? "#fff" : "#e05090",
          fontWeight:700, fontSize:13, cursor:"pointer",
        }} onClick={()=>setDefaultDuration(30)}>
          ⚡ 30 min
        </button>
      </div>

      <div style={{display:"flex", minWidth:500, position:"relative"}}>
        {/* Axe temps — créneaux de 30' */}
        <div style={{width:64, flexShrink:0, display:"flex", flexDirection:"column"}}>
          <div style={{height:HEADER, background:T.surface3, borderBottom:`2px solid ${T.border}`, borderRight:`1px solid ${T.border}`}} />
          {displayTimes.map(time => (
            <div key={`axis-${time}`} style={{
              height: H30, flexShrink:0,
              background: time.endsWith(":00") ? T.surface2 : T.surface3,
              borderBottom: time.endsWith(":00") ? `2px solid ${T.border}` : `1px solid ${T.border2}`,
              borderRight:`1px solid ${T.border}`,
              display:"flex", alignItems:"center", justifyContent:"flex-end", padding:"0 8px",
            }}>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize: time.endsWith(":00") ? 11 : 9, fontWeight: time.endsWith(":00") ? 700 : 400, color: time.endsWith(":00") ? T.textMid : T.textDim}}>{time}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Une colonne par kiné */}
        {kines.map(k => (
          <div key={k.id} style={{flex:1, minWidth:90, display:"flex", flexDirection:"column"}}>
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
            {/* Per slot: use buildKineRows to merge consecutive 30' pairs */}
            {buildKineRows(k).map(({time, nextTime, merged, h}) =>
              merged
                ? renderCell(k, time, h)
                : renderCell(k, time, h)
            )}
          </div>
        ))}
        {/* Planning overlay pleine largeur */}
        {(scheduleBlocks||[]).filter(b => b.date === date).map(block => {
          const tStart = block.time_start.slice(0,5);
          const tEnd = block.time_end.slice(0,5);
          const firstIdx = allTimes.indexOf(tStart);
          const endIdx = allTimes.indexOf(tEnd);
          if (firstIdx < 0) return null;
          const spanCount = endIdx >= 0 ? endIdx - firstIdx : 2;
          const top = HEADER + firstIdx * H30;
          const height = spanCount * H30;
          return (
            <div key={block.id} style={{
              position:"absolute",
              left: 64, right: 0,
              top, height,
              background: block.color+"28",
              borderTop: `3px solid ${block.color}88`,
              borderBottom: `2px solid ${block.color}44`,
              display:"flex", alignItems:"center", paddingLeft:16,
              pointerEvents:"none", zIndex:3,
            }}>
              <span style={{
                fontSize:12, fontWeight:800, color:"#fff",
                background: block.color+"dd", borderRadius:6,
                padding:"3px 12px", boxShadow:`0 1px 6px ${block.color}55`,
              }}>{block.label}</span>
            </div>
          );
        })}
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
            {booking.note && <div style={{fontSize:11,color:"#8b949e",marginTop:2}}>💬 {noteToDisplay(booking.note)}</div>}
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {/* Comment */}
          <button style={{...css.modalActionBtn, borderColor:"#30363d", color:"#e6edf3"}} onClick={onNote}>
            <span style={{fontSize:18}}>{booking.note?"✏️":"💬"}</span>
            <div style={{textAlign:"left"}}>
              <div style={{fontWeight:700}}>{booking.note ? "Modifier le commentaire" : "Ajouter un commentaire"}</div>
              {booking.note && <div style={{fontSize:11,opacity:0.6,marginTop:1}}>{noteToDisplay(booking.note)}</div>}
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

// ─── Soins items config ──────────────────────────────────────────────────────
const SOIN_ITEMS_SIMPLE = ["Récup", "Étirements", "Contusion", "Isocinétique", "Ondes de choc"];
const SOIN_ITEMS_SIDE   = ["Genou", "Cheville", "Tendon d'Achille", "Tendon rotulien", "Mollet", "Quadriceps", "Ischio-jambiers"];

// Sérialiser/désérialiser la note (JSON enrichi + texte libre)
function parseNote(raw) {
  if (!raw) return { items: {}, text: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "items" in parsed) return parsed;
  } catch {}
  return { items: {}, text: raw }; // ancienne note texte brut
}
function serializeNote(items, text) {
  const hasItems = Object.keys(items).some(k => items[k]);
  if (!hasItems && !text.trim()) return "";
  return JSON.stringify({ items, text: text.trim() });
}
function noteToDisplay(raw) {
  const { items, text } = parseNote(raw);
  const parts = [];
  for (const key of SOIN_ITEMS_SIMPLE) {
    if (items[key]) parts.push(key);
  }
  for (const key of SOIN_ITEMS_SIDE) {
    if (items[key+"_G"]) parts.push(key+" G");
    if (items[key+"_D"]) parts.push(key+" D");
  }
  if (text) parts.push(text);
  return parts.join(" · ");
}

// ─── Note Modal ───────────────────────────────────────────────────────────────
function NoteModal({ note, player, date, time, pract, onSave, onClose }) {
  const parsed = parseNote(note);
  const [items, setItems] = useState(parsed.items || {});
  const [text, setText]   = useState(parsed.text || "");

  function toggleItem(key) {
    setItems(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const hasAny = Object.values(items).some(Boolean) || text.trim();

  return (
    <div style={css.modalOverlay} onClick={onClose}>
      <div style={{...css.modalCard, maxWidth:480, maxHeight:"90vh", overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div style={{...css.practAvatar,background:pract.color,width:32,height:32,fontSize:12,flexShrink:0}}>{pract.initials}</div>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>{player}</div>
            <div style={{fontSize:12,color:T.textDim}}>{fmtLong(date)} · {time} · {pract.name}</div>
          </div>
        </div>

        {/* Items simples */}
        <div style={{marginBottom:14}}>
          <div style={{...css.label, marginBottom:8}}>Type de soin</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {SOIN_ITEMS_SIMPLE.map(item => (
              <button key={item} onClick={()=>toggleItem(item)} style={{
                padding:"6px 14px", borderRadius:20, fontSize:13, fontWeight:600, cursor:"pointer",
                border:`2px solid ${items[item] ? T.navy : T.border}`,
                background: items[item] ? T.navy : T.surface2,
                color: items[item] ? "#fff" : T.textMid,
                transition:"all 0.15s",
              }}>{items[item] ? "✓ " : ""}{item}</button>
            ))}
          </div>
        </div>

        {/* Items avec côté G/D */}
        <div style={{marginBottom:14}}>
          <div style={{...css.label, marginBottom:8}}>Zone anatomique <span style={{fontWeight:400,textTransform:"none",letterSpacing:0,color:T.textDim}}>(choisir le côté)</span></div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {SOIN_ITEMS_SIDE.map(item => (
              <div key={item} style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:13,color:T.textMid,flex:1,fontWeight:600}}>{item}</span>
                {["G","D"].map(side => {
                  const k = item+"_"+side;
                  const active = items[k];
                  return (
                    <button key={side} onClick={()=>toggleItem(k)} style={{
                      width:40, height:32, borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer",
                      border:`2px solid ${active ? (side==="G"?"#1565c0":"#c62828") : T.border}`,
                      background: active ? (side==="G"?"#1565c022":"#c6282822") : T.surface2,
                      color: active ? (side==="G"?"#1565c0":"#c62828") : T.textDim,
                      transition:"all 0.15s",
                    }}>{side}</button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Commentaire libre */}
        <div style={{marginBottom:14}}>
          <div style={{...css.label, marginBottom:6}}>Commentaire libre</div>
          <textarea style={{
            width:"100%", background:T.surface2, border:`1px solid ${T.border}`,
            borderRadius:10, padding:"10px 12px", color:T.text, fontSize:13,
            resize:"vertical", minHeight:64, fontFamily:"inherit", boxSizing:"border-box", outline:"none",
          }}
            placeholder="Remarques complémentaires..."
            value={text} onChange={e=>setText(e.target.value)}
          />
        </div>

        <div style={{display:"flex",gap:8}}>
          <button style={{...css.btn,...css.btnConfirm,flex:1}}
            onClick={()=>onSave(serializeNote(items,text))}>
            Enregistrer ✓
          </button>
          {hasAny && (
            <button style={{...css.btn,background:"#fff0f0",border:`1px solid ${T.red}`,color:T.red,fontSize:13,padding:"10px 14px"}}
              onClick={()=>{ setItems({}); setText(""); onSave(""); }}>
              Effacer
            </button>
          )}
          <button style={{...css.btn,background:T.surface2,color:T.textDim,fontSize:13,padding:"10px 14px"}}
            onClick={onClose}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stats Modal ──────────────────────────────────────────────────────────────
function StatsModal({ onClose, bookings, practitioners }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo,   setDateTo]   = useState("");
  const [practFilter, setPractFilter] = useState("");

  const allBookings = Object.entries(bookings).map(([k,v]) => {
    const [pId, date, time] = k.split("|");
    return { pId, date, time, ...v };
  });

  const filtered = allBookings.filter(b => {
    if (practFilter && b.pId !== practFilter) return false;
    if (dateFrom && b.date < dateFrom) return false;
    if (dateTo   && b.date > dateTo)   return false;
    return true;
  });

  // Compter les items
  const counts = {};
  const allKeys = [
    ...SOIN_ITEMS_SIMPLE,
    ...SOIN_ITEMS_SIDE.flatMap(s => [s+"_G", s+"_D"]),
  ];
  for (const k of allKeys) counts[k] = 0;

  for (const b of filtered) {
    const { items } = parseNote(b.note);
    for (const k of allKeys) {
      if (items[k]) counts[k]++;
    }
  }

  const total = filtered.length;

  return (
    <div style={css.modalOverlay} onClick={onClose}>
      <div style={{...css.modalCard, maxWidth:520, maxHeight:"92vh", overflowY:"auto", padding:20}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <h3 style={{margin:0,fontSize:17,color:T.navy,fontWeight:800}}>📊 Statistiques des soins</h3>
          <button style={{...css.backBtn,background:T.surface2,color:T.textDim,border:`1px solid ${T.border}`}} onClick={onClose}>✕</button>
        </div>

        {/* Filtres */}
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:120}}>
            <div style={{...css.label,marginBottom:4}}>Du</div>
            <input type="date" style={{...css.input,padding:"8px 10px",fontSize:13}} value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
          </div>
          <div style={{flex:1,minWidth:120}}>
            <div style={{...css.label,marginBottom:4}}>Au</div>
            <input type="date" style={{...css.input,padding:"8px 10px",fontSize:13}} value={dateTo} onChange={e=>setDateTo(e.target.value)} />
          </div>
          <div style={{flex:1,minWidth:140}}>
            <div style={{...css.label,marginBottom:4}}>Praticien</div>
            <select style={{...css.select,padding:"8px 10px",fontSize:13}} value={practFilter} onChange={e=>setPractFilter(e.target.value)}>
              <option value="">Tous</option>
              {practitioners.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{background:T.surface2,borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:13,color:T.navy,fontWeight:600}}>
          {total} soin{total>1?"s":""} sur la période
        </div>

        {/* Soins simples */}
        <div style={{marginBottom:14}}>
          <div style={{...css.label,marginBottom:8}}>Soins généraux</div>
          {SOIN_ITEMS_SIMPLE.map(item => {
            const n = counts[item] || 0;
            const pct = total ? Math.round(n/total*100) : 0;
            return (
              <div key={item} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span style={{width:160,fontSize:13,color:T.textMid,fontWeight:600}}>{item}</span>
                <div style={{flex:1,height:14,background:T.surface3,borderRadius:7,overflow:"hidden"}}>
                  <div style={{width:`${pct}%`,height:"100%",background:T.navy,borderRadius:7,transition:"width 0.4s"}} />
                </div>
                <span style={{fontSize:12,color:T.textDim,minWidth:40,textAlign:"right"}}>{n} ({pct}%)</span>
              </div>
            );
          })}
        </div>

        {/* Zones anatomiques G/D */}
        <div>
          <div style={{...css.label,marginBottom:8}}>Zones anatomiques</div>
          {SOIN_ITEMS_SIDE.map(item => {
            const nG = counts[item+"_G"] || 0;
            const nD = counts[item+"_D"] || 0;
            const maxN = Math.max(nG, nD, 1);
            return (
              <div key={item} style={{marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:700,color:T.textMid,marginBottom:4}}>{item}</div>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:11,color:"#1565c0",fontWeight:700,width:14}}>G</span>
                  <div style={{flex:1,height:12,background:T.surface3,borderRadius:6,overflow:"hidden"}}>
                    <div style={{width:`${Math.round(nG/maxN*100)}%`,height:"100%",background:"#1565c0",borderRadius:6}} />
                  </div>
                  <span style={{fontSize:11,color:T.textDim,minWidth:32,textAlign:"right"}}>{nG}</span>
                  <span style={{fontSize:11,color:"#c62828",fontWeight:700,width:14}}>D</span>
                  <div style={{flex:1,height:12,background:T.surface3,borderRadius:6,overflow:"hidden"}}>
                    <div style={{width:`${Math.round(nD/maxN*100)}%`,height:"100%",background:"#c62828",borderRadius:6}} />
                  </div>
                  <span style={{fontSize:11,color:T.textDim,minWidth:32,textAlign:"right"}}>{nD}</span>
                </div>
              </div>
            );
          })}
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

  staffActions: { display:"flex", gap:6, padding:"0 20px 8px", flexWrap:"wrap", overflowX:"auto" },
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
