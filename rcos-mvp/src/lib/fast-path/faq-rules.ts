// NOTE: rcos-mvp is a scaffold, NOT the deployed system. Fees are NEVER hardcoded here —
// the source of truth is agent/college.json in the main app. These defer to the office.
export const FAQ_RULES = [
  {
    pattern: /(fee|cost|price).*(mpc)/i,
    response: "Our admissions office will share the exact MPC fee and scholarship options on WhatsApp today — the amount depends on your ResoNET result."
  },
  {
    pattern: /(fee|cost|price).*(bipc)/i,
    response: "Our admissions office will share the exact BiPC fee and scholarship options on WhatsApp today — the amount depends on your ResoNET result."
  },
  {
    pattern: /(scholarship|discount|concession)/i,
    response: "Scholarships are decided by the ResoNET test — up to 100% tuition waiver based on your score. The office will confirm your exact slab after the test."
  },
  {
    pattern: /where.*(branch|location|campus)|kukatpally|attapur|madhapur/i,
    response: "We have 14+ campuses across Hyderabad:\n      • Kukatpally: Western Hills, opposite JNTU\n      • Attapur: Pillar No. 211, MJK Plaza\n      • Nallagandla: Plot No. 24, HIG, Opp. Aparna Cyber Life\n      • Madhapur, Dilsukhnagar, ECIL, Habsiguda, Himayatnagar\n      • Manikonda, Miyapur, SR Nagar, Suchitra, West Marredpally\n      • Global Campus (Kompally)"
  },
  {
    pattern: /(deadline|last date)/i,
    response: "The last date for Phase 1 admissions is April 30th. Phase 2 ends on May 15th, subject to seat availability."
  },
  {
    pattern: /(eligibility|marks).*(bipc)/i,
    response: "For BiPC, the eligibility requirement is 55% in 12th BiPC + NEET score."
  },
  {
    pattern: /hi|hello|namaste/i,
    response: "Namaste! I'm a Resonance admissions counselor. I'm here to help you with program information, fees, admission process, scholarships, and more. How can I assist you today?"
  }
];

export function routeFastPath(query: string) {
  for (const rule of FAQ_RULES) {
    if (rule.pattern.test(query)) {
      return { matched: true, response: rule.response };
    }
  }
  return { matched: false, response: null };
}
