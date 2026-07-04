-- ============================================================
-- RCOS LITE v7.2 - MVP PILOT DATABASE SCHEMA
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- CREATE EXTENSION IF NOT EXISTS vector; (Ignoring vector for MVP if not needed)

-- ============================================================
-- TABLE 1: leads
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(200),
  source VARCHAR(50) DEFAULT 'phone',
  branch_id VARCHAR(50) DEFAULT 'HYD-KUKATPALLY',
  program_interest VARCHAR(20),
  student_name VARCHAR(200),
  student_percentage FLOAT,
  student_board VARCHAR(50),
  status VARCHAR(50) DEFAULT 'inquiry',
  score FLOAT DEFAULT 0,
  assigned_counselor VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE 2: conversations
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  session_id VARCHAR(100) UNIQUE NOT NULL,
  channel VARCHAR(50) DEFAULT 'phone',
  language VARCHAR(10) DEFAULT 'en-IN',
  turn_count INT DEFAULT 0,
  current_stage VARCHAR(50) DEFAULT 'greeting',
  trust_level FLOAT DEFAULT 0.5,
  current_intent VARCHAR(50),
  current_goal VARCHAR(100),
  pending_tasks JSONB DEFAULT '[]',
  next_action VARCHAR(100),
  confidence FLOAT DEFAULT 0.5,
  outcome VARCHAR(50),
  history JSONB DEFAULT '[]',
  escalated BOOLEAN DEFAULT false,
  escalated_at TIMESTAMP,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE 3: messages
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  content_translated JSONB,
  intent VARCHAR(50),
  emotion VARCHAR(50),
  confidence FLOAT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE 4: appointments
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  branch_id VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  type VARCHAR(50) DEFAULT 'campus_visit',
  status VARCHAR(50) DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE 5: escalations
-- ============================================================
CREATE TABLE IF NOT EXISTS escalations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  reason VARCHAR(200) NOT NULL,
  context JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  assigned_to VARCHAR(100),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE 6: dynamic_knowledge (Cloud SQL, not JSON file)
-- ============================================================
CREATE TABLE IF NOT EXISTS dynamic_knowledge (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(50) NOT NULL,
  key VARCHAR(100) NOT NULL,
  value TEXT NOT NULL,
  effective_from TIMESTAMP DEFAULT NOW(),
  effective_to TIMESTAMP,
  source VARCHAR(50) DEFAULT 'admin',
  admin_name VARCHAR(100),
  version INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE 7: audit_log
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(100),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  actor VARCHAR(20) NOT NULL,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE 8: metrics
-- ============================================================
CREATE TABLE IF NOT EXISTS metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(100),
  path VARCHAR(20),
  latency_ms INT,
  intent VARCHAR(50),
  tool_called VARCHAR(50),
  escalated BOOLEAN DEFAULT false,
  success BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_lead ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_appointments_lead ON appointments(lead_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_escalations_lead ON escalations(lead_id);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON dynamic_knowledge(category);
CREATE INDEX IF NOT EXISTS idx_audit_lead ON audit_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_metrics_session ON metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_metrics_created ON metrics(created_at);
