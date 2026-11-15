import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

const beginMarker = html.indexOf('CORE:BEGIN');
const endMarker = html.indexOf('CORE:END');
assert.ok(beginMarker > 0 && endMarker > beginMarker, 'index.html 里找不到 CORE 标记');

const begin = html.indexOf('*/', beginMarker) + 2;
const end = html.lastIndexOf('/*', endMarker);
const code = html.slice(begin, end);
const core = new Function(code + `
  return {
    METERS_TO_FEET, ISO_OPTIONS, POWER_LEVELS, MODIFIER_PRESETS, TOLERANCE_PRESETS,
    FULL_STOPS, HALF_STOPS, THIRD_STOPS, DEFAULT_FLASH_PRESETS, CHART_DISTANCES_M,
    getApertureStops, getPowerByLabel, getAvailablePowers, getToleranceById,
    metersToUnit, unitToMeters, fmt, fmtEvDelta, calcEffectiveGnMeters,
    findNearestAperture, calcApertureBand, calcDistanceBand,
    solveApertureState, solveDistanceState, solvePowerState
  };
`)();

const {
  METERS_TO_FEET, ISO_OPTIONS, POWER_LEVELS, MODIFIER_PRESETS, TOLERANCE_PRESETS,
  FULL_STOPS, HALF_STOPS, THIRD_STOPS, DEFAULT_FLASH_PRESETS,
  getApertureStops, getPowerByLabel, getAvailablePowers, getToleranceById,
  metersToUnit, unitToMeters, calcEffectiveGnMeters, findNearestAperture,
  calcApertureBand, calcDistanceBand, solveApertureState, solveDistanceState, solvePowerState,
} = core;

const near = (a, b, eps = 1e-6, msg = '') =>
  assert.ok(Math.abs(a - b) < eps, `${msg} 期望 ${b}，实际 ${a}`);

test('有效 GN 随 ISO 按 √ 缩放', () => {
  near(calcEffectiveGnMeters({ gn100m: 12, iso: 100, powerRatio: 1 }).effectiveGnMeters, 12);
  near(calcEffectiveGnMeters({ gn100m: 12, iso: 400, powerRatio: 1 }).effectiveGnMeters, 24);
  near(calcEffectiveGnMeters({ gn100m: 12, iso: 1600, powerRatio: 1 }).effectiveGnMeters, 48);
});

test('有效 GN 随功率按 √ 缩放，且与 ISO 叠加正确', () => {
  near(calcEffectiveGnMeters({ gn100m: 20, iso: 100, powerRatio: 0.25 }).effectiveGnMeters, 10);
  near(calcEffectiveGnMeters({ gn100m: 12, iso: 400, powerRatio: 0.25 }).effectiveGnMeters, 12);
});

test('附件光损与胶片曝光补偿按 EV 折算', () => {
  // -1 EV 柔光罩 + +1 EV 胶片过曝 = 总计 -2 EV，有效 GN 减半
  const { effectiveGnMeters } = calcEffectiveGnMeters({
    gn100m: 24,
    iso: 100,
    powerRatio: 1,
    modifierLossEv: 1,
    exposureBiasEv: 1,
  });
  near(effectiveGnMeters, 12);
});

test('算光圈：整档/半档/1/3 档就近匹配与 EV 偏差', () => {
  const res = solveApertureState({
    gn100m: 12,
    iso: 400,
    powerLabel: '1/4',
    distanceMeters: 2.0,
    modifierLossEv: 0,
    exposureBiasEv: 0,
    stepMode: 'third',
    toleranceId: 'neg',
  });
  near(res.exactAperture, 6.0);
  assert.equal(res.nearest.stop.label, 'f/6.3');
  assert.ok(res.nearest.evDelta < 0, 'f/6.3 比 f/6.0 略小，略欠曝');
  assert.equal(res.warning, '');

  const fullRes = solveApertureState({
    gn100m: 12,
    iso: 100,
    powerLabel: '1/1',
    distanceMeters: 3.0,
    stepMode: 'full',
    toleranceId: 'neg',
  });
  near(fullRes.exactAperture, 4.0);
  assert.equal(fullRes.nearest.stop.label, 'f/4');
  near(fullRes.nearest.evDelta, 0, 1e-6);
});

