import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function runAnalyticsReader(): Promise<any> {
  return new Promise((resolve, reject) => {
    const python = process.env.PYTHON_BIN || 'python3';
    const script = path.join(process.cwd(), 'scripts', 'read_analytics_30d.py');
    const child = spawn(python, [script], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => reject(error));

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Analytics reader exited with ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error('Analytics reader returned invalid JSON.'));
      }
    });
  });
}

export async function GET() {
  try {
    const payload = await runAnalyticsReader();
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unable to read processed FIRMS analytics data.',
      },
      { status: 503 },
    );
  }
}
