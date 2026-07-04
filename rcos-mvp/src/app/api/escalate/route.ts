import { NextRequest, NextResponse } from 'next/server';
import { escalateToHuman } from '@/lib/handoff/escalate';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { lead_id, reason, conversation_id } = body;

  const result = await escalateToHuman(lead_id, reason, conversation_id);

  return NextResponse.json({
    message: result.message,
    ticket_id: result.ticket_id
  });
}
