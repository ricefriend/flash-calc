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

// 标记本身在注释里，取注释结束之后到下一段注释开始之前的内容
const begin = html.indexOf('*/', beginMarker) + 2;
const end = html.lastIndexOf('/*', endMarker);
const code = html.slice(begin, end);
const core = new Function(code + `
  return { FLASHES, SERIES, TOL, POWERS, ISO_SERIES, ISO_STOPS, powerLabel, gnAt, distFor, fExactFor,
           bandFor, fBandFor, distErrStops, fErrStops, nearestF, powerFor, isoRating };
`)();

const { FLASHES, SERIES, TOL, POWERS, ISO_SERIES, ISO_STOPS, powerLabel, gnAt, distFor, fExactFor,
        bandFor, fBandFor, distErrStops, fErrStops, nearestF, powerFor, isoRating } = core;

const near = (a, b, eps = 1e-6, msg = '') =>
  assert.ok(Math.abs(a - b) < eps, `${msg} 期望 ${b}，实际 ${a}`);

test('指数随 ISO 按 √ 缩放', () => {
  near(gnAt(36, 100, 1), 36, 1e-9, 'ISO100');
  near(gnAt(36, 400, 1), 72, 1e-9, 'ISO400 翻倍');
  near(gnAt(36, 1600, 1), 144, 1e-9, 'ISO1600 四倍');
});

test('指数随功率按 √ 缩放', () => {
  near(gnAt(36, 100, 0.5), 36 / Math.SQRT2, 1e-9, '半功率');
  near(gnAt(36, 100, 0.25), 18, 1e-9, '1/4 功率');
  near(gnAt(36, 100, 1 / 128), 36 / Math.sqrt(128), 1e-9, '1/128 功率');
});

test('ISO 和功率叠加', () => {
  near(gnAt(36, 400, 0.25), 36, 1e-9, 'ISO400 + 1/4 功率 = 回到 36');
});

test('距离 = 指数 ÷ 光圈', () => {
  near(distFor(36, 1), 36, 1e-9);
  near(distFor(36, 8), 4.5, 1e-9);
  near(distFor(72, 5.6), 72 / 5.6, 1e-9);
});

test('需要的光圈 = 指数 ÷ 距离', () => {
  near(fExactFor(72, 3), 24, 1e-9);
  near(fExactFor(36, 4.5), 8, 1e-9);
});

test('负片宽容带：+2 / −1 档 → 距离 [d/2, d√2]', () => {
  const b = bandFor(9, TOL.neg);
  near(b.min, 4.5, 1e-9, '近端过曝两档');
  near(b.max, 9 * Math.SQRT2, 1e-9, '远端欠曝一档');
  near(distErrStops(9, b.min), 2, 1e-9, '近端应是 +2 档');
  near(distErrStops(9, b.max), -1, 1e-9, '远端应是 −1 档');
});

test('反转片与数码的宽容带更窄', () => {
  const s = bandFor(9, TOL.slide);
  const g = bandFor(9, TOL.digi);
  near(distErrStops(9, s.min), 0.5, 1e-9);
  near(distErrStops(9, g.min), 1 / 3, 1e-9);
  assert.ok(s.min > bandFor(9, TOL.neg).min, '反转片近端必须比负片更靠远');
  assert.ok(g.min > s.min, '数码近端必须比反转片更靠远');
});

test('严格模式容差为零', () => {
  const b = bandFor(9, TOL.strict);
  near(b.min, 9, 1e-9);
  near(b.max, 9, 1e-9);
});

test('光圈容差区间方向正确（大光圈数 = 暗）', () => {
  const fb = fBandFor(24, TOL.neg);
  near(fb.min, 12, 1e-9, '更亮的一侧光圈数变小');
  near(fb.max, 24 * Math.SQRT2, 1e-9);
  near(fErrStops(24, fb.min), 2, 1e-9);
});

test('光圈误差：收小一档 = 欠一档', () => {
  near(fErrStops(8, 11), 2 * Math.log2(8 / 11), 1e-9, '8 → 11');
  assert.ok(fErrStops(8, 11) < 0, '收小光圈必须是负（欠曝）');
  assert.ok(distErrStops(9, 4.5) > 0, '靠近必须是正（过曝）');
});

