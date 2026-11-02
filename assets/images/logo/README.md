# BioClock 图标源文件

`assets/images/` 下的 App 图标（icon / favicon / splash / Android 自适应）全部由这里的 SVG 生成，
改图标只改 SVG，不要直接改 PNG。

| 文件 | 用途 |
| --- | --- |
| `icon.svg` | 主图标：120 网格的青绿底 + 白色水滴 + 对勾（iOS / 商店 / 参考稿） |
| `background.svg` | Android 自适应图标背景层（青绿渐变，铺满 108dp） |
| `foreground.svg` | Android 自适应图标前景层（青绿底 + 按安全区缩放的水滴） |
| `monochrome.svg` | Android 13+ 主题图标单色层（水滴剪影，对勾掏空） |
| `splash-icon.svg` | 启动图图形：水滴 + 对勾，透明底，缩到 62% 居中 |
| `preview.html` | 预览页：各尺寸 / 圆形遮罩 / 单色层 / 深色背景，双击即可看 |

## 重新生成 PNG

```bash
node tools/render-logo.mjs
```

脚本是纯 JS 实现的（无第三方依赖，只用 `node:zlib` 写 PNG），按上面的几何与配色逐像素光栅化，
每个像素做 3×3 超采样抗锯齿，输出可重复。产物：

- `icon.png` 1024×1024（方形铺满、无透明，符合 iOS / 商店要求）
- `favicon.png` 96×96（带圆角的方形）
- `splash-icon.png` 512×512（透明底）
- `android-icon-foreground.png` 1024×1024（青绿底铺满，水滴收在安全区内）
- `android-icon-monochrome.png` 1024×1024（透明底黑剪影）

`app.json` 里：

- Android 自适应图标 `backgroundColor: "#3FA89F"`（与图标中部的主色一致，各启动器的遮罩形状都不会露边），
  所以 `android-icon-background.png` 已不再被引用，留着即可。
- 启动页 `backgroundColor: "#3FA89F"`，配半透明的白色水滴对比度足够。

改完配色记得三处一起改：`icon.svg`、`app.json`、`tools/render-logo.mjs` 顶部的色值表。

## 配色

| 色值 | 用途 |
| --- | --- |
| `#5CC4B8` → `#2A8A82` | 青绿渐变底 |
| `#FFFFFF` → `#E6F6F4` | 水滴主体 |
| `#2A8A82` | 对勾 |

界面主色仍是 `src/ui/theme.ts` 里的蓝色，图标只出现在桌面/启动页/浏览器标签，两者不冲突。
