// 把 assets/images/logo/icon.svg（青绿底 + 水滴对勾）光栅化为 App 图标需要的 PNG。
// 纯 JS 实现（无第三方依赖），每个像素做 3×3 超采样抗锯齿，输出可重复。
// 用法：node tools/render-logo.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assetsDir = join(root, 'assets/images')

// ---------- 颜色（与 icon.svg 一致） ----------
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]
const WHITE = hex('#FFFFFF')
const DROP_BOTTOM = hex('#E6F6F4')
const BG_A = hex('#5CC4B8')
const BG_B = hex('#2A8A82')

// 设计稿是 120×120 的坐标
const S = 120
const CENTER = S / 2

const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const over = (dst, src, a) => [
  dst[0] + (src[0] - dst[0]) * a,
  dst[1] + (src[1] - dst[1]) * a,
  dst[2] + (src[2] - dst[2]) * a,
]

// ---------- 几何（全部用设计稿坐标） ----------
/** 水滴：顶点 (60,17)，两侧用贝塞尔收到圆心 (60,71) 的 30 半径圆上。 */
const DROP_TOP = { x: 60, y: 17 }
const DROP_C = { x: 60, y: 71 }
const DROP_R = 30
const DROP_CTRL = { x: 30, y: 51 } // 对应 SVG 里的 C 控制点
const DROP_END = { x: DROP_C.x - DROP_R, y: DROP_C.y }

function quad(p0, p1, p2, t) {
  const u = 1 - t
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y }
}

function inDrop(x, y) {
  if ((x - DROP_C.x) ** 2 + (y - DROP_C.y) ** 2 <= DROP_R * DROP_R) return true
  if (y < DROP_TOP.y || y > DROP_C.y) return false
  // 在轮廓上找纵坐标等于 y 的点，比较半宽（左右对称）
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (quad(DROP_TOP, DROP_CTRL, DROP_END, mid).y < y) lo = mid
    else hi = mid
  }
  const e = quad(DROP_TOP, DROP_CTRL, DROP_END, (lo + hi) / 2)
  return Math.abs(x - DROP_TOP.x) <= Math.abs(e.x - DROP_TOP.x)
}

/** 对勾：两段折线，圆头端点（等价于 stroke-linecap: round）。 */
const CHECK = [
  { a: { x: 47, y: 71 }, b: { x: 56, y: 80 } },
  { a: { x: 56, y: 80 }, b: { x: 74, y: 61 } },
]
const CHECK_W = 8

function distToSegment(p, { a, b }) {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const wx = p.x - a.x
  const wy = p.y - a.y
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
}

const onCheck = (x, y) => CHECK.some((seg) => distToSegment({ x, y }, seg) <= CHECK_W / 2)

// ---------- 逐像素上色 ----------
/** 完整图标（含青绿底）。iOS / 商店图标不允许圆角和透明，按方形铺满。 */
function shadeIcon(x, y) {
  // 青绿渐变底（左上亮 → 右下深）
  let out = lerp3(BG_A, BG_B, Math.min(1, Math.max(0, (x / S) * 0.5 + (y / S) * 0.5)))

  // 装饰圆压小了一点，放大到桌面尺寸时不抢图形
  if ((x - 92) ** 2 + (y - 26) ** 2 <= 12.6 * 12.6) out = over(out, WHITE, 0.18)
  if ((x - 24) ** 2 + (y - 100) ** 2 <= 9 * 9) out = over(out, WHITE, 0.12)

  if (!inDrop(x, y)) return out

  // 水滴本体：白 → #E6F6F4
  out = lerp3(WHITE, DROP_BOTTOM, Math.min(1, Math.max(0, (y - 17) / 84)))

  // 高光椭圆（rotate 20°）
  const a = (20 * Math.PI) / 180
  const hx = (x - 50) * Math.cos(a) + (y - 61) * Math.sin(a)
  const hy = -(x - 50) * Math.sin(a) + (y - 61) * Math.cos(a)
  if ((hx / 5) ** 2 + (hy / 9) ** 2 <= 1) out = over(out, WHITE, 0.7)

  if (onCheck(x, y)) out = BG_B
  return out
}

