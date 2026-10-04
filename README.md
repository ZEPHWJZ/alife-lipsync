# Alife LipSync 真音量口型驱动

为 [Alife](https://github.com/BDFFZI/Alife) 的 Live2D 桌宠增加**基于真实语音音量**的口型同步。

## 这是什么

Alife 官方的桌宠口型（`MouthModule`）是**噪声模拟**——说话时按时间随机张合，**不跟随真实音量**，所以换气/停顿处嘴还在动，观感不够自然。

本项目改为**真音量驱动**：

1. 语音插件播放音频前，**预计算音量包络**（按 40ms 分帧的 RMS）
2. 包络写入临时文件 `%TEMP%\Alife.Client\pet_mouth.bin`
3. 前端 `pet.js` 读取包络，**按本机时钟对齐**，驱动口型参数 `ParamA`
4. 换气/停顿（音量 < 0.02）时**快速闭嘴**，避免嘴还在动

## 效果

- 嘴型与声音**逐帧对齐**
- 换气、句间停顿处**快速闭嘴**
- 支持任意模型（自动读 `model3.json` 里声明的 LipSync 参数）

## 安装

### 1. 语音插件（`Alife.Function.Speech`）

把 `src/` 里的三个文件复制到插件目录：

```
Storage/Plugins/Alife.Function.Speech/
├── MouthSyncReporter.cs      # 新增：写包络文件
├── SpeechService.cs          # 替换：播放时发布包络
└── SpeechSilenceTrimmer.cs   # 替换：含 GetEnvelope 方法
```

### 2. 桌宠前端（`Alife.Function.DeskPet`）

替换 `pet.js`：

```
Storage/Plugins/Alife.Function.DeskPet/Resources/Live2DDeskPet/pet.js
```

### 3. 关闭官方噪声口型

编辑配置（没有就新建）：

```
Storage/Configuration/Alife.Function.DeskPet.Live2DDeskPet.json
```

```json
{
  "ModelName": "Mao",
  "MouthEnabled": false
}
```

### 4. 删除旧编译产物，重启 Alife

```
Runtime/PluginContext/CompiledPlugins/Alife.Function.Speech.dll
```

删掉它，重启 Alife 会强制重新编译。

## 原理

详见 [docs/原理.md](docs/原理.md)。

## 致谢

- [Alife](https://github.com/BDFFZI/Alife) by BDFFZI
- 本项目基于 Alife 二次开发，遵循 MIT 协议

## 许可

MIT