test('就近取档按档数而不是线性距离', () => {
  assert.equal(nearestF(SERIES.half, 5.7), 5.6);
  assert.equal(nearestF(SERIES.half, 1.8), 1.7);
  assert.equal(nearestF(SERIES.third, 1.8), 1.8);
  assert.equal(nearestF(SERIES.full, 1.8), 2);
  assert.equal(nearestF(SERIES.full, 3.5), 4);
  assert.equal(nearestF(SERIES.full, 0.7), 1, '超出最快档时夹到 f/1');
  assert.equal(nearestF(SERIES.full, 99), 32, '超出最慢档时夹到 f/32');
});

test('功率换算：f/8、3 米、ISO100、GN36', () => {
  const p = powerFor(36, 100, 8, 3);
  near(p.gnFull, 36, 1e-9);
  near(p.gnReq, 24, 1e-9);
  near(p.frac, 4 / 9, 1e-9, '(24/36)²');
  assert.equal(p.idx, 4, '第 4 个 1/3 档');
  assert.equal(powerLabel(p.idx), '1/2 −0.3');
});

test('功率换算：近距离落到 1/64 区间', () => {
  const p = powerFor(36, 100, 8, 0.5);
  near(p.gnReq, 4, 1e-9);
  near(p.frac, Math.pow(4 / 36, 2), 1e-9);
  assert.ok(p.idx >= 18 && p.idx <= 20, `实际 idx=${p.idx}`);
});

test('功率换算：15 米远灯不够', () => {
  const p = powerFor(36, 100, 8, 15);
  near(p.gnReq, 120, 1e-9);
  assert.ok(p.frac > 1, `frac=${p.frac} 应大于 1`);
});

test('功率换算：ISO 提高后同样的距离够用了', () => {
  const p100 = powerFor(36, 100, 8, 12);
  const p800 = powerFor(36, 800, 8, 12);
  assert.ok(p100.frac > 1, 'ISO100 时 12 米不够');
  assert.ok(p800.frac <= 1, 'ISO800 时 12 米够');
  near(p800.frac, p100.frac / 8, 1e-9, 'ISO 每翻一倍，所需功率比例减半');
});

test('功率档位表：1/1 到 1/128，共 22 档', () => {
  assert.equal(POWERS.length, 22);
  near(POWERS[0], 1, 1e-12);
  near(POWERS[21], 1 / 128, 1e-12);
  near(POWERS[3], 0.5, 1e-12);
  assert.equal(powerLabel(0), '1/1');
  assert.equal(powerLabel(3), '1/2');
  assert.equal(powerLabel(6), '1/4');
  assert.equal(powerLabel(9), '1/8');
  assert.equal(powerLabel(21), '1/128');
  // 每 3 档正好一档整光圈
  for (let k = 0; k + 3 < POWERS.length; k++) near(POWERS[k] / POWERS[k + 3], 2, 1e-9);
});

test('功率标签按闪光灯 LCD 的写法：整档 + 三分之一档偏移', () => {
  assert.equal(powerLabel(1), '1/1 −0.3');
  assert.equal(powerLabel(2), '1/1 −0.7');
  assert.equal(powerLabel(4), '1/2 −0.3');
  assert.equal(powerLabel(5), '1/2 −0.7');
  assert.equal(powerLabel(10), '1/8 −0.3');
  assert.equal(powerLabel(14), '1/16 −0.7');
  // 分母必须是灯上真有的整档数，不能出现 1/10.1 这种写法
  const allowed = [1, 2, 4, 8, 16, 32, 64, 128];
  for (let k = 0; k < 22; k++){
    const m = powerLabel(k).match(/^1\/(\d+)/);
    assert.ok(m, `第 ${k} 档标签格式不对：${powerLabel(k)}`);
    assert.ok(allowed.includes(Number(m[1])), `第 ${k} 档分母 ${m[1]} 不是整档`);
  }
});

