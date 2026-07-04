export const FAQ_RULES = [
  {
    pattern: /(fee|cost|price).*(mpc)/i,
    response: "The fee for MPC is ₹1,00,000 per year. This includes tuition, lab fees, and library access."
  },
  {
    pattern: /(fee|cost|price).*(bipc)/i,
    response: "The fee for BiPC is ₹1,10,000 per year, which includes all laboratory materials."
  },
  {
    pattern: /(scholarship|discount|concession)/i,
    response: "We offer several scholarships:\n      1. Merit Scholarship: 30% tuition waiver for students scoring above 85%\n      2. Need-based Scholarship: Up to 50% waiver based on family income\n      3. Sports Scholarship: 25% waiver for national-level athletes\n      4. Resonance Excellency Test (RET): Up to 100% scholarship"
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
