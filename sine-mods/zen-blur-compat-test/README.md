# Zen Transparent Blur A/B Test — v0.1.0

獨立、實驗性的 [Sine](https://github.com/CosmoCreeper/Sine) MOD，用於測試 **Zen Compact Transparent Mode** 在 **Zia v2.117.3** 下「透明正常，但網頁背景不模糊」的狀況。

**不會修改 Zen-Site-Folders、Zia 或 Zen Compact Transparent Mode 的原始程式碼。**
此 MOD 只在 macOS、Zen Compact Mode、原 Transparent Mode 啟用，而且所選分頁沒有 Zia 偵測到的可見影片時生效。

## 從 Sine 安裝

1. 打開 Zen 的 Sine 管理頁面。
2. 選擇從 GitHub 儲存庫／URL 安裝，輸入：
   `kcussiefil/Zen-Site-Folders/tree/main/sine-mods/zen-blur-compat-test`
3. 安裝後，打開 **Zen Transparent Blur A/B Test** 的齒輪設定。
4. 「毛玻璃合成修復測試」下拉選單：**關閉（預設）／方案 A／方案 B**。
5. **先測 A，再測 B。** 下拉選單只能選一種，避免同時啟用。

## 方案與原理

- **關閉**（預設）：不附加任何 CSS 合成規則，方便原始狀態對照。
- **A**：`#browser { backdrop-filter: blur(0px) !important; }`，根據其他 Zen 毛玻璃案例設計。不是直接加強側欄模糊，而是嘗試恢復 CSS 合成環境。
- **B**：`#zen-tabbox-wrapper { transform: scale(1) !important; }`，摘自 rasyidrafi 的 Zen Custom URL Bar，可能讓某些背景模糊效果恢復，但也可能影響排版或影片合成路徑。

MOD 不改變目前 Transparent Mode 設定的模糊強度與透明比例。

## 切換是否需要重新啟動？

**通常不用。** Sine 的下拉選單會更新 Firefox preference，並觸發 CSS MOD 重新套用；如果視覺未立即更新，可先收合／再展開側欄或重新整理頁面。首次安裝時是否需要重新啟動，取決於 Sine 版本與載入狀態，無法保證完全不需要。

## 影片保護與限制

Zia 2.117.3 會在選取分頁可見影片元素上標記 `browser[zia-video]`。此 MOD 於該標記存在時停止額外合成 CSS。但 Zia 偵測是非同步的，對油猴小窗也可能持續判定影片可見，**不能保證 HDR／SDR 不發灰**。

測試時請依序檢查：
1. 一般無影片頁面，側欄是否真正模糊。
2. 滑鼠從側欄移到 Site Folders v0.6.9 預覽卡片，兩者模糊是否保留。
3. SDR/HDR 影片播放、暫停、畫面內外、小窗時的顯色及模糊。
4. 是否有視窗位移、卡頓與動畫異常。

只要出現影片發灰或位置異常，立即選回 **關閉** 或在 Sine 停用 MOD。

## 來源

- [Zen Compact Transparent Mode issue #3](https://github.com/rasyidrafi/zen-compact-transparent-mode/issues/3)
- [Zen Custom URL Bar](https://github.com/rasyidrafi/zen-custom-urlbar)
- [Better Cleaned URL Bar](https://github.com/matteo-tafuro/zen-better-cleaned-url-bar)
- [Zia v2.117.3 compact CSS](https://github.com/z1n-k/zia/blob/v2.117.3/src/css/16-compact-mode.css)

**測試狀態：** 完成 CSS/JSON 靜態檢查；尚未在使用者的 macOS Zen 實機確認是否恢復模糊。不同 MOD／Zen 版本可能有差異。
