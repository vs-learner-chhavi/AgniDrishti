import { spawn } from 'node:child_process';
import path from 'node:path';

// Both API routes use this boundary. Neither substitutes heuristic predictions.
export function runModel(payload: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_BIN || 'python3', ['scenario_bridge.py'], {
      cwd: path.join(process.cwd(), 'ml'),
      env: { ...process.env, OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2' },
    });
    let output = '', settled = false, stage = 'Starting Python', stderrBuffer = '';
    const stages = new Set(['Loading feature libraries', 'Preparing observation features', 'Loading trained model', 'Predicting fire type', 'Calculating model explanation', 'Looking up infrastructure', 'Complete']);
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`Prediction timed out during: ${stage}. In your terminal, run .venv/bin/python ml/check_inference.py and share its output.`));
    }, 60_000);
    child.on('error', () => finish(new Error('Python could not start. Set PYTHON_BIN to your project virtual environment’s Python.')));
    child.stdin.on('error', () => finish(new Error('Model input could not be delivered.')));
    child.stderr.on('data', chunk => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = (lines.pop() || '').slice(-2048);
      for (const line of lines) {
        const value = line.replace(/^AGNIDRISHTI_STAGE:/, '');
        if (line.startsWith('AGNIDRISHTI_STAGE:') && stages.has(value)) {
          stage = value;
          console.info(`[AgniDrishti inference] ${stage}`);
        }
      }
    });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.length > 1_000_000) {
        child.kill('SIGKILL');
        finish(new Error('Model output exceeded the expected size.'));
      }
    });
    child.on('close', code => {
      if (code !== 0) return finish(new Error('Model process failed. Install ml/requirements-inference.txt and verify the model files.'));
      try { finish(undefined, JSON.parse(output.trim())); }
      catch { finish(new Error('Model returned invalid output.')); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export const fireTypeLabels: Record<string, string> = {
  industrial_fire: 'Industrial Fire', gas_flare: 'Gas Flare', agricultural_burning: 'Crop Burning',
  wildfire: 'Wildfire', mining_thermal_source: 'Mining',
};
