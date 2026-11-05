# Zen Transparent Blur — Local Compositor Test v0.2.0

獨立的 Sine 實驗 MOD。用來判斷 **Zia 2.117.3 + Zen Compact Transparent Mode + Zen-Site-Folders 0.6.9** 的側欄毛玻璃，可否只透過「瀏覽器介面的局部合成」恢復，且不讓 HDR 影片發灰。

**目前沒有宣稱已修正；C/D/E 為新候選，尚無 macOS Zen 實機結果。**

本 MOD **不修改** Zia、Transparent Mode、Site Folders 或其他 GitHub 專案的程式碼。只在 macOS、Zen Compact Mode，以及 Transparent Mode 已啟用時套用測試 CSS。為了能實測 HDR，**包含可見影片時仍照常啟用候選規則**。

## 安裝與升級

Sine → 從 GitHub URL 安裝：
`kcussiefil/Zen-Site-Folders/tree/main/sine-mods/zen-blur-compat-test`

若已安裝 v0.1.1，請先在 Sine **更新**這個 MOD，確認版本顯示 **v0.2.0**。然後點齒輪，從下拉選單選擇 **關閉／A／B／C／D／E**。

## 測試選項

| 選項 | CSS 主體 | 預期目的／已知結果 |
|---|---|---|
| 關閉（預設） | 不附加合成規則 | 控制組 |
| A | `#browser {backdrop-filter:blur(0px)}` | 已實測：有毛玻璃，但 HDR 發灰；保留作對照，**不建議長期使用** |
| B | `#zen-tabbox-wrapper {transform:scale(1)}` | 已實測：無效 |
| C | `#navigator-toolbox #titlebar {isolation:isolate}` | **新實驗**：只建立側欄內部堆疊環境，不直接觸碰網頁容器 |
| D | `#navigator-toolbox #titlebar {will-change:transform}` | **新實驗**：只提示浮動側欄要合成，網頁容器保持不動 |
| E | `#navigator-toolbox #titlebar::before {transform:translateZ(0)}` | **新實驗**：只處理 Transparent Mode 現有的毛玻璃背景偽元素 |

C/D/E 是**三種不同的局部層級**，互斥測試，只有其中一種會啟用。它們不增添其他 blur，也不改變 Transparent Mode 的透明度或模糊強度。

### 建議測試順序

1. 選 **關閉**，以一般網站及 HDR YouTube 建立基準。
2. 選 **C**，檢查側欄是否模糊、Site Folders 預覽滑鼠進出是否持續模糊，及 HDR 是否發灰。
3. 選回 **關閉**，讓合成層回復，再依序測 **D**、**E**。
4. 每個選項都測 YouTube 主影片、小窗、主影片捲出畫面、暫停、普通頁面及卡片預覽；特別注意卡頓、閃爍、圓角或遮罩異常。
5. 只要 HDR 發灰或畫面異常，立刻選回 **關閉**。

**重要：** 局部合成仍可能影響 Firefox 的畫面合成、效能或 HDR 顯示，不能因為不直接設定網頁容器就保證安全。此外，在 Firefox 的遠端網頁合成模型下，單靠局部側欄屬性可能無法取樣網頁背景；**C/D/E 全部無效也是合理的結果**。

## 切換與回復

Sine 的齒輪下拉選單修改偏好設定時會呼叫 `rebuildMods(false, false)`，正常情況不需重新啟動 Zen。若立即切換沒有變化，可先收合／展開側欄或重新整理影片頁；首次安裝及 MOD 更新是否需重啟，取決於當前 Sine 的實際載入行為。

此測試沒有任何 JavaScript 或外部連線。所有原始碼均可審查。

## 技術參考

- [Zia v2.117.3 CSS](https://github.com/z1n-k/zia/blob/v2.117.3/src/css/16-compact-mode.css)
- [Zen Compact Transparent Mode](https://github.com/rasyidrafi/zen-compact-transparent-mode)
- [Mozilla Bug 1799334（遠端網頁 backdrop-filter）](https://bugzilla.mozilla.org/show_bug.cgi?id=1799334)
- [MDN backdrop-filter / backdrop roots](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter)

