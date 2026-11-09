# Dan Frame

[打开网页](https://zhsm27.github.io/dan-frame/)

把 osu!mania 4K 段位字形放到图片正中央，调整大小和后处理，再导出原尺寸 PNG。可打开、拖放或粘贴图片。网页默认关闭后处理，选择预设后可切换「底图」或「全图」。图片和导入谱面在浏览器内处理。

「＋」接受透明图片及受支持的 `.osz` / `.zip`。导入原谱包后，匹配的封面版本会进入对应字符的字样列表，并保存在当前浏览器。包含未改动原图的 ZIP 也可以导入。

## 字形来源

| 字形 | 来源 |
| --- | --- |
| 1–10，α–ζ | DDMythical 的 [4K Dan Reform](https://osu.ppy.sh/community/forums/topics/597350)。[Emik 存档](https://sites.google.com/view/danreform/home)提供 V1 第 1–3 包、V2 第 1 包和 V2 Speed 包。封面抠图保留原始像素，边缘可能带少量底图。 |
| 在线谱面封面 | [第 1 包](https://osu.ppy.sh/beatmapsets/1079991)、[第 2 包](https://osu.ppy.sh/beatmapsets/1079998)、[Speed](https://osu.ppy.sh/beatmapsets/2320002)及 [Thaumiel Final](https://osu.ppy.sh/beatmapsets/1156299)的公开谱面文件。运行时从 [osu.direct](https://osu.direct/) 读取封面所需的字节范围。 |
| α–κ 独立字标 | [DanOverlay 署名的 icyilc 版本](https://danoverlay.pages.dev/)。部分源图自带错位效果。 |
| 社区剪影 | [一个小影龙分享的抠图](https://www.bilibili.com/opus/1013445216228605957)。 |
| θ、ι、κ 原版 | CloverWisp 在[谱面说明](https://osu.ppy.sh/beatmapsets/2297014)中公开的[未处理字标](https://drive.google.com/drive/folders/1wxZ8IL7yMx3CLJoTeT36QqQAMJqfpAVq)。原图保留其阴影与渐变。 |
| ε 清晰修复 | 参照 V1 封面描线并取样渐变，重建清晰的矢量轮廓。 |

色散预设将红通道向右上偏移，蓝通道向左下偏移。辉光、颗粒、暗角、柔焦、错行及对比可单独调节。

## 本地运行

用现代浏览器打开 `index.html`，或在仓库目录运行 `python -m http.server 8947` 后访问 [本地网页](http://localhost:8947/)。在线字形需要访问各上游资源站点。

应用代码使用 [MIT](LICENSE)。外部谱面、封面及字标归原作者所有，网页按需从原来源或公开谱面镜像读取。
