# Zen Site Folders

**將相同網站的 Zen 分頁整理成一般分頁區域內的精簡群組，不會自動釘選到上方。**

[English](README.md) · [最新正式版](https://github.com/kcussiefil/Zen-Site-Folders/releases/latest) · [更新紀錄](CHANGELOG.md)

Zen Site Folders 是適用於 Zen Browser 的 Sine MOD。使用者按下整理按鈕後，將符合條件的一般分頁依網站分組，並提供接近 Zia 風格的群組預覽卡片。

## 主要功能

- **手動一鍵整理：** 同網站至少有兩個符合條件的分頁才會建立新群組；單一分頁可加入既有的對應群組。
- **精簡預覽卡片：** 顯示群組中的分頁、可確認的開啟時間與 Zia 風格的音量指示。
- **原生操作感：** 群組展開／收合、拖曳閃避、位置提示與邊緣自動捲動。
- **保留分頁：** 整理與復原使用本機快照及分頁群組介面，不會為了整理而主動關閉或重新載入分頁。
- **獨立分頁排序：** 明確按下整理時才調整符合條件的獨立網頁分頁；無可靠開啟時間的舊分頁採保守排序。
- **剩餘單頁自動解散：** 關閉群組成員後只剩一頁時，可自動解散此 MOD 所建立的群組；手動拖出分頁不觸發此行為。

- **背景分頁拖曳：** 未選取或已卸載的分頁可直接拖曳排序，不先切換或喚醒；一般點擊仍會切換。可在 Sine 偏好設定單獨關閉（預設開啟）；Split View 沿用 Zen 原生行為。

## 安裝

1. 安裝 Zen Browser、[Sine](https://github.com/CosmoCreeper/Sine) 與 [Zia](https://github.com/z1n-k/zia)，目前預覽樣式以 **Zia 2.118** 為相容基準。
2. 在 Sine 依需要開啟外部來源 JavaScript MOD 安裝權限。
3. 使用儲存庫名稱 `kcussiefil/Zen-Site-Folders` 安裝。
4. 完整重啟 Zen，再使用側欄分隔線左側的整理按鈕；有有效快照時可使用相鄰的復原控制。

首次整理重要分頁前，請先備份 Zen Profile。若同時安裝會管理一般分頁群組的 MOD，請先確認是否互相衝突。

## 相容性與限制

- 整理的是**一般分頁群組**，不是釘選在上方的 Zen 原生資料夾，也不會自動將群組轉換為原生資料夾。
- 預覽卡片依循 **Zia 2.118** 的影片頁面狀態：關閉 *Blur over video* 時，卡片可能有透明感但不模糊，屬保護影片合成的設計。
- 開啟 *Blur over video* 後，卡片顯示時可能套用模糊；影片可能變暗或影響 HDR，仍需於自己的螢幕驗收。
- 無法可靠取得時間的歷史分頁，不會偽造開啟時間。
- 自動化測試不代表已涵蓋每一組 macOS、Zen、Zia、顯示器與其他 MOD 的實際視覺表現。

## 文件

| 項目 | 連結 |
| --- | --- |
| 目前版本 | **v1.0.2**，以 [`theme.json`](theme.json) 為準 |
| 版本整理 | [`CHANGELOG.md`](CHANGELOG.md) |
| 完整各版說明 | [GitHub Releases](https://github.com/kcussiefil/Zen-Site-Folders/releases)／[`releases/`](releases/) |
| macOS 實機驗收 | [`docs/macOS-acceptance.md`](docs/macOS-acceptance.md) |
| 發布規範 | [`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md) |

**單純整理文件不需要升版，也不會自行觸發 Sine 更新。**

選取分頁顏色、原生右鍵選項及調色視窗已交由 [HDR Guard](https://github.com/kcussiefil/Zen-Compact-Transparent-HDR-Guard) v0.4.5 獨立管理。背景分頁拖曳預設內建，不再提供 Sine 開關；必要時可透過 `about:config` 設定 `zen.sitefolders.background_drag.enabled=false` 停用。

**v1.0.2** 依照 Yab 開源實作改為原生分頁內的「新群組」預覽：拖至目標分頁後，約 180ms 顯示網站 favicon 與「新群組」，水平進度從左往右填滿 500ms，完成後改成資料夾圖示，放開才建立原生群組。不再出現 v1.0.1 的環形進度或另一層半透明浮動卡片。建群位置固定在目標分頁，成員順序固定為「目標在前、拖入分頁在後」，避免放開時讀取已被 Zia 改動的分頁排序；完全不更動 Zen 原生拖曳動畫的全域設定。Gecko 支援時拖曳影像只顯示 favicon，否則保留 Zen 原生影像。

**v1.0.1** 完整移除手動群組顏色功能與既有顏色紀錄，讓手動群組與自動群組一致。拖曳合併採用參考 Yab 開源程式的「鎖定目標、環形進度、完成後放開建立」流程：120ms 顯示目標網站 favicon，再以 420ms 完成環形進度；拖曳期間即使 Zia 位移其他分頁，目標仍維持固定。移除半透明合併卡片，並在建立原生群組前清理殘留的拖曳位移，避免第一幀錯位。

**v1.0.0** 讓手動建立的普通群組完整沿用 Site Folders／Zia 的透明外觀、收合動畫、群組預覽與拖曳規則。兩分頁合併命中區放大到中央 80%，預覽等待縮短為 95ms，邊緣仍保留原生拖曳排序。手動群組右鍵可選九種 Firefox 原生群組顏色，以低調的標題色條呈現；不變更自動網站群組，重啟後保留手動群組及選色。

**v0.9.9** 新增建立未釘選普通群組：將獨立分頁拖曳到另一個獨立分頁中央，短暫停留顯示預覽後放開；或以 `Command` 多選分頁，再從右鍵選擇「建立普通群組」。同網站使用網站名稱及 favicon；跨網站預設「新群組」與資料夾圖示。群組右鍵可重新命名、更換圖示、解散；不受自動依網站整理影響。若需停用拖曳建立，可在 `about:config` 設 `zen.sitefolders.manual_group_drag.enabled=false`，右鍵建立仍可使用。

**v0.9.8** 修正 Sine 更新偵測：同步更新 `theme.json` 的 `updatedAt`；不修改執行時的 JS／CSS。

**v0.9.7** 修正從收合群組預覽卡片進入分頁後，相關背景連結錯誤插入群組底部；群組 favicon 改採 Zia 的原生未載入圖示亮度，不再以父層透明度比例推算。

**v0.9.6** 讓網站群組標題的 favicon 亮度跟隨 Zia 未載入分頁圖示：全組未載入才黯淡，任一分頁載入就恢復正常；隨 Zia 設定即時切換，不新增 JS 觀察器或修改排版、動畫。

**v0.9.4** 增加事件式背景拖曳修復：進入 Zen 設定或 Sine 重新載入後，若背景拖曳模組消失，於切換分頁、視窗取得焦點或按下分頁時重新載入；不使用輪詢，也不更動 v0.9.2 已驗證的拖曳處理。瀏覽器主控台可檢查 `window.__zsfBackgroundDragRecoveryV094?.debug()`。
