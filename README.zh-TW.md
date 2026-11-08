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
| 目前版本 | **v0.8.3**，以 [`theme.json`](theme.json) 為準 |
| 版本整理 | [`CHANGELOG.md`](CHANGELOG.md) |
| 完整各版說明 | [GitHub Releases](https://github.com/kcussiefil/Zen-Site-Folders/releases)／[`releases/`](releases/) |
| macOS 實機驗收 | [`docs/macOS-acceptance.md`](docs/macOS-acceptance.md) |
| 發布規範 | [`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md) |

**單純整理文件不需要升版，也不會自行觸發 Sine 更新。**