test('三种模式互相闭合', () => {
  const gn = gnAt(36, 400, 0.25);           // = 36
  const d = distFor(gn, 5.6);
  near(fExactFor(gn, d), 5.6, 1e-9, '距离 → 光圈应回到原值');
  const p = powerFor(36, 400, 5.6, d);
  near(p.frac, 0.25, 1e-9, '功率比例应回到 1/4');
  assert.equal(p.idx, 6, '1/4 应是第 6 个 1/3 档');
});

test('光圈序列单调递增且覆盖常用档', () => {
  for (const key of ['full', 'half', 'third']){
    const s = SERIES[key];
    for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1], `${key} 第 ${i} 项不单调`);
  }
  assert.deepEqual(SERIES.full, [1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22, 32]);
  assert.ok(SERIES.third.includes(1.8), '1/3 档表要含 f/1.8（Konica 那颗镜头）');
  assert.ok(SERIES.half.includes(5.6) && SERIES.half.includes(11));
});

test('ISO 序列：1/3 档、25–6400、含 160', () => {
  assert.equal(ISO_SERIES[0], 25);
  assert.equal(ISO_SERIES[ISO_SERIES.length - 1], 6400);
  for (let i = 1; i < ISO_SERIES.length; i++){
    assert.ok(ISO_SERIES[i] > ISO_SERIES[i - 1], `第 ${i} 项不单调`);
    const ratio = ISO_SERIES[i] / ISO_SERIES[i - 1];
    // 1/3 档 = 1.2599 倍，取整到标称值后会在 1.25–1.28 之间
    assert.ok(ratio > 1.22 && ratio < 1.31, `${ISO_SERIES[i - 1]} → ${ISO_SERIES[i]} 不是 1/3 档`);
  }
  assert.ok(ISO_SERIES.includes(160), '要有 160');
  for (const v of [100, 200, 400, 800]) assert.ok(ISO_SERIES.includes(v), `要有 ${v}`);
  // 整档值必须按 2 倍相邻
  for (let i = 1; i < ISO_STOPS.length; i++) assert.equal(ISO_STOPS[i], ISO_STOPS[i - 1] * 2);
});

test('ISO 评级：200 的卷按 160 拍 = 过曝 1/3 档', () => {
  const r = isoRating(160);
  assert.ok(r, '160 不该返回 null');
  assert.equal(r.base, 200);
  assert.ok(r.stops > 0, '160 相对 200 是过曝');
  near(r.stops, Math.log2(200 / 160), 1e-9);
  assert.equal(r.text, '相当于把 200 的卷过曝 1/3 档');
});

test('ISO 评级：整档值不显示提示', () => {
  for (const v of [25, 50, 100, 200, 400, 800, 1600, 3200, 6400]) assert.equal(isoRating(v), null);
});

test('ISO 评级：整档值不显示提示，320 是 400 欠 1/3', () => {
  for (const v of [25, 50, 100, 200, 400, 800, 1600, 3200, 6400]) assert.equal(isoRating(v), null);
  const r2 = isoRating(320);
  assert.equal(r2.base, 400);
  assert.ok(r2.stops > 0 && r2.text.indexOf('过曝') >= 0);
  const r3 = isoRating(250);
  assert.equal(r3.base, 200);
  assert.ok(r3.stops < 0 && r3.text.indexOf('欠曝') >= 0);
});

test('闪光灯预设：指数与标称灯头焦距都写了', () => {
  assert.ok(FLASHES.length >= 5, '至少内置几个型号');
  const tt350 = FLASHES.find((f) => f.id === 'tt350');
  assert.equal(tt350.gn, 36);
  assert.equal(tt350.zoom, 105);
  for (const f of FLASHES){
    assert.ok(f.name, `${f.id} 缺名字`);
    if (f.custom) continue;
    assert.ok(f.gn > 5 && f.gn < 120, `${f.id} 的指数 ${f.gn} 不像样`);
    assert.ok(f.zoom >= 24 && f.zoom <= 200, `${f.id} 的焦距 ${f.zoom} 不像样`);
  }
  assert.ok(FLASHES.some((f) => f.custom), '必须有自定义入口');
  const ids = FLASHES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, '型号 id 不能重复');
});
