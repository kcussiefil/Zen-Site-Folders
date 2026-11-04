# Zen Transparent Blur A/B Test — v0.1.1

這是一個獨立的 [Sine](https://github.com/CosmoCreeper/Sine) 實驗性 MOD，用來測試 **Zia v2.117.3 + Zen Compact Transparent Mode** 在一般網頁與 SDR/HDR 影片頁面下是否能恢復真正的側欄毛玻璃。

**v0.1.1 重要變更：移除影片排除條件。** A 和 B 會在影片可見時照常啟用，以便實際檢驗能否恢復毛玻璃，以及是否讓影片發灰。**本版本不承諾 HDR/SDR 顯色安全，只能用於測試。**

不修改 Zen-Site-Folders、Zia 或 Zen Compact Transparent Mode 原始碼；只在 macOS、Zen Compact Mode、Transparent Mode 的啟用設定為 true 時啟動測試規則。

## Sine 安裝

將下列路徑貼到 Sine 的 GitHub/URL 安裝欄位：

`kcussiefil/Zen-Site-Folders/tree/main/sine-mods/zen-blur-compat-test`

安裝後從「Zen Transparent Blur A/B Test」齒輪選取：
- **關閉（預設）**：完全不套用測試 CSS。
- **方案 A**：在 `#browser` 套用 `backdrop-filter: blur(0px)`。
- **方案 B**：在 `#zen-tabbox-wrapper` 套用 `transform: scale(1)`（展開網址列並聚焦時暫停）。

A/B 使用互斥的 Firefox preferences；一次只啟用一個。預設是 Off。

## 不重啟切換

Sine 的下拉選單會更改 Firefox preference 並呼叫 `rebuildMods(false, false)`；一般情況不用重新啟動瀏覽器。首次安裝、修改程式碼或 Sine 更新載入仍有可能需要重新啟動／檢查 MOD 更新。若切換後無反應，可以先收起再展開側欄或重新整理頁面。

## 必須測試的狀態

1. 一般網站：側欄真正模糊？移動滑鼠進 Site Folders v0.6.9 的預覽卡片，側欄與卡片是否都保持毛玻璃？
2. YouTube 主播放器可見：真正模糊？SDR/HDR 顏色、亮度是否發灰？
3. YouTube 捲到評論並顯示油猴小窗：仍有毛玻璃？HDR/SDR 顏色是否異常？
4. 暫停／切換影片、開關側欄、網址列展開時：是否有閃爍、錯位或卡頓？

**如果影片發灰、顏色異常或網頁卡頓，立即在 Sine 選「關閉」，然後再測另一方案。**
這是刻意移除 Zia 影片保護例外後的比較測試；不能當作正式 HDR-safe 修補程式。

## 來源

- [Zen Compact Transparent Mode issue #3](https://github.com/rasyidrafi/zen-compact-transparent-mode/issues/3)
- [Zen Custom URL Bar](https://github.com/rasyidrafi/zen-custom-urlbar)
- [Better Cleaned URL Bar](https://github.com/matteo-tafuro/zen-better-cleaned-url-bar)
- [Zia v2.117.3 compact CSS](https://github.com/z1n-k/zia/blob/v2.117.3/src/css/16-compact-mode.css)

已做原始碼與遠端檔案靜態檢查；尚未在使用者的 Zen 實機驗證。
