// Run with Playwright installed (or set PLAYWRIGHT_MODULE to its module directory).
// Test-only instrumentation is served from memory; index.html is never modified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/standardrobot.json'), 'utf8'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const marker = '      initializeDefaults();';
assert.equal(html.split(marker).length, 2);
html = html.replace(marker, `      window.__H = { state, refs, robotCrc, createDerivedRuntimeSeed, processDerivedRobotChunk, queueRxBytes, deriveData, renderDirty, scheduleRefresh, invalidateDerivedCaches, createChart, renderCharts, getChartSelectableFields, getChartFrameIntervalMs, startRecording, archiveCurrentRecording, setActiveTimeline, buildAnalysisExportTable, buildDerivedExportRuntimeForTimeline, snapshotTimelineGraphConfig, snapshotParserGraphState, persistLocalPrefsNow, clearRealtimeHistoryData };\n${marker}`);

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => route.request().url().startsWith(url) ? route.continue() : route.abort());
    await page.goto(url);
    if (await page.locator('#version-modal-close').isVisible()) await page.locator('#version-modal-close').click();
    await page.waitForFunction(() => !!window.__H);
    assert.equal(await page.locator('#robot-dashboard').isVisible(), true, 'IMU dashboard is the default workspace');
    assert.equal(await page.locator('.config-panel').isVisible(), true, 'connection manager remains available');
    assert.equal(await page.locator('.chart-panel').count(), 1, 'default custom debug waveform');
    assert.equal(await page.locator('[data-robot-packet]').count(), 9, 'nine dedicated packet information groups below IMU');
    assert.equal(await page.locator('[data-robot-packet][data-packet-state="received"]').count(), 0, 'no invented packet readings before receive');
    const initialChart = page.locator('.chart-panel').first();
    assert.deepEqual(await initialChart.locator('[data-chart-robot-group] option').evaluateAll(options => options.map(option => option.value)), ['debug'], 'only custom debug source is selectable');
    assert.equal(await initialChart.locator('.scope-data-selector').isVisible(), true, 'data selection is directly visible outside settings');
    await initialChart.locator('[data-chart-toggle]').click();
    assert.equal(await initialChart.locator('.chart-config [data-chart-robot-group], .chart-config [data-scope-channel-select], .chart-config [data-chart-binding]').count(), 0, 'gear settings contain plotting parameters only');
    await initialChart.locator('[data-chart-toggle]').click();
    await initialChart.locator('[data-chart-robot-group]').locator('..').locator('.custom-select-trigger').click();
    await page.locator('.custom-select-menu.open .custom-select-option', { hasText: '自定义调试数据' }).click();
    assert.match(await initialChart.locator('[data-chart-robot-hint]').textContent(), /等待对应数据包/);
    assert.equal(await initialChart.locator('[data-chart-robot-group]').inputValue(), 'debug');
    await initialChart.locator('[data-scope-channel-panel] summary').click();
    await page.evaluate((frame) => { window.__H.queueRxBytes(Uint8Array.from(frame), Date.now()); }, fixtures.debug);
    await page.waitForFunction(() => window.__H.state.charts[0].bindings.includes('parsed.debug.speed'));
    await page.waitForFunction(() => document.querySelector('[data-chart-robot-hint]').textContent.includes('已绑定 3'));
    assert.notEqual(await initialChart.locator('[data-scope-channel-panel]').getAttribute('open'), null, 'channel picker remains expanded when fields arrive');
    assert.equal(await initialChart.locator('.scope-channel-list [data-scope-channel-select]').count(), 3, 'new custom fields appear in independent picker');
    assert.deepEqual((await initialChart.locator('.scope-channel-list label span').allTextContents()).sort(), ['count', 'speed', '温度'], 'channel labels preserve device supplied UTF-8 field names');
    await page.evaluate((f) => {
      const h = window.__H;
      const names = ['imu', 'robot', 'game', 'event', 'pid', 'motion', 'hp', 'position', 'status', 'joint'];
      h.queueRxBytes(Uint8Array.from(names.flatMap(name => f[name])), Date.now() + 20);
    }, fixtures);
    await page.waitForFunction(() => document.querySelectorAll('[data-robot-packet][data-packet-state="received"]').length === 9);
    assert.match(await page.locator('[data-robot-packet="pid"]').textContent(), /反馈值 fdb.*1\.25/);
    assert.match(await page.locator('[data-robot-packet="event"]').textContent(), /0xFFFFFFFF/);
    assert.match(await page.locator('[data-robot-packet="hp"]').textContent(), /蓝方基地115/);
    assert.match(await page.locator('[data-robot-packet="status"]').textContent(), /当前血量400/);
    assert.ok(await page.evaluate(() => document.querySelector('#robot-other-info').getBoundingClientRect().top >= document.querySelector('.robot-imu-layout').getBoundingClientRect().bottom), 'packet information is positioned below IMU');
    assert.equal(await initialChart.locator('[data-scope-channel-select]').count(), 3, 'built-in packet fields never enter custom channel picker');
    assert.equal(await page.evaluate(() => window.__H.getChartSelectableFields().every(field => field.key.startsWith('parsed.debug.'))), true);
    assert.deepEqual((await page.locator('#parser-preview strong').allTextContents()).sort(), ['count', 'speed', '温度'], 'custom result panel does not duplicate IMU or built-in status packets');
    if (process.env.UPDATE_ROBOT_INFO_PREVIEW) await page.locator('#robot-other-info').screenshot({ path: path.join(root, 'docs/robot-status-preview.png') });
    await page.setViewportSize({ width: 390, height: 1100 });
    await page.waitForFunction(() => document.body.classList.contains('compact-single') && Number(getComputedStyle(document.querySelector('.left-column')).opacity) === 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && Array.from(document.querySelectorAll('.robot-packet-card')).every(card => card.scrollWidth <= card.clientWidth + 1)), 'populated packet cards fit a mobile screen');
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.waitForFunction(() => !document.body.classList.contains('compact-single'));
    await initialChart.locator('[data-scope-channel-select="parsed.debug.count"]').uncheck();
    await page.evaluate(() => {
      const h = window.__H, frame = new Uint8Array(25), view = new DataView(frame.buffer);
      frame.set([0x5a, 19, 1]); frame[3] = h.robotCrc(frame.subarray(0, 3), 8);
      view.setUint32(4, 123457, true); frame.set(new TextEncoder().encode('yaw'), 8); frame[18] = 1;
      view.setFloat32(19, 1.25, true); view.setUint16(23, h.robotCrc(frame.subarray(0, 23), 16), true);
      h.queueRxBytes(frame, Date.now() + 40);
    });
    await page.waitForFunction(() => document.querySelector('[data-scope-channel-select="parsed.debug.yaw"]'));
    assert.equal(await initialChart.locator('[data-scope-channel-select="parsed.debug.count"]').isChecked(), false, 'field arrival preserves unchecked channels');
    assert.equal(await initialChart.locator('[data-scope-channel-select="parsed.debug.yaw"]').locator('..').locator('span').textContent(), 'yaw');
    assert.equal(await page.evaluate(() => window.__H.state.derivedRuntime.robot.imu.values['imu.yaw']), 0.5, 'custom yaw never overwrites IMU yaw');
    await page.evaluate(() => {
      const h = window.__H, legacy = h.createChart('time');
      legacy.robotGroup = 'imu'; legacy.name = 'IMU 欧拉角 · rad'; legacy.bindings = ['parsed.imu.yaw'];
      h.state.charts.push(legacy); h.scheduleRefresh();
    });
    await page.waitForFunction(() => window.__H.state.charts.at(-1).robotGroup === 'debug' && window.__H.state.charts.at(-1).bindings.every(key => key.startsWith('parsed.debug.')));
    assert.equal(await page.locator('.chart-panel').last().locator('[data-chart-robot-group] option').count(), 1, 'old chart configurations migrate to custom-only selection');
    await page.evaluate(() => {
      const h = window.__H;
      h.state.charts.pop();
      h.clearRealtimeHistoryData();
      h.state.charts[0].robotGroup = 'debug';
      h.state.charts[0].bindings = [];
      h.deriveData(); h.renderCharts(true);
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-robot-packet][data-packet-state="received"]').length === 0);
    console.log('PASS nine live packet panels, custom-only plot source, named UTF-8 channels, dynamic fields/selection preservation, legacy chart migration');

    const parserResults = await page.evaluate((f) => {
      const h = window.__H;
      const check = (ok, description) => { if (!ok) throw new Error(description); };
      const runtime = () => h.createDerivedRuntimeSeed('robot', 'timeline');
      const feed = (r, bytes, timestamp = 1000, direction = 'rx') => h.processDerivedRobotChunk(r, { bytes, timestamp, direction });
      const r = runtime();
      for (const byte of f.imu) feed(r, [byte]);
      check(r.robot.valid === 1 && r.robot.buffer.length === 0, 'one-byte chunks decode one frame');
      check(r.robot.imu.values['imu.pitch'] === -0.25, 'IMU signed Float32');
      check(r.robot.imu.deviceTimestamp === 123456, 'device timestamp');
      for (let split = 0; split <= f.debug.length; split += 1) {
        const sample = runtime(); feed(sample, f.debug.slice(0, split)); feed(sample, f.debug.slice(split));
        check(sample.robot.valid === 1 && sample.allCardsMap['debug.count'] === 4294967295 && sample.allCardsMap['debug.温度'] === -20.25, 'all custom packet splits, UInt32 and UTF-8');
      }
      feed(r, [...f.debug, ...f.imu], 1020);
      check(r.robot.valid === 3 && r.numericSeries['parsed.imu.yaw'][1].t === 20, 'sticky packets preserve actual receive times');
      const badHeader = [...f.imu]; badHeader[3] ^= 1;
      const badCrc = [...f.imu]; badCrc[12] ^= 1;
      feed(r, [0, 255, ...badHeader, ...badCrc, ...f.imu], 1040);
      check(r.robot.valid === 4 && r.robot.crc8Errors >= 1 && r.robot.crc16Errors === 1, 'resynchronize after noise and CRC errors');
      feed(r, [...f.malformedImu, ...f.nanImu, ...f.invalidDebugType, ...f.invalidDebugLength, ...f.unknown, ...f.debug], 1060);
      check(r.robot.payloadErrors === 4 && r.robot.unknown === 1 && r.robot.valid === 6, 'malformed payloads never poison later frames');
      const before = r.robot.valid; feed(r, f.imu, 1080, 'tx'); check(r.robot.valid === before, 'TX frames ignored');
      const others = runtime();
      const names = ['pid', 'pidLegacy', 'motion', 'motionLegacy', 'joint', 'jointLegacy', 'robot', 'game', 'event', 'hp', 'position', 'status', 'statusLegacy'];
      feed(others, names.flatMap((name) => f[name]));
      check(others.robot.valid === names.length && others.robot.payloadErrors === 0, 'HERO and legacy packet layouts');
      check(others.allCardsMap['status.projectile_allowance_fortress'] === 12 && others.allCardsMap['hp.blue_base'] === 115 && others.allCardsMap['event.event_data'] === 4294967295, 'other packet offsets');
      return { customSplits: f.debug.length + 1, packetLayouts: names.length + 2, crcRecovery: true };
    }, fixtures);
    console.log('PASS protocol fixtures generated by upstream CRC implementation:', parserResults);

    await page.evaluate((f) => {
      const h = window.__H;
      h.startRecording();
      h.queueRxBytes(Uint8Array.from(f.imu.slice(0, 7)), Date.now());
      h.deriveData();
      if (h.state.derivedRuntime.robot.valid !== 0) throw Error('partial frame must wait');
      h.queueRxBytes(Uint8Array.from([...f.imu.slice(7), ...f.debug]), Date.now() + 10);
      h.deriveData();
      if (h.state.derivedRuntime.robot.valid !== 2) throw Error('real RX pipeline must resume frame');
      h.scheduleRefresh();
    }, fixtures);
    await page.waitForFunction(() => document.querySelector('#robot-imu-values').textContent.includes('28.648'));
    await page.locator('#robot-angle-unit').selectOption('rad', { force: true });
    await page.waitForFunction(() => document.querySelector('#robot-imu-values').textContent.includes('0.500'));
    assert.equal(await page.evaluate(() => window.__H.state.derived.chartSeries['parsed.debug.speed'][0].v), 12.5);
    await page.locator('#add-time-chart-btn').click();
    const chart = page.locator('.chart-panel').last();
    await chart.hover();
    await chart.locator('[data-chart-robot-group]').locator('..').locator('.custom-select-trigger').click();
    await page.locator('.custom-select-menu.open .custom-select-option', { hasText: '自定义调试数据' }).click();
    assert.deepEqual(await page.evaluate(() => window.__H.state.charts.at(-1).bindings.sort()), ['parsed.debug.count', 'parsed.debug.speed', 'parsed.debug.温度']);
    assert.equal(await chart.locator('[data-chart-binding]').count(), 0);
    assert.equal(await chart.locator('[data-chart-robot-group]').inputValue(), 'debug');
    await chart.locator('[data-scope-channel-panel] summary').click();
    await chart.locator('[data-scope-channel-select="parsed.debug.count"]').uncheck();
    assert.equal(await page.evaluate(() => window.__H.state.charts.at(-1).hiddenBindings.includes('parsed.debug.count')), true);
    await page.waitForFunction(() => document.querySelectorAll('.chart-panel')[1].querySelector('[data-scope-channel-summary]').textContent.includes('2/3'));
    await chart.locator('[data-scope-channel="parsed.debug.count"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.chart-panel')[1].querySelector('[data-scope-channel-select="parsed.debug.count"]').checked);
    await page.evaluate(() => {
      const h = window.__H;
      const chart = h.createChart('fft'); chart.bindings = ['parsed.debug.speed']; h.state.charts.push(chart); h.renderCharts(true);
      if (!h.getChartSelectableFields('fft').some((field) => field.key === 'parsed.debug.speed')) throw Error('custom FFT channel disabled');
      if (h.getChartFrameIntervalMs(chart, [{ t: 0, v: 1 }, { t: 20, v: 2 }, { t: 40, v: 3 }]) !== 20) throw Error('FFT must use this channel sample interval');
    });

    const timelineResults = await page.evaluate(() => {
      const h = window.__H;
      h.archiveCurrentRecording();
      const timeline = h.state.timelines.at(-1);
      const exported = h.buildAnalysisExportTable(timeline);
      if (exported.rows.length !== 2 || !exported.fieldLabels.includes('speed')) throw Error('recorded analysis export');
      h.setActiveTimeline(timeline.id);
      h.state.playback.positionMs = timeline.durationMs;
      h.deriveData();
      if (h.state.derivedRuntime.robot.valid !== 2) throw Error('timeline replay');
      h.state.playback.positionMs = 0;
      h.deriveData();
      if (h.state.derivedRuntime.robot?.valid) throw Error('rewind must reset decoder and latest IMU');
      h.state.playback.positionMs = timeline.durationMs;
      h.scheduleRefresh();
      return { exportRows: exported.rows.length, fields: exported.fieldLabels.length, rewind: true };
    });
    console.log('PASS real RX, UI units, custom channel selection, FFT, recording/replay/export:', timelineResults);

    await page.evaluate((f) => {
      const h = window.__H;
      h.setActiveTimeline('realtime');
      h.clearRealtimeHistoryData();
      const start = Date.now();
      for (let i = 0; i < 400; i += 1) {
        h.queueRxBytes(Uint8Array.from(i % 2 ? f.imu : f.debug), start + i * 200);
        h.deriveData();
      }
      if (h.state.derivedRuntime.robot.valid !== 400) throw Error('decoder reset on raw log trimming');
      if (h.state.derived.numericSeries['parsed.imu.yaw'].length !== 151) throw Error('waveform lost history on raw log trimming');
      if (h.state.session.rawChunks.length >= 400) throw Error('test must cross raw history retention limit');
      h.clearRealtimeHistoryData();
      for (let i = 0; i < 400; i += 1) h.queueRxBytes(Uint8Array.from(i % 2 ? f.imu : f.debug), start + i);
      h.deriveData();
      if (h.state.derivedRuntime.robot.valid !== 400) throw Error('binary burst lost packets before scheduled refresh');
      h.scheduleRefresh();
    }, fixtures);
    console.log('PASS 400 packets across raw log trimming preserve incremental waveform history; 400-packet burst before refresh loses no packets');

    for (const size of [{ width: 1440, height: 1050 }, { width: 900, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => !document.body.classList.contains('compact-single') || Number(getComputedStyle(document.querySelector('.left-column')).opacity) === 0);
      const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth, cards: document.querySelectorAll('.robot-imu-card').length, canvas: document.querySelector('#robot-attitude-canvas').width }));
      if (dimensions.page > dimensions.viewport + 1) console.log(await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((element) => { const rect = element.getBoundingClientRect(); return rect.right > innerWidth + 1 && getComputedStyle(element).display !== 'none' && !element.closest('#parser-preview'); }).slice(-20).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, position: getComputedStyle(element).position, opacity: getComputedStyle(element).opacity, text: element.textContent.slice(0, 40) }))));
      assert.ok(dimensions.page <= dimensions.viewport + 1, `no horizontal overflow at ${size.width}: ${JSON.stringify(dimensions)}`);
      assert.equal(dimensions.cards, 6);
      assert.ok(dimensions.canvas > 0);
      if (process.env.ROBOT_SCREENSHOTS) {
        fs.mkdirSync(process.env.ROBOT_SCREENSHOTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.ROBOT_SCREENSHOTS, `imu-${size.width}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.locator('#protocol-mode').selectOption('text', { force: true });
    assert.equal(await page.locator('#text-parser-pane').isVisible(), true);
    await page.locator('#protocol-mode').selectOption('binary', { force: true });
    assert.equal(await page.locator('#binary-parser-pane').isVisible(), true);
    await page.locator('#protocol-mode').selectOption('robot', { force: true });
    await page.evaluate(() => window.__H.persistLocalPrefsNow());
    await page.reload();
    assert.equal(await page.locator('#robot-dashboard').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__H.state.parser.robotUnit), 'rad');
    await page.locator('#protocol-mode').selectOption('text', { force: true });
    await page.evaluate(() => window.__H.persistLocalPrefsNow());
    await page.reload();
    assert.equal(await page.locator('#text-parser-pane').isVisible(), true, 'chosen generic protocol persists after migration');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#protocol-mode').selectOption('robot', { force: true });
    await page.waitForFunction(() => document.body.classList.contains('theme-dark'));
    const darkColors = await page.locator('.robot-imu-card').first().evaluate((element) => ({ text: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
    assert.notEqual(darkColors.text, darkColors.background);
    const offline = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    offline.on('pageerror', (error) => errors.push(error.message));
    await offline.route('https://**/*', (route) => route.abort());
    await offline.goto(require('node:url').pathToFileURL(path.join(root, 'index.html')).href);
    assert.equal(await offline.locator('#robot-dashboard').isVisible(), true, 'single HTML works offline without instrumentation');
    await offline.close();
    assert.deepEqual(errors, [], 'no browser JavaScript errors');
    console.log('PASS desktop/tablet/mobile layout, real custom-select interaction, generic parser modes, settings persistence, dark theme, offline HTML, no JS errors');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
