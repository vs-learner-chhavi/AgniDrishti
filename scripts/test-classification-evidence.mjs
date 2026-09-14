import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = mkdtempSync(path.join(tmpdir(), 'agnidrishti-evidence-'));
let evidence;
try {
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
    'lib/classification-evidence.ts', '--outDir', output, '--module', 'commonjs',
    '--target', 'ES2021', '--skipLibCheck'], { cwd: root });
  evidence = createRequire(import.meta.url)(path.join(output, 'classification-evidence.js'));
} finally { rmSync(output, { recursive: true, force: true }); }
const { explanationSummary, evidenceGroups } = evidence;
const factor = (feature, value, shap_value) => ({ feature, value, shap_value });
// Reproduce the user's three-negative Mining excerpt. These are test inputs,
// not a claimed live model run or invented supporting evidence.
const excerpt = [factor('persistent_activity', 0, -.9), factor('active_days_30d', 3, -.7), factor('frp_per_detection_30d', 1.77, -.5)];
const probabilities = { mining_thermal_source: .4, industrial_fire: .36, gas_flare: .12, agricultural_burning: .08, wildfire: .04 };

test('40% Mining remains tentative, merges recurrence, and shows the actual runner-up', () => {
  const result = explanationSummary('mining_thermal_source', .4, excerpt, probabilities);
  assert.match(result.opening, /40.0%.*tentative/);
  assert.equal(result.supporting.length, 0);
  assert.equal(result.opposing.length, 2);
  assert.equal(result.opposing[0].text, 'Detected on 3 of the previous 30 days');
  assert.match(result.opposing[1].text, /1.77 MW/);
  assert.match(result.noSupport, /saved excerpt/);
  assert.match(result.alternative, /Industrial Fire.*36.0%.*4.0 percentage points.*close call/);
});
test('support below the old top-three cutoff is surfaced from the full contribution list', () => {
  const result = explanationSummary('mining_thermal_source', .4, [...excerpt, factor('brightness', 320, .2)], probabilities, true);
  assert.equal(result.supporting.length, 1);
  assert.match(result.supporting[0].text, /320 K/);
});
test('all-negative full explanations discuss baselines without inventing positive factors', () => {
  const result = explanationSummary('mining_thermal_source', .4, excerpt, probabilities, true);
  assert.equal(result.supporting.length, 0);
  assert.match(result.noSupport, /No inputs raise.*baseline/);
  assert.doesNotMatch(result.noSupport, /saved excerpt/);
});
test('opposite recurrence contributions stay in their respective sections', () => {
  const factors = [factor('active_days_7d', 2, .3), factor('active_days_30d', 3, -.5)];
  assert.match(evidenceGroups(factors, 1)[0].text, /2 of the previous 7/);
  assert.match(evidenceGroups(factors, -1)[0].text, /3 of the previous 30/);
});
test('neutral and invalid contributions never become supporting/opposing reasons', () => {
  const factors = [factor('frp', 1, 0), factor('brightness', 300, NaN), factor('hour', 12, Infinity)];
  assert.deepEqual(evidenceGroups(factors, 1), []);
  assert.deepEqual(evidenceGroups(factors, -1), []);
  assert.doesNotMatch(explanationSummary('wildfire', .9, factors, {}, true).opening, /support this result/);
});
test('missing class probabilities do not create a fictional alternative', () => {
  const result = explanationSummary('wildfire', .8, [], {}, false);
  assert.equal(result.runnerUp, undefined);
  assert.match(result.alternative, /unavailable/);
  assert.match(result.noSupport, /No model contributions/);
});
test('ties and narrow leads are tentative even above 50%', () => {
  const result = explanationSummary('wildfire', .51, [factor('frp', 40, .3)], { wildfire: .51, agricultural_burning: .49 }, true);
  assert.match(result.opening, /tentative/);
  assert.match(result.alternative, /Crop Burning.*close call/);
  const tied = explanationSummary('wildfire', .5, [], { wildfire: .5, gas_flare: .5 }, true);
  assert.match(tied.alternative, /0.0 percentage points.*close call/);
});
test('display labels also exclude the predicted class from alternatives', () => {
  const result = explanationSummary('Mining thermal source', .4, excerpt, probabilities);
  assert.equal(result.runnerUp[0], 'industrial_fire');
});
test('grouping leaves the original technical evidence unchanged', () => {
  const factors = [...excerpt, factor('brightness', 330, .2)];
  const before = JSON.stringify(factors);
  explanationSummary('mining_thermal_source', .4, factors, probabilities, true);
  assert.equal(JSON.stringify(factors), before);
});
