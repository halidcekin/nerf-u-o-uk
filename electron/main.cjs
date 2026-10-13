// Desktop wrapper: runs the built game (dist/) in its own window on the discrete GPU.
const { app, BrowserWindow, protocol, net, Menu } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// Laptops with Intel + NVIDIA: always use the high-performance GPU.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const DIST = path.join(__dirname, '..', 'dist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Foam Wars',
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
  const dev = process.env.FOAM_DEV_URL;
  win.loadURL(dev || 'app://game/index.html');

  // Automated check: FOAM_SELFTEST=<png path> → wait for the game, report GPU/FPS, save a screenshot, quit.
  if (process.env.FOAM_SELFTEST) {
    win.webContents.once('did-finish-load', async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 120; i++) { if (await win.webContents.executeJavaScript('!!window.__game')) break; await wait(500); }
      await win.webContents.executeJavaScript(`(() => { document.getElementById('start').classList.add('hidden'); document.getElementById('hud').classList.remove('hidden'); const g = window.__game; g.player.locked = true; g.player.pos.set(7.5,0,7.2); g.player.yaw = Math.PI*0.7; g.player.pitch = -0.12; })()`);
      await wait(6000);
      const info = await win.webContents.executeJavaScript(`(() => { const r = window.__game.renderer; return { fps: document.getElementById('fps').textContent, quality: document.getElementById('quality').textContent, calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, textures: r.info.memory.textures }; })()`);
      const gpu = await app.getGPUInfo('basic').catch(() => null);
      console.log('SELFTEST', JSON.stringify(info));
      if (gpu) console.log('GPU devices', JSON.stringify(gpu.gpuDevice?.map(d => ({ vendor: d.vendorId, active: d.active, desc: d.deviceString }))));
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(process.env.FOAM_SELFTEST, img.toPNG());
      app.quit();
    });
  }
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (process.env.FOAM_DEBUG) console.log('REQ', req.url, '->', file, require('fs').existsSync(file));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
