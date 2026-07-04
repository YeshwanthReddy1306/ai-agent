const { validateToolCall } = require('./validation');
const { pool } = require('../db');

class ToolExecutor {
  async execute(actionName, params, context = {}) {
    const { valid, errors } = validateToolCall(actionName, params);
    
    if (!valid) {
      const errorResult = { error: 'Validation failed', details: errors };
      await this.auditLog(actionName, params, errorResult, context);
      return errorResult;
    }

    try {
      let result;
      switch (actionName) {
        case 'appointment':
          result = await this.mockAppointment(params);
          break;
        case 'crm':
          result = await this.mockCrm(params);
          break;
        case 'knowledge':
          result = await this.mockKnowledge(params);
          break;
        case 'whatsapp':
          result = await this.mockWhatsapp(params);
          break;
        default:
          throw new Error(`Tool ${actionName} not implemented.`);
      }
      
      await this.auditLog(actionName, params, result, context);
      return result;
    } catch (err) {
      const errorResult = { error: 'Tool execution failed', details: err.message };
      await this.auditLog(actionName, params, errorResult, context);
      return errorResult;
    }
  }

  async auditLog(actionName, params, result, context) {
    try {
      if (pool) {
        await pool.query(
          `INSERT INTO audit_log (session_id, lead_id, actor, action, details, timestamp)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [
            context.session_id || null,
            context.lead_id || null,
            'ai',
            actionName,
            JSON.stringify({ params, result })
          ]
        );
      }
    } catch (e) {
      console.error('[AUDIT LOG ERROR]', e.message);
    }
  }

  async mockAppointment(params) {
    return { success: true, message: `Appointment booked at ${params.branch} for ${params.date} at ${params.time}` };
  }

  async mockCrm(params) {
    return { success: true, message: `Lead updated with program ${params.program}` };
  }

  async mockKnowledge(params) {
    return { success: true, message: `Knowledge queried for ${params.category}` };
  }

  async mockWhatsapp(params) {
    return { success: true, message: `WhatsApp message sent to ${params.phone}` };
  }
}

const executor = new ToolExecutor();

module.exports = { ToolExecutor, executor };
