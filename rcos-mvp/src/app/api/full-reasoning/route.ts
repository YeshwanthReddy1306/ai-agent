import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { groq } from '@ai-sdk/groq';

// NOTE: This rcos-mvp scaffold is NOT the deployed system (server.js is). Kept for the
// Next.js migration path only. GUARD: Groq must NEVER handle Telugu/Hindi — it destroys them
// (field-proven). Those languages belong on Sarvam-105b via the main server, not here.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { transcript, session_id, user_id, language } = body;

  if (language && language !== 'en-IN') {
    return NextResponse.json(
      { error: 'Telugu/Hindi must be handled by the Sarvam pipeline (server.js), not Groq.' },
      { status: 400 }
    );
  }

  const result = await generateText({
    model: groq('llama-3.3-70b-versatile'),
    system: `You are a 30-year veteran admissions counselor at Resonance Hyderabad.
             Reply in English only. Be warm, professional, and honest.
             Never confirm false hope. State only fees/facts you were given — never invent numbers.
             Always provide actionable next steps.`,
    prompt: transcript
  });

  const escalated = result.text.includes('escalate') || 
                    result.text.includes('connect you to a counselor');

  return NextResponse.json({
    response: result.text,
    intent: 'full_reasoning',
    emotion: 'professional',
    escalated
  });
}
