// Browser and numerical regression checks for waveform controls. Requires Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const marker = '      initializeDefaults();';
const original = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.equal(original.split(marker).length, 2);
const html = original.replace(marker, `      window.__W = { state, refs, createChart, renderCharts, drawChart, computeSpectrum, getFftCacheEntry, samplePixelPath, getScopeSeries, sliceSeriesWithNeighbors, normalizeFftSize, formatScopeTimeTick, resetChartView, setScopePaused, persistLocalPrefsNow, snapshotChartConfig, hydrateChartFromConfig, queueRxBytes, deriveData, robotCrc, invalidateDerivedCaches };\n${marker}`);

(async () => {
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => route.request().url().startsWith(url) ? route.continue() : route.abort());
    await page.goto(url);
    if (await page.locator('#version-modal-close').isVisible()) await page.locator('#version-modal-close').click();
    const numerical = await page.evaluate(() => {
      const h = window.__W;
      const check = (value, message) => { if (!value) throw Error(message); };
      check(h.formatScopeTimeTick(-40, 200) === '-0.04s' && h.formatScopeTimeTick(-20, 200) === '-0.02s', 'short time windows retain distinct tick labels near zero');
      const peak = (spectrum) => spectrum.reduce((a, b) => a.a > b.a ? a : b);
      const signal = Array.from({ length: 1024 }, (_, i) => 30 + 1.5 * Math.sin(2 * Math.PI * 50 * i / 1024));
      for (const windowFunction of ['hann', 'rect']) {
        const spectrum = h.computeSpectrum(signal, 1024, { windowFunction, removeDc: true });
        check(peak(spectrum).f === 50 && Math.abs(peak(spectrum).a - 1.5) < 1e-8, '50 Hz / 1.5 amplitude and DC rejection for ' + windowFunction);
        check(spectrum.length === 513 && spectrum.at(-1).f === 512, 'Nyquist included; FFT points must match the actual transform');
      }
      const dc = h.computeSpectrum(new Array(1024).fill(2.5), 1024, { windowFunction: 'rect', removeDc: false });
      check(Math.abs(dc[0].a - 2.5) < 1e-9, 'DC must not be doubled');
      const nyquist = h.computeSpectrum(Array.from({ length: 1024 }, (_, i) => i % 2 ? -2 : 2), 1024, { windowFunction: 'rect' });
      check(Math.abs(nyquist.at(-1).a - 2) < 1e-9, 'Nyquist amplitude must not be doubled');
      check(h.computeSpectrum([1, NaN, 2, 3], 100).length === 0, 'invalid values cannot corrupt spectrum');
      const large = h.computeSpectrum(new Array(80000).fill(0), 1000);
      check(large.length === 16385 && large.every((point) => Number.isFinite(point.a)), 'oversized window bounded safely');
      const points = Array.from({ length: 20000 }, (_, i) => ({ x: i / 100, y: i === 777 ? 100 : i === 778 ? -100 : 0 }));
      const reduced = h.samplePixelPath(points, 800);
      check(reduced.length <= 800 && reduced.some((p) => p.y === 100) && reduced.some((p) => p.y === -100), 'both narrow positive and negative spikes retained');
      check(reduced[0] === points[0] && reduced.at(-1) === points.at(-1) && reduced.every((point, i) => i === 0 || point.x >= reduced[i - 1].x), 'decimation preserves endpoints and sample order');
      const overlapping = h.samplePixelPath(points.map((p) => ({ ...p, x: 1 })), 80);
      check(overlapping.some((p) => p.y === 100) && overlapping.some((p) => p.y === -100), 'same-time batched extrema retained');
      const chart = h.createChart('fft');
      const a = signal.map((v, i) => ({ t: i, v, i })), b = signal.map((v, i) => ({ t: i, v: v * 2, i }));
      const first = h.getFftCacheEntry(chart, 'a', a, 1024, 1024);
      h.getFftCacheEntry(chart, 'b', b, 1024, 1024);
      check(h.getFftCacheEntry(chart, 'a', a, 1024, 1024) === first, 'multiple channel caches survive a paint');
      chart.fftRemoveDc = false;
      check(h.getFftCacheEntry(chart, 'a', a, 1024, 1024) !== first, 'FFT option change invalidates cache');
      const hydrated = h.hydrateChartFromConfig({ ...h.snapshotChartConfig(chart), waveform: { timeWindowMs: 2500 }, fft: { windowSize: 999999, windowFunction: 'rect', removeDc: false, frameIntervalMs: 0.5 } });
      check(hydrated.fftWindow === 32768 && hydrated.timeWindowMs === 2500 && hydrated.fftRemoveDc === false && hydrated.fftWindowFunction === 'rect', 'bounded FFT config restoration');
      return { sineHz: 50, amplitude: 1.5, spikesPreserved: true, multichannelCache: true };
    });
    console.log('PASS numerical waveform/FFT checks:', numerical);

    await page.evaluate(() => {
      const h = window.__W;
      const keys = ['parsed.debug.signal', 'parsed.debug.reference'];
      const names = ['signal', 'reference'], encoder = new TextEncoder(), baseTime = Date.now();
      let batch = [];
      for (let i = 0; i < 2048; i += 1) {
        const frame = new Uint8Array(40), view = new DataView(frame.buffer);
        frame.set([0x5a, 34, 1]); frame[3] = h.robotCrc(frame.subarray(0, 3), 8);
        view.setUint32(4, i, true);
        names.forEach((name, ch) => {
          const offset = 8 + ch * 15;
          frame.set(encoder.encode(name), offset); frame[offset + 10] = 1;
          view.setFloat32(offset + 11, (ch ? 0.6 : 1.5) * Math.sin(2 * Math.PI * 50 * i / 1000 + ch * 0.6) + (ch ? 0 : 2), true);
        });
        view.setUint16(38, h.robotCrc(frame.subarray(0, 38), 16), true);
        batch.push(...frame);
        if (i % 20 === 19 || i === 2047) { h.queueRxBytes(Uint8Array.from(batch), baseTime + Math.floor(i / 20) * 20); batch = []; }
      }
      h.deriveData();
      h.state.charts = ['time', 'fft'].map((type) => {
        const chart = h.createChart(type); chart.bindings = [...keys]; chart.robotGroup = 'debug'; chart.fftFrameIntervalMs = '1'; chart.timeWindowMs = 1000; chart.fftWindow = 1024; chart.heightPx = 270;
        chart.name = type === 'time' ? '时域 · 50 Hz 正弦与参考信号' : '频域 · 去直流后的幅度谱';
        return chart;
      });
      h.renderCharts(true);
    });
    await page.waitForFunction(() => window.__W.state.charts[1].scopeInfo.includes('Fs 1000'));
    const time = page.locator('.chart-panel').nth(0), fft = page.locator('.chart-panel').nth(1);
    assert.match(await fft.locator('[data-scope-info]').textContent(), /Fs 1000 Hz.*1024\/1024.*Δf/);
    await time.locator('[data-scope-channel]').first().click();
    await page.waitForFunction(() => window.__W.state.charts[0].scopeTracks.length === 1);
    assert.equal(await time.locator('[data-scope-channel]').first().getAttribute('aria-pressed'), 'false');
    await time.locator('[data-scope-channel]').first().click();
    await time.locator('[data-scope-pause]').click();
    const pausedEnd = await page.evaluate(() => window.__W.getScopeSeries(window.__W.state.charts[0], 'parsed.debug.signal').at(-1).v);
    await page.evaluate(() => {
      const h = window.__W;
      h.state.derived.numericSeries['parsed.debug.signal'].push({ i: 2048, t: 2048, v: 99 });
      h.drawChart(h.state.charts[0]);
    });
    assert.equal(await page.evaluate(() => window.__W.getScopeSeries(window.__W.state.charts[0], 'parsed.debug.signal').at(-1).v), pausedEnd, 'pause freezes samples while input keeps accumulating');
    await time.locator('[data-scope-pause]').click();
    await page.waitForFunction(() => window.__W.getScopeSeries(window.__W.state.charts[0], 'parsed.debug.signal').at(-1).v === 99);
    await time.locator('[data-scope-cursor]').click();
    const geometry = await page.evaluate(() => {
      const h = window.__W, chart = h.state.charts[0], box = document.querySelector('.chart-panel canvas').getBoundingClientRect();
      return { x: box.x + chart.drawMeta.left, y: box.y + chart.drawMeta.top, width: chart.drawMeta.plotW, height: chart.drawMeta.plotH };
    });
    await page.mouse.click(geometry.x + geometry.width * 0.4, geometry.y + geometry.height * 0.45);
    await page.mouse.click(geometry.x + geometry.width * 0.6, geometry.y + geometry.height * 0.45);
    await page.waitForFunction(() => window.__W.state.charts[0].scopeCursors.length === 2);
    await page.waitForFunction(() => document.querySelector('[data-scope-readout]').textContent.includes('Δt'));
    assert.match(await time.locator('[data-scope-readout]').textContent(), /Δt 200(?:\.0)? ms.*ΔY/);
    await time.locator('[data-scope-cursor]').click();
    await time.locator('[data-scope-pause]').click();
    await time.locator('[data-chart-auto]').click();
    const zoomBefore = await page.evaluate(() => window.__W.state.charts[0].drawMeta.xRange.range);
    await page.mouse.move(geometry.x + geometry.width * 0.7, geometry.y + geometry.height * 0.5);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction((range) => window.__W.state.charts[0].drawMeta.xRange.range < range, zoomBefore);
    const anchorBefore = await page.evaluate(() => window.__W.state.charts[0].drawMeta.anchorTime);
    await page.evaluate(() => {
      const h = window.__W;
      h.state.derived.numericSeries['parsed.debug.signal'].push({ i: 2100, t: 2100, v: 0 });
      h.drawChart(h.state.charts[0]);
    });
    assert.equal(await page.evaluate(() => window.__W.state.charts[0].drawMeta.anchorTime), anchorBefore, 'manual view stays on history as new samples arrive');
    await time.locator('[data-chart-auto]').click();
    assert.equal(await page.evaluate(() => window.__W.state.charts[0].viewFollowLatestX), true);
    console.log('PASS legend visibility, live pause/resume, A/B cursors, wheel zoom, stable history and AUTO follow');

    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1200 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => !document.body.classList.contains('compact-single') || Number(getComputedStyle(document.querySelector('.left-column')).opacity) === 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no page overflow at ${width}`);
      await fft.scrollIntoViewIfNeeded();
      if (process.env.ROBOT_SCREENSHOTS) {
        fs.mkdirSync(process.env.ROBOT_SCREENSHOTS, { recursive: true });
        await fft.screenshot({ path: path.join(process.env.ROBOT_SCREENSHOTS, `spectrum-${width}.png`) });
      }
      if (width === 390) {
        await fft.locator('[data-scope-channel-panel] summary').click();
        await fft.locator('[data-scope-channel-select]').first().uncheck();
        await page.waitForFunction(() => document.querySelectorAll('.chart-panel')[1].querySelector('[data-scope-channel-summary]').textContent.includes('1/2'));
        await fft.locator('[data-scope-channel-select]').first().check();
        await fft.locator('[data-scope-channel-panel] summary').click();
        await fft.locator('[data-chart-toggle]').click();
        await fft.locator('[data-chart-fft-frame-interval]').fill('0.5');
        await fft.locator('[data-chart-fft-frame-interval]').dispatchEvent('change');
        await page.waitForFunction(() => window.__W.state.charts[1].scopeInfo.includes('Fs 2000'));
        await fft.locator('[data-chart-fft-frame-interval]').fill('1');
        await fft.locator('[data-chart-fft-frame-interval]').dispatchEvent('change');
        await fft.locator('[data-chart-toggle]').click();
      }
    }
    await page.setViewportSize({ width: 1440, height: 1200 });
    await fft.locator('[data-chart-toggle]').click();
    await fft.locator('[data-chart-fft-window]').selectOption('512', { force: true });
    await fft.locator('[data-scope-fft-function]').selectOption('rect', { force: true });
    await fft.locator('[data-scope-remove-dc]').uncheck();
    await page.waitForFunction(() => window.__W.state.charts[1].scopeInfo.includes('512/512'));
    const saved = await page.evaluate(() => window.__W.snapshotChartConfig(window.__W.state.charts[1]));
    assert.equal(saved.fft.windowSize, 512);
    assert.equal(saved.fft.windowFunction, 'rect');
    assert.equal(saved.fft.removeDc, false);
    const missingTiming = await page.evaluate(() => {
      const h = window.__W, chart = h.state.charts[1];
      const originalSeries = h.state.derived.numericSeries;
      const previousInterval = chart.fftFrameIntervalMs;
      h.state.derived.numericSeries = Object.fromEntries(Object.entries(originalSeries).map(([key, points]) => [key, points.map((p) => ({ ...p, t: 0 }))]));
      chart.fftFrameIntervalMs = '';
      h.drawChart(chart);
      const message = chart.scopeInfo;
      h.state.derived.numericSeries = originalSeries;
      chart.fftFrameIntervalMs = previousInterval;
      h.drawChart(chart);
      return message;
    });
    assert.match(missingTiming, /无法推断采样率/);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => document.body.classList.contains('theme-dark'));
    if (process.env.ROBOT_SCREENSHOTS) {
      await fft.screenshot({ path: path.join(process.env.ROBOT_SCREENSHOTS, 'spectrum-dark.png') });
    }
    if (process.env.UPDATE_WAVEFORM_PREVIEWS) {
      await page.evaluate(() => {
        const h = window.__W;
        h.invalidateDerivedCaches(); h.deriveData();
        h.state.charts.forEach((chart) => { chart.open = false; chart.timeWindowMs = 200; chart.fftWindow = 1024; chart.fftWindowFunction = 'hann'; chart.fftRemoveDc = true; chart.pausedData = null; chart.cursorMode = false; chart.scopeCursors = []; h.resetChartView(chart); });
        h.renderCharts(true);
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await time.screenshot({ path: path.join(root, 'docs/waveform-time-preview.png') });
      await fft.screenshot({ path: path.join(root, 'docs/waveform-fft-preview.png') });
    }
    assert.deepEqual(errors, []);
    console.log('PASS responsive layout, FFT settings/serialization, system dark theme and no browser errors');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
