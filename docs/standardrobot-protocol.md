# StandardRobot++ 协议适配

在线版地址、源码仓库和项目出处见 [README](../README.md)。

## 使用

1. 用桌面 Chrome / Edge 打开在线版，将设备连接到当前电脑，点击「连接设备」并授权串口。
2. 设置与设备一致的波特率等参数，接收协议选择「StandardRobot++ 协议」。
3. IMU 姿态、三个欧拉角和三个角速度在上方面板显示，可切换度/弧度；其下的九组运行信息分别显示机器人信息、比赛状态、事件、PID、运动、HP、位置、机器人状态和关节状态。
4. 绘图来源仅为「自定义调试数据」。在图框上方展开「选择通道」，按设备发送的字段名称勾选曲线，支持英文和中文名称。收到新字段后自动加入，已取消的勾选会保留。
5. 采样周期、显示时长、FFT 参数位于图框齿轮设置中。批量发送时，建议填写设备真实的采样周期 Δt。操作细节见 [时域与频域说明](waveform.md)。
6. REC 录制原始字节，结束后可回放和导出；回放与实时接收使用同一套解码器。

## 协议格式

整帧为：`0x5A + 载荷长度 UInt8 + 数据 ID UInt8 + CRC8 + 载荷 + CRC16 LE`。

- 载荷长度包含开头的 4 字节设备时间戳 UInt32 LE；整帧长度为载荷长度加 6。
- CRC8 覆盖前 3 字节，初值 `0xFF`，反射多项式 `0x8C`。
- CRC16 覆盖除末尾 CRC16 外的整帧，初值 `0xFFFF`，反射多项式 `0x8408`，无最终异或。
- 多字节数值均为小端。设备时间戳按原始值显示，不推断时间单位。
- IMU（`0x02`）：时间戳后为 6 个 Float32，依次为 yaw、pitch、roll、yaw_vel、pitch_vel、roll_vel，原始单位 rad / rad/s。
- 自定义调试包（`0x01`）：时间戳后重复数据项，每项为 **10 字节 UTF-8 名称（零填充）+ 1 字节类型 + 4 字节数值**；类型 `0` 表示 UInt32，`1` 表示 Float32。名称按 UTF-8 字节计长，不应截断中文字符。

解码器支持半包、粘包和校验错误后的帧头恢复。错误类型、无效 UTF-8、非有限浮点值和错误载荷不进入图表。未收到数据的面板显示等待，不使用虚构零值。

## 浏览器验证

```powershell
npm install --no-save --no-package-lock playwright
node tools/test-robot-protocol.cjs
node tools/test-waveform.cjs
node tools/sync-agent-prompt.mjs --check
```

Windows 默认使用已安装的 Chrome；可设置 `CHROME_PATH` 指定浏览器。Playwright 安装在其他位置时，用 `PLAYWRIGHT_MODULE` 指定模块目录。测试页面从内存中提供调试接口，正式网页不包含测试接口。

固定测试帧位于 `tests/fixtures/standardrobot.json`。已覆盖分帧、CRC、中文名称、九类运行信息、自定义通道勾选、录制回放、FFT 和桌面/手机布局。实际串口与采样频率需要连接硬件确认。
