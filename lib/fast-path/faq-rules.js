// lib/fast-path/faq-rules.js

const FAQ_RULES = [
  // ============================================================
  // FEE QUERIES
  // ============================================================
  {
    keywords: ['fee', 'cost', 'tuition', 'price', 'kitna', 'entha'],
    program_required: true,
    // Fees intentionally NOT hardcoded — the admissions office confirms exact figures.
    // (Removed invented ₹1,00,000 literals, 2026-07-03. Never state a fee here.)
    response: (program) =>
      `For ${program}, our admissions office will share the exact current fee and scholarship options on WhatsApp today — the amount depends on the ResoNET scholarship result.`
  },

  // ============================================================
  // SCHOLARSHIP QUERIES
  // ============================================================
  {
    keywords: ['scholarship', 'aid', 'grant', 'financial', 'merit'],
    program_required: false,
    response: () => {
      return `We offer several scholarships:
      1. Merit Scholarship: 30% tuition waiver for students scoring above 85%
      2. Need-based Scholarship: Up to 50% waiver based on family income
      3. Sports Scholarship: 25% waiver for national-level athletes
      4. Resonance Excellency Test (RET): Up to 100% scholarship`;
    }
  },

  // ============================================================
  // ELIGIBILITY QUERIES
  // ============================================================
  {
    keywords: ['eligible', 'eligibility', 'qualify', 'criteria', 'requirement', 'marks', 'yogya', 'arhata'],
    program_required: true,
    response: (program) => {
      const eligibility = {
        'MPC': '60% in 12th PCM + JEE Main score',
        'BiPC': '55% in 12th BiPC + NEET score',
        'both': '60% in 12th PCM for MPC, 55% in 12th BiPC for BiPC'
      };
      return `For ${program}, the eligibility requirement is ${eligibility[program] || eligibility.both}.`;
    }
  },

  // ============================================================
  // BRANCH QUERIES
  // ============================================================
  {
    keywords: ['branch', 'campus', 'center', 'location', 'address'],
    program_required: false,
    response: () => {
      return `We have 14+ campuses across Hyderabad:
      • Kukatpally: Western Hills, opposite JNTU
      • Attapur: Pillar No. 211, MJK Plaza
      • Nallagandla: Plot No. 24, HIG, Opp. Aparna Cyber Life
      • Madhapur, Dilsukhnagar, ECIL, Habsiguda, Himayatnagar
      • Manikonda, Miyapur, SR Nagar, Suchitra, West Marredpally
      • Global Campus (Kompally)`;
    }
  },

  // ============================================================
  // ADMISSION PROCESS QUERIES
  // ============================================================
  {
    keywords: ['admission', 'process', 'apply', 'application', 'registration'],
    program_required: false,
    response: () => {
      return `The admission process has 3 stages:
      1. Level 1 Test (Online) - >75% to proceed
      2. Level 2 Test - >75% to proceed
      3. Personal Evaluation with expert faculty
      After completing all stages, admission is offered.
      
      Important dates:
      • Application Deadline: March 31, 2026
      • RET (Scholarship Test): January - March 2026
      • Academic Session starts: July 2026`;
    }
  },

  // ============================================================
  // DEADLINE QUERIES
  // ============================================================
  {
    keywords: ['deadline', 'date', 'last date', 'timeline', 'time limit'],
    program_required: false,
    response: () => {
      return `Important deadlines:
      • Application Deadline: March 31, 2026
      • Document Submission: April 15, 2026
      • RET (Scholarship Test): January - March 2026
      • Fee Payment: June 30, 2026
      • Semester Start: July 15, 2026`;
    }
  },

  // ============================================================
  // HOSTEL QUERIES
  // ============================================================
  {
    keywords: ['hostel', 'accommodation', 'room', 'stay', 'living'],
    program_required: false,
    response: () => {
      return `We have AC hostel facilities at select campuses:
      • Room types: Single, Double, Triple occupancy
      • Amenities: 24/7 security, Wi-Fi, laundry
      • Mess: Vegetarian and Non-vegetarian options
      • Exact hostel fee is confirmed by the admissions office (varies by room type).`;
    }
  },

  // ============================================================
  // TRANSPORT QUERIES
  // ============================================================
  {
    keywords: ['transport', 'bus', 'route', 'commute', 'travel'],
    program_required: false,
    response: () => {
      return `We provide transport facilities:
      • Routes covering major city areas
      • Morning and evening schedules
      • Exact transport fee and routes are confirmed by the admissions office.
      • Available at all campuses`;
    }
  },

  // ============================================================
  // PLACEMENT QUERIES
  // ============================================================
  {
    keywords: ['placement', 'job', 'career', 'package', 'salary', 'company'],
    program_required: false,
    response: () => {
      return `Our placement record:
      • 3 out of 4 students secure merit rank in IIT-JEE/NEET (2025)
      • 80% success rate for 7 consecutive years
      • 3800+ success stories in 6 years
      • Top companies: Amazon, Microsoft, Google, TCS, Infosys`;
    }
  },

  // ============================================================
  // FACULTY QUERIES
  // ============================================================
  {
    keywords: ['faculty', 'teacher', 'professor', 'staff', 'mentor'],
    program_required: false,
    response: () => {
      return `Our faculty:
      • Highly qualified and experienced
      • Trained with updated methodologies
      • Specialized for IIT-JEE/NEET coaching
      • Regular mentoring and doubt-clearing support`;
    }
  },

  // ============================================================
  // GREETINGS
  // ============================================================
  {
    keywords: ['hello', 'hi', 'hey', 'namaste', 'namaskaram', 'good morning', 'good afternoon', 'good evening'],
    program_required: false,
    response: () => {
      return `Namaste! I'm a Resonance admissions counselor. I'm here to help you with program information, fees, admission process, scholarships, and more. How can I assist you today?`;
    }
  },

  // ============================================================
  // FAREWELLS
  // ============================================================
  {
    keywords: ['goodbye', 'bye', 'thank you', 'thanks', 'dhanyavad', 'thank you very much'],
    program_required: false,
    response: () => {
      return `Thank you for your time! I wish you all the best. If you have any more questions, please don't hesitate to call us at 1800-123-456 or visit our website. Have a great day!`;
    }
  }
];

// ============================================================
// Program Detection Helper
// ============================================================

function detectProgram(query) {
  const queryLower = query.toLowerCase();
  if (queryLower.includes('mpc') || queryLower.includes('maths') || queryLower.includes('engineering')) {
    return 'MPC';
  }
  if (queryLower.includes('bipc') || queryLower.includes('biology') || queryLower.includes('medical') || queryLower.includes('neet')) {
    return 'BiPC';
  }
  if (queryLower.includes('both') || queryLower.includes('all') || queryLower.includes('options')) {
    return 'both';
  }
  return null;
}

// ============================================================
// Fast Path Router
// ============================================================

function routeFastPath(query) {
  const queryLower = query.toLowerCase();
  const program = detectProgram(query);

  for (const rule of FAQ_RULES) {
    if (rule.keywords.some(keyword => queryLower.includes(keyword))) {
      // Check if program is required and not detected
      if (rule.program_required && !program) {
        return {
          matched: true,
          response: `Could you please specify which program you're asking about? (MPC or BiPC)`
        };
      }
      return {
        matched: true,
        response: rule.response(program || 'both')
      };
    }
  }

  return { matched: false, response: '' };
}

module.exports = {
  FAQ_RULES,
  detectProgram,
  routeFastPath
};
