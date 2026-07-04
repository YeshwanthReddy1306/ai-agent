import { pool } from '../db/pool';

export async function logMetric(data: any) {
  try {
    if (!pool) return;
    await pool.query(
      `INSERT INTO metrics (session_id, path, latency_ms, intent, tool_called, escalated, success, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [data.session_id, data.path, data.latency_ms, data.intent, data.tool_called || null, data.escalated || false, data.success !== false]
    );
  } catch (error: any) {
    console.error('Failed to log metric:', error.message);
  }
}

export async function getMetrics(startDate: Date, endDate: Date) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT
      COUNT(*) as total_calls,
      AVG(latency_ms) as avg_latency,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency,
      COUNT(CASE WHEN path = 'fast' THEN 1 END) as fast_path_count,
      COUNT(CASE WHEN path = 'full' THEN 1 END) as full_path_count,
      COUNT(CASE WHEN escalated THEN 1 END) as escalation_count,
      COUNT(CASE WHEN success THEN 1 END) as success_count
     FROM metrics WHERE created_at BETWEEN $1 AND $2`,
    [startDate, endDate]
  );
  return result.rows[0];
}
