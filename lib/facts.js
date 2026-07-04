// On-demand fact injection (H3 optimization). The heavy long-tail facts (34 campus
// addresses, DLPD prices, hostel breakdown, brochure links, demographic scholarship
// edge-cases) are kept OUT of the per-turn system prompt and injected ONLY on turns where
// the parent's words trigger them. This cuts average prompt tokens without losing coverage.
// Deterministic keyword match — no embeddings, no tool-calling.

function relevantFacts(userText, college) {
  const q = String(userText || '').toLowerCase();
  const parts = [];

  if (/campus|address|branch|where|location|near|area|reach/.test(q)) {
    const list = (college.campuses || []).map((c) => `${c.area}: ${c.landmark} (${c.type})`).join('; ');
    parts.push(`CAMPUSES (${college.campusCountNote || '34 across Hyderabad'}): ${list}`);
  }
  if (/distance|online|dlpd|correspond|self.?study/.test(q)) {
    const d = college.streams && college.streams['Distance / Online (DLPD)'];
    if (d) parts.push(`DISTANCE/ONLINE: ${d.feePerYear} ${d.note}`);
  }
  if (/hostel|residential|accommodation|room|mess|stay/.test(q)) {
    if (college.hostel) parts.push(`HOSTEL: ${college.hostel.feePerYear} — ${college.hostel.note}`);
  }
  if (/sat|global|abroad|foreign|overseas|ielts/.test(q)) {
    const s = college.streams && college.streams['MPC + JEE Advanced + SAT (Global)'];
    if (s) parts.push(`SAT/GLOBAL: ${s.feePerYear} ${s.note}`);
  }
  if (/brochure|pdf|link|send.*(detail|info)|whatsapp.*(detail|info)/.test(q)) {
    const b = Object.entries(college.brochures || {}).map(([k, v]) => `${k}: ${v}`).join(' | ');
    if (b) parts.push(`BROCHURES (send only if asked): ${b}`);
  }
  if (/defence|army|military|single (parent|mother)|sibling|olympiad|kvpy|ntse|board (marks|percent)/.test(q)) {
    parts.push('SCHOLARSHIP EDGE CASES: Class-X 95%+ = 100% or flat ₹40,000; Olympiad Stage III=100%/II=90%/I=75%; KVPY final=50%, NTSE II=40%; Defence/paramilitary=40%; single mother=50%; sibling 10-25%.');
  }
  if (/long.?term|repeat|dropper|gap year/.test(q)) {
    const l = college.streams && college.streams['Long-term (Repeaters / droppers)'];
    if (l) parts.push(`REPEATERS: ${l.feePerYear} ${l.note}`);
  }

  return parts.join('\n');
}

module.exports = { relevantFacts };
