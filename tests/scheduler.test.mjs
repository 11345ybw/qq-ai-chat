import assert from 'node:assert/strict';
import test from 'node:test';

import { applyProactiveAttempt, applyProactiveSent, applyUserMessage, decideProactive, inQuietHours, quietHoursEnd } from '../src/scheduler.mjs';

const at = (s) => new Date(`2026-10-10T${s}+08:00`);

const baseCfg = {
  enabled: true,
  idleSeconds: 300,
  jitterPercent: 0,
  onlyAfterUserMessage: true,
  quietHours: ['23:30', '07:30'],
  maxConsecutive: 3,
  stopAfterMax: true,
  backoffMultiplier: 1.6,
  maxIdleSeconds: 1800,
  checkIntervalSeconds: 20,
  minSecondsBetweenAnyMessage: 45,
};

const baseState = (over = {}) => ({
  lastUserAt: 0,
  lastBotAt: 0,
  lastProactiveAt: 0,
  lastProactiveAttemptAt: 0,
  consecutiveProactive: 0,
  currentIdleMs: null,
  everUserMessage: true,
  ...over,
});

test('inQuietHours 支持跨零点', () => {
  const q = ['23:30', '07:30'];
  assert.equal(inQuietHours(at('23:45:00'), q), true);
  assert.equal(inQuietHours(at('00:10:00'), q), true);
  assert.equal(inQuietHours(at('07:29:00'), q), true);
  assert.equal(inQuietHours(at('07:30:00'), q), false);
  assert.equal(inQuietHours(at('12:00:00'), q), false);
});

test('inQuietHours 支持普通区间与空值', () => {
  const q = ['13:00', '14:00'];
  assert.equal(inQuietHours(at('13:30:00'), q), true);
  assert.equal(inQuietHours(at('15:00:00'), q), false);
  assert.equal(inQuietHours(at('15:00:00'), null), false);
  assert.equal(inQuietHours(at('15:00:00'), ['bad', '14:00']), false);
});

test('quietHoursEnd 给出今晚或明早的结束时刻', () => {
  const end = quietHoursEnd(at('23:45:00'), ['23:30', '07:30']);
  assert.equal(`${end.getHours()}:${String(end.getMinutes()).padStart(2, '0')}`, '7:30');
  assert.ok(end.getTime() > at('23:45:00').getTime());
});

test('关闭时永远等待', () => {
  const d = decideProactive(baseState(), { ...baseCfg, enabled: false }, at('12:00:00'));
  assert.equal(d.action, 'wait');
  assert.match(d.reason, /关闭/);
});

test('对方没发过消息时不主动', () => {
  const d = decideProactive(baseState({ everUserMessage: false }), baseCfg, at('12:00:00'));
  assert.equal(d.action, 'wait');
  assert.match(d.reason, /还没发过消息/);
});

test('免打扰时段不发', () => {
  const d = decideProactive(baseState({ lastUserAt: at('23:00:00').getTime() }), baseCfg, at('23:45:00'));
  assert.equal(d.action, 'wait');
  assert.match(d.reason, /免打扰/);
});

test('沉默不够久不发', () => {
  const state = baseState({ lastUserAt: at('12:00:00').getTime() });
  const d = decideProactive(state, baseCfg, at('12:02:00'));
  assert.equal(d.action, 'wait');
  assert.match(d.reason, /阈值/);
});

test('沉默够久了就发', () => {
  const state = baseState({ lastUserAt: at('12:00:00').getTime() });
  const d = decideProactive(state, baseCfg, at('12:06:00'));
  assert.equal(d.action, 'send');
});

test('连发到上限后停下等他回话', () => {
  const state = baseState({ lastUserAt: at('12:00:00').getTime(), consecutiveProactive: 3, lastBotAt: at('12:05:00').getTime() });
  const d = decideProactive(state, baseCfg, at('12:30:00'));
  assert.equal(d.action, 'wait');
  assert.match(d.reason, /连发/);
});

test('刚尝试过（可能失败）时不重复打接口', () => {
  const state = baseState({ lastUserAt: at('12:00:00').getTime(), lastProactiveAttemptAt: at('12:06:00').getTime() });
  const d = decideProactive(state, baseCfg, at('12:06:20'));
  assert.equal(d.action, 'wait');
  assert.match(d.reason, /刚尝试过/);
});

test('连续失败会把重试间隔拉长', () => {
  const state = baseState({
    lastUserAt: at('12:00:00').getTime(),
    lastProactiveAttemptAt: at('12:06:00').getTime(),
    proactiveFailures: 4,
  });
  // 间隔 = minSecondsBetweenAnyMessage * (1 + 4) = 225 秒
  assert.equal(decideProactive(state, baseCfg, at('12:07:00')).action, 'wait');
  assert.equal(decideProactive(state, baseCfg, at('12:09:00')).action, 'wait');
  assert.equal(decideProactive(state, baseCfg, at('12:10:00')).action, 'send');
});

test('成功发出后失败计数清零', () => {
  const state = baseState({ proactiveFailures: 5 });
  applyProactiveSent(state, baseCfg, at('12:00:00'));
  assert.equal(state.proactiveFailures, 0);
});

test('对方回话后失败计数清零', () => {
  const state = baseState({ proactiveFailures: 5 });
  applyUserMessage(state, baseCfg, at('12:00:00'));
  assert.equal(state.proactiveFailures, 0);
});

test('applyUserMessage 复位计数与阈值', () => {
  const cfg = baseCfg;
  const state = baseState({ consecutiveProactive: 2, currentIdleMs: 900000 });
  applyUserMessage(state, cfg, at('12:00:00'));
  assert.equal(state.consecutiveProactive, 0);
  assert.equal(state.currentIdleMs, cfg.idleSeconds * 1000);
  assert.equal(state.lastUserAt, at('12:00:00').getTime());
  assert.equal(state.totalUserMessages, 1);
});

test('applyProactiveSent 计数递增并按倍数退避且不超上限', () => {
  const state = baseState();
  applyProactiveSent(state, baseCfg, at('12:00:00'));
  assert.equal(state.consecutiveProactive, 1);
  assert.equal(state.currentIdleMs, 300000 * 1.6);
  for (let i = 0; i < 10; i += 1) applyProactiveSent(state, baseCfg, at('12:10:00'));
  assert.equal(state.currentIdleMs, baseCfg.maxIdleSeconds * 1000);
  assert.equal(state.totalBotMessages, 11);
});

test('applyProactiveAttempt 只记时间不改计数', () => {
  const state = baseState();
  applyProactiveAttempt(state, at('12:00:00'));
  assert.equal(state.lastProactiveAttemptAt, at('12:00:00').getTime());
  assert.equal(state.consecutiveProactive, 0);
});
