# MuMu 12（桥接模式）联调备忘

> 本机：Windows 10 + PowerShell 5.1，MuMu 12 实例索引 `1`。

## 1. 一次性的路径

```powershell
$adb = 'G:\Program Files\Netease\MuMu\nx_device\12.0\shell\adb.exe'
$mm  = 'G:\Program Files\Netease\MuMu\nx_main\MuMuManager.exe'
```

## 2. 连接方式（按省事程度排序）

**首选：`emulator-5556`**，MuMu 启动后 ADB 会自动出现，不用手动 connect，也不会因为桥接/NAT 变化而变：

```powershell
adb devices                 # 应该能看到 emulator-5556
$d = 'emulator-5556'
& $adb -s $d shell input tap 450 800
```

**其次：桥接模式局域网 IP**（重启实例后 IP 可能变）：

```powershell
& $mm sh -v 1 "ip -4 addr show | grep inet"   # 查 192.168.31.x
& $adb connect 192.168.31.105:5555
```

**NAT 模式**：`adb connect 127.0.0.1:16384`。

**完全不用 adb 也行**：`MuMuManager sh -v 1 "<命令>"` 能直接跑 shell（root 权限），改设置、看文件都可以。

## 3. 实例开机后 ADB 掉了怎么办

桥接模式下，重启实例后 `adb_enabled` 可能被重置为 `0`，
表现为 `adb connect 192.168.31.105:5555` 失败、`MuMuManager adb` 报 `vm not ready`。

但 `MuMuManager sh`（不走 adb，走虚拟机的串口/控制通道）一直可用：

```powershell
& $mm sh -v 1 "settings get global adb_enabled"           # 0 表示 adb 已关闭
& $mm sh -v 1 "settings put global adb_enabled 1"
& $mm sh -v 1 "setprop service.adb.tcp.port 5555"
& $mm sh -v 1 "stop adbd; start adbd"
& $mm sh -v 1 "netstat -ltn | grep :5555"                 # 确认在监听

& $adb kill-server
& $adb connect 192.168.31.105:5555
& $adb devices
```

实例的局域网 IP 用 `& $mm sh -v 1 "ip -4 addr show | grep inet"` 查
（本机桥接后是 `192.168.31.105`，重启实例后可能变）。

## 4. 启动开发服务器并连上

```powershell
npx expo start --port 8081 --localhost --clear
& $adb -s emulator-5556 reverse tcp:8081 tcp:8081   # 模拟器里的 127.0.0.1:8081 指向电脑
```

如果不想用 adb reverse，也可以让 Metro 监听 `0.0.0.0`，然后在模拟器里访问
`http://10.0.2.2:8081`（NAT 模式）或 `http://192.168.31.x:8081`（桥接模式）。
`10.0.2.2` 是安卓模拟器访问宿主机的专用地址。

模拟器里打开 Expo Go（已侧载 58.0.5），进入项目后即为开发版。

## 5. 截图与点击

只要实例里**只有一个 focusable display**（正常情况下就是 display 0），
`input tap` 和 `screencap` 不用带 `-d`：

```powershell
& $adb -s $d shell screencap -p /sdcard/s.png
& $adb -s $d pull /sdcard/s.png "$env:TEMP\s.png"
& $adb -s $d shell input tap 450 800
```

⚠️ 如果 `dumpsys window displays` 里出现多个 `mCurrentFocus=Window{...}`，
说明开启了扩展屏/多屏，App 会被放到别的 display 上，此时必须用
`input -d <id>` 和 `screencap -p -d <SurfaceFlinger id>`，
SurfaceFlinger id 从 `dumpsys SurfaceFlinger --display-id` 取。

## 6. 已知坑

- `adb root` 之后立刻 `unroot` 会把 adb 搞掉，需要按第 2 节重开。**不要用 `adb root` 读应用私有目录**。
- Expo Go（host.exp.exponent）是 `debuggable=false`，`run-as` 用不了。
- `adb shell input text` 只支持 ASCII，中文需要用输入法粘贴（或测试时用英文）。
- RN 的 `uiautomator dump` 里很多节点 bounds 是 `[0,0][0,0]`，定位请用截图坐标。
- `npx expo export --platform web` 会因为 expo-sqlite 的 wasm 资源报错，改用 `--platform android`。
- 桥接模式启动瞬间路由器可能报“ARP 攻击拦截”，是虚拟网卡广播导致的误报。

## 7. Expo Go 读文件（重要）

Expo Go 里 `expo-file-system` 会拒绝读取 DocumentPicker 复制到缓存的文件
（`Missing 'READ' permission` / `isn't readable`），因为它把非 experience 目录当成外部路径。
绕开方式：用 React Native 的 `fetch(uri)` 直接读 `file://`，见
`app/(tabs)/settings.tsx` 的 `readPickedText()`。不要再改回 `readAsStringAsync`。

另外，`.json` 文件在系统「打开方式」里不会出现 BioClock/Expo Go，这是正常的：
Expo Go 没有注册 JSON 的 intent filter。正确姿势是在 App 内点「导入数据」再选文件。