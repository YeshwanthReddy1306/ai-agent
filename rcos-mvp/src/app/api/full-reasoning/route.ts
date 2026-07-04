import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { groq } from '@ai-sdk/groq';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { transcript, session_id, user_id, language } = body;

  const result = await generateText({
    model: groq('llama-3-70b-8192'),
    system: `You are a 30-year veteran admissions counselor at Resonance Hyderabad.
             You speak in ${language || 'en-IN'}.
             Be warm, professional, and honest.
             Never confirm false hope.
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
