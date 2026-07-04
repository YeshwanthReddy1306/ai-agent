const TOOL_VALIDATION_RULES = {
  appointment: {
    fields: {
      branch: {
        required: true,
        allowed: ['HYD-KUKATPALLY', 'HYD-ATTAPUR', 'HYD-NALLAGANDLA', 'HYD-MADHAPUR'],
        error: 'Invalid branch. Please select from: Kukatpally, Attapur, Nallagandla, Madhapur'
      },
      date: {
        required: true,
        validate: (date) => {
          const d = new Date(date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const maxDate = new Date();
          maxDate.setDate(maxDate.getDate() + 30);
          return d >= today && d <= maxDate;
        },
        error: 'Date must be between today and 30 days from now'
      },
      time: {
        required: true,
        validate: (time) => {
          const [hours] = time.split(':').map(Number);
          return hours >= 9 && hours < 18;
        },
        error: 'Time must be between 9:00 AM and 6:00 PM'
      }
    }
  },
  crm: {
    fields: {
      phone: {
        required: true,
        validate: (phone) => /^[0-9]{10}$/.test(phone.replace(/[^0-9]/g, '')),
        error: 'Phone number must be 10 digits'
      },
      program: {
        required: true,
        allowed: ['MPC', 'BiPC'],
        error: 'Program must be MPC or BiPC'
      }
    }
  },
  knowledge: {
    fields: {
      category: {
        required: true,
        allowed: ['fees', 'scholarships', 'deadlines', 'branches'],
        error: 'Invalid category. Must be: fees, scholarships, deadlines, branches'
      }
    }
  },
  whatsapp: {
    fields: {
      phone: {
        required: true,
        validate: (phone) => /^[0-9]{10}$/.test(phone.replace(/[^0-9]/g, '')),
        error: 'Phone number must be 10 digits'
      },
      message: {
        required: true,
        validate: (message) => message.length > 0 && message.length <= 4096,
        error: 'Message must be between 1 and 4096 characters'
      }
    }
  }
};

function validateToolCall(tool, params) {
  const rule = TOOL_VALIDATION_RULES[tool];
  if (!rule) return { valid: false, errors: [`Unknown tool: ${tool}`] };
  
  const errors = [];
  
  for (const [field, config] of Object.entries(rule.fields)) {
    const value = params[field];
    if (config.required && (value === undefined || value === null || value === '')) {
      errors.push(`Missing required field: ${field}`);
      continue;
    }
    
    if (value !== undefined && value !== null && value !== '') {
      if (config.allowed && !config.allowed.includes(value)) {
        errors.push(`Invalid value for ${field}: ${config.error}`);
      }
      if (config.validate && !config.validate(value)) {
        errors.push(`Invalid value for ${field}: ${config.error}`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}

module.exports = {
  TOOL_VALIDATION_RULES,
  validateToolCall
};
