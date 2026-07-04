import { NextRequest, NextResponse } from 'next/server';
import { routeFastPath } from '@/lib/fast-path/faq-rules';
import { logMetric } from '@/lib/observability/metrics';

const USE_FULL_REASONING = process.env.USE_FULL_REASONING === 'true' ? true : false;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transcript, session_id, user_id, language } = body;
    const startTime = Date.now();

    // 1. Try Fast Path first
    if (!USE_FULL_REASONING) {
      const fastResult = routeFastPath(transcript);
      if (fastResult.matched) {
        await logMetric({
          session_id,
          path: 'fast',
          latency_ms: Date.now() - startTime,
          intent: 'faq',
          escalated: false,
          success: true
        });
        
        return NextResponse.json({
          response: fastResult.response,
          language: language || 'en-IN',
          emotion: 'professional'
        });
      }
    }

    // 2. Full Reasoning
    const frUrl = new URL('/api/full-reasoning', req.url);
    const frReq = await fetch(frUrl.toString(), {
      method: 'POST',
      body: JSON.stringify({ transcript, session_id, user_id, language }),
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!frReq.ok) {
      throw new Error('Full reasoning failed');
    }
    
    const result = await frReq.json();

    await logMetric({
      session_id,
      path: 'full',
      latency_ms: Date.now() - startTime,
      intent: result.intent,
      tool_called: result.tool_called,
      escalated: result.escalated || false,
      success: true
    });

    return NextResponse.json({
      response: result.response,
      language: language || 'en-IN',
      emotion: result.emotion || 'professional'
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
