// ---- Electron 通讯 ----

// 每个桌宠实例使用独立的 IPC 频道，避免多开时消息互相串扰
var petChannel = new URLSearchParams(location.search).get('petChannel') || 'pet';

function getIpc() {
    var electron = require('electron');
    return electron.ipcRenderer;
}

function postMessage(data) {
    try {
        getIpc().send(petChannel, JSON.stringify(data));
    } catch {
    }
}

const messageBus = {
    _handlers: new Map(),
    on(type, handler) {
        if (!this._handlers.has(type)) {
            this._handlers.set(type, []);
        }

        this._handlers.get(type).push(handler);
    },
    _dispatch(msg) {
        const handlers = this._handlers.get(msg.type) || [];

        handlers.forEach(handler => handler(msg));
    }
};

getIpc().on(petChannel, function (event, msg) {
    if (typeof msg === 'string') {
        try {
            msg = JSON.parse(msg);
        } catch {
            return;
        }
    }
    messageBus._dispatch(msg);
});


// ---- 前端日志转发 ----
function formatLogArg(arg) {
    if (arg instanceof Error) return arg.name + ': ' + arg.message + '\n' + (arg.stack || '');
    if (typeof arg === 'object') {
        try {
            return JSON.stringify(arg);
        } catch {
            return String(arg);
        }
    }
    return String(arg);
}

function postLog(level) {
    try {
        var args = Array.prototype.slice.call(arguments, 1);
        postMessage({
            type: 'log',
            level: level,
            text: args.map(formatLogArg).join(' ')
        });
    } catch {
    }
}

{
    var rawWarn = console.warn.bind(console);
    var rawError = console.error.bind(console);
    console.warn = function () {
        postLog.apply(null, ['warn'].concat(Array.prototype.slice.call(arguments)));
        rawWarn.apply(console, arguments);
    };
    console.error = function () {
        postLog.apply(null, ['error'].concat(Array.prototype.slice.call(arguments)));
        rawError.apply(console, arguments);
    };
}

window.addEventListener('error', function (e) {
    var target = e.target;
    if (target && target !== window) {
        postLog('resource-error', target.tagName || 'unknown', target.src || target.href || '');
        return;
    }
    postLog('error', e.message, e.filename + ':' + e.lineno + ':' + e.colno, e.error || '');
}, true);

window.addEventListener('unhandledrejection', function (e) {
    postLog('unhandledrejection', e.reason);
});

// ---- 前端资源注入辅助 ----
function injectCSS(css) {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
}

function injectHTML(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    while (div.firstChild) document.body.appendChild(div.firstChild);
}

// ---- 加载模型 ----

messageBus.on('load', function (msg) {
    loadModel(msg.url);
});

const app = new PIXI.Application({
    view: document.getElementById('canvas'),
    autoStart: true,
    resizeTo: window,
    transparent: true,
    backgroundAlpha: 0,
});

let model = null;

// 用户在模型上的追加偏移与缩放（独立于布局基准，窗口 resize/updateLayout 不会重置）
let userScale = 1;
let userOffsetX = 0;
let userOffsetY = 0;

// 将布局基准 + 用户追加变换应用到模型
function applyTransform() {
    if (!model) return;
    const sc = window.innerHeight / model.internalModel.originalHeight;
    model.scale.set(sc * userScale);
    model.position.set(window.innerWidth * 0.5 + userOffsetX, window.innerHeight * 0.48 + userOffsetY);
}

// 光标是否落在角色身上：按 Live2D 命中的 HitAreas 判定（与双击互动同一套区域）。
// 放在这里而不是各模块内，是因为命中测试必须和画布坐标对齐，且鼠标穿透状态下
// 窗口收不到鼠标事件、渲染进程无法自行感知光标，只能由主进程推送坐标后在此判定，
// 各模块共用同一个入口避免重复实现。
window.isOverModelAt = function (x, y) {
    if (!model) return false;
    try {
        return model.hitTest(x, y).length > 0;
    } catch (e) {
        return false;
    }
};

async function loadModel(url) {
    console.log('[Pet] Loading model:', url);
    if (model) app.stage.removeChild(model);
    try {
        model = await PIXI.live2d.Live2DModel.from(url, {autoInteract: false});
        console.log('[Pet] Model loaded successfully');
    } catch (err) {
        console.error('[Pet] Live2D model load failed:', err);
        postMessage({type: 'loaded'});
        return;
    }
    app.stage.addChild(model);
    
    var updateLayout = function () {
        var s = window.innerHeight / 540;
        document.documentElement.style.setProperty('--ui-scale', s);
        applyTransform();
    };

    model.anchor.set(0.5, 0.5);
    updateLayout();
    model.interactive = true;
    window.addEventListener('resize', updateLayout);

    // ---- LipSync ---- 读取音量包络，按本机时钟驱动口型 ParamA
    try {
        var fs = require('fs');
        var os = require('os');
        var path = require('path');
        var mouthDir = path.join(os.tmpdir(), 'Alife.Client');
        var envPath = path.join(mouthDir, 'pet_mouth.bin');
        var tickPath = path.join(mouthDir, 'pet_mouth_start.txt');
        var lipEnv = null;
        var lipWinMs = 40;
        var lipStartMs = 0;
        var lipTicker = '';
        var lipDisp = 0;
        var lipSilent = 0;

        setInterval(function () {
            try {
                var t = fs.readFileSync(tickPath, 'utf8').trim();
                if (!t || t === lipTicker) return;
                lipTicker = t;
                var buf = fs.readFileSync(envPath);
                var win = buf.readInt32LE(0);
                var len = buf.readInt32LE(4);
                var arr = new Float32Array(len);
                for (var i = 0; i < len; i++) arr[i] = buf.readFloatLE(8 + i * 4);
                lipEnv = arr;
                lipWinMs = win;
                lipStartMs = parseInt(t, 10);
                lipDisp = 0;
                lipSilent = 0;
            } catch (e) {}
        }, 100);

        function lipWrite() {
            try {
                if (!lipEnv) return;
                var core = model && model.internalModel && model.internalModel.coreModel;
                if (!core) return;
                var elapsed = Date.now() - lipStartMs;
                var idx = Math.floor(elapsed / lipWinMs);
                var target = (idx >= 0 && idx < lipEnv.length) ? lipEnv[idx] : 0;
                if (target < 0) target = 0;
                if (target > 1) target = 1;

                var k;
                if (target < 0.02) {
                    // 静音（换气/停顿）：快速归零，避免嘴还在动
                    lipSilent++;
                    k = lipSilent >= 2 ? 0.55 : 0.4;
                } else {
                    lipSilent = 0;
                    k = target > lipDisp ? 0.35 : 0.28;
                }
                lipDisp += (target - lipDisp) * k;
                if (lipDisp < 0.005) lipDisp = 0;
                core.setParameterValueById('ParamA', lipDisp);
            } catch (e) {}
        }
        // 挂到模型官方的每帧更新时机，与模型刷新同节拍，避免被覆盖
        app.ticker.add(function () {
            if (!model || !model.internalModel) return;
            var im = model.internalModel;
            if (!im.__maoLipHooked) {
                im.__maoLipHooked = true;
                im.on('beforeModelUpdate', lipWrite);
                console.log('[Pet] LipSync hooked to beforeModelUpdate');
            }
        });
    } catch (e) {
        console.warn('[Pet] LipSync init failed:', e);
    }

    postMessage({type: 'loaded'});
}

// ---- 初始化完成 ----
postMessage({type: 'init'});