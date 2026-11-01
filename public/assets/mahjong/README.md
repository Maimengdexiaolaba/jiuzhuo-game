# 麻将牌图形素材来源

本目录下的 `1p.svg` ~ `9p.svg`（一筒~九筒）与 `1s.svg`（幺鸡 / 一索）来自开源项目：

- 项目：**mahjong_graphic — 可以随意商用的立直麻将矢量图**
- 地址：https://github.com/lietxia/mahjong_graphic
- 作者：lietxia
- 授权：M+ 字型授权条款（M+ FONT LICENSE），允许商业与非商业使用、复制、分发与修改，无担保。
- 完整授权文本见同目录 `LICENSE-mahjong_graphic.txt`

## 使用说明

- 仅取用推饼子牌组所需的 10 个牌面，已随项目一起保存，运行时不访问任何外部地址。
- 若后续新增玩法需要其它牌面（万子 `*m.svg`、字牌 `*z.svg`、花牌等），
  按同样命名从上述仓库取用并放入本目录即可。

## 替换说明

前端 `public/js/tiles.js` 通过固定路径 `/assets/mahjong/<牌名>.svg` 引用：

| 牌 | 文件 |
| --- | --- |
| 一筒 ~ 九筒 | `1p.svg` ~ `9p.svg` |
| 幺鸡 | `1s.svg` |
| 牌背 | 由 CSS 绘制，非图片 |
