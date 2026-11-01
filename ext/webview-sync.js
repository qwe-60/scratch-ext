/*!
 * webview-sync.js  —  Scratch 3 / Gandi IDE 扩展：在舞台上方显示并同步网页
 *  版本 1.0.0
 *
 *  原理：Scratch 舞台是 canvas，无法直接渲染网页，所以本扩展在舞台上方叠加一个
 *  <iframe> 图层，并实时跟踪舞台元素（.stage-wrapper / canvas）的位置与尺寸，
 *  用 ResizeObserver + requestAnimationFrame 做像素级对齐；全屏/小舞台切换、
 *  窗口缩放、布局变化都会自动跟随。
 *
 *  用法（Gandi IDE / 创作兔）：扩展 → 自定义扩展 → 输入本文件的链接或粘贴源码。
 *  ⚠ 网页自身禁止被 iframe 嵌套（X-Frame-Options / CSP frame-ancestors）时无法显示，
 *    这是浏览器安全策略，任何扩展都绕不过去。
 */
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) {
    // iframe 操作需要 DOM 权限，沙箱模式不可用
    throw new Error('[webview-sync] 请在「非沙箱 / 不沙箱」模式下加载本扩展');
  }

  const BT = Scratch.BlockType || {};
  const AT = Scratch.ArgumentType || {};
  const BlockType = {
    COMMAND: BT.COMMAND || 'command',
    REPORTER: BT.REPORTER || 'reporter',
    BOOLEAN: BT.BOOLEAN || 'Boolean',
    HAT: BT.HAT || 'hat',
    LABEL: BT.LABEL || 'label',
    BUTTON: BT.BUTTON || 'button'
  };
  const ArgumentType = {
    STRING: AT.STRING || 'string',
    NUMBER: AT.NUMBER || 'number',
    BOOLEAN: AT.BOOLEAN || 'Boolean',
    ANGLE: AT.ANGLE || 'angle',
    COLOR: AT.COLOR || 'color',
    IMAGE: AT.IMAGE || 'image'
  };

  // ---------------------------------------------------------------- state
  const state = {
    url: 'https://www.baidu.com/',
    visible: true,
    mouse: true,
    margin: 0,     // 相对舞台边缘的内缩（Scratch 坐标单位）
    zoom: 100,     // 页面缩放百分比（CSS zoom）
    scaleX: 1,
    scaleY: 1,
    tx: 0,
    ty: 0,
    frame: null,   // iframe
    host: null,    // 外层定位容器
    disabled: false,
    targetEl: null,
    ro: null,
    raf: 0,
    lastSig: ''
  };

  const log = (...a) => console.log('[webview-sync]', ...a);

  // ---------------------------------------------------------------- DOM
  function ensureDom() {
    if (state.host && state.host.isConnected && state.frame && state.frame.isConnected) return;

    let host = document.getElementById('wvs-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'wvs-host';
      Object.assign(host.style, {
        position: 'fixed',
        zIndex: '2147483000',
        overflow: 'hidden',
        pointerEvents: 'none',
        background: '#fff',
        display: 'none',
        borderRadius: '0px'
      });

      const frame = document.createElement('iframe');
      frame.id = 'wvs-frame';
      frame.setAttribute('allow', 'autoplay; fullscreen; clipboard-read; clipboard-write');
      frame.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      Object.assign(frame.style, {
        border: '0px',
        width: '100%',
        height: '100%',
        display: 'block',
        transformOrigin: '0 0',
        background: '#fff'
      });
      frame.addEventListener('load', () => { log('iframe loaded'); });
      frame.addEventListener('error', () => { log('iframe error'); });

      host.appendChild(frame);
      document.body.appendChild(host);
      state.host = host;
      state.frame = frame;
      if (state.url) frame.src = state.url;
      applyFrameStyle();
    } else {
      state.host = host;
      state.frame = document.getElementById('wvs-frame');
    }
  }

  function destroyDom() {
    if (state.ro) { try { state.ro.disconnect(); } catch (e) {} state.ro = null; }
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    if (state.host && state.host.parentNode) state.host.parentNode.removeChild(state.host);
    state.host = null;
    state.frame = null;
    state.targetEl = null;
  }

  function applyFrameStyle() {
    const f = state.frame;
    if (!f) return;
    f.style.transform = 'scale(' + state.scaleX + ',' + state.scaleY + ')';
    f.style.transformOrigin = '0 0';
    f.style.width = (100 / state.scaleX) + '%';
    f.style.height = (100 / state.scaleY) + '%';
    f.style.zoom = state.zoom + '%';
    if (state.host) {
      state.host.style.pointerEvents = state.mouse ? 'auto' : 'none';
      state.host.style.display = (state.visible && !state.disabled) ? 'block' : 'none';
    }
  }

  // ---------------------------------------------------------------- stage tracking
  function findStageEl() {
    // 依次尝试常见选择器（Gandi / TurboWarp / 官方）
    const sels = [
      '.gandi-stage .stage-wrapper',
      '.stage-wrapper',
      '.stage_wrapper',
      '[class*="stage-wrapper"]',
      '.stage_stage_1fD7k',
      '.stage'
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el && el.getBoundingClientRect().width > 50) return el;
    }
    // 兜底：最大的 canvas
    let best = null, area = 0;
    document.querySelectorAll('canvas').forEach(c => {
      const r = c.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > area) { area = a; best = c; }
    });
    return best;
  }

  function tick() {
    state.raf = requestAnimationFrame(tick);

    if (!state.visible || state.disabled) return;
    ensureDom();

    const el = findStageEl();
    if (!el || !state.host) return;

    if (el !== state.targetEl) {
      state.targetEl = el;
      if (state.ro) { try { state.ro.disconnect(); } catch (e) {} }
      if (typeof ResizeObserver !== 'undefined') {
        state.ro = new ResizeObserver(() => syncBox());
        state.ro.observe(el);
      }
    }

    if (state._manualBox) applyManualBox(); else syncBox();
  }

  function applyManualBox() {
    const b = state._manualBox;
    const host = state.host;
    if (!host || !b) return;
    host.style.display = state.visible ? 'block' : 'none';
    host.style.left = b.left + 'px';
    host.style.top = b.top + 'px';
    host.style.width = b.width + 'px';
    host.style.height = b.height + 'px';
  }

  function syncBox() {
    const el = state.targetEl;
    const host = state.host;
    if (!el || !host) return;

    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) { host.style.display = 'none'; return; }
    host.style.display = state.visible ? 'block' : 'none';
    if (!state.visible) return;

    // Scratch 坐标 → 屏幕像素
    const sx = r.width / 480;
    const sy = r.height / 360;
    const m = Math.max(-100, Math.min(200, state.margin));

    const left = r.left + m * sx;
    const top = r.top + m * sy;
    const width = Math.max(1, r.width - 2 * m * sx);
    const height = Math.max(1, r.height - 2 * m * sy);

    state.scaleX = sx;
    state.scaleY = sy;

    const sig = left + ',' + top + ',' + width + ',' + height + ',' + state.zoom + ',' + state.mouse;
    if (sig !== state.lastSig) {
      state.lastSig = sig;
      host.style.left = left + 'px';
      host.style.top = top + 'px';
      host.style.width = width + 'px';
      host.style.height = height + 'px';
      applyFrameStyle();
    }
  }

  function startLoop() {
    if (!state.raf) state.raf = requestAnimationFrame(tick);
  }

  // 页面尺寸/全屏变化时强制刷新
  window.addEventListener('resize', () => { state.lastSig = ''; syncBox(); });
  document.addEventListener('fullscreenchange', () => {
    setTimeout(() => { state.lastSig = ''; const el = findStageEl(); state.targetEl = el; syncBox(); }, 120);
  });

  // ---------------------------------------------------------------- UI safety
  // 把事件冒泡挡掉，避免点击 iframe 时触发舞台/编辑器快捷键
  document.addEventListener('keydown', (e) => {
    if (!state.visible || state.disabled) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    // 允许 Esc 退出全屏
    if (e.key === 'Escape') return;
  }, true);

  // ---------------------------------------------------------------- extension
  class WebViewSync {
    getInfo() {
      return {
        id: 'webviewsync',
        name: '网页同步',
        color1: '#2f6fed',
        color2: '#2559c4',
        color3: '#1d469c',
        blockIconURI: 'data:image/svg+xml;utf8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
          '<rect x="3" y="7" width="34" height="26" rx="4" fill="#fff"/>' +
          '<rect x="3" y="7" width="34" height="7" rx="4" fill="#2559c4"/>' +
          '<circle cx="8" cy="10.5" r="1.5" fill="#ff6b6b"/><circle cx="13" cy="10.5" r="1.5" fill="#ffd166"/>' +
          '<circle cx="18" cy="10.5" r="1.5" fill="#06d6a0"/>' +
          '<path d="M12 26 L18 18 L23 23 L28 16 L32 26 Z" fill="#9bb8f7"/></svg>'
        ),
        blocks: [
          { blockType: BlockType.LABEL, text: '— 显示 —' },
          {
            opcode: 'show',
            blockType: BlockType.COMMAND,
            text: '在舞台上显示网页 [URL]',
            arguments: {
              URL: { type: ArgumentType.STRING, defaultValue: 'https://www.baidu.com/' }
            }
          },
          {
            opcode: 'showCover',
            blockType: BlockType.COMMAND,
            text: '在舞台上显示网页 [URL] 并且禁止鼠标操作',
            arguments: {
              URL: { type: ArgumentType.STRING, defaultValue: 'https://www.baidu.com/' }
            }
          },
          {
            opcode: 'navigate',
            blockType: BlockType.COMMAND,
            text: '加载网页 [URL]',
            arguments: {
              URL: { type: ArgumentType.STRING, defaultValue: 'https://www.baidu.com/' }
            }
          },
          {
            opcode: 'reload',
            blockType: BlockType.COMMAND,
            text: '刷新网页'
          },
          {
            opcode: 'hide',
            blockType: BlockType.COMMAND,
            text: '隐藏网页'
          },
          {
            opcode: 'setVisible',
            blockType: BlockType.COMMAND,
            text: '网页显示状态设为 [STATE]',
            arguments: {
              STATE: { type: ArgumentType.STRING, menu: 'showHideMenu', defaultValue: '显示' }
            }
          },
          { blockType: BlockType.LABEL, text: '— 同步与布局 —' },
          {
            opcode: 'setMargin',
            blockType: BlockType.COMMAND,
            text: '网页四周内缩 [M] 个 Scratch 单位',
            arguments: {
              M: { type: ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          {
            opcode: 'setRect',
            blockType: BlockType.COMMAND,
            text: '网页位置 x: [X] y: [Y] 宽度: [W] 高度: [H]',
            arguments: {
              X: { type: ArgumentType.NUMBER, defaultValue: -240 },
              Y: { type: ArgumentType.NUMBER, defaultValue: 180 },
              W: { type: ArgumentType.NUMBER, defaultValue: 480 },
              H: { type: ArgumentType.NUMBER, defaultValue: 360 }
            }
          },
          {
            opcode: 'fullStage',
            blockType: BlockType.COMMAND,
            text: '网页铺满整个舞台'
          },
          {
            opcode: 'setZoom',
            blockType: BlockType.COMMAND,
            text: '页面缩放 [Z] %',
            arguments: {
              Z: { type: ArgumentType.NUMBER, defaultValue: 100 }
            }
          },
          {
            opcode: 'hideAll',
            blockType: BlockType.COMMAND,
            text: '关闭网页并移除图层'
          },
          {
            opcode: 'setMouse',
            blockType: BlockType.COMMAND,
            text: '允许鼠标操作网页 [ON]',
            arguments: {
              ON: { type: ArgumentType.STRING, menu: 'onOffMenu', defaultValue: 'true' }
            }
          },
          {
            opcode: 'setPointerEvents',
            blockType: BlockType.COMMAND,
            text: '网页吃掉鼠标点击 [ON]',
            arguments: {
              ON: { type: ArgumentType.STRING, menu: 'onOffMenu', defaultValue: 'true' }
            }
          },
          {
            opcode: 'sync',
            blockType: BlockType.COMMAND,
            text: '立即同步网页位置与大小'
          },
          { blockType: BlockType.LABEL, text: '— 取值 —' },
          {
            opcode: 'getURL',
            blockType: BlockType.REPORTER,
            text: '当前网页地址'
          },
          {
            opcode: 'getVisible',
            blockType: BlockType.BOOLEAN,
            text: '网页正在显示？'
          },
          {
            opcode: 'getStageWidth',
            blockType: BlockType.REPORTER,
            text: '舞台屏幕宽度'
          },
          {
            opcode: 'getStageHeight',
            blockType: BlockType.REPORTER,
            text: '舞台屏幕高度'
          },
          {
            opcode: 'webToScratchX',
            blockType: BlockType.REPORTER,
            text: '网页X [PX] 换算成 Scratch X',
            arguments: { PX: { type: ArgumentType.NUMBER, defaultValue: 0 } }
          },
          {
            opcode: 'webToScratchY',
            blockType: BlockType.REPORTER,
            text: '网页Y [PY] 换算成 Scratch Y',
            arguments: { PY: { type: ArgumentType.NUMBER, defaultValue: 0 } }
          },
          {
            opcode: 'blocked',
            blockType: BlockType.BOOLEAN,
            text: '网页被网站禁止嵌套？'
          }
        ],
        menus: {
          showHideMenu: { acceptReporters: false, items: ['显示', '隐藏'] },
          onOffMenu: { acceptReporters: false, items: ['true', 'false'] }
        }
      };
    }

    // ------------------------------------------------------------ commands
    show(args) {
      state.url = String(args.URL || '').trim() || state.url;
      state.visible = true;
      state.disabled = false;
      state.lastSig = '';
      ensureDom();
      if (state.frame && state.frame.getAttribute('src') !== state.url) state.frame.src = state.url;
      startLoop();
    }

    showCover(args) {
      this.show(args);
      state.mouse = false;
      applyFrameStyle();
    }

    navigate(args) {
      state.url = String(args.URL || '').trim() || state.url;
      ensureDom();
      if (state.frame) state.frame.src = state.url;
      startLoop();
    }

    reload() {
      ensureDom();
      if (state.frame) {
        try { state.frame.contentWindow.location.reload(); }
        catch (e) { state.frame.src = state.url; } // 跨域兜底
      }
    }

    hide() {
      state.visible = false;
      applyFrameStyle();
    }

    setVisible(args) {
      state.visible = ('显示' === String(args.STATE));
      applyFrameStyle();
    }

    setMargin(args) {
      state.margin = Number(args.M) || 0;
      state.lastSig = '';
      syncBox();
    }

    setRect(args) {
      ensureDom();
      const el = findStageEl();
      if (!el) return;
      const r = el.getBoundingClientRect();
      const sx = r.width / 480, sy = r.height / 360;
      const x = Number(args.X) || 0, y = Number(args.Y) || 0;
      const w = Number(args.W) || 480, h = Number(args.H) || 360;
      const left = r.left + (x + 240) * sx;
      const top = r.top + (180 - y) * sy;
      state.scaleX = sx; state.scaleY = sy;
      state.visible = true;
      const host = state.host;
      host.style.display = 'block';
      host.style.left = left + 'px';
      host.style.top = top + 'px';
      host.style.width = Math.max(1, w * sx) + 'px';
      host.style.height = Math.max(1, h * sy) + 'px';
      // 手动区域模式下暂停自动覆盖（把 wall 尺寸交给用户）
      state._manualBox = { left, top, width: w * sx, height: h * sy };
      applyFrameStyle();
      startLoop();
    }

    fullStage() {
      state._manualBox = null;
      state.margin = 0;
      state.lastSig = '';
      ensureDom();
      if (!state.visible) { state.visible = true; }
      startLoop();
      syncBox();
    }

    setZoom(args) {
      state.zoom = Math.max(10, Math.min(500, Number(args.Z) || 100));
      state.lastSig = '';
      applyFrameStyle();
    }

    hideAll() {
      state.disabled = true;
      state.visible = false;
      state._manualBox = null;
      destroyDom();
      if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    }

    setMouse(args) { this.setPointerEvents(args); }

    setPointerEvents(args) {
      state.mouse = String(args.ON) !== 'false';
      applyFrameStyle();
    }

    sync() {
      state.lastSig = '';
      syncBox();
    }

    // ------------------------------------------------------------ reporters
    getURL() { return state.url; }
    getVisible() { return !!(state.visible && !state.disabled && state.host && state.host.style.display !== 'none'); }

    getStageWidth() {
      const el = findStageEl();
      return el ? Math.round(el.getBoundingClientRect().width) : 0;
    }

    getStageHeight() {
      const el = findStageEl();
      return el ? Math.round(el.getBoundingClientRect().height) : 0;
    }

    webToScratchX(args) {
      const el = findStageEl();
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return ((Number(args.PX) || 0) - r.left) / (r.width / 480) - 240;
    }

    webToScratchY(args) {
      const el = findStageEl();
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      return 180 - ((Number(args.PY) || 0) - r.top) / (r.height / 360);
    }

    blocked() {
      // 浏览器的 X-Frame-Options / CSP 无法被跨域读取，也没有可靠回调。
      // 启发式：同源时 contentDocument 为空 → 被拦；跨域时无法判定 → 返回 false。
      const f = state.frame;
      if (!f) return false;
      try {
        const d = f.contentDocument;
        if (d && d.body && d.body.childElementCount === 0 && d.body.textContent.trim() === '') return true;
      } catch (e) { return false; }
      return false;
    }
  }

  Scratch.extensions.register(new WebViewSync());
})(Scratch);