/** favicon：浏览器显示方形，套上 design 稿里的 38 圆角。 */
function shadeFavicon(x, y) {
  const r = 38
  const cx = Math.max(r, Math.min(x, S - r))
  const cy = Math.max(r, Math.min(y, S - r))
  const inside =
    (x >= r && x <= S - r) ||
    (y >= r && y <= S - r) ||
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  return inside ? shadeIcon(x, y) : null
}

/** 单色层：水滴剪影（对勾掏空成负形），Android 13+ 主题图标用。 */
function shadeMonochrome(x, y) {
  if (!inDrop(x, y)) return null
  return onCheck(x, y) ? null : [0, 0, 0]
}

/** 启动图：只要水滴 + 对勾，透明底，缩到约 62% 居中。 */
function shadeSplash(x, y) {
  const dx = (x - CENTER) / 0.62 + CENTER
  const dy = (y - CENTER) / 0.62 + CENTER
  if (!inDrop(dx, dy)) return null
  const out = lerp3(WHITE, DROP_BOTTOM, Math.min(1, Math.max(0, (dy - 17) / 84)))
  return onCheck(dx, dy) ? BG_B : out
}

/** Android 自适应图标：青绿铺满背景，水滴按 0.8 缩放（圆形遮罩下刚好留边）。 */
function shadeAdaptive(x, y) {
  const gx = (x / S) * 108
  const gy = (y / S) * 108
  let out = lerp3(BG_A, BG_B, Math.min(1, Math.max(0, (gx / 108) * 0.5 + (gy / 108) * 0.5)))
  const dx = (gx - 54) / 0.8 + CENTER
  const dy = (gy - 54) / 0.8 + CENTER
  if (!inDrop(dx, dy)) return out
  out = lerp3(WHITE, DROP_BOTTOM, Math.min(1, Math.max(0, (dy - 17) / 84)))
  return onCheck(dx, dy) ? BG_B : out
}

const SS = 3 // 每个输出像素 3×3 采样

/** 返回 RGBA 浮点缓冲；shade 返回 null 表示透明。 */
function render(size, shade) {
  const out = new Float32Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ((x + (sx + 0.5) / SS) / size) * S
          const py = ((y + (sy + 0.5) / SS) / size) * S
          const c = shade(px, py)
          if (!c) continue
          r += c[0]
          g += c[1]
          b += c[2]
          a += 1
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      if (a > 0) {
        out[i] = r / a
        out[i + 1] = g / a
        out[i + 2] = b / a
      }
      out[i + 3] = (a / n) * 255
    }
  }
  return out
}

// ---------- PNG 编码 ----------
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < width * 4; x++) {
      raw[rowStart + 1 + x] = Math.max(0, Math.min(255, Math.round(rgba[y * width * 4 + x])))
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const targets = [
  { out: 'icon.png', size: 1024, shade: shadeIcon },
  { out: 'favicon.png', size: 96, shade: shadeFavicon },
  { out: 'splash-icon.png', size: 512, shade: shadeSplash },
  { out: 'android-icon-foreground.png', size: 1024, shade: shadeAdaptive },
  { out: 'android-icon-monochrome.png', size: 1024, shade: shadeMonochrome },
]

mkdirSync(assetsDir, { recursive: true })
for (const t of targets) {
  const started = Date.now()
  const rgba = render(t.size, t.shade)
  const png = encodePng(t.size, t.size, rgba)
  writeFileSync(join(assetsDir, t.out), png)
  console.log(`${t.out} ${t.size}x${t.size} ${(png.length / 1024).toFixed(0)}KB ${Date.now() - started}ms`)
}
