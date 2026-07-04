import { NextRequest, NextResponse } from 'next/server';
import { routeFastPath } from '@/lib/fast-path/faq-rules';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { query } = body;
  
  const result = routeFastPath(query);
  
  return NextResponse.json({
    matched: result.matched,
    response: result.response
  });
}