test('算光圈：极值告警', () => {
  const tooDark = solveApertureState({
    gn100m: 10,
    iso: 100,
    powerLabel: '1/16',
    distanceMeters: 10,
    stepMode: 'full',
    toleranceId: 'neg',
  });
  assert.ok(tooDark.warning.length > 0);

  const tooBright = solveApertureState({
    gn100m: 60,
    iso: 1600,
    powerLabel: '1/1',
    distanceMeters: 1,
    stepMode: 'full',
    toleranceId: 'neg',
  });
  assert.ok(tooBright.warning.length > 0);
});

test('算距离：彩色负片 (+2/−1) 与反转片/严格宽容带', () => {
  const neg = solveDistanceState({
    gn100m: 18,
    iso: 100,
    powerLabel: '1/1',
    apertureValue: 2,
    unit: 'm',
    toleranceId: 'neg',
  });
  near(neg.exactInUnit, 9);
  near(neg.minSafeInUnit, 4.5);
  near(neg.maxSafeInUnit, 9 * Math.SQRT2);

  const strict = solveDistanceState({
    gn100m: 18,
    iso: 100,
    powerLabel: '1/1',
    apertureValue: 2,
    unit: 'm',
    toleranceId: 'strict',
  });
  near(strict.minSafeInUnit, 9);
  near(strict.maxSafeInUnit, 9);
});

test('算功率：反推准确挡位与最低功率限制', () => {
  const res = solvePowerState({
    gn100m: 12,
    iso: 100,
    distanceMeters: 3.0,
    apertureValue: 2.0,
    minPowerLabel: '1/64',
    unit: 'm',
    toleranceId: 'neg',
  });
  assert.equal(res.recommendedPower.label, '1/4');
  near(res.evDelta, 0, 1e-6);
  assert.equal(res.warning, '');

  // 银燕 BY-24ZP 最低仅支持 1/1
  const restricted = solvePowerState({
    gn100m: 24,
    iso: 100,
    distanceMeters: 2.0,
    apertureValue: 2.0,
    minPowerLabel: '1/1',
    unit: 'm',
    toleranceId: 'neg',
  });
  assert.equal(restricted.recommendedPower.label, '1/1');
  assert.ok(restricted.warning.includes('1/1'));
});

test('单位换算与光圈/功率/容差预设完整性', () => {
  near(metersToUnit(1, 'ft'), METERS_TO_FEET);
  near(unitToMeters(METERS_TO_FEET, 'ft'), 1);

  assert.equal(getApertureStops('full').length, FULL_STOPS.length);
  assert.equal(getApertureStops('half').length, HALF_STOPS.length);
  assert.equal(getApertureStops('third').length, THIRD_STOPS.length);
  assert.equal(getPowerByLabel('1/16').ratio, 1 / 16);
  assert.equal(getAvailablePowers('1/16').length, 5);
  assert.equal(getToleranceById('slide').over, 0.5);
  assert.ok(ISO_OPTIONS.includes(160) && ISO_OPTIONS.includes(400));
  assert.ok(MODIFIER_PRESETS.some((m) => m.id === 'bounce' && m.lossEv === 2.0));
  assert.ok(TOLERANCE_PRESETS.length === 4);
  assert.ok(POWER_LEVELS.length === 8);
  assert.ok(DEFAULT_FLASH_PRESETS.length >= 10);
  const bAp = calcApertureBand(4, { over: 2, under: 1 });
  near(bAp.min, 2);
  near(bAp.max, 4 * Math.SQRT2);
  const bDist = calcDistanceBand(4, { over: 2, under: 1 });
  near(bDist.min, 2);
  near(bDist.max, 4 * Math.SQRT2);
});
